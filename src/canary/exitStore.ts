import Database from 'better-sqlite3';
import { encodeFunctionData } from 'viem';
import type { Hex } from '../domain.js';
import type { CanaryActionState } from './types.js';
import { CANARY_E0_ROUNDTRIP_R0, type CanaryExitIntent } from './roundTrip.js';
import {
  CANARY_MAX_SLIPPAGE_BPS,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  CANARY_SNIPER_R0,
  INK_SWAP_ROUTER_02,
  swapRouter02Abi,
  type CanarySwapIntent
} from './swapIntent.js';

export type CanaryExitInsertResult = 'INSERTED' | 'DUPLICATE';

export interface CanaryExitActionRecord {
  actionId: string;
  parentBuyActionId: string;
  launchId: string;
  baselineId: string;
  state: CanaryActionState;
  intent: CanaryExitIntent;
  nonce: number | null;
  transactionHash: Hex | null;
  serializedTransaction: Hex | null;
  lastError: string | null;
  outputBalanceBefore: bigint | null;
  outputBalanceAfter: bigint | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export class CanaryExitStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canary_exit_actions (
        action_id TEXT PRIMARY KEY,
        parent_buy_action_id TEXT NOT NULL UNIQUE,
        launch_id TEXT NOT NULL UNIQUE,
        baseline_id TEXT NOT NULL,
        state TEXT NOT NULL,
        intent_json TEXT NOT NULL,
        nonce INTEGER,
        transaction_hash TEXT UNIQUE,
        serialized_transaction TEXT,
        last_error TEXT,
        output_balance_before TEXT,
        output_balance_after TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        FOREIGN KEY(parent_buy_action_id) REFERENCES canary_actions(action_id)
      );
      CREATE INDEX IF NOT EXISTS idx_canary_exit_actions_state ON canary_exit_actions(state);
    `);
  }

  close(): void { this.db.close(); }

  insertReserved(record: CanaryExitActionRecord): CanaryExitInsertResult {
    if (record.state !== 'RESERVED') throw new Error(`CANARY_EXIT_INITIAL_STATE_INVALID:${record.state}`);
    if (record.intent.actionId !== record.actionId) throw new Error('CANARY_EXIT_INTENT_ACTION_ID_MISMATCH');
    if (record.intent.parentBuyActionId !== record.parentBuyActionId) throw new Error('CANARY_EXIT_PARENT_ACTION_ID_MISMATCH');
    if (record.intent.launchId !== record.launchId || record.intent.baselineId !== record.baselineId) {
      throw new Error('CANARY_EXIT_INTENT_IDENTITY_MISMATCH');
    }
    assertExitCalldataMatchesIntent(record.intent);

    const transaction = this.db.transaction(() => {
      const parent = this.db.prepare(`
        SELECT action_id, launch_id, baseline_id, state, intent_json, output_balance_before, output_balance_after
        FROM canary_actions
        WHERE action_id = ?
      `).get(record.parentBuyActionId) as ParentBuyRow | undefined;
      if (!parent) throw new Error(`CANARY_EXIT_PARENT_BUY_MISSING:${record.parentBuyActionId}`);
      if (parent.state !== 'INCLUDED') throw new Error(`CANARY_EXIT_PARENT_BUY_NOT_INCLUDED:${parent.state}`);
      if (parent.launch_id !== record.launchId || parent.baseline_id !== record.baselineId) {
        throw new Error('CANARY_EXIT_PARENT_BUY_IDENTITY_MISMATCH');
      }
      if (!parent.intent_json) throw new Error('CANARY_EXIT_PARENT_INTENT_MISSING');
      const parentIntent = reviveParentIntent(parent.intent_json);
      assertExitBoundToPersistedParent(record.intent, parent, parentIntent);

      if (parent.output_balance_before === null || parent.output_balance_after === null) {
        throw new Error('CANARY_EXIT_PARENT_BALANCE_EVIDENCE_MISSING');
      }
      const acquired = BigInt(parent.output_balance_after) - BigInt(parent.output_balance_before);
      if (acquired <= 0n) throw new Error(`CANARY_EXIT_PARENT_ACQUIRED_BALANCE_INVALID:${acquired}`);
      if (record.intent.amountIn !== acquired) {
        throw new Error(`CANARY_EXIT_AMOUNT_MUST_EQUAL_ACQUIRED:${record.intent.amountIn}:${acquired}`);
      }

      const result = this.db.prepare(`
        INSERT OR IGNORE INTO canary_exit_actions (
          action_id, parent_buy_action_id, launch_id, baseline_id, state, intent_json,
          nonce, transaction_hash, serialized_transaction, last_error,
          output_balance_before, output_balance_after, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.actionId, record.parentBuyActionId, record.launchId, record.baselineId, record.state,
        jsonSafeStringify(record.intent), record.nonce, record.transactionHash, record.serializedTransaction,
        record.lastError, record.outputBalanceBefore?.toString() ?? null,
        record.outputBalanceAfter?.toString() ?? null, record.createdAtMs, record.updatedAtMs
      );
      if (result.changes === 1) return 'INSERTED' as const;

