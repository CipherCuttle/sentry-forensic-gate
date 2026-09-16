import Database from 'better-sqlite3';
import { getAddress, type Hex } from 'viem';
import {
  assertCanaryApprovalCalldata,
  CANARY_E0_APPROVAL_R0,
  deriveCanaryApprovalActionId,
  type CanaryApprovalIntent
} from './approval.js';
import { deriveCanaryExitActionId } from './roundTrip.js';
import { deriveCanaryActionId, type CanarySwapIntent } from './swapIntent.js';

export type CanaryApprovalState = 'RESERVED' | 'SIGNED' | 'SUBMITTED' | 'INCLUDED' | 'REVERTED' | 'SAFE_HALT';
export type CanaryApprovalInsertResult = 'INSERTED' | 'DUPLICATE';

export interface CanaryApprovalActionRecord {
  actionId: string;
  parentBuyActionId: string;
  parentExitActionId: string;
  launchId: string;
  baselineId: string;
  state: CanaryApprovalState;
  intent: CanaryApprovalIntent;
  observedAllowanceBefore: bigint;
  observedAllowanceAfter: bigint | null;
  nonce: number | null;
  transactionHash: Hex | null;
  serializedTransaction: Hex | null;
  lastError: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export class CanaryApprovalStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canary_approval_actions (
        action_id TEXT PRIMARY KEY,
        parent_buy_action_id TEXT NOT NULL UNIQUE,
        parent_exit_action_id TEXT NOT NULL UNIQUE,
        launch_id TEXT NOT NULL UNIQUE,
        baseline_id TEXT NOT NULL,
        state TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        observed_allowance_before TEXT NOT NULL,
        observed_allowance_after TEXT,
        nonce INTEGER,
        transaction_hash TEXT UNIQUE,
        serialized_transaction TEXT,
        last_error TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        FOREIGN KEY(parent_buy_action_id) REFERENCES canary_actions(action_id)
      );
      CREATE INDEX IF NOT EXISTS idx_canary_approval_actions_state ON canary_approval_actions(state);
    `);
  }

  close(): void { this.db.close(); }

  async insertReserved(record: CanaryApprovalActionRecord): Promise<CanaryApprovalInsertResult> {
    if (record.state !== 'RESERVED') throw new Error(`CANARY_APPROVAL_INITIAL_STATE_INVALID:${record.state}`);
    if (record.observedAllowanceBefore !== 0n) throw new Error(`CANARY_APPROVAL_DIRTY_ALLOWANCE:${record.observedAllowanceBefore}`);
    this.assertRecordIntentIdentity(record);
    assertCanaryApprovalCalldata(record.intent);

    const expectedExitActionId = await deriveCanaryExitActionId({
      parentBuyActionId: record.parentBuyActionId,
      launchId: record.launchId,
      baselineId: record.baselineId
    });
    if (record.parentExitActionId !== expectedExitActionId) throw new Error('CANARY_APPROVAL_PARENT_EXIT_IDENTITY_DRIFT');
    const expectedActionId = await deriveCanaryApprovalActionId({
      parentBuyActionId: record.parentBuyActionId,
      parentExitActionId: record.parentExitActionId,
      launchId: record.launchId,
      baselineId: record.baselineId,
      token: record.intent.token,
      spender: record.intent.spender,
      amount: record.intent.amount
    });
    if (record.actionId !== expectedActionId) throw new Error('CANARY_APPROVAL_ACTION_IDENTITY_DRIFT');

    const transaction = this.db.transaction(() => {
      const parent = this.db.prepare(`
        SELECT action_id, launch_id, baseline_id, state, intent_json, output_balance_before, output_balance_after
        FROM canary_actions
        WHERE action_id = ?
      `).get(record.parentBuyActionId) as ParentBuyRow | undefined;
      if (!parent) throw new Error(`CANARY_APPROVAL_PARENT_BUY_MISSING:${record.parentBuyActionId}`);
      if (parent.state !== 'INCLUDED') throw new Error(`CANARY_APPROVAL_PARENT_BUY_NOT_INCLUDED:${parent.state}`);
      if (parent.launch_id !== record.launchId || parent.baseline_id !== record.baselineId) {
        throw new Error('CANARY_APPROVAL_PARENT_BUY_IDENTITY_MISMATCH');
      }
      if (!parent.intent_json) throw new Error('CANARY_APPROVAL_PARENT_BUY_INTENT_MISSING');
      if (parent.output_balance_before === null || parent.output_balance_after === null) {
        throw new Error('CANARY_APPROVAL_PARENT_BALANCE_EVIDENCE_MISSING');
      }
      const acquired = BigInt(parent.output_balance_after) - BigInt(parent.output_balance_before);
      if (acquired <= 0n) throw new Error(`CANARY_APPROVAL_PARENT_ACQUIRED_BALANCE_INVALID:${acquired}`);
      if (record.intent.amount !== acquired) {
        throw new Error(`CANARY_APPROVAL_AMOUNT_MUST_EQUAL_ACQUIRED:${record.intent.amount}:${acquired}`);
      }

      const parentIntent = reviveBuyIntent(parent.intent_json);
      const expectedBuyActionId = deriveBuyActionIdSyncGuard(parentIntent, parent.action_id);
      if (!expectedBuyActionId) throw new Error('CANARY_APPROVAL_PERSISTED_PARENT_IDENTITY_INVALID');
      if (
        getAddress(record.intent.token) !== getAddress(parentIntent.tokenOut) ||
        getAddress(record.intent.spender) !== getAddress(parentIntent.router)
      ) {
        throw new Error('CANARY_APPROVAL_PERSISTED_PARENT_INTENT_BINDING_MISMATCH');
      }

      const result = this.db.prepare(`
        INSERT OR IGNORE INTO canary_approval_actions (
          action_id, parent_buy_action_id, parent_exit_action_id, launch_id, baseline_id,
          state, intent_json, observed_allowance_before, observed_allowance_after,
          nonce, transaction_hash, serialized_transaction, last_error, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.actionId, record.parentBuyActionId, record.parentExitActionId, record.launchId, record.baselineId,
        record.state, jsonSafeStringify(record.intent), record.observedAllowanceBefore.toString(),
        record.observedAllowanceAfter?.toString() ?? null, record.nonce, record.transactionHash,
        record.serializedTransaction, record.lastError, record.createdAtMs, record.updatedAtMs
      );
      if (result.changes === 1) return 'INSERTED' as const;

