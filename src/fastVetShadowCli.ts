import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import type { OutcomeReceipt } from './evidence/receipts.js';
import {
  CREATOR_OUTCOME_HORIZON_MS,
  projectCreatorOutcomeFeatures,
  type CreatorOutcomeFeatureReceipt
} from './forensic/creatorOutcome.js';
import type { ProvenanceFact } from './graph/provenance.js';
import { evaluateFastVetShadow, type FastVetShadowRow } from './evaluation/fastVetShadow.js';
import { FORWARD_OUTCOMES_R1, type ForwardOutcomeReceipt } from './outcome/forwardTypes.js';
import { INK_CHAIN_ID } from './sentry/contracts.js';
import type { BaselineDecisionPoint } from './shadow/baselineStore.js';
import type { ExecutableBaselineBatch } from './shadow/baselineTypes.js';

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

try {
  const baselineBatches = readBaselines(db);
  const facts = readFacts(db);
  const outcomes = readOutcomes(db);

  const factLaunchIds = new Set(facts.map((fact) => fact.launchId));
  const decisionPoints = baselineBatches.map(toDecisionPoint);
  const featureInputs = decisionPoints.filter((baseline) => factLaunchIds.has(baseline.launchId));
  const features = await projectCreatorOutcomeFeatures(featureInputs, facts, outcomes);
  const featureByLaunch = uniqueFeatureMap(features);
  const targetByLaunch = uniqueTargetMap(outcomes);

  const rows: FastVetShadowRow[] = baselineBatches.map((baseline) => ({
    launchId: baseline.launchId,
    baseline,
    creatorFeature: featureByLaunch.get(baseline.launchId) ?? null,
    targetOutcome: targetByLaunch.get(baseline.launchId) ?? null
  }));

  const receipt = await evaluateFastVetShadow(rows);
  console.log(JSON.stringify(jsonSafe({
    ...receipt,
    source: {
      dbPath,
      chainId: INK_CHAIN_ID,
      baselineCount: baselineBatches.length,
      provenanceFactCount: facts.length,
      canonical24hOutcomeCount: outcomes.length,
      note: 'READ_ONLY_LOCAL_LEDGER_SMOKE_NO_CHAIN_REFETCH'
    }
  })));
} finally {
  db.close();
}

function readBaselines(db: Database.Database): ExecutableBaselineBatch[] {
  const rows = db.prepare(`
    SELECT b.payload_json
    FROM baseline_batches b
    JOIN launches l ON l.launch_id = b.launch_id
    WHERE l.chain_id = ?
    ORDER BY CAST(b.decision_block AS INTEGER), b.launch_id
  `).all(INK_CHAIN_ID) as Array<{ payload_json: string }>;
  return rows.map((row) => reviveBaselineBatch(row.payload_json));
}

function readFacts(db: Database.Database): ProvenanceFact[] {
  const rows = db.prepare(`
    SELECT payload_json
    FROM provenance_facts
    WHERE chain_id = ?
    ORDER BY CAST(observed_block AS INTEGER), log_index, fact_id
  `).all(INK_CHAIN_ID) as Array<{ payload_json: string }>;
  return rows.map((row) => reviveProvenanceFact(row.payload_json));
}

function readOutcomes(db: Database.Database): ForwardOutcomeReceipt[] {
  const rows = db.prepare(`
    SELECT payload_json
    FROM outcomes
    WHERE policy_version = ? AND horizon_ms = ?
    ORDER BY CAST(observed_block AS INTEGER), outcome_id
  `).all(FORWARD_OUTCOMES_R1, CREATOR_OUTCOME_HORIZON_MS) as Array<{ payload_json: string }>;

  return rows
    .map((row) => reviveOutcome(row.payload_json))
    .filter((outcome): outcome is ForwardOutcomeReceipt => outcome.policyVersion === FORWARD_OUTCOMES_R1);
}

function toDecisionPoint(batch: ExecutableBaselineBatch): BaselineDecisionPoint {
  return {
    baselineId: batch.baselineId,
    authorityDigest: batch.authorityDigest,
    launchId: batch.launchId,
    decisionBlock: batch.decisionBlock,
    decisionBlockHash: batch.decisionBlockHash,
    status: batch.status
  };
}

function uniqueFeatureMap(features: readonly CreatorOutcomeFeatureReceipt[]): Map<string, CreatorOutcomeFeatureReceipt> {
  const map = new Map<string, CreatorOutcomeFeatureReceipt>();
  for (const feature of features) {
    if (map.has(feature.launchId)) throw new Error(`FAST_VET_SHADOW_DUPLICATE_FEATURE:${feature.launchId}`);
    map.set(feature.launchId, feature);
  }
  return map;
}

function uniqueTargetMap(outcomes: readonly ForwardOutcomeReceipt[]): Map<string, ForwardOutcomeReceipt> {
  const map = new Map<string, ForwardOutcomeReceipt>();
  for (const outcome of outcomes) {
    if (map.has(outcome.launchId)) throw new Error(`FAST_VET_SHADOW_DUPLICATE_24H_TARGET:${outcome.launchId}`);
    map.set(outcome.launchId, outcome);
  }
  return map;
}

function reviveProvenanceFact(json: string): ProvenanceFact {
  const value = JSON.parse(json) as Omit<ProvenanceFact, 'observedBlock'> & { observedBlock: string };
  return { ...value, observedBlock: BigInt(value.observedBlock) };
}

function reviveOutcome(json: string): OutcomeReceipt {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return reviveDeepBigInts(raw, new Set([
    'observedBlock',
    'executableValueUsdMicros',
    'liquidityUsdMicros',
    'entryNotionalUsdMicros',
    'entryTokenAmount',
    'baseAmountOut',
    'executableReturnBps',
    'poolActiveLiquidity'
  ])) as unknown as OutcomeReceipt;
}

function reviveBaselineBatch(json: string): ExecutableBaselineBatch {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return reviveDeepBigInts(raw, new Set([
    'decisionBlock',
    'positionLiquidity',
    'activeLiquidity',
    'sqrtPriceX96Before',
    'notionalUsdMicros',
    'baseAmount',
    'blockNumber',
    'amountIn',
    'amountOut',
    'sqrtPriceX96After',
    'gasEstimate',
    'independentReverseRecoveryBps'
  ])) as unknown as ExecutableBaselineBatch;
}

function reviveDeepBigInts(value: unknown, bigintKeys: ReadonlySet<string>, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveDeepBigInts(item, bigintKeys));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
      childKey,
      reviveDeepBigInts(child, bigintKeys, childKey)
    ]));
  }
  if (key && bigintKeys.has(key) && typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return value;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
