import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex
} from 'viem';
import { ponsE0TokenAbi } from './ponsE0Contracts.js';
import {
  decidePonsE3PostBuyExit,
  type PonsE3V4RecoveryProof
} from './ponsE3Failover.js';
import type { PonsE2RecoveryIntentSet } from './ponsE2V4RecoveryIntent.js';

export const PONS_E3B_RUNTIME_FAILOVER_V1 =
  'PONS_E3B_RUNTIME_FAILOVER_V1' as const;

export interface PonsE3BCurveRevokeIntent {
  version: typeof PONS_E3B_RUNTIME_FAILOVER_V1;
  kind: 'TOKEN_REVOKE_CURVE';
  token: Address;
  owner: Address;
  curve: Address;
  target: Address;
  calldata: Hex;
  value: 0n;
}

export type PonsE3BRuntimeDecision =
  | {
      version: typeof PONS_E3B_RUNTIME_FAILOVER_V1;
      route: 'CURVE_PATH_ACTIVE';
      token: Address;
      owner: Address;
      curve: Address;
      tokenAmount: bigint;
    }
  | {
      version: typeof PONS_E3B_RUNTIME_FAILOVER_V1;
      route: 'CURVE_REVOKE_REQUIRED';
      token: Address;
      owner: Address;
      curve: Address;
      tokenAmount: bigint;
      currentCurveAllowance: bigint;
      cleanup: PonsE3BCurveRevokeIntent;
      nextAction: 'REVERIFY_FROM_CHAIN_AFTER_REVOKE';
    }
  | {
      version: typeof PONS_E3B_RUNTIME_FAILOVER_V1;
      route: 'V4_HANDOFF_READY';
      token: Address;
      owner: Address;
      curve: Address;
      tokenAmount: bigint;
      poolId: Hex;
      e2Intents: PonsE2RecoveryIntentSet;
    }
  | {
      version: typeof PONS_E3B_RUNTIME_FAILOVER_V1;
      route: 'STOP';
      token: Address;
      owner: Address;
      curve: Address;
      tokenAmount: bigint;
      reason: string;
    };

export function buildPonsE3BCurveRevokeIntent(params: {
  token: Address;
  owner: Address;
  curve: Address;
}): PonsE3BCurveRevokeIntent {
  const token = getAddress(params.token);
  const owner = getAddress(params.owner);
  const curve = getAddress(params.curve);
  const calldata = encodeFunctionData({
    abi: ponsE0TokenAbi,
    functionName: 'approve',
    args: [curve, 0n]
  });
  const intent: PonsE3BCurveRevokeIntent = {
    version: PONS_E3B_RUNTIME_FAILOVER_V1,
    kind: 'TOKEN_REVOKE_CURVE',
    token,
    owner,
    curve,
    target: token,
    calldata,
    value: 0n
  };
  assertPonsE3BCurveRevokeIntent(intent);
  return intent;
}

export function assertPonsE3BCurveRevokeIntent(
  intent: PonsE3BCurveRevokeIntent
): void {
  if (intent.version !== PONS_E3B_RUNTIME_FAILOVER_V1) {
    throw new Error('PONS_E3B_CURVE_REVOKE_VERSION_INVALID');
  }
  if (intent.kind !== 'TOKEN_REVOKE_CURVE') {
    throw new Error('PONS_E3B_CURVE_REVOKE_KIND_INVALID');
  }
  if (getAddress(intent.target) !== getAddress(intent.token)) {
    throw new Error('PONS_E3B_CURVE_REVOKE_TARGET_MISMATCH');
  }
  if (intent.value !== 0n) {
    throw new Error('PONS_E3B_CURVE_REVOKE_NATIVE_VALUE_FORBIDDEN');
  }
  const decoded = decodeFunctionData({
    abi: ponsE0TokenAbi,
    data: intent.calldata
  });
  if (
    decoded.functionName !== 'approve' ||
    getAddress(decoded.args[0]) !== getAddress(intent.curve) ||
    decoded.args[1] !== 0n
  ) {
    throw new Error('PONS_E3B_CURVE_REVOKE_CALLDATA_MISMATCH');
  }
}

