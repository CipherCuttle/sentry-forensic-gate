import type { Address, Hex } from 'viem';
import { sha256Hex } from '../evidence/canonical.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  CANARY_SNIPER_R0,
  deriveCanaryActionId,
  type CanarySwapIntent
} from './swapIntent.js';

export const CANARY_E0_ROUNDTRIP_R0 = 'CANARY_E0_ROUNDTRIP_R0' as const;
export const CANARY_E0_EXIT_R0 = 'CANARY_E0_EXIT_R0' as const;

export interface CanaryExitIntent extends CanarySwapIntent {
  roundTripVersion: typeof CANARY_E0_ROUNDTRIP_R0;
  leg: 'EXIT';
  parentBuyActionId: string;
}

export interface CanaryExitIntentInput {
  buyIntent: CanarySwapIntent;
  quoteBlockNumber: bigint;
  quoteBlockHash: Hex;
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippageBps: number;
  chainTimestampSeconds: number;
  deadlineSeconds: number;
}

export async function deriveCanaryExitActionId(params: {
  parentBuyActionId: string;
  launchId: string;
  baselineId: string;
}): Promise<string> {
  if (!params.parentBuyActionId || !params.launchId || !params.baselineId) {
    throw new Error('CANARY_EXIT_IDENTITY_REQUIRED');
  }
  return sha256Hex({
    kind: CANARY_E0_EXIT_R0,
    parentBuyActionId: params.parentBuyActionId,
    launchId: params.launchId,
    baselineId: params.baselineId,
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS
  });
}

export async function buildCanaryExitIntent(input: CanaryExitIntentInput): Promise<CanaryExitIntent> {
  assertCanonicalBuyIntent(input.buyIntent);
  if (input.amountIn <= 0n) throw new Error('CANARY_EXIT_AMOUNT_IN_MUST_BE_POSITIVE');
  if (input.quotedAmountOut <= 0n) throw new Error('CANARY_EXIT_QUOTED_AMOUNT_OUT_MUST_BE_POSITIVE');

  const expectedBuyActionId = await deriveCanaryActionId(input.buyIntent.launchId, input.buyIntent.baselineId);
  if (input.buyIntent.actionId !== expectedBuyActionId) {
    throw new Error('CANARY_EXIT_PARENT_BUY_IDENTITY_DRIFT');
  }

  // The exit deliberately reuses the already-reviewed generic swap-intent builder
  // with token direction reversed. Its generic action ID is replaced below with a
  // child ID bound to the exact parent buy so the exit can never collide with the
  // singleton buy authority.
  const genericExit = await buildCanarySwapIntent({
    launchId: input.buyIntent.launchId,
    baselineId: input.buyIntent.baselineId,
    quoteBlockNumber: input.quoteBlockNumber,
    quoteBlockHash: input.quoteBlockHash,
    tokenIn: input.buyIntent.tokenOut as Address,
    tokenOut: input.buyIntent.tokenIn as Address,
    fee: input.buyIntent.fee,
    recipient: input.buyIntent.recipient,
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
    amountIn: input.amountIn,
    quotedAmountOut: input.quotedAmountOut,
    slippageBps: input.slippageBps,
    chainTimestampSeconds: input.chainTimestampSeconds,
    deadlineSeconds: input.deadlineSeconds
  });
  const actionId = await deriveCanaryExitActionId({
    parentBuyActionId: input.buyIntent.actionId,
    launchId: input.buyIntent.launchId,
    baselineId: input.buyIntent.baselineId
  });
  if (actionId === input.buyIntent.actionId) throw new Error('CANARY_EXIT_ACTION_ID_COLLISION');

  return {
    ...genericExit,
    actionId,
    roundTripVersion: CANARY_E0_ROUNDTRIP_R0,
    leg: 'EXIT',
    parentBuyActionId: input.buyIntent.actionId
  };
}

function assertCanonicalBuyIntent(intent: CanarySwapIntent): void {
  if (intent.version !== CANARY_SNIPER_R0) throw new Error('CANARY_EXIT_PARENT_VERSION_INVALID');
  if (intent.notionalUsdMicros !== CANARY_PRIMARY_NOTIONAL_USD_MICROS) {
    throw new Error('CANARY_EXIT_PARENT_NOTIONAL_INVALID');
  }
  if (intent.value !== 0n) throw new Error('CANARY_EXIT_PARENT_VALUE_INVALID');
  if (!intent.launchId || !intent.baselineId || !intent.actionId) throw new Error('CANARY_EXIT_PARENT_IDENTITY_MISSING');
}
