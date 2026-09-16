import Database from 'better-sqlite3';
import type { Hex } from '../domain.js';
import type { ExecutableBaselineBatch } from '../shadow/baselineTypes.js';
import type { CanaryActionRecord, CanaryActionState } from './types.js';

export type CanaryInsertResult = 'INSERTED' | 'DUPLICATE' | 'BUY_LIMIT';

export class CanaryStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canary_actions (
        action_id TEXT PRIMARY KEY,
        launch_id TEXT NOT NULL UNIQUE,
        baseline_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        state TEXT NOT NULL,
        origin_decision_block TEXT NOT NULL,
        origin_decision_block_hash TEXT NOT NULL,
        intent_json TEXT,
        nonce INTEGER,
        transaction_hash TEXT UNIQUE,
        serialized_transaction TEXT,
        last_error TEXT,
        output_balance_before TEXT,
        output_balance_after TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_canary_actions_state ON canary_actions(state);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_canary_single_committed_buy
        ON canary_actions(decision)
        WHERE decision = 'PASS' AND state <> 'SKIPPED';
    `);
  }

  close(): void { this.db.close(); }

  listPendingBaselines(minDecisionBlock: bigint, limit: number): ExecutableBaselineBatch[] {
    if (minDecisionBlock < 0n) throw new Error('CANARY_MIN_DECISION_BLOCK_INVALID');
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('CANARY_CANDIDATE_LIMIT_INVALID');
    const rows = this.db.prepare(`
      SELECT b.payload_json
      FROM baseline_batches b
      LEFT JOIN canary_actions a ON a.launch_id = b.launch_id
      WHERE b.status = 'COMPLETE'
        AND a.action_id IS NULL
        AND CAST(b.decision_block AS INTEGER) >= CAST(? AS INTEGER)
      ORDER BY CAST(b.decision_block AS INTEGER), b.launch_id
      LIMIT ?
    `).all(minDecisionBlock.toString(), limit) as Array<{ payload_json: string }>;
    return rows.map((row) => reviveBaselineBatch(row.payload_json));
  }

  countCommittedBuys(): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM canary_actions
      WHERE decision = 'PASS' AND state <> 'SKIPPED'
    `).get() as { count: number };
    return row.count;
  }

  getAction(actionId: string): CanaryActionRecord | null {
    const row = this.db.prepare('SELECT * FROM canary_actions WHERE action_id = ?').get(actionId) as CanaryActionRow | undefined;
    return row ? fromActionRow(row) : null;
  }

  listUnresolvedActions(): CanaryActionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM canary_actions
      WHERE state IN ('RESERVED', 'SIGNED', 'SUBMITTED', 'SAFE_HALT')
      ORDER BY created_at_ms, action_id
    `).all() as CanaryActionRow[];
    return rows.map(fromActionRow);
  }

  insert(record: CanaryActionRecord): CanaryInsertResult {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO canary_actions (
        action_id, launch_id, baseline_id, decision, reasons_json, state,
        origin_decision_block, origin_decision_block_hash, intent_json,
        nonce, transaction_hash, serialized_transaction, last_error,
        output_balance_before, output_balance_after, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.actionId, record.launchId, record.baselineId, record.decision,
      JSON.stringify(record.reasons), record.state, record.originDecisionBlock.toString(),
      record.originDecisionBlockHash.toLowerCase(), record.intent ? jsonSafeStringify(record.intent) : null,
      record.nonce, record.transactionHash, record.serializedTransaction, record.lastError,
      record.outputBalanceBefore?.toString() ?? null, record.outputBalanceAfter?.toString() ?? null,
      record.createdAtMs, record.updatedAtMs
    );
    if (result.changes === 1) return 'INSERTED';

    const existing = this.db.prepare('SELECT action_id, baseline_id FROM canary_actions WHERE action_id = ? OR launch_id = ? LIMIT 1')
      .get(record.actionId, record.launchId) as { action_id: string; baseline_id: string } | undefined;
    if (existing) {
      if (existing.action_id === record.actionId && existing.baseline_id === record.baselineId) return 'DUPLICATE';
      throw new Error(`CANARY_ACTION_IDENTITY_CONFLICT:${record.launchId}`);
    }

    if (record.decision === 'PASS' && record.state !== 'SKIPPED' && this.countCommittedBuys() >= 1) {
      return 'BUY_LIMIT';
    }
    throw new Error(`CANARY_ACTION_INSERT_REJECTED:${record.launchId}`);
  }

  markSigned(actionId: string, params: { nonce: number; transactionHash: Hex; serializedTransaction: Hex }): void {
    this.transition(actionId, 'RESERVED', 'SIGNED', {
      nonce: params.nonce,
      transaction_hash: params.transactionHash.toLowerCase(),
      serialized_transaction: params.serializedTransaction
    });
  }

  markSubmitted(actionId: string): void {
    this.transition(actionId, 'SIGNED', 'SUBMITTED', {});
  }

  markSafeHalt(actionId: string, error: string): void {
    const row = this.db.prepare('SELECT state FROM canary_actions WHERE action_id = ?').get(actionId) as { state: CanaryActionState } | undefined;
    if (!row) throw new Error(`CANARY_ACTION_MISSING:${actionId}`);
    if (!['RESERVED', 'SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) throw new Error(`CANARY_SAFE_HALT_INVALID_STATE:${row.state}`);
    this.db.prepare('UPDATE canary_actions SET state = ?, last_error = ?, updated_at_ms = ? WHERE action_id = ?')
      .run('SAFE_HALT', error.slice(0, 512), Date.now(), actionId);
  }

  markIncluded(actionId: string, outputBalanceAfter: bigint): void {
    const row = this.db.prepare('SELECT state FROM canary_actions WHERE action_id = ?').get(actionId) as { state: CanaryActionState } | undefined;
    if (!row || !['SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) throw new Error(`CANARY_INCLUDED_INVALID_STATE:${row?.state ?? 'MISSING'}`);
    this.db.prepare('UPDATE canary_actions SET state = ?, output_balance_after = ?, updated_at_ms = ? WHERE action_id = ?')
      .run('INCLUDED', outputBalanceAfter.toString(), Date.now(), actionId);
  }

  markReverted(actionId: string): void {
    const row = this.db.prepare('SELECT state FROM canary_actions WHERE action_id = ?').get(actionId) as { state: CanaryActionState } | undefined;
    if (!row || !['SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) throw new Error(`CANARY_REVERTED_INVALID_STATE:${row?.state ?? 'MISSING'}`);
    this.db.prepare('UPDATE canary_actions SET state = ?, updated_at_ms = ? WHERE action_id = ?')
      .run('REVERTED', Date.now(), actionId);
  }

  private transition(actionId: string, expected: CanaryActionState, next: CanaryActionState, patch: Record<string, unknown>): void {
    const allowedColumns = new Set(['nonce', 'transaction_hash', 'serialized_transaction']);
    for (const key of Object.keys(patch)) if (!allowedColumns.has(key)) throw new Error(`CANARY_PATCH_COLUMN_FORBIDDEN:${key}`);
    const entries = Object.entries(patch);
    const assignments = entries.map(([key]) => `${key} = ?`);
    assignments.push('state = ?', 'updated_at_ms = ?');
    const values = entries.map(([, value]) => value);
    values.push(next, Date.now(), actionId, expected);
    const result = this.db.prepare(`UPDATE canary_actions SET ${assignments.join(', ')} WHERE action_id = ? AND state = ?`).run(...values);
    if (result.changes !== 1) throw new Error(`CANARY_STATE_TRANSITION_FAILED:${actionId}:${expected}:${next}`);
  }
}

type CanaryActionRow = {
  action_id: string; launch_id: string; baseline_id: string; decision: CanaryActionRecord['decision'];
  reasons_json: string; state: CanaryActionState; origin_decision_block: string; origin_decision_block_hash: Hex;
  intent_json: string | null; nonce: number | null; transaction_hash: Hex | null; serialized_transaction: Hex | null;
  last_error: string | null; output_balance_before: string | null; output_balance_after: string | null;
  created_at_ms: number; updated_at_ms: number;
};

function fromActionRow(row: CanaryActionRow): CanaryActionRecord {
  return {
    actionId: row.action_id,
    launchId: row.launch_id,
    baselineId: row.baseline_id,
    decision: row.decision,
    reasons: JSON.parse(row.reasons_json) as string[],
    state: row.state,
    originDecisionBlock: BigInt(row.origin_decision_block),
    originDecisionBlockHash: row.origin_decision_block_hash,
    intent: row.intent_json ? reviveIntent(row.intent_json) : null,
    nonce: row.nonce,
    transactionHash: row.transaction_hash,
    serializedTransaction: row.serialized_transaction,
    lastError: row.last_error,
    outputBalanceBefore: row.output_balance_before === null ? null : BigInt(row.output_balance_before),
    outputBalanceAfter: row.output_balance_after === null ? null : BigInt(row.output_balance_after),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function reviveIntent(json: string): CanaryActionRecord['intent'] {
  const raw = JSON.parse(json) as Record<string, unknown>;
  for (const key of ['quoteBlockNumber', 'notionalUsdMicros', 'amountIn', 'quotedAmountOut', 'amountOutMinimum', 'deadlineEpochSeconds', 'value']) {
    if (typeof raw[key] === 'string' && /^\d+$/.test(raw[key] as string)) raw[key] = BigInt(raw[key] as string);
  }
  return raw as unknown as NonNullable<CanaryActionRecord['intent']>;
}

function reviveBaselineBatch(json: string): ExecutableBaselineBatch {
  const raw = JSON.parse(json) as unknown;
  return reviveDeepBigInts(raw, new Set([
    'decisionBlock', 'positionLiquidity', 'activeLiquidity', 'sqrtPriceX96Before',
    'notionalUsdMicros', 'baseAmount', 'blockNumber', 'amountIn', 'amountOut',
    'sqrtPriceX96After', 'gasEstimate', 'independentReverseRecoveryBps'
  ])) as ExecutableBaselineBatch;
}

function reviveDeepBigInts(value: unknown, bigintKeys: ReadonlySet<string>, key?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => reviveDeepBigInts(item, bigintKeys));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, reviveDeepBigInts(child, bigintKeys, childKey)]));
  }
  if (key && bigintKeys.has(key) && typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return value;
}

function jsonSafeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
}
