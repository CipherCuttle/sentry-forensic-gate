import type { Hex } from '../domain.js';
import type { Store } from '../db/store.js';
import type { OutcomeReceipt } from '../evidence/receipts.js';
import { projectCreatorOutcomeFeatures } from '../forensic/creatorOutcome.js';
import type { ProvenanceFact } from '../graph/provenance.js';
import {
  CREATOR_SIGNAL_CONFIRMATIONS,
  CREATOR_SIGNAL_HORIZON_MS,
  evaluateCreatorSignal,
  type CreatorSignalComparableRow,
  type CreatorSignalEvaluationReceipt,
  type MatureLaunchEvidence
} from '../evaluation/creatorSignal.js';
import { FORWARD_OUTCOMES_R1, type ForwardOutcomeReceipt } from '../outcome/forwardTypes.js';
import type { ForwardOutcomeSource, OutcomeBlockPoint } from '../outcome/ports.js';
import { INK_CHAIN_ID } from '../sentry/contracts.js';
import type { BaselineDecisionPoint, BaselineStore } from '../shadow/baselineStore.js';

export type CreatorSignalSource = Pick<ForwardOutcomeSource, 'getHeadBlockNumber' | 'getBlockPoint'>;
export type CreatorSignalStore = Pick<
  Store & BaselineStore,
  'listProvenanceFacts' | 'listOutcomes' | 'listBaselineDecisionPoints'
>;

export async function buildCreatorSignalEvaluation(
  source: CreatorSignalSource,
  store: CreatorSignalStore
): Promise<CreatorSignalEvaluationReceipt> {
  const headBlock = await source.getHeadBlockNumber();
  if (headBlock < CREATOR_SIGNAL_CONFIRMATIONS) {
    throw new Error(`CREATOR_SIGNAL_HEAD_BELOW_CONFIRMATIONS:${headBlock}`);
  }
  const asOfBlock = headBlock - CREATOR_SIGNAL_CONFIRMATIONS;
  const asOfStart = await source.getBlockPoint(asOfBlock);

  const [factsRaw, baselinesRaw, outcomesRaw] = await Promise.all([
    store.listProvenanceFacts(),
    store.listBaselineDecisionPoints(),
    store.listOutcomes()
  ]);
  const facts = [...factsRaw].sort(compareFacts);
  for (const fact of facts) {
    if (fact.chainId !== INK_CHAIN_ID) throw new Error(`CREATOR_SIGNAL_CHAIN_MISMATCH:${fact.factId}`);
  }
  const baselines = [...baselinesRaw].sort(compareBaselines);
  const baselineByLaunch = uniqueBaselineMap(baselines);

  const r1Outcomes = outcomesRaw
    .filter((outcome): outcome is ForwardOutcomeReceipt => isCanonicalR1Outcome(outcome))
    .filter((outcome) => outcome.horizonMs === CREATOR_SIGNAL_HORIZON_MS && outcome.observedBlock <= asOfBlock)
    .sort(compareOutcomes);
  const outcomeById = uniqueOutcomeIdMap(r1Outcomes);
  const targetByLaunch = uniqueTargetMap(r1Outcomes);

  // Recompute creator-history features from canonical R1 outcomes only. Legacy
  // outcome fixtures never acquire evaluation authority through this path.
  const features = await projectCreatorOutcomeFeatures(baselines, facts, r1Outcomes);
  const featureByLaunch = new Map(features.map((feature) => [feature.launchId, feature]));

  const matureLaunches: MatureLaunchEvidence[] = [];
  const matureFactByLaunch = new Map<string, ProvenanceFact>();

  for (const fact of facts) {
    if (fact.observedBlock > asOfBlock) continue;
    const point = await source.getBlockPoint(fact.observedBlock);
    assertHash('CREATOR_SIGNAL_FACT_REORG', fact.observedBlock, fact.observedBlockHash, point.blockHash);
    if (point.timestampMs + CREATOR_SIGNAL_HORIZON_MS > asOfStart.timestampMs) continue;

    matureFactByLaunch.set(fact.launchId, fact);
    const baseline = baselineByLaunch.get(fact.launchId) ?? null;
    if (baseline) {
      if (baseline.decisionBlock > asOfBlock) {
        throw new Error(`CREATOR_SIGNAL_BASELINE_AFTER_ASOF:${fact.launchId}`);
      }
      const decisionPoint = await source.getBlockPoint(baseline.decisionBlock);
      assertHash('CREATOR_SIGNAL_BASELINE_REORG', baseline.decisionBlock, baseline.decisionBlockHash, decisionPoint.blockHash);
    }
    matureLaunches.push({
      launchId: fact.launchId,
      factId: fact.factId,
      factEvidenceDigest: fact.evidenceDigest,
      baselineId: baseline?.baselineId ?? null,
      baselineAuthorityDigest: baseline?.authorityDigest ?? null,
      baselineStatus: baseline?.status ?? null
    });
  }

  const rows: CreatorSignalComparableRow[] = [];
  const referencedOutcomeIds = new Set<string>();
  for (const mature of matureLaunches) {
    if (mature.baselineStatus !== 'COMPLETE' || !mature.baselineId || !mature.baselineAuthorityDigest) continue;
    const feature = featureByLaunch.get(mature.launchId);
    if (!feature) throw new Error(`CREATOR_SIGNAL_FEATURE_MISSING:${mature.launchId}`);
    if (feature.baselineId !== mature.baselineId) throw new Error(`CREATOR_SIGNAL_FEATURE_BASELINE_MISMATCH:${mature.launchId}`);

    const targetOutcome = targetByLaunch.get(mature.launchId) ?? null;
    if (targetOutcome && targetOutcome.baselineId !== mature.baselineId) {
      throw new Error(`CREATOR_SIGNAL_TARGET_BASELINE_MISMATCH:${mature.launchId}`);
    }
    if (targetOutcome) referencedOutcomeIds.add(targetOutcome.outcomeId);
    feature.sourceOutcomeIds.forEach((outcomeId) => referencedOutcomeIds.add(outcomeId));

    rows.push({
      launchId: mature.launchId,
      baselineId: mature.baselineId,
      baselineAuthorityDigest: mature.baselineAuthorityDigest,
      feature,
      targetOutcome
    });
  }

  // Every R1 outcome that can influence a target or creator-history feature is
  // hash-checked against the canonical chain before evaluation.
  for (const outcomeId of [...referencedOutcomeIds].sort()) {
    const outcome = outcomeById.get(outcomeId);
    if (!outcome) throw new Error(`CREATOR_SIGNAL_SOURCE_OUTCOME_MISSING:${outcomeId}`);
    if (outcome.observedBlock > asOfBlock) throw new Error(`CREATOR_SIGNAL_OUTCOME_AFTER_ASOF:${outcomeId}`);
    const point = await source.getBlockPoint(outcome.observedBlock);
    assertHash('CREATOR_SIGNAL_OUTCOME_REORG', outcome.observedBlock, outcome.observedBlockHash, point.blockHash);
  }

  // Final as-of block read is the last RPC operation. Any suffix reorg that
  // affected facts, baseline decisions, or outcome evidence during the read
  // window necessarily changes this anchor and invalidates the evaluation.
  const asOfEnd = await source.getBlockPoint(asOfBlock);
  assertHash('CREATOR_SIGNAL_ASOF_REORG', asOfBlock, asOfStart.blockHash, asOfEnd.blockHash);

  return evaluateCreatorSignal({
    chainId: INK_CHAIN_ID,
    asOfBlock,
    asOfBlockHash: asOfStart.blockHash,
    asOfTimestampMs: asOfStart.timestampMs,
    confirmations: CREATOR_SIGNAL_CONFIRMATIONS,
    matureLaunches,
    rows
  });
}

