import { decodeFunctionData, encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { sha256Hex } from '../evidence/canonical.js';
import { ERC20_MAX_UINT256, erc20ApprovalAbi } from './approval.js';
import {
  assertCanaryEntryApprovalCalldata,
  CANARY_E0_ENTRY_APPROVAL_R0,
  type CanaryEntryApprovalIntent
} from './entryApproval.js';
import { INK_SWAP_ROUTER_02 } from './swapIntent.js';

export const CANARY_E0_ENTRY_APPROVAL_REVOKE_R0 = 'CANARY_E0_ENTRY_APPROVAL_REVOKE_R0' as const;

export interface CanaryEntryApprovalRevokeIntent {
  version: typeof CANARY_E0_ENTRY_APPROVAL_REVOKE_R0;
  actionId: string;
  parentEntryApprovalActionId: string;
  parentBuyActionId: string;
  launchId: string;
  baselineId: string;
  owner: Address;
  token: Address;
  spender: Address;
  expectedAllowance: bigint;
  amount: 0n;
  calldata: Hex;
}

export async function deriveCanaryEntryApprovalRevokeActionId(params: {
  parentEntryApprovalActionId: string;
  parentBuyActionId: string;
  launchId: string;
  baselineId: string;
  owner: Address;
  token: Address;
  spender: Address;
  expectedAllowance: bigint;
}): Promise<string> {
  if (!params.parentEntryApprovalActionId || !params.parentBuyActionId || !params.launchId || !params.baselineId) {
    throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_IDENTITY_REQUIRED');
  }
  assertExpectedAllowance(params.expectedAllowance);
  const spender = getAddress(params.spender);
  if (spender !== INK_SWAP_ROUTER_02) {
    throw new Error(`CANARY_ENTRY_APPROVAL_REVOKE_SPENDER_MUST_EQUAL_ROUTER:${spender}`);
  }
  return sha256Hex({
    kind: CANARY_E0_ENTRY_APPROVAL_REVOKE_R0,
    parentEntryApprovalActionId: params.parentEntryApprovalActionId,
    parentBuyActionId: params.parentBuyActionId,
    launchId: params.launchId,
    baselineId: params.baselineId,
    owner: getAddress(params.owner),
    token: getAddress(params.token),
    spender,
    expectedAllowance: params.expectedAllowance,
    amount: 0n
  });
}

export async function buildCanaryEntryApprovalRevokeIntent(
  parent: CanaryEntryApprovalIntent
): Promise<CanaryEntryApprovalRevokeIntent> {
  assertCanonicalParent(parent);
  const owner = getAddress(parent.owner);
  const token = getAddress(parent.token);
  const spender = getAddress(parent.spender);
  const actionId = await deriveCanaryEntryApprovalRevokeActionId({
    parentEntryApprovalActionId: parent.actionId,
    parentBuyActionId: parent.parentBuyActionId,
    launchId: parent.launchId,
    baselineId: parent.baselineId,
    owner,
    token,
    spender,
    expectedAllowance: parent.amount
  });
  if (actionId === parent.actionId || actionId === parent.parentBuyActionId) {
    throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_ACTION_ID_COLLISION');
  }
  const calldata = encodeFunctionData({
    abi: erc20ApprovalAbi,
    functionName: 'approve',
    args: [spender, 0n]
  });
  const intent: CanaryEntryApprovalRevokeIntent = {
    version: CANARY_E0_ENTRY_APPROVAL_REVOKE_R0,
    actionId,
    parentEntryApprovalActionId: parent.actionId,
    parentBuyActionId: parent.parentBuyActionId,
    launchId: parent.launchId,
    baselineId: parent.baselineId,
    owner,
    token,
    spender,
    expectedAllowance: parent.amount,
    amount: 0n,
    calldata
  };
  assertCanaryEntryApprovalRevokeCalldata(intent);
  return intent;
}

export function assertCanaryEntryApprovalRevokeCoversParent(
  revoke: CanaryEntryApprovalRevokeIntent,
  parent: CanaryEntryApprovalIntent
): void {
  assertCanonicalParent(parent);
  if (revoke.parentEntryApprovalActionId !== parent.actionId) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PARENT_APPROVAL_MISMATCH');
  if (revoke.parentBuyActionId !== parent.parentBuyActionId) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PARENT_BUY_MISMATCH');
  if (revoke.launchId !== parent.launchId || revoke.baselineId !== parent.baselineId) {
    throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PARENT_IDENTITY_MISMATCH');
  }
  if (getAddress(revoke.owner) !== getAddress(parent.owner)) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_OWNER_MISMATCH');
  if (getAddress(revoke.token) !== getAddress(parent.token)) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_TOKEN_MISMATCH');
  if (getAddress(revoke.spender) !== getAddress(parent.spender)) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_SPENDER_MISMATCH');
  if (revoke.expectedAllowance !== parent.amount) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_ALLOWANCE_MISMATCH');
  if (revoke.amount !== 0n) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_AMOUNT_NONZERO');
  assertCanaryEntryApprovalRevokeCalldata(revoke);
}

export function assertCanaryEntryApprovalRevokeCalldata(
  intent: Pick<CanaryEntryApprovalRevokeIntent, 'spender' | 'expectedAllowance' | 'amount' | 'calldata'>
): void {
  assertExpectedAllowance(intent.expectedAllowance);
  if (intent.amount !== 0n) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_AMOUNT_NONZERO');
  if (getAddress(intent.spender) !== INK_SWAP_ROUTER_02) {
    throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_CALLDATA_SPENDER_NOT_CANONICAL');
  }
  const decoded = decodeFunctionData({ abi: erc20ApprovalAbi, data: intent.calldata });
  if (decoded.functionName !== 'approve') throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_CALLDATA_FUNCTION_INVALID');
  const [spender, amount] = decoded.args;
  if (getAddress(spender) !== getAddress(intent.spender)) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_CALLDATA_SPENDER_MISMATCH');
  if (amount !== 0n) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_CALLDATA_AMOUNT_NOT_ZERO');
}

function assertCanonicalParent(parent: CanaryEntryApprovalIntent): void {
  if (parent.version !== CANARY_E0_ENTRY_APPROVAL_R0) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PARENT_VERSION_INVALID');
  assertCanaryEntryApprovalCalldata(parent);
  assertExpectedAllowance(parent.amount);
  if (getAddress(parent.spender) !== INK_SWAP_ROUTER_02) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PARENT_SPENDER_INVALID');
  if (!parent.actionId || !parent.parentBuyActionId || !parent.launchId || !parent.baselineId) {
    throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_PARENT_IDENTITY_MISSING');
  }
}

function assertExpectedAllowance(amount: bigint): void {
  if (amount <= 0n) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_EXPECTED_ALLOWANCE_MUST_BE_POSITIVE');
  if (amount === ERC20_MAX_UINT256) throw new Error('CANARY_ENTRY_APPROVAL_REVOKE_INFINITE_ALLOWANCE_FORBIDDEN');
}