      const existing = this.db.prepare(`
        SELECT action_id, parent_buy_action_id, launch_id, baseline_id
        FROM canary_exit_actions
        WHERE action_id = ? OR parent_buy_action_id = ? OR launch_id = ?
        LIMIT 1
      `).get(record.actionId, record.parentBuyActionId, record.launchId) as ExistingExitRow | undefined;
      if (existing && existing.action_id === record.actionId && existing.parent_buy_action_id === record.parentBuyActionId &&
          existing.launch_id === record.launchId && existing.baseline_id === record.baselineId) {
        return 'DUPLICATE' as const;
      }
      throw new Error(`CANARY_EXIT_IDENTITY_CONFLICT:${record.launchId}`);
    });

    return transaction();
  }

  listUnresolved(): CanaryExitActionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM canary_exit_actions
      WHERE state IN ('RESERVED', 'SIGNED', 'SUBMITTED', 'SAFE_HALT')
      ORDER BY created_at_ms, action_id
    `).all() as ExitRow[];
    return rows.map(fromRow);
  }
}

type ParentBuyRow = {
  action_id: string;
  launch_id: string;
  baseline_id: string;
  state: CanaryActionState;
  intent_json: string | null;
  output_balance_before: string | null;
  output_balance_after: string | null;
};

type ExistingExitRow = {
  action_id: string;
  parent_buy_action_id: string;
  launch_id: string;
  baseline_id: string;
};

type ExitRow = ExistingExitRow & {
  state: CanaryActionState;
  intent_json: string;
  nonce: number | null;
  transaction_hash: Hex | null;
  serialized_transaction: Hex | null;
  last_error: string | null;
  output_balance_before: string | null;
  output_balance_after: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function assertExitCalldataMatchesIntent(exit: CanaryExitIntent): void {
  if (exit.roundTripVersion !== CANARY_E0_ROUNDTRIP_R0 || exit.leg !== 'EXIT') {
    throw new Error('CANARY_EXIT_VERSION_OR_LEG_INVALID');
  }
  if (exit.version !== CANARY_SNIPER_R0) throw new Error('CANARY_EXIT_SWAP_VERSION_INVALID');
  if (!sameHex(exit.router, INK_SWAP_ROUTER_02)) throw new Error('CANARY_EXIT_ROUTER_INVALID');
  if (exit.notionalUsdMicros !== CANARY_PRIMARY_NOTIONAL_USD_MICROS) throw new Error('CANARY_EXIT_NOTIONAL_INVALID');
  if (exit.value !== 0n) throw new Error('CANARY_EXIT_VALUE_INVALID');
  if (!Number.isInteger(exit.fee) || exit.fee < 0 || exit.fee > 1_000_000) throw new Error('CANARY_EXIT_FEE_INVALID');
  if (exit.amountIn <= 0n || exit.quotedAmountOut <= 0n) throw new Error('CANARY_EXIT_QUOTE_INVALID');
  if (!Number.isInteger(exit.slippageBps) || exit.slippageBps < 1 || exit.slippageBps > CANARY_MAX_SLIPPAGE_BPS) {
    throw new Error('CANARY_EXIT_SLIPPAGE_INVALID');
  }
  const expectedMinimum = (exit.quotedAmountOut * BigInt(10_000 - exit.slippageBps)) / 10_000n;
  if (expectedMinimum <= 0n || exit.amountOutMinimum !== expectedMinimum) {
    throw new Error('CANARY_EXIT_MIN_OUT_INVALID');
  }
  if (exit.deadlineEpochSeconds <= 0n) throw new Error('CANARY_EXIT_DEADLINE_INVALID');

  const exactInputCalldata = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: 'exactInputSingle',
    args: [{
      tokenIn: exit.tokenIn,
      tokenOut: exit.tokenOut,
      fee: exit.fee,
      recipient: exit.recipient,
      amountIn: exit.amountIn,
      amountOutMinimum: exit.amountOutMinimum,
      sqrtPriceLimitX96: 0n
    }]
  });
  const expectedCalldata = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: 'multicall',
    args: [exit.deadlineEpochSeconds, [exactInputCalldata]]
  });
  if (!sameHex(exit.calldata, expectedCalldata)) throw new Error('CANARY_EXIT_CALLDATA_MISMATCH');
}

function assertExitBoundToPersistedParent(exit: CanaryExitIntent, parent: ParentBuyRow, buy: CanarySwapIntent): void {
  if (buy.actionId !== parent.action_id || buy.launchId !== parent.launch_id || buy.baselineId !== parent.baseline_id) {
    throw new Error('CANARY_EXIT_PERSISTED_PARENT_INTENT_IDENTITY_DRIFT');
  }
  const bindingsMatch =
    sameHex(exit.router, buy.router) &&
    sameHex(exit.tokenIn, buy.tokenOut) &&
    sameHex(exit.tokenOut, buy.tokenIn) &&
    exit.fee === buy.fee &&
    sameHex(exit.recipient, buy.recipient) &&
    exit.notionalUsdMicros === buy.notionalUsdMicros;
  if (!bindingsMatch) throw new Error('CANARY_EXIT_PERSISTED_PARENT_INTENT_BINDING_MISMATCH');
}

function sameHex(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }

function fromRow(row: ExitRow): CanaryExitActionRecord {
  return {
    actionId: row.action_id,
    parentBuyActionId: row.parent_buy_action_id,
    launchId: row.launch_id,
    baselineId: row.baseline_id,
    state: row.state,
    intent: reviveIntent(row.intent_json),
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

function reviveIntent(json: string): CanaryExitIntent {
  return reviveSwapIntent(json) as CanaryExitIntent;
}

function reviveParentIntent(json: string): CanarySwapIntent {
  return reviveSwapIntent(json) as CanarySwapIntent;
}

function reviveSwapIntent(json: string): CanarySwapIntent | CanaryExitIntent {
  const raw = JSON.parse(json) as Record<string, unknown>;
  for (const key of ['quoteBlockNumber', 'notionalUsdMicros', 'amountIn', 'quotedAmountOut', 'amountOutMinimum', 'deadlineEpochSeconds', 'value']) {
    if (typeof raw[key] === 'string' && /^\d+$/.test(raw[key] as string)) raw[key] = BigInt(raw[key] as string);
  }
  return raw as unknown as CanarySwapIntent | CanaryExitIntent;
}

function jsonSafeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
}
