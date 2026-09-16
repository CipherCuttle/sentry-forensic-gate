import type { Address, Hex } from 'viem';
import type { CanaryEntryApprovalIntent } from './entryApproval.js';
import {
  assertCanaryEntryApprovalRevokeCoversParent,
  buildCanaryEntryApprovalRevokeIntent,
  type CanaryEntryApprovalRevokeIntent
} from './entryApprovalRevoke.js';
import {
  CanaryEntryApprovalRevokeStore,
  type CanaryEntryApprovalRevokeActionRecord
} from './entryApprovalRevokeStore.js';
import type { SignedCanaryTransaction } from './viemCanaryExecutor.js';

export const CANARY_E0_ENTRY_APPROVAL_REVOKE_RUNTIME_R0 = 'CANARY_E0_ENTRY_APPROVAL_REVOKE_RUNTIME_R0' as const;

export interface CanaryEntryApprovalRevokePreflight {
  actionId: string;
  wallet: Address;
  token: Address;
  spender: Address;
  expectedAllowance: bigint;
  amount: 0n;
  checkedAtBlock: bigint;
  allowanceBefore: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface CanaryEntryApprovalRevokeExecutor {
  readonly walletAddress: Address;
  getTokenAllowance(token: Address, spender: Address): Promise<bigint>;
  preflightEntryApprovalRevoke(intent: CanaryEntryApprovalRevokeIntent): Promise<CanaryEntryApprovalRevokePreflight>;
  signEntryApprovalRevoke(
    intent: CanaryEntryApprovalRevokeIntent,
    preflight: CanaryEntryApprovalRevokePreflight
  ): Promise<SignedCanaryTransaction>;
  broadcastExact(signed: SignedCanaryTransaction): Promise<Hex>;
  getReceiptIfPresent(transactionHash: Hex): Promise<{ status: string } | null>;
}

export type CanaryE0EntryApprovalRevokeRuntimeAction =
  | 'ALREADY_CLEAN'
  | 'ENTRY_APPROVAL_REVOKE_INCLUDED'
  | 'ENTRY_APPROVAL_REVOKE_SUBMITTED'
  | 'BLOCKED_UNRESOLVED'
  | 'BLOCKED_SETUP';

export interface CanaryE0EntryApprovalRevokeRuntimeReport {
  version: typeof CANARY_E0_ENTRY_APPROVAL_REVOKE_RUNTIME_R0;
  action: CanaryE0EntryApprovalRevokeRuntimeAction;
  parentEntryApprovalActionId: string;
  revokeActionId?: string | undefined;
  transactionHash?: Hex | undefined;
  reason?: string | undefined;
}

export type CanaryE0EntryApprovalRevokeReconcileReport =
  Omit<CanaryE0EntryApprovalRevokeRuntimeReport, 'action'> & {
    action: Exclude<CanaryE0EntryApprovalRevokeRuntimeAction, 'ALREADY_CLEAN'>;
  };

export async function advanceCanaryE0EntryApprovalRevoke(params: {
  parentApproval: CanaryEntryApprovalIntent;
  store: CanaryEntryApprovalRevokeStore;
  executor: CanaryEntryApprovalRevokeExecutor;
}): Promise<CanaryE0EntryApprovalRevokeRuntimeReport> {
  const intent = await buildCanaryEntryApprovalRevokeIntent(params.parentApproval);
  let committed = params.store.getCommitted();

  if (committed) {
    try {
      assertCanaryEntryApprovalRevokeCoversParent(committed.intent, params.parentApproval);
    } catch (error) {
      return report(params.parentApproval.actionId, 'BLOCKED_SETUP', {
        revokeActionId: committed.actionId,
        reason: stableError(error)
      });
    }
    if (committed.actionId !== intent.actionId) {
      return report(params.parentApproval.actionId, 'BLOCKED_SETUP', {
        revokeActionId: committed.actionId,
        reason: 'CANARY_ENTRY_APPROVAL_REVOKE_COMMITTED_IDENTITY_DRIFT'
      });
    }
    if (committed.state === 'REVERTED' || committed.state === 'SKIPPED') {
      return report(params.parentApproval.actionId, 'BLOCKED_SETUP', {
        revokeActionId: committed.actionId,
        transactionHash: committed.transactionHash ?? undefined,
        reason: `CANARY_ENTRY_APPROVAL_REVOKE_TERMINAL_STATE:${committed.state}`
      });
    }

    const reconciled = await reconcileRevoke(committed, params.store, params.executor);
    if (reconciled) {
      return report(params.parentApproval.actionId, reconciled.action, {
        revokeActionId: committed.actionId,
        transactionHash: reconciled.transactionHash,
        reason: reconciled.reason
      });
    }

    committed = params.store.getCommitted();
    if (!committed || committed.state !== 'INCLUDED') {
      return report(params.parentApproval.actionId, 'BLOCKED_UNRESOLVED', {
        revokeActionId: committed?.actionId,
        reason: 'CANARY_ENTRY_APPROVAL_REVOKE_NOT_INCLUDED_AFTER_RECONCILE'
      });
    }
    const allowance = await params.executor.getTokenAllowance(committed.intent.token, committed.intent.spender);
    if (allowance !== 0n) {
      return report(params.parentApproval.actionId, 'BLOCKED_SETUP', {
        revokeActionId: committed.actionId,
        reason: `CANARY_ENTRY_APPROVAL_REVOKE_POST_INCLUDE_ALLOWANCE_NOT_ZERO:${allowance}`
      });
    }
    return report(params.parentApproval.actionId, 'ALREADY_CLEAN', { revokeActionId: committed.actionId });
  }

  const currentAllowance = await params.executor.getTokenAllowance(intent.token, intent.spender);
  if (currentAllowance === 0n) {
    return report(params.parentApproval.actionId, 'ALREADY_CLEAN');
  }
  if (currentAllowance !== intent.expectedAllowance) {
    return report(params.parentApproval.actionId, 'BLOCKED_SETUP', {
      reason: `CANARY_ENTRY_APPROVAL_REVOKE_ALLOWANCE_DRIFT:${currentAllowance}:${intent.expectedAllowance}`
    });
  }
  return executeRevoke(intent, params.store, params.executor);
}

export async function reconcileCanaryE0EntryApprovalRevoke(params: {
  store: CanaryEntryApprovalRevokeStore;
  executor: CanaryEntryApprovalRevokeExecutor;
}): Promise<CanaryE0EntryApprovalRevokeReconcileReport | null> {
  const unresolved = params.store.listUnresolved();
  if (!unresolved.length) return null;
  if (unresolved.length > 1) {
    return reconcileReport(unresolved[0]!.parentEntryApprovalActionId, 'BLOCKED_SETUP', {
      revokeActionId: unresolved[0]!.actionId,
      reason: 'CANARY_ENTRY_APPROVAL_REVOKE_MULTIPLE_UNRESOLVED_INVARIANT_BROKEN'
    });
  }
  const action = unresolved[0]!;
  const reconciled = await reconcileRevoke(action, params.store, params.executor);
  if (!reconciled) return null;
  return reconcileReport(action.parentEntryApprovalActionId, reconciled.action, {
    revokeActionId: action.actionId,
    transactionHash: reconciled.transactionHash,
    reason: reconciled.reason
  });
}

async function executeRevoke(
  intent: CanaryEntryApprovalRevokeIntent,
  store: CanaryEntryApprovalRevokeStore,
  executor: CanaryEntryApprovalRevokeExecutor
): Promise<CanaryE0EntryApprovalRevokeRuntimeReport> {
  let preflight: CanaryEntryApprovalRevokePreflight;
  try {
    preflight = await executor.preflightEntryApprovalRevoke(intent);
  } catch (error) {
    return report(intent.parentEntryApprovalActionId, 'BLOCKED_SETUP', {
      revokeActionId: intent.actionId,
      reason: stableError(error)
    });
  }

  const now = Date.now();
  const inserted = await store.insertReserved({
    actionId: intent.actionId,
    parentEntryApprovalActionId: intent.parentEntryApprovalActionId,
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
  });
  if (inserted !== 'INSERTED') {
    return report(intent.parentEntryApprovalActionId, 'BLOCKED_UNRESOLVED', {
      revokeActionId: intent.actionId,
      reason: inserted === 'REVOKE_SLOT_TAKEN'
        ? 'CANARY_ENTRY_APPROVAL_REVOKE_SLOT_TAKEN'
        : 'CANARY_ENTRY_APPROVAL_REVOKE_RESERVATION_DUPLICATE_NO_SIGN'
    });
  }

  let signed: SignedCanaryTransaction;
  try {
    signed = await executor.signEntryApprovalRevoke(intent, preflight);
    store.markSigned(intent.actionId, signed);
  } catch (error) {
    store.markSafeHalt(intent.actionId, stableError(error));
    return report(intent.parentEntryApprovalActionId, 'BLOCKED_UNRESOLVED', {
      revokeActionId: intent.actionId,
      reason: stableError(error)
    });
  }

  try {
    const transactionHash = await executor.broadcastExact(signed);
    store.markSubmitted(intent.actionId);
    const receipt = await executor.getReceiptIfPresent(transactionHash);
    if (!receipt) {
      return report(intent.parentEntryApprovalActionId, 'ENTRY_APPROVAL_REVOKE_SUBMITTED', {
        revokeActionId: intent.actionId,
        transactionHash
      });
    }
    if (receipt.status === 'reverted') {
      store.markReverted(intent.actionId);
      return report(intent.parentEntryApprovalActionId, 'BLOCKED_SETUP', {
        revokeActionId: intent.actionId,
        transactionHash,
        reason: 'CANARY_ENTRY_APPROVAL_REVOKE_REVERTED'
      });
    }
    const allowance = await executor.getTokenAllowance(intent.token, intent.spender);
    store.markIncluded(intent.actionId, allowance);
    return report(intent.parentEntryApprovalActionId, 'ENTRY_APPROVAL_REVOKE_INCLUDED', {
      revokeActionId: intent.actionId,
      transactionHash
    });
  } catch (error) {
    store.markSafeHalt(intent.actionId, stableError(error));
    return report(intent.parentEntryApprovalActionId, 'BLOCKED_UNRESOLVED', {
      revokeActionId: intent.actionId,
      transactionHash: signed.transactionHash,
      reason: stableError(error)
    });
  }
}

async function reconcileRevoke(
  action: CanaryEntryApprovalRevokeActionRecord,
  store: CanaryEntryApprovalRevokeStore,
  executor: CanaryEntryApprovalRevokeExecutor
): Promise<{
  action: Exclude<CanaryE0EntryApprovalRevokeRuntimeAction, 'ALREADY_CLEAN'>;
  transactionHash?: Hex | undefined;
  reason?: string | undefined;
} | null> {
  if (action.state === 'INCLUDED') return null;
  if (action.state === 'RESERVED' && !action.transactionHash) {
    store.markSafeHalt(action.actionId, 'CANARY_ENTRY_APPROVAL_REVOKE_RESTART_AFTER_RESERVATION_NO_RETRY');
    return {
      action: 'BLOCKED_UNRESOLVED',
      reason: 'CANARY_ENTRY_APPROVAL_REVOKE_RESTART_AFTER_RESERVATION_NO_RETRY'
    };
  }
  if (!action.transactionHash || !action.serializedTransaction) {
    store.markSafeHalt(action.actionId, 'CANARY_ENTRY_APPROVAL_REVOKE_SIGNED_IDENTITY_INCOMPLETE');
    return {
      action: 'BLOCKED_UNRESOLVED',
      reason: 'CANARY_ENTRY_APPROVAL_REVOKE_SIGNED_IDENTITY_INCOMPLETE'
    };
  }
  const receipt = await executor.getReceiptIfPresent(action.transactionHash);
  if (!receipt) {
    return {
      action: 'BLOCKED_UNRESOLVED',
      transactionHash: action.transactionHash,
      reason: 'CANARY_ENTRY_APPROVAL_REVOKE_TX_NOT_YET_OBSERVED_NO_RETRY'
    };
  }
  if (receipt.status === 'reverted') {
    store.markReverted(action.actionId);
    return {
      action: 'BLOCKED_SETUP',
      transactionHash: action.transactionHash,
      reason: 'CANARY_ENTRY_APPROVAL_REVOKE_REVERTED'
    };
  }
  const allowance = await executor.getTokenAllowance(action.intent.token, action.intent.spender);
  store.markIncluded(action.actionId, allowance);
  return { action: 'ENTRY_APPROVAL_REVOKE_INCLUDED', transactionHash: action.transactionHash };
}

function reconcileReport(
  parentEntryApprovalActionId: string,
  action: Exclude<CanaryE0EntryApprovalRevokeRuntimeAction, 'ALREADY_CLEAN'>,
  extra: {
    revokeActionId?: string | undefined;
    transactionHash?: Hex | undefined;
    reason?: string | undefined;
  } = {}
): CanaryE0EntryApprovalRevokeReconcileReport {
  return {
    version: CANARY_E0_ENTRY_APPROVAL_REVOKE_RUNTIME_R0,
    action,
    parentEntryApprovalActionId,
    ...extra
  };
}

function report(
  parentEntryApprovalActionId: string,
  action: CanaryE0EntryApprovalRevokeRuntimeAction,
  extra: {
    revokeActionId?: string | undefined;
    transactionHash?: Hex | undefined;
    reason?: string | undefined;
  } = {}
): CanaryE0EntryApprovalRevokeRuntimeReport {
  return {
    version: CANARY_E0_ENTRY_APPROVAL_REVOKE_RUNTIME_R0,
    action,
    parentEntryApprovalActionId,
    ...extra
  };
}

function stableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
