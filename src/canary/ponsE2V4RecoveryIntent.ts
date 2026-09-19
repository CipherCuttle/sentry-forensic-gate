import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex
} from 'viem';
import {
  CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY
} from '../adapters/robinhood/ponsV2/v4ExitRecoveryAuthority.js';
import type {
  PonsE1V4PoolKey,
  PonsE1V4RecoveryPlan
} from './ponsE1V4ExitRecovery.js';

export const PONS_E2_SIGNED_V4_RECOVERY_V1 =
  'PONS_E2_SIGNED_V4_RECOVERY_V1' as const;

const erc20ApproveAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' }
  ],
  outputs: [{ name: '', type: 'bool' }]
}] as const;

const permit2ApproveAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'token', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' }
  ],
  outputs: []
}] as const;

const universalRouterAbi = [{
  type: 'function',
  name: 'execute',
  stateMutability: 'payable',
  inputs: [
    { name: 'commands', type: 'bytes' },
    { name: 'inputs', type: 'bytes[]' },
    { name: 'deadline', type: 'uint256' }
  ],
  outputs: []
}] as const;

interface PonsE2IntentBase {
  version: typeof PONS_E2_SIGNED_V4_RECOVERY_V1;
  token: Address;
  owner: Address;
  calldata: Hex;
  value: 0n;
}

export interface PonsE2TokenApprovalIntent extends PonsE2IntentBase {
  kind: 'TOKEN_APPROVE_PERMIT2_EXACT';
  target: Address;
  spender: Address;
  amount: bigint;
}

export interface PonsE2Permit2ApprovalIntent extends PonsE2IntentBase {
  kind: 'PERMIT2_ALLOW_ROUTER_EXACT';
  target: Address;
  spender: Address;
  amount: bigint;
  expiration: bigint;
}

export interface PonsE2V4ExitIntent extends PonsE2IntentBase {
  kind: 'V4_EXIT_ALL';
  target: Address;
  poolId: Hex;
  poolKey: PonsE1V4PoolKey;
  tokenAmount: bigint;
  minNativeOut: bigint;
  slippageBps: number;
  deadline: bigint;
}

export interface PonsE2Permit2RevokeIntent extends PonsE2IntentBase {
  kind: 'PERMIT2_REVOKE_ROUTER';
  target: Address;
  spender: Address;
}

export interface PonsE2TokenRevokeIntent extends PonsE2IntentBase {
  kind: 'TOKEN_REVOKE_PERMIT2';
  target: Address;
  spender: Address;
}

export type PonsE2RecoveryIntent =
  | PonsE2TokenApprovalIntent
  | PonsE2Permit2ApprovalIntent
  | PonsE2V4ExitIntent
  | PonsE2Permit2RevokeIntent
  | PonsE2TokenRevokeIntent;

export interface PonsE2RecoveryIntentSet {
  tokenApproval: PonsE2TokenApprovalIntent;
  permit2Approval: PonsE2Permit2ApprovalIntent;
  exit: PonsE2V4ExitIntent;
  permit2Revoke: PonsE2Permit2RevokeIntent;
  tokenRevoke: PonsE2TokenRevokeIntent;
}

export function buildPonsE2RecoveryIntents(params: {
  plan: PonsE1V4RecoveryPlan;
  poolId: Hex;
}): PonsE2RecoveryIntentSet {
  const { plan } = params;
  const token = getAddress(plan.token);
  const owner = getAddress(plan.owner);
  const permit2 = getAddress(
    CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2
  );
  const router = getAddress(
    CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.universalRouter
  );

  if (getAddress(plan.permit2) !== permit2) {
    throw new Error('PONS_E2_PLAN_PERMIT2_AUTHORITY_MISMATCH');
  }
  if (getAddress(plan.universalRouter) !== router) {
    throw new Error('PONS_E2_PLAN_ROUTER_AUTHORITY_MISMATCH');
  }
  if (plan.calls.length !== 3) {
    throw new Error('PONS_E2_PLAN_CALL_CARDINALITY_INVALID');
  }

  const [tokenCall, permit2Call, exitCall] = plan.calls;
  if (
    tokenCall.kind !== 'APPROVE_PERMIT2_EXACT' ||
    permit2Call.kind !== 'PERMIT2_ALLOW_ROUTER_EXACT' ||
    exitCall.kind !== 'V4_EXIT_ALL'
  ) {
    throw new Error('PONS_E2_PLAN_CALL_ORDER_INVALID');
  }

  const tokenApproval: PonsE2TokenApprovalIntent = {
    version: PONS_E2_SIGNED_V4_RECOVERY_V1,
    kind: 'TOKEN_APPROVE_PERMIT2_EXACT',
    token,
    owner,
    target: token,
    spender: permit2,
    amount: plan.tokenAmount,
    calldata: tokenCall.calldata,
    value: 0n
  };
  const permit2Approval: PonsE2Permit2ApprovalIntent = {
    version: PONS_E2_SIGNED_V4_RECOVERY_V1,
    kind: 'PERMIT2_ALLOW_ROUTER_EXACT',
    token,
    owner,
    target: permit2,
    spender: router,
    amount: plan.tokenAmount,
    expiration: plan.permit2Expiration,
    calldata: permit2Call.calldata,
    value: 0n
  };
  const exit: PonsE2V4ExitIntent = {
    version: PONS_E2_SIGNED_V4_RECOVERY_V1,
    kind: 'V4_EXIT_ALL',
    token,
    owner,
    target: router,
    poolId: params.poolId,
    poolKey: plan.poolKey,
    tokenAmount: plan.tokenAmount,
    minNativeOut: plan.minNativeOut,
    slippageBps: plan.slippageBps,
    deadline: plan.deadline,
    calldata: exitCall.calldata,
    value: 0n
  };
  const permit2Revoke: PonsE2Permit2RevokeIntent = {
    version: PONS_E2_SIGNED_V4_RECOVERY_V1,
    kind: 'PERMIT2_REVOKE_ROUTER',
    token,
    owner,
    target: permit2,
    spender: router,
    calldata: encodeFunctionData({
      abi: permit2ApproveAbi,
      functionName: 'approve',
      args: [token, router, 0n, 0]
    }),
    value: 0n
  };
  const tokenRevoke: PonsE2TokenRevokeIntent = {
    version: PONS_E2_SIGNED_V4_RECOVERY_V1,
    kind: 'TOKEN_REVOKE_PERMIT2',
    token,
    owner,
    target: token,
    spender: permit2,
    calldata: encodeFunctionData({
      abi: erc20ApproveAbi,
      functionName: 'approve',
      args: [permit2, 0n]
    }),
    value: 0n
  };

  for (const intent of [
    tokenApproval,
    permit2Approval,
    exit,
    permit2Revoke,
    tokenRevoke
  ]) {
    assertPonsE2RecoveryIntentCalldata(intent);
  }

  return {
    tokenApproval,
    permit2Approval,
    exit,
    permit2Revoke,
    tokenRevoke
  };
}

