import { getAddress, type Address, type Hex } from 'viem';
import type { BaselineQuoteReceipt } from '../shadow/baselineTypes.js';
import { buildCanaryApprovalIntent, type CanaryApprovalIntent } from './approval.js';
import { CanaryApprovalStore, type CanaryApprovalActionRecord } from './approvalStore.js';
import { CanaryExitStore, type CanaryExitActionRecord } from './exitStore.js';
import { buildCanaryExitIntent, type CanaryExitIntent } from './roundTrip.js';
import { CANARY_PRIMARY_NOTIONAL_USD_MICROS, type CanarySwapIntent } from './swapIntent.js';
import { CanaryStore } from './store.js';
import type { CanaryActionRecord } from './types.js';
import type {
  CanaryApprovalPreflight,
  CanaryChainClock,
  CanaryPreflight,
  SignedCanaryTransaction
} from './viemCanaryExecutor.js';

export const CANARY_E0_ROUNDTRIP_RUNTIME_R0 = 'CANARY_E0_ROUNDTRIP_RUNTIME_R0' as const;

export interface CanaryE0RoundTripExecutor {
  readonly walletAddress: Address;
  getChainClock(): Promise<CanaryChainClock>;
  preflightApproval(intent: CanaryApprovalIntent): Promise<CanaryApprovalPreflight>;
  signApproval(intent: CanaryApprovalIntent, preflight: CanaryApprovalPreflight): Promise<SignedCanaryTransaction>;
  preflight(intent: CanarySwapIntent): Promise<CanaryPreflight>;
  sign(intent: CanarySwapIntent, preflight: CanaryPreflight): Promise<SignedCanaryTransaction>;
  broadcastExact(signed: SignedCanaryTransaction): Promise<Hex>;
  getReceiptIfPresent(transactionHash: Hex): Promise<{ status: 'success' | 'reverted' } | null>;
  getTokenAllowance(token: Address, spender?: Address): Promise<bigint>;
  getTokenBalance(token: Address): Promise<bigint>;
}

export interface CanaryE0RoundTripRuntimeOptions {
  slippageBps: number;
  deadlineSeconds: number;
}

export type CanaryE0RoundTripRuntimeAction =
  | 'APPROVAL_INCLUDED'
  | 'APPROVAL_SUBMITTED'
  | 'EXIT_INCLUDED'
  | 'EXIT_SUBMITTED'
  | 'COMPLETE'
  | 'NEEDS_EXIT_QUOTE'
  | 'BLOCKED_UNRESOLVED'
  | 'BLOCKED_SETUP';

export interface CanaryE0RoundTripRuntimeReport {
  version: typeof CANARY_E0_ROUNDTRIP_RUNTIME_R0;
  action: CanaryE0RoundTripRuntimeAction;
  buyActionId: string;
  approvalActionId?: string;
  exitActionId?: string;
  transactionHash?: Hex;
  reason?: string;
}

type ReportExtra = {
  approvalActionId?: string | undefined;
  exitActionId?: string | undefined;
  transactionHash?: Hex | undefined;
  reason?: string | undefined;
};

