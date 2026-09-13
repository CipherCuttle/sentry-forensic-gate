import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { FORWARD_OUTCOMES_R1 } from './outcome/forwardTypes.js';
import { ViemForwardOutcomeSource } from './outcome/viemSource.js';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from './sentry/contracts.js';
import {
  deriveBaselineAuthorityDigest,
  type ExecutableBaselineBatch
} from './shadow/baselineTypes.js';

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

try {
  const readSnapshot = db.transaction(() => {
    const checkpoint = db.prepare(`
      SELECT block_number, block_hash, reorg_guard_block, reorg_guard_hash
      FROM chain_checkpoints WHERE chain_id = ?
    `).get(INK_CHAIN_ID) as CheckpointRow | undefined;

    const launchCount = scalarCount('SELECT COUNT(*) AS count FROM launches WHERE chain_id = ?', INK_CHAIN_ID);
    const provenanceFactCount = scalarCount('SELECT COUNT(*) AS count FROM provenance_facts WHERE chain_id = ?', INK_CHAIN_ID);
    const provenanceEdgeCount = scalarCount('SELECT COUNT(*) AS count FROM provenance_edges WHERE chain_id = ?', INK_CHAIN_ID);
    const baselineRows = db.prepare(`
      SELECT baseline_id, status, authority_digest, payload_json
      FROM baseline_batches
      ORDER BY CAST(decision_block AS INTEGER), launch_id
    `).all() as BaselineRow[];
    const outcomeRows = db.prepare(`
      SELECT horizon_ms, payload_json FROM outcomes WHERE policy_version = ? ORDER BY horizon_ms, outcome_id
    `).all(FORWARD_OUTCOMES_R1) as Array<{ horizon_ms: number; payload_json: string }>;

    return {
      checkpoint,
      launchCount,
      provenanceFactCount,
      provenanceEdgeCount,
      baselineRows,
      outcomeRows
    };
  });

  // All ledger reads are captured under one SQLite read transaction so this
  // receipt cannot combine rows from different committed runtime states.
  const snapshot = readSnapshot();

  const baselineCounts: Record<string, number> = {};
  let baselineAuthorityDigestsVerified = 0;
  for (const row of snapshot.baselineRows) {
    baselineCounts[row.status] = (baselineCounts[row.status] ?? 0) + 1;
    const batch = reviveBaselineBatch(row.payload_json);
    if (
      batch.baselineId !== row.baseline_id ||
      batch.status !== row.status ||
      batch.authorityDigest !== row.authority_digest
    ) {
      throw new Error(`ACTIVATION_BASELINE_ROW_MISMATCH:${row.baseline_id}`);
    }
    const { authorityDigest: _storedPayloadDigest, ...withoutDigest } = batch;
    const recomputed = await deriveBaselineAuthorityDigest(withoutDigest);
    if (recomputed !== row.authority_digest) {
      throw new Error(`ACTIVATION_BASELINE_DIGEST_MISMATCH:${row.baseline_id}`);
    }
    baselineAuthorityDigestsVerified += 1;
  }

  const outcomeCounts: Record<string, { total: number; complete: number; unverified: number; classifications: Record<string, number> }> = {};
  for (const row of snapshot.outcomeRows) {
    const key = String(row.horizon_ms);
    const bucket = outcomeCounts[key] ??= { total: 0, complete: 0, unverified: 0, classifications: {} };
    const payload = JSON.parse(row.payload_json) as { status?: string; classification?: string };
    bucket.total += 1;
    if (payload.status === 'COMPLETE') bucket.complete += 1;
    else bucket.unverified += 1;
    if (payload.classification) {
      bucket.classifications[payload.classification] = (bucket.classifications[payload.classification] ?? 0) + 1;
    }
  }

  const source = new ViemForwardOutcomeSource({ rpcUrl: process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL });
  const chainHead = await source.getHeadBlockNumber();
  let checkpointCanonical: boolean | null = null;
  if (snapshot.checkpoint) {
    const point = await source.getBlockPoint(BigInt(snapshot.checkpoint.block_number));
    checkpointCanonical = point.blockHash.toLowerCase() === snapshot.checkpoint.block_hash.toLowerCase();
  }

  console.log(JSON.stringify(jsonSafe({
    receiptVersion: 'RESEARCH_RUNTIME_ACTIVATION_R1',
    deployedCommit: process.env.RENDER_GIT_COMMIT ?? null,
    serviceId: process.env.RENDER_SERVICE_ID ?? null,
    gitBranch: process.env.RENDER_GIT_BRANCH ?? null,
    dbPath,
    shadowOnly: process.env.SHADOW_ONLY === 'true',
    sentryStartBlock: process.env.SENTRY_START_BLOCK ?? null,
    chainHead,
    checkpoint: snapshot.checkpoint ? {
      blockNumber: snapshot.checkpoint.block_number,
      blockHash: snapshot.checkpoint.block_hash,
      guardBlockNumber: snapshot.checkpoint.reorg_guard_block,
      guardBlockHash: snapshot.checkpoint.reorg_guard_hash,
      canonicalNow: checkpointCanonical
    } : null,
    launchCount: snapshot.launchCount,
    provenanceFactCount: snapshot.provenanceFactCount,
    provenanceEdgeCount: snapshot.provenanceEdgeCount,
    baselines: baselineCounts,
    baselineAuthorityDigestsVerified,
    outcomes: outcomeCounts
  })));
} finally {
  db.close();
}

function scalarCount(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { count: number };
  return Number(row.count);
}

function reviveBaselineBatch(json: string): ExecutableBaselineBatch {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const value = reviveDeepBigInts(raw, new Set([
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
  ]));
  return value as ExecutableBaselineBatch;
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

type CheckpointRow = {
  block_number: string;
  block_hash: string;
  reorg_guard_block: string | null;
  reorg_guard_hash: string | null;
};

type BaselineRow = {
  baseline_id: string;
  status: ExecutableBaselineBatch['status'];
  authority_digest: string;
  payload_json: string;
};