      const existing = this.db.prepare(`
        SELECT action_id, parent_buy_action_id, parent_exit_action_id, launch_id, baseline_id
        FROM canary_approval_actions
        WHERE action_id = ? OR parent_buy_action_id = ? OR parent_exit_action_id = ? OR launch_id = ?
        LIMIT 1
      `).get(record.actionId, record.parentBuyActionId, record.parentExitActionId, record.launchId) as ExistingApprovalRow | undefined;
      if (
        existing &&
        existing.action_id === record.actionId &&
        existing.parent_buy_action_id === record.parentBuyActionId &&
        existing.parent_exit_action_id === record.parentExitActionId &&
        existing.launch_id === record.launchId &&
        existing.baseline_id === record.baselineId
      ) return 'DUPLICATE' as const;
      throw new Error(`CANARY_APPROVAL_IDENTITY_CONFLICT:${record.launchId}`);
    });

    return transaction();
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
    const row = this.db.prepare('SELECT state FROM canary_approval_actions WHERE action_id = ?').get(actionId) as { state: CanaryApprovalState } | undefined;
    if (!row) throw new Error(`CANARY_APPROVAL_ACTION_MISSING:${actionId}`);
    if (!['RESERVED', 'SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) {
      throw new Error(`CANARY_APPROVAL_SAFE_HALT_INVALID_STATE:${row.state}`);
    }
    this.db.prepare('UPDATE canary_approval_actions SET state = ?, last_error = ?, updated_at_ms = ? WHERE action_id = ?')
      .run('SAFE_HALT', error.slice(0, 512), Date.now(), actionId);
  }

  markIncluded(actionId: string, observedAllowanceAfter: bigint): void {
    const row = this.db.prepare('SELECT state, intent_json FROM canary_approval_actions WHERE action_id = ?').get(actionId) as { state: CanaryApprovalState; intent_json: string } | undefined;
    if (!row || !['SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) {
      throw new Error(`CANARY_APPROVAL_INCLUDED_INVALID_STATE:${row?.state ?? 'MISSING'}`);
    }
    const intent = reviveApprovalIntent(row.intent_json);
    if (observedAllowanceAfter !== intent.amount) {
      throw new Error(`CANARY_APPROVAL_POST_ALLOWANCE_NOT_EXACT:${observedAllowanceAfter}:${intent.amount}`);
    }
    this.db.prepare('UPDATE canary_approval_actions SET state = ?, observed_allowance_after = ?, updated_at_ms = ? WHERE action_id = ?')
      .run('INCLUDED', observedAllowanceAfter.toString(), Date.now(), actionId);
  }

  markReverted(actionId: string): void {
    const row = this.db.prepare('SELECT state FROM canary_approval_actions WHERE action_id = ?').get(actionId) as { state: CanaryApprovalState } | undefined;
    if (!row || !['SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) {
      throw new Error(`CANARY_APPROVAL_REVERTED_INVALID_STATE:${row?.state ?? 'MISSING'}`);
    }
    this.db.prepare('UPDATE canary_approval_actions SET state = ?, updated_at_ms = ? WHERE action_id = ?')
      .run('REVERTED', Date.now(), actionId);
  }

  listUnresolved(): CanaryApprovalActionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM canary_approval_actions
      WHERE state IN ('RESERVED', 'SIGNED', 'SUBMITTED', 'SAFE_HALT')
      ORDER BY created_at_ms, action_id
    `).all() as ApprovalRow[];
    return rows.map(fromRow);
  }

  private assertRecordIntentIdentity(record: CanaryApprovalActionRecord): void {
    if (record.intent.version !== CANARY_E0_APPROVAL_R0) throw new Error('CANARY_APPROVAL_VERSION_INVALID');
    if (record.intent.actionId !== record.actionId) throw new Error('CANARY_APPROVAL_INTENT_ACTION_ID_MISMATCH');
    if (record.intent.parentBuyActionId !== record.parentBuyActionId) throw new Error('CANARY_APPROVAL_PARENT_BUY_ID_MISMATCH');
    if (record.intent.parentExitActionId !== record.parentExitActionId) throw new Error('CANARY_APPROVAL_PARENT_EXIT_ID_MISMATCH');
    if (record.intent.launchId !== record.launchId || record.intent.baselineId !== record.baselineId) {
      throw new Error('CANARY_APPROVAL_INTENT_IDENTITY_MISMATCH');
    }
  }

  private transition(actionId: string, expected: CanaryApprovalState, next: CanaryApprovalState, patch: Record<string, unknown>): void {
    const allowedColumns = new Set(['nonce', 'transaction_hash', 'serialized_transaction']);
    for (const key of Object.keys(patch)) if (!allowedColumns.has(key)) throw new Error(`CANARY_APPROVAL_PATCH_COLUMN_FORBIDDEN:${key}`);
    const entries = Object.entries(patch);
    const assignments = entries.map(([key]) => `${key} = ?`);
    assignments.push('state = ?', 'updated_at_ms = ?');
    const values = entries.map(([, value]) => value);
    values.push(next, Date.now(), actionId, expected);
    const result = this.db.prepare(`UPDATE canary_approval_actions SET ${assignments.join(', ')} WHERE action_id = ? AND state = ?`).run(...values);
    if (result.changes !== 1) throw new Error(`CANARY_APPROVAL_STATE_TRANSITION_FAILED:${actionId}:${expected}:${next}`);
  }
}

type ParentBuyRow = {
  action_id: string;
  launch_id: string;
  baseline_id: string;
  state: string;
  intent_json: string | null;
  output_balance_before: string | null;
  output_balance_after: string | null;
};

type ExistingApprovalRow = {
  action_id: string;
  parent_buy_action_id: string;
  parent_exit_action_id: string;
  launch_id: string;
  baseline_id: string;
};

type ApprovalRow = ExistingApprovalRow & {
  state: CanaryApprovalState;
  intent_json: string;
  observed_allowance_before: string;
  observed_allowance_after: string | null;
  nonce: number | null;
  transaction_hash: Hex | null;
  serialized_transaction: Hex | null;
  last_error: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function fromRow(row: ApprovalRow): CanaryApprovalActionRecord {
  return {
    actionId: row.action_id,
    parentBuyActionId: row.parent_buy_action_id,
    parentExitActionId: row.parent_exit_action_id,
    launchId: row.launch_id,
    baselineId: row.baseline_id,
    state: row.state,
    intent: reviveApprovalIntent(row.intent_json),
    observedAllowanceBefore: BigInt(row.observed_allowance_before),
    observedAllowanceAfter: row.observed_allowance_after === null ? null : BigInt(row.observed_allowance_after),
    nonce: row.nonce,
    transactionHash: row.transaction_hash,
    serializedTransaction: row.serialized_transaction,
    lastError: row.last_error,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  };
}

function reviveBuyIntent(json: string): CanarySwapIntent {
  return reviveBigInts(JSON.parse(json) as Record<string, unknown>) as unknown as CanarySwapIntent;
}

function reviveApprovalIntent(json: string): CanaryApprovalIntent {
  return reviveBigInts(JSON.parse(json) as Record<string, unknown>) as unknown as CanaryApprovalIntent;
}

function reviveBigInts(raw: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['quoteBlockNumber', 'notionalUsdMicros', 'amountIn', 'quotedAmountOut', 'amountOutMinimum', 'deadlineEpochSeconds', 'value', 'amount']) {
    if (typeof raw[key] === 'string' && /^\d+$/.test(raw[key] as string)) raw[key] = BigInt(raw[key] as string);
  }
  return raw;
}

function deriveBuyActionIdSyncGuard(intent: CanarySwapIntent, persistedActionId: string): boolean {
  // The deterministic buy ID depends only on launch+baseline. The async hash is
  // validated before approval construction; here the persisted key must still
  // match the intent's own immutable action ID and identity fields.
  return Boolean(intent.actionId && intent.actionId === persistedActionId && intent.launchId && intent.baselineId);
}

function jsonSafeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
}
