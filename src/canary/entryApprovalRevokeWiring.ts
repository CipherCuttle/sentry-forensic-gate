import { getAddress } from 'viem';
import type { Hex } from '../domain.js';
import type { CanaryEntryApprovalActionRecord } from './entryApprovalStore.js';
import { CanaryEntryApprovalStore } from './entryApprovalStore.js';
import {
  advanceCanaryE0EntryApprovalRevoke,
  type CanaryEntryApprovalRevokeExecutor
} from './entryApprovalRevokeRuntime.js';
import { CanaryEntryApprovalRevokeStore } from './entryApprovalRevokeStore.js';

export const CANARY_E0_ENTRY_APPROVAL_REVOKE_WIRING_R0 = 'CANARY_E0_ENTRY_APPROVAL_REVOKE_WIRING_R0' as const;

export type CanaryEntryApprovalCleanupTrigger =
  | 'PARENT_BUY_INCLUDED'
  | 'PARENT_BUY_REVERTED'
  | 'PARENT_BUY_SKIPPED'
  | 'CANDIDATE_EXPIRED'
  | 'CANDIDATE_REJECTED'
  | 'REVOKE_RECOVERY';

export type CanaryEntryApprovalCleanupAction =
  | 'ENTRY_APPROVAL_CLEANED'
  | 'ENTRY_APPROVAL_REVOKE_INCLUDED'
  | 'ENTRY_APPROVAL_REVOKE_SUBMITTED'
  | 'BLOCKED_UNRESOLVED'
  | 'BLOCKED_SETUP';

export interface CanaryEntryApprovalCleanupReport {
  version: typeof CANARY_E0_ENTRY_APPROVAL_REVOKE_WIRING_R0;
  action: CanaryEntryApprovalCleanupAction;
  trigger: CanaryEntryApprovalCleanupTrigger;
  parentEntryApprovalActionId: string;
  transactionHash?: Hex | undefined;
  reason?: string | undefined;
}

export async function cleanupCanaryE0EntryApproval(params: {
  trigger: CanaryEntryApprovalCleanupTrigger;
  parentApproval: CanaryEntryApprovalActionRecord;
  entryApprovalStore: CanaryEntryApprovalStore;
  revokeStore: CanaryEntryApprovalRevokeStore;
  executor: CanaryEntryApprovalRevokeExecutor;
}): Promise<CanaryEntryApprovalCleanupReport> {
  if (params.parentApproval.state !== 'INCLUDED') {
    return report(params, 'BLOCKED_SETUP', {
      reason: `CANARY_E0_ENTRY_APPROVAL_CLEANUP_PARENT_NOT_INCLUDED:${params.parentApproval.state}`
    });
  }
  if (getAddress(params.parentApproval.intent.owner) !== getAddress(params.executor.walletAddress)) {
    return report(params, 'BLOCKED_SETUP', {
      reason: 'CANARY_E0_ENTRY_APPROVAL_CLEANUP_OWNER_MUST_EQUAL_EXECUTOR_WALLET'
    });
  }

  const revoke = await advanceCanaryE0EntryApprovalRevoke({
    parentApproval: params.parentApproval.intent,
    store: params.revokeStore,
    executor: params.executor
  });

  if (revoke.action === 'ALREADY_CLEAN' || revoke.action === 'ENTRY_APPROVAL_REVOKE_INCLUDED') {
    params.entryApprovalStore.markCleanupTerminal(params.parentApproval.actionId, params.trigger);
    return report(
      params,
      revoke.action === 'ALREADY_CLEAN' ? 'ENTRY_APPROVAL_CLEANED' : 'ENTRY_APPROVAL_REVOKE_INCLUDED',
      { transactionHash: revoke.transactionHash }
    );
  }

  return report(params, revoke.action, {
    transactionHash: revoke.transactionHash,
    reason: revoke.reason
  });
}

function report(
  params: Pick<Parameters<typeof cleanupCanaryE0EntryApproval>[0], 'trigger' | 'parentApproval'>,
  action: CanaryEntryApprovalCleanupAction,
  extra: { transactionHash?: Hex | undefined; reason?: string | undefined } = {}
): CanaryEntryApprovalCleanupReport {
  return {
    version: CANARY_E0_ENTRY_APPROVAL_REVOKE_WIRING_R0,
    action,
    trigger: params.trigger,
    parentEntryApprovalActionId: params.parentApproval.actionId,
    ...extra
  };
}