export function assertPonsE2RecoveryIntentCalldata(
  intent: PonsE2RecoveryIntent
): void {
  if (intent.version !== PONS_E2_SIGNED_V4_RECOVERY_V1) {
    throw new Error('PONS_E2_INTENT_VERSION_INVALID');
  }
  if (getAddress(intent.owner) === getAddress(intent.target)) {
    if (intent.kind !== 'TOKEN_APPROVE_PERMIT2_EXACT' &&
        intent.kind !== 'TOKEN_REVOKE_PERMIT2') {
      throw new Error('PONS_E2_SELF_TARGET_INVALID');
    }
  }
  if (intent.value !== 0n) {
    throw new Error('PONS_E2_NATIVE_VALUE_FORBIDDEN');
  }

  if (
    intent.kind === 'TOKEN_APPROVE_PERMIT2_EXACT' ||
    intent.kind === 'TOKEN_REVOKE_PERMIT2'
  ) {
    if (getAddress(intent.target) !== getAddress(intent.token)) {
      throw new Error('PONS_E2_TOKEN_APPROVAL_TARGET_MISMATCH');
    }
    const decoded = decodeFunctionData({
      abi: erc20ApproveAbi,
      data: intent.calldata
    });
    const expectedAmount =
      intent.kind === 'TOKEN_APPROVE_PERMIT2_EXACT' ? intent.amount : 0n;
    if (
      decoded.functionName !== 'approve' ||
      getAddress(decoded.args[0]) !== getAddress(intent.spender) ||
      decoded.args[1] !== expectedAmount
    ) {
      throw new Error('PONS_E2_TOKEN_APPROVAL_CALLDATA_MISMATCH');
    }
    return;
  }

  if (
    intent.kind === 'PERMIT2_ALLOW_ROUTER_EXACT' ||
    intent.kind === 'PERMIT2_REVOKE_ROUTER'
  ) {
    if (
      getAddress(intent.target) !==
      getAddress(CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.permit2)
    ) {
      throw new Error('PONS_E2_PERMIT2_TARGET_MISMATCH');
    }
    const decoded = decodeFunctionData({
      abi: permit2ApproveAbi,
      data: intent.calldata
    });
    const expectedAmount =
      intent.kind === 'PERMIT2_ALLOW_ROUTER_EXACT' ? intent.amount : 0n;
    const expectedExpiration =
      intent.kind === 'PERMIT2_ALLOW_ROUTER_EXACT' ? intent.expiration : 0n;
    if (
      decoded.functionName !== 'approve' ||
      getAddress(decoded.args[0]) !== getAddress(intent.token) ||
      getAddress(decoded.args[1]) !== getAddress(intent.spender) ||
      decoded.args[2] !== expectedAmount ||
      BigInt(decoded.args[3]) !== expectedExpiration
    ) {
      throw new Error('PONS_E2_PERMIT2_APPROVAL_CALLDATA_MISMATCH');
    }
    return;
  }

  if (
    getAddress(intent.target) !==
    getAddress(CURRENT_PONS_V2_V4_EXIT_RECOVERY_AUTHORITY.universalRouter)
  ) {
    throw new Error('PONS_E2_EXIT_ROUTER_MISMATCH');
  }
  const decoded = decodeFunctionData({
    abi: universalRouterAbi,
    data: intent.calldata
  });
  if (
    decoded.functionName !== 'execute' ||
    decoded.args[0] !== '0x10' ||
    decoded.args[2] !== intent.deadline ||
    decoded.args[1].length !== 1
  ) {
    throw new Error('PONS_E2_EXIT_CALLDATA_MISMATCH');
  }
}