export function decidePonsE3BRuntimeFailover(params: {
  token: Address;
  owner: Address;
  curve: Address;
  postBuyTokenBalance: bigint;
  e0Status: 'BUY_INCLUDED' | 'APPROVAL_INCLUDED';
  curveGraduated: boolean;
  curveReadyToGraduate: boolean;
  currentCurveAllowance: bigint;
  allowanceBlockHash?: Hex;
  v4Recovery?: PonsE3V4RecoveryProof;
}): PonsE3BRuntimeDecision {
  const token = getAddress(params.token);
  const owner = getAddress(params.owner);
  const curve = getAddress(params.curve);
  const tokenAmount = params.postBuyTokenBalance;

  if (tokenAmount <= 0n) {
    return stop(token, owner, curve, tokenAmount, 'PONS_E3B_POST_BUY_BALANCE_INVALID');
  }
  if (params.currentCurveAllowance < 0n) {
    return stop(token, owner, curve, tokenAmount, 'PONS_E3B_CURVE_ALLOWANCE_INVALID');
  }

  if (!params.curveGraduated && !params.curveReadyToGraduate) {
    return {
      version: PONS_E3B_RUNTIME_FAILOVER_V1,
      route: 'CURVE_PATH_ACTIVE',
      token,
      owner,
      curve,
      tokenAmount
    };
  }

  if (!params.curveGraduated && params.curveReadyToGraduate) {
    return stop(
      token,
      owner,
      curve,
      tokenAmount,
      'PONS_E3B_GRADUATION_PENDING_FAIL_CLOSED'
    );
  }

  if (params.currentCurveAllowance !== 0n) {
    return {
      version: PONS_E3B_RUNTIME_FAILOVER_V1,
      route: 'CURVE_REVOKE_REQUIRED',
      token,
      owner,
      curve,
      tokenAmount,
      currentCurveAllowance: params.currentCurveAllowance,
      cleanup: buildPonsE3BCurveRevokeIntent({ token, owner, curve }),
      nextAction: 'REVERIFY_FROM_CHAIN_AFTER_REVOKE'
    };
  }

  if (!params.v4Recovery || !params.allowanceBlockHash) {
    return stop(
      token,
      owner,
      curve,
      tokenAmount,
      'PONS_E3B_V4_PROOF_REQUIRED_AFTER_CLEAN_CURVE_AUTHORITY'
    );
  }

  const e3 = decidePonsE3PostBuyExit({
    token,
    owner,
    postBuyTokenBalance: tokenAmount,
    e0CurveAllowance: 0n,
    curveExit: {
      status: 'CURVE_INACTIVE',
      reason: 'graduated'
    },
    v4Recovery: {
      ...params.v4Recovery,
      curveAllowanceBlockHash: params.allowanceBlockHash
    }
  });

  if (e3.route !== 'V4_RECOVERY') {
    return stop(
      token,
      owner,
      curve,
      tokenAmount,
      `PONS_E3B_E3_HANDOFF_REJECTED:${e3.route === 'STOP' ? e3.reason : e3.route}`
    );
  }

  return {
    version: PONS_E3B_RUNTIME_FAILOVER_V1,
    route: 'V4_HANDOFF_READY',
    token,
    owner,
    curve,
    tokenAmount,
    poolId: e3.poolId,
    e2Intents: e3.intents
  };
}

function stop(
  token: Address,
  owner: Address,
  curve: Address,
  tokenAmount: bigint,
  reason: string
): PonsE3BRuntimeDecision {
  return {
    version: PONS_E3B_RUNTIME_FAILOVER_V1,
    route: 'STOP',
    token,
    owner,
    curve,
    tokenAmount,
    reason
  };
}
