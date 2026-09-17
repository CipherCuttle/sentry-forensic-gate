import Database from 'better-sqlite3';
import { keccak256 } from 'viem';
import type { Hex } from '../domain.js';
import { assertCanaryEntryApprovalCalldata, deriveCanaryEntryApprovalActionId, type CanaryEntryApprovalIntent } from './entryApproval.js';
import { deriveCanaryActionId } from './swapIntent.js';
import type { CanaryActionState } from './types.js';

export type CanaryEntryApprovalInsertResult = 'INSERTED' | 'DUPLICATE' | 'ENTRY_SLOT_TAKEN';

export interface CanaryEntryApprovalActionRecord {
  actionId: string;
  parentBuyActionId: string;
  launchId: string;
  baselineId: string;
  state: CanaryActionState;
  intent: CanaryEntryApprovalIntent;
  observedAllowanceBefore: bigint;
  observedAllowanceAfter: bigint | null;
  nonce: number | null;
  transactionHash: Hex | null;
  serializedTransaction: Hex | null;
  lastError: string | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export class CanaryEntryApprovalStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canary_entry_approval_actions (
        action_id TEXT PRIMARY KEY,
        singleton_key INTEGER NOT NULL UNIQUE CHECK(singleton_key = 1),
        parent_buy_action_id TEXT NOT NULL UNIQUE,
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
        updated_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_canary_entry_approval_state ON canary_entry_approval_actions(state);
    `);
  }

  close(): void { this.db.close(); }

  async insertReserved(record: CanaryEntryApprovalActionRecord): Promise<CanaryEntryApprovalInsertResult> {
    if (record.state !== 'RESERVED') throw new Error(`CANARY_ENTRY_APPROVAL_INITIAL_STATE_INVALID:${record.state}`);
    if (record.observedAllowanceBefore !== 0n) throw new Error(`CANARY_ENTRY_APPROVAL_DIRTY_ALLOWANCE:${record.observedAllowanceBefore}`);
    await this.assertRecordIdentity(record);
    assertCanaryEntryApprovalCalldata(record.intent);

    const result = this.db.prepare(`
      INSERT OR IGNORE INTO canary_entry_approval_actions (
        action_id, singleton_key, parent_buy_action_id, launch_id, baseline_id, state, intent_json,
        observed_allowance_before, observed_allowance_after, nonce, transaction_hash,
        serialized_transaction, last_error, created_at_ms, updated_at_ms
      ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.actionId,
      record.parentBuyActionId,
      record.launchId,
      record.baselineId,
      record.state,
      jsonSafeStringify(record.intent),
      record.observedAllowanceBefore.toString(),
      record.observedAllowanceAfter?.toString() ?? null,
      record.nonce,
      record.transactionHash,
      record.serializedTransaction,
      record.lastError,
      record.createdAtMs,
      record.updatedAtMs
    );
    if (result.changes === 1) return 'INSERTED';

    const existing = this.db.prepare(`
      SELECT action_id, parent_buy_action_id, launch_id, baseline_id
      FROM canary_entry_approval_actions
      LIMIT 1
    `).get() as ExistingRow | undefined;
    if (!existing) throw new Error('CANARY_ENTRY_APPROVAL_INSERT_REJECTED');
    if (
      existing.action_id === record.actionId &&
      existing.parent_buy_action_id === record.parentBuyActionId &&
      existing.launch_id === record.launchId &&
      existing.baseline_id === record.baselineId
    ) return 'DUPLICATE';
    return 'ENTRY_SLOT_TAKEN';
  }

  getByParentBuyActionId(parentBuyActionId: string): CanaryEntryApprovalActionRecord | null {
    const row = this.db.prepare('SELECT * FROM canary_entry_approval_actions WHERE parent_buy_action_id = ?')
      .get(parentBuyActionId) as EntryRow | undefined;
    return row ? fromRow(row) : null;
  }

  getCommitted(): CanaryEntryApprovalActionRecord | null {
    const row = this.db.prepare('SELECT * FROM canary_entry_approval_actions LIMIT 1').get() as EntryRow | undefined;
    return row ? fromRow(row) : null;
  }

