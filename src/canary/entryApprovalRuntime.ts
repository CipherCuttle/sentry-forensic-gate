import type { Hex } from 'viem';
import { assertCanaryEntryApprovalCoversBuy, buildCanaryEntryApprovalIntent } from './entryApproval.js';
import { CanaryEntryApprovalStore, type CanaryEntryApprovalActionRecord } from './entryApprovalStore.js';
import type { CanarySwapIntent } from './swapIntent.js';
import type { CanaryApprovalPreflight, SignedCanaryTransaction, ViemCanaryExecutor } from './viemCanaryExecutor.js';

export const CANARY_E0_ENTRY_APPROVAL_RUNTIME_R0 = 'CANARY_E0_ENTRY_APPROVAL_RUNTIME_R0' as const;

export type CanaryE0EntryApprovalRuntimeAction =
  | 'ENTRY_APPROVAL_INCLUDED'
  | 'ENTRY_APPROVAL_SUBMITTED'
  | 'READY_TO_BUY'
  | 'BLOCKED_UNRESOLVED'
  | 'BLOCKED_SETUP';

export interface CanaryE0EntryApprovalRuntimeReport {
  version: typeof CANARY_E0_ENTRY_APPROVAL_RUNTIME_R0;
  action: CanaryE0EntryApprovalRuntimeAction;
  buyActionId: string;
  entryApprovalActionId?: string | undefined;
  transactionHash?: Hex | undefined;
  reason?: string | undefined;
}

export async function reconcileCanaryE0EntryApproval(params: {
  store: CanaryEntryApprovalStore;
  executor: ViemCanaryExecutor;
}): Promise<CanaryE0EntryApprovalRuntimeReport | null> {
  const unresolved = params.store.listUnresolved();
  if (!unresolved.length) return null;
  if (unresolved.length > 1) {
    return report(unresolved[0]!.parentBuyActionId, 'BLOCKED_SETUP', {
      entryApprovalActionId: unresolved[0]!.actionId,
      reason: 'CANARY_E0_MULTIPLE_UNRESOLVED_ENTRY_APPROVALS_INVARIANT_BROKEN'
    });
  }
  const action = unresolved[0]!;
  const reconciled = await reconcileEntryApproval(action, params.store, params.executor);
  if (!reconciled) return null;
  return report(action.parentBuyActionId, reconciled.action, {
    entryApprovalActionId: action.actionId,
    transactionHash: reconciled.transactionHash,
    reason: reconciled.reason
  });
}

export async function advanceCanaryE0EntryApproval(params: {
  plannedBuy: CanarySwapIntent;
  store: CanaryEntryApprovalStore;
  executor: ViemCanaryExecutor;
}): Promise<CanaryE0EntryApprovalRuntimeReport> {
  let committed = params.store.getCommitted();
  if (!committed) return executeEntryApproval(params);

  try {
    assertCanaryEntryApprovalCoversBuy(committed.intent, params.plannedBuy);
  } catch (error) {
    return report(params.plannedBuy.actionId, 'BLOCKED_SETUP', {
      entryApprovalActionId: committed.actionId,
      reason: stableError(error)
    });
  }

  if (committed.state === 'REVERTED') {
    return report(params.plannedBuy.actionId, 'BLOCKED_SETUP', {
      entryApprovalActionId: committed.actionId,
      transactionHash: committed.transactionHash ?? undefined,
      reason: 'CANARY_E0_ENTRY_APPROVAL_REVERTED'
    });
  }
  if (committed.state === 'SKIPPED') {
    return report(params.plannedBuy.actionId, 'BLOCKED_SETUP', {
      entryApprovalActionId: committed.actionId,
      reason: 'CANARY_E0_ENTRY_APPROVAL_STATE_INVALID:SKIPPED'
    });
  }

  const reconciled = await reconcileEntryApproval(committed, params.store, params.executor);
  if (reconciled) return report(params.plannedBuy.actionId, reconciled.action, {
    entryApprovalActionId: committed.actionId,
    transactionHash: reconciled.transactionHash,
    reason: reconciled.reason
  });

  committed = params.store.getCommitted();
  if (!committed || committed.state !== 'INCLUDED') {
    return report(params.plannedBuy.actionId, 'BLOCKED_UNRESOLVED', {
      entryApprovalActionId: committed?.actionId,
      reason: 'CANARY_E0_ENTRY_APPROVAL_NOT_INCLUDED_AFTER_RECONCILE'
    });
  }

  const allowance = await params.executor.getTokenAllowance(committed.intent.token, committed.intent.spender);
  if (allowance !== committed.intent.amount) {
    return report(params.plannedBuy.actionId, 'BLOCKED_SETUP', {
      entryApprovalActionId: committed.actionId,
      reason: `CANARY_E0_ENTRY_APPROVAL_LIVE_ALLOWANCE_NOT_EXACT:${allowance}:${committed.intent.amount}`
    });
  }
  return report(params.plannedBuy.actionId, 'READY_TO_BUY', { entryApprovalActionId: committed.actionId });
}