export async function advanceCanaryE0RoundTrip(params: {
  buyActionId: string;
  buyStore: CanaryStore;
  approvalStore: CanaryApprovalStore;
  exitStore: CanaryExitStore;
  executor: CanaryE0RoundTripExecutor;
  options: CanaryE0RoundTripRuntimeOptions;
  exitQuote?: BaselineQuoteReceipt | null;
}): Promise<CanaryE0RoundTripRuntimeReport> {
  validateOptions(params.options);
  const buy = params.buyStore.getAction(params.buyActionId);
  if (!buy) return report(params.buyActionId, 'BLOCKED_SETUP', { reason: 'CANARY_E0_BUY_ACTION_MISSING' });

  let acquired: bigint;
  try {
    acquired = assertIncludedBuy(buy, params.executor.walletAddress);
  } catch (error) {
    return report(params.buyActionId, 'BLOCKED_SETUP', { reason: stableError(error) });
  }

  let approval = params.approvalStore.getByParentBuyActionId(params.buyActionId);
  if (!approval) return executeApproval({ ...params, buy, acquired });

  const approvalReconcile = await reconcileApproval(approval, params.executor, params.approvalStore);
  if (approvalReconcile) return report(params.buyActionId, approvalReconcile.action, {
    approvalActionId: approval.actionId,
    transactionHash: approvalReconcile.transactionHash,
    reason: approvalReconcile.reason
  });

  approval = params.approvalStore.getByParentBuyActionId(params.buyActionId);
  if (!approval || approval.state !== 'INCLUDED') {
    return report(params.buyActionId, 'BLOCKED_UNRESOLVED', {
      approvalActionId: approval?.actionId,
      reason: 'CANARY_E0_APPROVAL_NOT_INCLUDED_AFTER_RECONCILE'
    });
  }

  let exit = params.exitStore.getByParentBuyActionId(params.buyActionId);
  if (!exit) {
    if (!params.exitQuote) return report(params.buyActionId, 'NEEDS_EXIT_QUOTE', { approvalActionId: approval.actionId });
    return executeExit({ ...params, buy, acquired, approval, exitQuote: params.exitQuote });
  }

  const exitReconcile = await reconcileExit(exit, params.executor, params.exitStore);
  if (exitReconcile) return report(params.buyActionId, exitReconcile.action, {
    approvalActionId: approval.actionId,
    exitActionId: exit.actionId,
    transactionHash: exitReconcile.transactionHash,
    reason: exitReconcile.reason
  });

  exit = params.exitStore.getByParentBuyActionId(params.buyActionId);
  if (exit?.state === 'INCLUDED') {
    return report(params.buyActionId, 'COMPLETE', {
      approvalActionId: approval.actionId,
      exitActionId: exit.actionId,
      transactionHash: exit.transactionHash ?? undefined
    });
  }
  return report(params.buyActionId, 'BLOCKED_UNRESOLVED', {
    approvalActionId: approval.actionId,
    exitActionId: exit?.actionId,
    reason: 'CANARY_E0_EXIT_NOT_INCLUDED_AFTER_RECONCILE'
  });
}

async function executeApproval(params: {
  buyActionId: string;
  buy: CanaryActionRecord;
  acquired: bigint;
  approvalStore: CanaryApprovalStore;
  executor: CanaryE0RoundTripExecutor;
}): Promise<CanaryE0RoundTripRuntimeReport> {
  const buyIntent = params.buy.intent!;
  let intent: CanaryApprovalIntent;
  let preflight: CanaryApprovalPreflight;
  try {
    intent = await buildCanaryApprovalIntent({ buyIntent, acquiredAmount: params.acquired });
    preflight = await params.executor.preflightApproval(intent);
  } catch (error) {
    return report(params.buyActionId, 'BLOCKED_SETUP', { reason: stableError(error) });
  }

  const now = Date.now();
  const inserted = await params.approvalStore.insertReserved({
    actionId: intent.actionId,
    parentBuyActionId: intent.parentBuyActionId,
    parentExitActionId: intent.parentExitActionId,
    launchId: intent.launchId,
    baselineId: intent.baselineId,
    state: 'RESERVED',
    intent,
    observedAllowanceBefore: preflight.allowanceBefore,
    observedAllowanceAfter: null,
    nonce: null,
    transactionHash: null,
    serializedTransaction: null,
    lastError: null,
    createdAtMs: now,
    updatedAtMs: now
  });
  if (inserted !== 'INSERTED') {
    return report(params.buyActionId, 'BLOCKED_UNRESOLVED', {
      approvalActionId: intent.actionId,
      reason: 'CANARY_E0_APPROVAL_RESERVATION_DUPLICATE_NO_SIGN'
    });
  }

  let signed: SignedCanaryTransaction;
  try {
    signed = await params.executor.signApproval(intent, preflight);
    params.approvalStore.markSigned(intent.actionId, signed);
  } catch (error) {
    params.approvalStore.markSafeHalt(intent.actionId, stableError(error));
    return report(params.buyActionId, 'BLOCKED_UNRESOLVED', {
      approvalActionId: intent.actionId,
      reason: stableError(error)
    });
  }

  try {
    const transactionHash = await params.executor.broadcastExact(signed);
    params.approvalStore.markSubmitted(intent.actionId);
    const receipt = await params.executor.getReceiptIfPresent(transactionHash);
    if (!receipt) return report(params.buyActionId, 'APPROVAL_SUBMITTED', { approvalActionId: intent.actionId, transactionHash });
    if (receipt.status === 'reverted') {
      params.approvalStore.markReverted(intent.actionId);
      return report(params.buyActionId, 'BLOCKED_SETUP', {
        approvalActionId: intent.actionId,
        transactionHash,
        reason: 'CANARY_E0_APPROVAL_REVERTED'
      });
    }
    const allowance = await params.executor.getTokenAllowance(intent.token, intent.spender);
    params.approvalStore.markIncluded(intent.actionId, allowance);
    return report(params.buyActionId, 'APPROVAL_INCLUDED', { approvalActionId: intent.actionId, transactionHash });
  } catch (error) {
    params.approvalStore.markSafeHalt(intent.actionId, stableError(error));
    return report(params.buyActionId, 'BLOCKED_UNRESOLVED', {
      approvalActionId: intent.actionId,
      transactionHash: signed.transactionHash,
      reason: stableError(error)
    });
  }
}