  listUnresolved(): CanaryEntryApprovalActionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM canary_entry_approval_actions
      WHERE state IN ('RESERVED', 'SIGNED', 'SUBMITTED', 'SAFE_HALT')
      ORDER BY created_at_ms, action_id
    `).all() as EntryRow[];
    return rows.map(fromRow);
  }

  markSigned(actionId: string, params: { nonce: number; transactionHash: Hex; serializedTransaction: Hex }): void {
    if (!Number.isSafeInteger(params.nonce) || params.nonce < 0) throw new Error(`CANARY_ENTRY_APPROVAL_NONCE_INVALID:${params.nonce}`);
    const derivedHash = keccak256(params.serializedTransaction);
    if (derivedHash.toLowerCase() !== params.transactionHash.toLowerCase()) {
      throw new Error('CANARY_ENTRY_APPROVAL_SIGNED_IDENTITY_MISMATCH');
    }
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
    const row = this.db.prepare('SELECT state FROM canary_entry_approval_actions WHERE action_id = ?').get(actionId) as { state: CanaryActionState } | undefined;
    if (!row) throw new Error(`CANARY_ENTRY_APPROVAL_ACTION_MISSING:${actionId}`);
    if (!['RESERVED', 'SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) {
      throw new Error(`CANARY_ENTRY_APPROVAL_SAFE_HALT_INVALID_STATE:${row.state}`);
    }
    this.db.prepare('UPDATE canary_entry_approval_actions SET state = ?, last_error = ?, updated_at_ms = ? WHERE action_id = ?')
      .run('SAFE_HALT', error.slice(0, 512), Date.now(), actionId);
  }

  markIncluded(actionId: string, observedAllowanceAfter: bigint): void {
    const row = this.db.prepare(`
      SELECT state, transaction_hash, serialized_transaction, intent_json
      FROM canary_entry_approval_actions WHERE action_id = ?
    `).get(actionId) as ReconcileRow | undefined;
    if (!row || !['SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) {
      throw new Error(`CANARY_ENTRY_APPROVAL_INCLUDED_INVALID_STATE:${row?.state ?? 'MISSING'}`);
    }
    this.assertSignedProvenance(row, actionId);
    const intent = reviveIntent(row.intent_json);
    if (observedAllowanceAfter !== intent.amount) {
      throw new Error(`CANARY_ENTRY_APPROVAL_INCLUDED_ALLOWANCE_NOT_EXACT:${observedAllowanceAfter}:${intent.amount}`);
    }
    this.db.prepare(`
      UPDATE canary_entry_approval_actions
      SET state = ?, observed_allowance_after = ?, updated_at_ms = ?
      WHERE action_id = ?
    `).run('INCLUDED', observedAllowanceAfter.toString(), Date.now(), actionId);
  }

  markReverted(actionId: string): void {
    const row = this.db.prepare(`
      SELECT state, transaction_hash, serialized_transaction, intent_json
      FROM canary_entry_approval_actions WHERE action_id = ?
    `).get(actionId) as ReconcileRow | undefined;
    if (!row || !['SIGNED', 'SUBMITTED', 'SAFE_HALT'].includes(row.state)) {
      throw new Error(`CANARY_ENTRY_APPROVAL_REVERTED_INVALID_STATE:${row?.state ?? 'MISSING'}`);
    }
    this.assertSignedProvenance(row, actionId);
    this.db.prepare('UPDATE canary_entry_approval_actions SET state = ?, updated_at_ms = ? WHERE action_id = ?')
      .run('REVERTED', Date.now(), actionId);
  }

  markCleanupTerminal(actionId: string, reason: string): void {
    const row = this.db.prepare(`
      SELECT state, observed_allowance_after, last_error
      FROM canary_entry_approval_actions WHERE action_id = ?
    `).get(actionId) as CleanupRow | undefined;
    if (!row) throw new Error(`CANARY_ENTRY_APPROVAL_ACTION_MISSING:${actionId}`);
    const terminalReason = `CANARY_E0_ENTRY_APPROVAL_CLEANUP_TERMINAL:${reason}`.slice(0, 512);
    if (row.state === 'SKIPPED') {
      if (row.observed_allowance_after !== '0') {
        throw new Error(`CANARY_ENTRY_APPROVAL_CLEANUP_TERMINAL_ALLOWANCE_NOT_ZERO:${row.observed_allowance_after ?? 'NULL'}`);
      }
      if (row.last_error !== terminalReason) {
        throw new Error('CANARY_ENTRY_APPROVAL_CLEANUP_TERMINAL_REASON_DRIFT');
      }
      return;
    }
    if (row.state !== 'INCLUDED') {
      throw new Error(`CANARY_ENTRY_APPROVAL_CLEANUP_INVALID_STATE:${row.state}`);
    }
    const result = this.db.prepare(`
      UPDATE canary_entry_approval_actions
      SET state = 'SKIPPED', observed_allowance_after = '0', last_error = ?, updated_at_ms = ?
      WHERE action_id = ? AND state = 'INCLUDED'
    `).run(terminalReason, Date.now(), actionId);
    if (result.changes !== 1) throw new Error(`CANARY_ENTRY_APPROVAL_CLEANUP_TERMINAL_TRANSITION_FAILED:${actionId}`);
  }

  private async assertRecordIdentity(record: CanaryEntryApprovalActionRecord): Promise<void> {
    if (record.intent.actionId !== record.actionId) throw new Error('CANARY_ENTRY_APPROVAL_INTENT_ACTION_ID_MISMATCH');
    if (record.intent.parentBuyActionId !== record.parentBuyActionId) throw new Error('CANARY_ENTRY_APPROVAL_PARENT_BUY_MISMATCH');
    if (record.intent.launchId !== record.launchId || record.intent.baselineId !== record.baselineId) {
      throw new Error('CANARY_ENTRY_APPROVAL_INTENT_IDENTITY_MISMATCH');
    }
    const expectedParentBuyActionId = await deriveCanaryActionId(record.launchId, record.baselineId);
    if (record.parentBuyActionId !== expectedParentBuyActionId) throw new Error('CANARY_ENTRY_APPROVAL_PARENT_BUY_IDENTITY_DRIFT');
    const expectedActionId = await deriveCanaryEntryApprovalActionId({
      parentBuyActionId: record.parentBuyActionId,
      launchId: record.launchId,
      baselineId: record.baselineId,
      owner: record.intent.owner,
      token: record.intent.token,
      buyTokenOut: record.intent.buyTokenOut,
      buyFee: record.intent.buyFee,
      spender: record.intent.spender,
      amount: record.intent.amount,
      sourceQuoteBlockNumber: record.intent.sourceQuoteBlockNumber,
      sourceQuoteBlockHash: record.intent.sourceQuoteBlockHash
    });
    if (record.actionId !== expectedActionId) throw new Error('CANARY_ENTRY_APPROVAL_ACTION_ID_DRIFT');
  }

  private assertSignedProvenance(row: Pick<ReconcileRow, 'transaction_hash' | 'serialized_transaction'>, actionId: string): void {
    if (!row.transaction_hash || !row.serialized_transaction) {
      throw new Error(`CANARY_ENTRY_APPROVAL_RECONCILE_SIGNED_PROVENANCE_MISSING:${actionId}`);
    }
    const derivedHash = keccak256(row.serialized_transaction);
    if (derivedHash.toLowerCase() !== row.transaction_hash.toLowerCase()) {
      throw new Error(`CANARY_ENTRY_APPROVAL_RECONCILE_SIGNED_IDENTITY_MISMATCH:${actionId}`);
    }
  }

  private transition(actionId: string, expected: CanaryActionState, next: CanaryActionState, patch: Record<string, unknown>): void {
    const allowedColumns = new Set(['nonce', 'transaction_hash', 'serialized_transaction']);
    for (const key of Object.keys(patch)) if (!allowedColumns.has(key)) throw new Error(`CANARY_ENTRY_APPROVAL_PATCH_COLUMN_FORBIDDEN:${key}`);
    const entries = Object.entries(patch);
    const assignments = entries.map(([key]) => `${key} = ?`);
    assignments.push('state = ?', 'updated_at_ms = ?');
    const values = entries.map(([, value]) => value);
    values.push(next, Date.now(), actionId, expected);
    const result = this.db.prepare(`UPDATE canary_entry_approval_actions SET ${assignments.join(', ')} WHERE action_id = ? AND state = ?`).run(...values);
    if (result.changes !== 1) throw new Error(`CANARY_ENTRY_APPROVAL_STATE_TRANSITION_FAILED:${actionId}:${expected}:${next}`);
  }
}

type ExistingRow = {
  action_id: string;
  parent_buy_action_id: string;
  launch_id: string;
  baseline_id: string;
};

type EntryRow = ExistingRow & {
  state: CanaryActionState;
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

type ReconcileRow = {
  state: CanaryActionState;
  transaction_hash: Hex | null;
  serialized_transaction: Hex | null;
  intent_json: string;
};

type CleanupRow = {
  state: CanaryActionState;
  observed_allowance_after: string | null;
  last_error: string | null;
};

function fromRow(row: EntryRow): CanaryEntryApprovalActionRecord {
  return {
    actionId: row.action_id,
    parentBuyActionId: row.parent_buy_action_id,
    launchId: row.launch_id,
    baselineId: row.baseline_id,
    state: row.state,
    intent: reviveIntent(row.intent_json),
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

function reviveIntent(json: string): CanaryEntryApprovalIntent {
  const raw = JSON.parse(json) as Record<string, unknown>;
  for (const key of ['amount', 'sourceQuoteBlockNumber', 'notionalUsdMicros']) {
    if (typeof raw[key] === 'string' && /^\d+$/.test(raw[key] as string)) raw[key] = BigInt(raw[key] as string);
  }
  return raw as unknown as CanaryEntryApprovalIntent;
}

function jsonSafeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
}