async function executeEntryApproval(params: {
  plannedBuy: CanarySwapIntent;
  store: CanaryEntryApprovalStore;
  executor: ViemCanaryExecutor;
}): Promise<CanaryE0EntryApprovalRuntimeReport> {
  let intent;
  let preflight: CanaryApprovalPreflight;
  try {
    intent = await buildCanaryEntryApprovalIntent(params.plannedBuy);
    preflight = await params.executor.preflightApproval(intent);
  } catch (error) {
    return report(params.plannedBuy.actionId, 'BLOCKED_SETUP', { reason: stableError(error) });
  }

  const now = Date.now();
  const inserted = await params.store.insertReserved({
    actionId: intent.actionId,
    parentBuyActionId: intent.parentBuyActionId,
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
  }, params.plannedBuy);
  if (inserted.status !== 'INSERTED') {
    return report(params.plannedBuy.actionId, 'BLOCKED_UNRESOLVED', {
      entryApprovalActionId: intent.actionId,
      reason: inserted.status === 'ENTRY_SLOT_TAKEN'
        ? 'CANARY_E0_ENTRY_APPROVAL_SLOT_TAKEN'
        : 'CANARY_E0_ENTRY_APPROVAL_RESERVATION_DUPLICATE_NO_SIGN'
    });
  }

  let signed: SignedCanaryTransaction;
  try {
    signed = await params.executor.signEntryApprovalReserved({
      intent,
      preflight,
      store: params.store,
      signingCapability: inserted.signingCapability
    });
    params.store.markSigned(intent.actionId, signed);
  } catch (error) {
    params.store.markSafeHalt(intent.actionId, stableError(error));
    return report(params.plannedBuy.actionId, 'BLOCKED_UNRESOLVED', {
      entryApprovalActionId: intent.actionId,
      reason: stableError(error)
    });
  }

  try {
    const transactionHash = await params.executor.broadcastExact(signed);
    params.store.markSubmitted(intent.actionId);
    const receipt = await params.executor.getReceiptIfPresent(transactionHash);
    if (!receipt) {
      return report(params.plannedBuy.actionId, 'ENTRY_APPROVAL_SUBMITTED', {
        entryApprovalActionId: intent.actionId,
        transactionHash
      });
    }
    if (receipt.status === 'reverted') {
      params.store.markReverted(intent.actionId);
      return report(params.plannedBuy.actionId, 'BLOCKED_SETUP', {
        entryApprovalActionId: intent.actionId,
        transactionHash,
        reason: 'CANARY_E0_ENTRY_APPROVAL_REVERTED'
      });
    }
    const allowance = await params.executor.getTokenAllowance(intent.token, intent.spender);
    params.store.markIncluded(intent.actionId, allowance);
    return report(params.plannedBuy.actionId, 'ENTRY_APPROVAL_INCLUDED', {
      entryApprovalActionId: intent.actionId,
      transactionHash
    });
  } catch (error) {
    params.store.markSafeHalt(intent.actionId, stableError(error));
    return report(params.plannedBuy.actionId, 'BLOCKED_UNRESOLVED', {
      entryApprovalActionId: intent.actionId,
      transactionHash: signed.transactionHash,
      reason: stableError(error)
    });
  }
}

async function reconcileEntryApproval(
  action: CanaryEntryApprovalActionRecord,
  store: CanaryEntryApprovalStore,
  executor: ViemCanaryExecutor
): Promise<{
  action: Exclude<CanaryE0EntryApprovalRuntimeAction, 'READY_TO_BUY'>;
  transactionHash?: Hex;
  reason?: string;
} | null> {
  if (action.state === 'INCLUDED') return null;
  if (action.state === 'RESERVED' && !action.transactionHash) {
    store.markSafeHalt(action.actionId, 'CANARY_E0_RESTART_AFTER_ENTRY_APPROVAL_RESERVATION_NO_RETRY');
    return { action: 'BLOCKED_UNRESOLVED', reason: 'CANARY_E0_RESTART_AFTER_ENTRY_APPROVAL_RESERVATION_NO_RETRY' };
  }
  if (!action.transactionHash || !action.serializedTransaction) {
    store.markSafeHalt(action.actionId, 'CANARY_E0_ENTRY_APPROVAL_SIGNED_IDENTITY_INCOMPLETE');
    return { action: 'BLOCKED_UNRESOLVED', reason: 'CANARY_E0_ENTRY_APPROVAL_SIGNED_IDENTITY_INCOMPLETE' };
  }
  const receipt = await executor.getReceiptIfPresent(action.transactionHash);
  if (!receipt) {
    return {
      action: 'BLOCKED_UNRESOLVED',
      transactionHash: action.transactionHash,
      reason: 'CANARY_E0_ENTRY_APPROVAL_TX_NOT_YET_OBSERVED_NO_RETRY'
    };
  }
  if (receipt.status === 'reverted') {
    store.markReverted(action.actionId);
    return {
      action: 'BLOCKED_SETUP',
      transactionHash: action.transactionHash,
      reason: 'CANARY_E0_ENTRY_APPROVAL_REVERTED'
    };
  }
  const allowance = await executor.getTokenAllowance(action.intent.token, action.intent.spender);
  store.markIncluded(action.actionId, allowance);
  return { action: 'ENTRY_APPROVAL_INCLUDED', transactionHash: action.transactionHash };
}

function report(
  buyActionId: string,
  action: CanaryE0EntryApprovalRuntimeAction,
  extra: {
    entryApprovalActionId?: string | undefined;
    transactionHash?: Hex | undefined;
    reason?: string | undefined;
  } = {}
): CanaryE0EntryApprovalRuntimeReport {
  return { version: CANARY_E0_ENTRY_APPROVAL_RUNTIME_R0, action, buyActionId, ...extra };
}

function stableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