async function executeExit(params: {
  buyActionId: string;
  buy: CanaryActionRecord;
  acquired: bigint;
  approval: CanaryApprovalActionRecord;
  exitQuote: BaselineQuoteReceipt;
  exitStore: CanaryExitStore;
  executor: CanaryE0RoundTripExecutor;
  options: CanaryE0RoundTripRuntimeOptions;
}): Promise<CanaryE0RoundTripRuntimeReport> {
  const buyIntent = params.buy.intent!;
  try {
    assertExitQuoteBoundToBuy(params.exitQuote, buyIntent, params.acquired);
  } catch (error) {
    return report(params.buyActionId, 'BLOCKED_SETUP', {
      approvalActionId: params.approval.actionId,
      reason: stableError(error)
    });
  }

  let intent: CanaryExitIntent;
  let preflight: CanaryPreflight;
  try {
    const chainClock = await params.executor.getChainClock();
    intent = await buildCanaryExitIntent({
      buyIntent,
      quoteBlockNumber: params.exitQuote.blockNumber,
      quoteBlockHash: params.exitQuote.blockHash,
      amountIn: params.acquired,
      quotedAmountOut: params.exitQuote.amountOut,
      slippageBps: params.options.slippageBps,
      chainTimestampSeconds: chainClock.timestampSeconds,
      deadlineSeconds: params.options.deadlineSeconds
    });
    if (intent.actionId !== params.approval.parentExitActionId) throw new Error('CANARY_E0_EXIT_APPROVAL_IDENTITY_MISMATCH');
    preflight = await params.executor.preflight(intent);
    if (preflight.inputAllowance !== params.acquired) {
      throw new Error(`CANARY_E0_EXIT_ALLOWANCE_NOT_EXACT:${preflight.inputAllowance}:${params.acquired}`);
    }
  } catch (error) {
    return report(params.buyActionId, 'BLOCKED_SETUP', {
      approvalActionId: params.approval.actionId,
      reason: stableError(error)
    });
  }

  const now = Date.now();
  const inserted = params.exitStore.insertReserved({
    actionId: intent.actionId,
    parentBuyActionId: intent.parentBuyActionId,
    launchId: intent.launchId,
    baselineId: intent.baselineId,
    state: 'RESERVED',
    intent,
    nonce: null,
    transactionHash: null,
    serializedTransaction: null,
    lastError: null,
    outputBalanceBefore: preflight.outputBalanceBefore,
    outputBalanceAfter: null,
    createdAtMs: now,
    updatedAtMs: now
  });
  if (inserted !== 'INSERTED') {
    return report(params.buyActionId, 'BLOCKED_UNRESOLVED', {
      approvalActionId: params.approval.actionId,
      exitActionId: intent.actionId,
      reason: 'CANARY_E0_EXIT_RESERVATION_DUPLICATE_NO_SIGN'
    });
  }

  let signed: SignedCanaryTransaction;
  try {
    signed = await params.executor.sign(intent, preflight);
    params.exitStore.markSigned(intent.actionId, signed);
  } catch (error) {
    params.exitStore.markSafeHalt(intent.actionId, stableError(error));
    return report(params.buyActionId, 'BLOCKED_UNRESOLVED', {
      approvalActionId: params.approval.actionId,
      exitActionId: intent.actionId,
      reason: stableError(error)
    });
  }

  try {
    const transactionHash = await params.executor.broadcastExact(signed);
    params.exitStore.markSubmitted(intent.actionId);
    const receipt = await params.executor.getReceiptIfPresent(transactionHash);
    if (!receipt) return report(params.buyActionId, 'EXIT_SUBMITTED', {
      approvalActionId: params.approval.actionId,
      exitActionId: intent.actionId,
      transactionHash
    });
    if (receipt.status === 'reverted') {
      params.exitStore.markReverted(intent.actionId);
      return report(params.buyActionId, 'BLOCKED_SETUP', {
        approvalActionId: params.approval.actionId,
        exitActionId: intent.actionId,
        transactionHash,
        reason: 'CANARY_E0_EXIT_REVERTED'
      });
    }
    const outputBalanceAfter = await params.executor.getTokenBalance(intent.tokenOut);
    params.exitStore.markIncluded(intent.actionId, outputBalanceAfter);
    return report(params.buyActionId, 'EXIT_INCLUDED', {
      approvalActionId: params.approval.actionId,
      exitActionId: intent.actionId,
      transactionHash
    });
  } catch (error) {
    params.exitStore.markSafeHalt(intent.actionId, stableError(error));
    return report(params.buyActionId, 'BLOCKED_UNRESOLVED', {
      approvalActionId: params.approval.actionId,
      exitActionId: intent.actionId,
      transactionHash: signed.transactionHash,
      reason: stableError(error)
    });
  }
}