function isCanonicalR1Outcome(outcome: OutcomeReceipt): outcome is ForwardOutcomeReceipt {
  return outcome.policyVersion === FORWARD_OUTCOMES_R1 &&
    typeof outcome.observedBlockHash === 'string' &&
    typeof outcome.baselineId === 'string' &&
    typeof outcome.evidenceDigest === 'string' &&
    (outcome.status === 'COMPLETE' || outcome.status === 'UNVERIFIED') &&
    typeof outcome.targetTimestampMs === 'number' &&
    typeof outcome.observedTimestampMs === 'number' &&
    typeof outcome.entryNotionalUsdMicros === 'bigint' &&
    typeof outcome.entryTokenAmount === 'bigint' &&
    typeof outcome.marketPool === 'string' &&
    typeof outcome.marketFee === 'number' &&
    typeof outcome.baseToken === 'string' &&
    typeof outcome.baseAmountOut === 'bigint' &&
    typeof outcome.poolActiveLiquidity === 'bigint';
}

function uniqueBaselineMap(baselines: readonly BaselineDecisionPoint[]): Map<string, BaselineDecisionPoint> {
  const map = new Map<string, BaselineDecisionPoint>();
  for (const baseline of baselines) {
    if (map.has(baseline.launchId)) throw new Error(`CREATOR_SIGNAL_DUPLICATE_BASELINE:${baseline.launchId}`);
    map.set(baseline.launchId, baseline);
  }
  return map;
}

function uniqueOutcomeIdMap(outcomes: readonly ForwardOutcomeReceipt[]): Map<string, ForwardOutcomeReceipt> {
  const map = new Map<string, ForwardOutcomeReceipt>();
  for (const outcome of outcomes) {
    if (map.has(outcome.outcomeId)) throw new Error(`CREATOR_SIGNAL_DUPLICATE_OUTCOME_ID:${outcome.outcomeId}`);
    map.set(outcome.outcomeId, outcome);
  }
  return map;
}

function uniqueTargetMap(outcomes: readonly ForwardOutcomeReceipt[]): Map<string, ForwardOutcomeReceipt> {
  const map = new Map<string, ForwardOutcomeReceipt>();
  for (const outcome of outcomes) {
    const existing = map.get(outcome.launchId);
    if (existing) throw new Error(`CREATOR_SIGNAL_DUPLICATE_TARGET:${outcome.launchId}`);
    map.set(outcome.launchId, outcome);
  }
  return map;
}

function assertHash(label: string, blockNumber: bigint, expected: Hex, actual: Hex): void {
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(`${label}:block=${blockNumber}:expected=${expected}:actual=${actual}`);
  }
}

function compareFacts(a: ProvenanceFact, b: ProvenanceFact): number {
  if (a.observedBlock !== b.observedBlock) return a.observedBlock < b.observedBlock ? -1 : 1;
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.factId.localeCompare(b.factId);
}

function compareBaselines(a: BaselineDecisionPoint, b: BaselineDecisionPoint): number {
  if (a.decisionBlock !== b.decisionBlock) return a.decisionBlock < b.decisionBlock ? -1 : 1;
  return a.launchId.localeCompare(b.launchId);
}

function compareOutcomes(a: ForwardOutcomeReceipt, b: ForwardOutcomeReceipt): number {
  if (a.observedBlock !== b.observedBlock) return a.observedBlock < b.observedBlock ? -1 : 1;
  return a.outcomeId.localeCompare(b.outcomeId);
}
