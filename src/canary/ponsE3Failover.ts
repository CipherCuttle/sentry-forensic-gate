import {
  getAddress,
  type Address,
  type Hex
} from 'viem';
import type { PonsE1V4RecoveryPlan } from './ponsE1V4ExitRecovery.js';
import {
  buildPonsE2RecoveryIntents,
  type PonsE2RecoveryIntentSet
} from './ponsE2V4RecoveryIntent.js';

export const PONS_E3_E0_TO_E2_FAILOVER_V1 =
  'PONS_E3_E0_TO_E2_FAILOVER_V1' as const;

export type PonsE3CurveExitObservation =
  | {
      status: 'EXECUTABLE';
      curve: Address;
      tokensIn: bigint;
      quotedNativeOut: bigint;
      minNativeOut: bigint;
    }
  | {
      status: 'NOT_EXECUTABLE' | 'CURVE_INACTIVE' | 'ERROR';
      reason: string;
    };

export interface PonsE3V4RecoveryProof {
  verdict: 'PONS_E1_V4_EXIT_RECOVERY_DRY_READY';
  token: Address;
  owner: Address;
  tokenBalance: bigint;
  poolId: Hex;
  currentTokenAllowanceToPermit2: bigint;
  currentPermit2AllowanceToRouter: bigint;
  plan: PonsE1V4RecoveryPlan;
}

export type PonsE3FailoverDecision =
  | {
      version: typeof PONS_E3_E0_TO_E2_FAILOVER_V1;
      route: 'CURVE_EXIT';
      token: Address;
      owner: Address;
      tokenAmount: bigint;
      curve: Address;
      quotedNativeOut: bigint;
      minNativeOut: bigint;
    }
  | {
      version: typeof PONS_E3_E0_TO_E2_FAILOVER_V1;
      route: 'V4_RECOVERY';
      token: Address;
      owner: Address;
      tokenAmount: bigint;
      poolId: Hex;
      intents: PonsE2RecoveryIntentSet;
    }
  | {
      version: typeof PONS_E3_E0_TO_E2_FAILOVER_V1;
      route: 'STOP';
      token: Address;
      owner: Address;
      tokenAmount: bigint;
      reason: string;
    };

export function decidePonsE3PostBuyExit(params: {
  token: Address;
  owner: Address;
  postBuyTokenBalance: bigint;
  curveExit: PonsE3CurveExitObservation;
  v4Recovery?: PonsE3V4RecoveryProof;
}): PonsE3FailoverDecision {
  const token = getAddress(params.token);
  const owner = getAddress(params.owner);
  const tokenAmount = params.postBuyTokenBalance;

  if (tokenAmount <= 0n) {
    return stop(token, owner, tokenAmount, 'PONS_E3_POST_BUY_TOKEN_BALANCE_NOT_POSITIVE');
  }

  if (params.curveExit.status === 'EXECUTABLE') {
    if (params.curveExit.tokensIn !== tokenAmount) {
      return stop(token, owner, tokenAmount, 'PONS_E3_CURVE_EXIT_NOT_FULL_BALANCE');
    }
    if (
      params.curveExit.quotedNativeOut <= 0n ||
      params.curveExit.minNativeOut <= 0n ||
      params.curveExit.minNativeOut > params.curveExit.quotedNativeOut
    ) {
      return stop(token, owner, tokenAmount, 'PONS_E3_CURVE_EXIT_QUOTE_INVALID');
    }
    return {
      version: PONS_E3_E0_TO_E2_FAILOVER_V1,
      route: 'CURVE_EXIT',
      token,
      owner,
      tokenAmount,
      curve: getAddress(params.curveExit.curve),
      quotedNativeOut: params.curveExit.quotedNativeOut,
      minNativeOut: params.curveExit.minNativeOut
    };
  }

  if (params.curveExit.status === 'ERROR') {
    return stop(
      token,
      owner,
      tokenAmount,
      `PONS_E3_CURVE_EXIT_ERROR_FAIL_CLOSED:${params.curveExit.reason}`
    );
  }

  const proof = params.v4Recovery;
  if (!proof) {
    return stop(token, owner, tokenAmount, 'PONS_E3_V4_RECOVERY_PROOF_MISSING');
  }
  if (proof.verdict !== 'PONS_E1_V4_EXIT_RECOVERY_DRY_READY') {
    return stop(token, owner, tokenAmount, 'PONS_E3_V4_RECOVERY_VERDICT_INVALID');
  }
  if (getAddress(proof.token) !== token) {
    return stop(token, owner, tokenAmount, 'PONS_E3_V4_RECOVERY_TOKEN_MISMATCH');
  }
  if (getAddress(proof.owner) !== owner) {
    return stop(token, owner, tokenAmount, 'PONS_E3_V4_RECOVERY_OWNER_MISMATCH');
  }
  if (
    proof.tokenBalance !== tokenAmount ||
    proof.plan.tokenAmount !== tokenAmount
  ) {
    return stop(token, owner, tokenAmount, 'PONS_E3_V4_RECOVERY_BALANCE_DRIFT');
  }
  if (
    getAddress(proof.plan.token) !== token ||
    getAddress(proof.plan.owner) !== owner
  ) {
    return stop(token, owner, tokenAmount, 'PONS_E3_V4_RECOVERY_PLAN_IDENTITY_DRIFT');
  }
  if (
    proof.currentTokenAllowanceToPermit2 !== 0n ||
    proof.currentPermit2AllowanceToRouter !== 0n
  ) {
    return stop(token, owner, tokenAmount, 'PONS_E3_V4_RECOVERY_DIRTY_PREEXISTING_AUTHORITY');
  }

  const intents = buildPonsE2RecoveryIntents({
    plan: proof.plan,
    poolId: proof.poolId
  });
  if (
    intents.tokenApproval.amount !== tokenAmount ||
    intents.permit2Approval.amount !== tokenAmount ||
    intents.exit.tokenAmount !== tokenAmount
  ) {
    return stop(token, owner, tokenAmount, 'PONS_E3_V4_RECOVERY_INTENT_AMOUNT_DRIFT');
  }

  return {
    version: PONS_E3_E0_TO_E2_FAILOVER_V1,
    route: 'V4_RECOVERY',
    token,
    owner,
    tokenAmount,
    poolId: proof.poolId,
    intents
  };
}

function stop(
  token: Address,
  owner: Address,
  tokenAmount: bigint,
  reason: string
): PonsE3FailoverDecision {
  return {
    version: PONS_E3_E0_TO_E2_FAILOVER_V1,
    route: 'STOP',
    token,
    owner,
    tokenAmount,
    reason
  };
}