async function reconcileApproval(
  approval: CanaryApprovalActionRecord,
  executor: CanaryE0RoundTripExecutor,
  store: CanaryApprovalStore
): Promise<{ action: CanaryE0RoundTripRuntimeAction; transactionHash?: Hex; reason?: string } | null> {
  if (approval.state === 'INCLUDED') return null;
  if (approval.state === 'REVERTED') return { action: 'BLOCKED_SETUP', reason: 'CANARY_E0_APPROVAL_ALREADY_REVERTED' };
  if (approval.state === 'RESERVED') {
    store.markSafeHalt(approval.actionId, 'CANARY_E0_RESTART_AFTER_APPROVAL_RESERVATION_NO_RETRY');
    return { action: 'BLOCKED_UNRESOLVED', reason: 'CANARY_E0_RESTART_AFTER_APPROVAL_RESERVATION_NO_RETRY' };
  }
  if (!approval.transactionHash || !approval.serializedTransaction) {
    store.markSafeHalt(approval.actionId, 'CANARY_E0_APPROVAL_SIGNED_PROVENANCE_MISSING');
    return { action: 'BLOCKED_UNRESOLVED', reason: 'CANARY_E0_APPROVAL_SIGNED_PROVENANCE_MISSING' };
  }
  const receipt = await executor.getReceiptIfPresent(approval.transactionHash);
  if (!receipt) return {
    action: 'BLOCKED_UNRESOLVED',
    transactionHash: approval.transactionHash,
    reason: 'CANARY_E0_APPROVAL_TX_NOT_YET_OBSERVED_NO_RETRY'
  };
  if (receipt.status === 'reverted') {
    store.markReverted(approval.actionId);
    return { action: 'BLOCKED_SETUP', transactionHash: approval.transactionHash, reason: 'CANARY_E0_APPROVAL_REVERTED' };
  }
  const allowance = await executor.getTokenAllowance(approval.intent.token, approval.intent.spender);
  store.markIncluded(approval.actionId, allowance);
  return { action: 'APPROVAL_INCLUDED', transactionHash: approval.transactionHash };
}

async function reconcileExit(
  exit: CanaryExitActionRecord,
  executor: CanaryE0RoundTripExecutor,
  store: CanaryExitStore
): Promise<{ action: CanaryE0RoundTripRuntimeAction; transactionHash?: Hex; reason?: string } | null> {
  if (exit.state === 'INCLUDED') return null;
  if (exit.state === 'REVERTED') return { action: 'BLOCKED_SETUP', reason: 'CANARY_E0_EXIT_ALREADY_REVERTED' };
  if (exit.state === 'RESERVED') {
    store.markSafeHalt(exit.actionId, 'CANARY_E0_RESTART_AFTER_EXIT_RESERVATION_NO_RETRY');
    return { action: 'BLOCKED_UNRESOLVED', reason: 'CANARY_E0_RESTART_AFTER_EXIT_RESERVATION_NO_RETRY' };
  }
  if (!exit.transactionHash || !exit.serializedTransaction) {
    store.markSafeHalt(exit.actionId, 'CANARY_E0_EXIT_SIGNED_PROVENANCE_MISSING');
    return { action: 'BLOCKED_UNRESOLVED', reason: 'CANARY_E0_EXIT_SIGNED_PROVENANCE_MISSING' };
  }
  const receipt = await executor.getReceiptIfPresent(exit.transactionHash);
  if (!receipt) return {
    action: 'BLOCKED_UNRESOLVED',
    transactionHash: exit.transactionHash,
    reason: 'CANARY_E0_EXIT_TX_NOT_YET_OBSERVED_NO_RETRY'
  };
  if (receipt.status === 'reverted') {
    store.markReverted(exit.actionId);
    return { action: 'BLOCKED_SETUP', transactionHash: exit.transactionHash, reason: 'CANARY_E0_EXIT_REVERTED' };
  }
  const outputBalanceAfter = await executor.getTokenBalance(exit.intent.tokenOut);
  store.markIncluded(exit.actionId, outputBalanceAfter);
  return { action: 'EXIT_INCLUDED', transactionHash: exit.transactionHash };
}

