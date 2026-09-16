import { decodeFunctionData, encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { sha256Hex } from '../evidence/canonical.js';
import { deriveCanaryExitActionId } from './roundTrip.js';
import {
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  CANARY_SNIPER_R0,
  deriveCanaryActionId,
  type CanarySwapIntent
} from './swapIntent.js';

export const CANARY_E0_APPROVAL_R0 = 'CANARY_E0_APPROVAL_R0' as const;
export const ERC20_MAX_UINT256 = (1n << 256n) - 1n;

export const erc20ApprovalAbi = [
  {
    type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

export interface CanaryApprovalIntent {
  version: typeof CANARY_E0_APPROVAL_R0;
  actionId: string;
  parentBuyActionId: string;
  parentExitActionId: string;
  launchId: string;
  baselineId: string;
  token: Address;
  spender: Address;
  amount: bigint;
  calldata: Hex;
}

export type CanaryApprovalAllowanceDisposition = 'APPROVE_EXACT' | 'BLOCKED_DIRTY_ALLOWANCE';

export async function deriveCanaryApprovalActionId(params: {
  parentBuyActionId: string;
  parentExitActionId: string;
  launchId: string;
  baselineId: string;
  token: Address;
  spender: Address;
  amount: bigint;
}): Promise<string> {
  if (!params.parentBuyActionId || !params.parentExitActionId || !params.launchId || !params.baselineId) {
    throw new Error('CANARY_APPROVAL_IDENTITY_REQUIRED');
  }
  assertExactApprovalAmount(params.amount);
  return sha256Hex({
    kind: CANARY_E0_APPROVAL_R0,
    parentBuyActionId: params.parentBuyActionId,
    parentExitActionId: params.parentExitActionId,
    launchId: params.launchId,
    baselineId: params.baselineId,
    token: getAddress(params.token),
    spender: getAddress(params.spender),
    amount: params.amount,
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS
  });
}

export async function buildCanaryApprovalIntent(params: {
  buyIntent: CanarySwapIntent;
  acquiredAmount: bigint;
}): Promise<CanaryApprovalIntent> {
  assertCanonicalParentBuy(params.buyIntent);
  assertExactApprovalAmount(params.acquiredAmount);
  const expectedBuyActionId = await deriveCanaryActionId(params.buyIntent.launchId, params.buyIntent.baselineId);
  if (params.buyIntent.actionId !== expectedBuyActionId) throw new Error('CANARY_APPROVAL_PARENT_BUY_IDENTITY_DRIFT');

  const parentExitActionId = await deriveCanaryExitActionId({
    parentBuyActionId: params.buyIntent.actionId,
    launchId: params.buyIntent.launchId,
    baselineId: params.buyIntent.baselineId
  });
  const token = getAddress(params.buyIntent.tokenOut);
  const spender = getAddress(params.buyIntent.router);
  const actionId = await deriveCanaryApprovalActionId({
    parentBuyActionId: params.buyIntent.actionId,
    parentExitActionId,
    launchId: params.buyIntent.launchId,
    baselineId: params.buyIntent.baselineId,
    token,
    spender,
    amount: params.acquiredAmount
  });
  if (actionId === params.buyIntent.actionId || actionId === parentExitActionId) {
    throw new Error('CANARY_APPROVAL_ACTION_ID_COLLISION');
  }
  const calldata = encodeFunctionData({
    abi: erc20ApprovalAbi,
    functionName: 'approve',
    args: [spender, params.acquiredAmount]
  });
  assertCanaryApprovalCalldata({ token, spender, amount: params.acquiredAmount, calldata });
  return {
    version: CANARY_E0_APPROVAL_R0,
    actionId,
    parentBuyActionId: params.buyIntent.actionId,
    parentExitActionId,
    launchId: params.buyIntent.launchId,
    baselineId: params.buyIntent.baselineId,
    token,
    spender,
    amount: params.acquiredAmount,
    calldata
  };
}

export function classifyCanaryApprovalAllowance(current: bigint, required: bigint): CanaryApprovalAllowanceDisposition {
  if (current < 0n) throw new Error('CANARY_APPROVAL_ALLOWANCE_INVALID');
  assertExactApprovalAmount(required);
  if (current === 0n) return 'APPROVE_EXACT';
  return 'BLOCKED_DIRTY_ALLOWANCE';
}

export function assertCanaryApprovalCalldata(intent: Pick<CanaryApprovalIntent, 'spender' | 'amount' | 'calldata'> & { token?: Address }): void {
  assertExactApprovalAmount(intent.amount);
  const decoded = decodeFunctionData({ abi: erc20ApprovalAbi, data: intent.calldata });
  if (decoded.functionName !== 'approve') throw new Error('CANARY_APPROVAL_CALLDATA_FUNCTION_INVALID');
  const [spender, amount] = decoded.args;
  if (getAddress(spender) !== getAddress(intent.spender)) throw new Error('CANARY_APPROVAL_CALLDATA_SPENDER_MISMATCH');
  if (amount !== intent.amount) throw new Error('CANARY_APPROVAL_CALLDATA_AMOUNT_MISMATCH');
}

function assertExactApprovalAmount(amount: bigint): void {
  if (amount <= 0n) throw new Error('CANARY_APPROVAL_AMOUNT_MUST_BE_POSITIVE');
  if (amount === ERC20_MAX_UINT256) throw new Error('CANARY_APPROVAL_INFINITE_ALLOWANCE_FORBIDDEN');
}

function assertCanonicalParentBuy(intent: CanarySwapIntent): void {
  if (intent.version !== CANARY_SNIPER_R0) throw new Error('CANARY_APPROVAL_PARENT_VERSION_INVALID');
  if (intent.notionalUsdMicros !== CANARY_PRIMARY_NOTIONAL_USD_MICROS) throw new Error('CANARY_APPROVAL_PARENT_NOTIONAL_INVALID');
  if (intent.value !== 0n) throw new Error('CANARY_APPROVAL_PARENT_VALUE_INVALID');
  if (!intent.actionId || !intent.launchId || !intent.baselineId) throw new Error('CANARY_APPROVAL_PARENT_IDENTITY_MISSING');
}