function assertIncludedBuy(buy: CanaryActionRecord, wallet: Address): bigint {
  if (buy.state !== 'INCLUDED') throw new Error(`CANARY_E0_BUY_NOT_INCLUDED:${buy.state}`);
  if (buy.decision !== 'PASS') throw new Error(`CANARY_E0_BUY_DECISION_INVALID:${buy.decision}`);
  if (!buy.intent) throw new Error('CANARY_E0_BUY_INTENT_MISSING');
  if (getAddress(buy.intent.recipient) !== getAddress(wallet)) throw new Error('CANARY_E0_BUY_WALLET_MISMATCH');
  if (buy.outputBalanceBefore === null || buy.outputBalanceAfter === null) throw new Error('CANARY_E0_BUY_BALANCE_EVIDENCE_MISSING');
  const acquired = buy.outputBalanceAfter - buy.outputBalanceBefore;
  if (acquired <= 0n) throw new Error(`CANARY_E0_BUY_ACQUIRED_INVALID:${acquired}`);
  return acquired;
}

function assertExitQuoteBoundToBuy(quote: BaselineQuoteReceipt, buy: CanarySwapIntent, acquired: bigint): void {
  if (quote.kind !== 'INDEPENDENT_REVERSE_EXIT' || quote.mode !== 'EXACT_INPUT') throw new Error('CANARY_E0_EXIT_QUOTE_KIND_INVALID');
  if (!quote.executable || quote.amountOut <= 0n) throw new Error('CANARY_E0_EXIT_QUOTE_NOT_EXECUTABLE');
  if (quote.launchId !== buy.launchId) throw new Error('CANARY_E0_EXIT_QUOTE_LAUNCH_MISMATCH');
  if (getAddress(quote.tokenIn as Address) !== getAddress(buy.tokenOut)) throw new Error('CANARY_E0_EXIT_QUOTE_TOKEN_IN_MISMATCH');
  if (getAddress(quote.tokenOut as Address) !== getAddress(buy.tokenIn)) throw new Error('CANARY_E0_EXIT_QUOTE_TOKEN_OUT_MISMATCH');
  if (quote.fee !== buy.fee) throw new Error('CANARY_E0_EXIT_QUOTE_FEE_MISMATCH');
  if (quote.amountIn !== acquired) throw new Error(`CANARY_E0_EXIT_QUOTE_AMOUNT_IN_MISMATCH:${quote.amountIn}:${acquired}`);
  if (quote.notionalUsdMicros !== CANARY_PRIMARY_NOTIONAL_USD_MICROS) throw new Error('CANARY_E0_EXIT_QUOTE_NOTIONAL_MISMATCH');
}

function validateOptions(options: CanaryE0RoundTripRuntimeOptions): void {
  if (!Number.isInteger(options.slippageBps) || options.slippageBps < 0 || options.slippageBps > 10_000) {
    throw new Error('CANARY_E0_SLIPPAGE_BPS_INVALID');
  }
  if (!Number.isInteger(options.deadlineSeconds) || options.deadlineSeconds < 1 || options.deadlineSeconds > 120) {
    throw new Error('CANARY_E0_DEADLINE_SECONDS_INVALID');
  }
}

function report(buyActionId: string, action: CanaryE0RoundTripRuntimeAction, extra: ReportExtra = {}): CanaryE0RoundTripRuntimeReport {
  const out: CanaryE0RoundTripRuntimeReport = { version: CANARY_E0_ROUNDTRIP_RUNTIME_R0, action, buyActionId };
  if (extra.approvalActionId !== undefined) out.approvalActionId = extra.approvalActionId;
  if (extra.exitActionId !== undefined) out.exitActionId = extra.exitActionId;
  if (extra.transactionHash !== undefined) out.transactionHash = extra.transactionHash;
  if (extra.reason !== undefined) out.reason = extra.reason;
  return out;
}

function stableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
