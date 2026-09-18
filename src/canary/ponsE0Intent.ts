import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex
} from 'viem';
import { PONS_V2_NATIVE_PAIR_TOKEN } from '../adapters/robinhood/ponsV2/contracts.js';
import { ponsE0CurveTradeAbi, ponsE0TokenAbi } from './ponsE0Contracts.js';

export const PONS_E0_LIVE_CANARY_R0 = 'PONS_E0_LIVE_CANARY_R0' as const;
export const PONS_E0_NOTIONAL_USD_MICROS = 1_000_000n;
export const PONS_E0_MAX_SLIPPAGE_BPS = 1_000;
export const PONS_E0_MAX_SELLABLE_SHARE_BPS = 100n;

export interface PonsE0BuyIntent {
  version: typeof PONS_E0_LIVE_CANARY_R0;
  kind: 'BUY';
  token: Address;
  curve: Address;
  recipient: Address;
  notionalUsdMicros: bigint;
  quoteIn: bigint;
  quotedTokensOut: bigint;
  minTokensOut: bigint;
  sellableTokens: bigint;
  snipeTaxBps: 0n;
  slippageBps: number;
  calldata: Hex;
  value: bigint;
}

export interface PonsE0ApprovalIntent {
  version: typeof PONS_E0_LIVE_CANARY_R0;
  kind: 'APPROVE_SELL_EXACT';
  token: Address;
  curve: Address;
  owner: Address;
  amount: bigint;
  calldata: Hex;
  value: 0n;
}

export interface PonsE0SellIntent {
  version: typeof PONS_E0_LIVE_CANARY_R0;
  kind: 'SELL_ALL';
  token: Address;
  curve: Address;
  recipient: Address;
  tokensIn: bigint;
  quotedQuoteOut: bigint;
  minQuoteOut: bigint;
  slippageBps: number;
  calldata: Hex;
  value: 0n;
}

export type PonsE0Intent = PonsE0BuyIntent | PonsE0ApprovalIntent | PonsE0SellIntent;

export function buildPonsE0BuyIntent(params: {
  token: Address;
  curve: Address;
  recipient: Address;
  pairToken: Address;
  notionalUsdMicros: bigint;
  quoteIn: bigint;
  quotedTokensOut: bigint;
  sellableTokens: bigint;
  snipeTaxBps: bigint;
  slippageBps: number;
}): PonsE0BuyIntent {
  assertAddress(params.token, 'TOKEN');
  assertAddress(params.curve, 'CURVE');
  assertAddress(params.recipient, 'RECIPIENT');
  if (getAddress(params.pairToken) !== getAddress(PONS_V2_NATIVE_PAIR_TOKEN)) {
    throw new Error('PONS_E0_NATIVE_PAIR_REQUIRED');
  }
  if (params.notionalUsdMicros !== PONS_E0_NOTIONAL_USD_MICROS) {
    throw new Error('PONS_E0_NOTIONAL_MUST_EQUAL_ONE_DOLLAR');
  }
  if (params.quoteIn <= 0n || params.quotedTokensOut <= 0n || params.sellableTokens <= 0n) {
    throw new Error('PONS_E0_BUY_QUOTE_INVALID');
  }
  if (params.snipeTaxBps !== 0n) {
    throw new Error(`PONS_E0_SNIPE_TAX_MUST_BE_ZERO:${params.snipeTaxBps}`);
  }
  assertSlippage(params.slippageBps);
  if (
    params.quotedTokensOut * 10_000n >
    params.sellableTokens * PONS_E0_MAX_SELLABLE_SHARE_BPS
  ) {
    throw new Error('PONS_E0_BUY_TOO_CLOSE_TO_GRADUATION');
  }
  const minTokensOut = applySlippage(params.quotedTokensOut, params.slippageBps);
  if (minTokensOut <= 0n) throw new Error('PONS_E0_BUY_MIN_OUTPUT_INVALID');
  const calldata = encodeFunctionData({
    abi: ponsE0CurveTradeAbi,
    functionName: 'buy',
    args: [params.quoteIn, minTokensOut, params.recipient]
  });
  const intent: PonsE0BuyIntent = {
    version: PONS_E0_LIVE_CANARY_R0,
    kind: 'BUY',
    token: getAddress(params.token),
    curve: getAddress(params.curve),
    recipient: getAddress(params.recipient),
    notionalUsdMicros: params.notionalUsdMicros,
    quoteIn: params.quoteIn,
    quotedTokensOut: params.quotedTokensOut,
    minTokensOut,
    sellableTokens: params.sellableTokens,
    snipeTaxBps: 0n,
    slippageBps: params.slippageBps,
    calldata,
    value: params.quoteIn
  };
  assertPonsE0IntentCalldata(intent);
  return intent;
}

export function buildPonsE0ApprovalIntent(params: {
  token: Address;
  curve: Address;
  owner: Address;
  amount: bigint;
}): PonsE0ApprovalIntent {
  assertAddress(params.token, 'TOKEN');
  assertAddress(params.curve, 'CURVE');
  assertAddress(params.owner, 'OWNER');
  if (params.amount <= 0n) throw new Error('PONS_E0_APPROVAL_AMOUNT_INVALID');
  const calldata = encodeFunctionData({
    abi: ponsE0TokenAbi,
    functionName: 'approve',
    args: [params.curve, params.amount]
  });
  const intent: PonsE0ApprovalIntent = {
    version: PONS_E0_LIVE_CANARY_R0,
    kind: 'APPROVE_SELL_EXACT',
    token: getAddress(params.token),
    curve: getAddress(params.curve),
    owner: getAddress(params.owner),
    amount: params.amount,
    calldata,
    value: 0n
  };
  assertPonsE0IntentCalldata(intent);
  return intent;
}

export function buildPonsE0SellIntent(params: {
  token: Address;
  curve: Address;
  recipient: Address;
  tokensIn: bigint;
  quotedQuoteOut: bigint;
  slippageBps: number;
}): PonsE0SellIntent {
  assertAddress(params.token, 'TOKEN');
  assertAddress(params.curve, 'CURVE');
  assertAddress(params.recipient, 'RECIPIENT');
  if (params.tokensIn <= 0n || params.quotedQuoteOut <= 0n) {
    throw new Error('PONS_E0_SELL_QUOTE_INVALID');
  }
  assertSlippage(params.slippageBps);
  const minQuoteOut = applySlippage(params.quotedQuoteOut, params.slippageBps);
  if (minQuoteOut <= 0n) throw new Error('PONS_E0_SELL_MIN_OUTPUT_INVALID');
  const calldata = encodeFunctionData({
    abi: ponsE0CurveTradeAbi,
    functionName: 'sell',
    args: [params.tokensIn, minQuoteOut, params.recipient]
  });
  const intent: PonsE0SellIntent = {
    version: PONS_E0_LIVE_CANARY_R0,
    kind: 'SELL_ALL',
    token: getAddress(params.token),
    curve: getAddress(params.curve),
    recipient: getAddress(params.recipient),
    tokensIn: params.tokensIn,
    quotedQuoteOut: params.quotedQuoteOut,
    minQuoteOut,
    slippageBps: params.slippageBps,
    calldata,
    value: 0n
  };
  assertPonsE0IntentCalldata(intent);
  return intent;
}

export function assertPonsE0IntentCalldata(intent: PonsE0Intent): void {
  if (intent.version !== PONS_E0_LIVE_CANARY_R0) {
    throw new Error('PONS_E0_INTENT_VERSION_INVALID');
  }
  if (intent.kind === 'BUY') {
    const decoded = decodeFunctionData({ abi: ponsE0CurveTradeAbi, data: intent.calldata });
    if (
      decoded.functionName !== 'buy' ||
      decoded.args[0] !== intent.quoteIn ||
      decoded.args[1] !== intent.minTokensOut ||
      getAddress(decoded.args[2]) !== getAddress(intent.recipient) ||
      intent.value !== intent.quoteIn
    ) {
      throw new Error('PONS_E0_BUY_CALLDATA_MISMATCH');
    }
    return;
  }
  if (intent.kind === 'APPROVE_SELL_EXACT') {
    const decoded = decodeFunctionData({ abi: ponsE0TokenAbi, data: intent.calldata });
    if (
      decoded.functionName !== 'approve' ||
      getAddress(decoded.args[0]) !== getAddress(intent.curve) ||
      decoded.args[1] !== intent.amount ||
      intent.value !== 0n
    ) {
      throw new Error('PONS_E0_APPROVAL_CALLDATA_MISMATCH');
    }
    return;
  }
  const decoded = decodeFunctionData({ abi: ponsE0CurveTradeAbi, data: intent.calldata });
  if (
    decoded.functionName !== 'sell' ||
    decoded.args[0] !== intent.tokensIn ||
    decoded.args[1] !== intent.minQuoteOut ||
    getAddress(decoded.args[2]) !== getAddress(intent.recipient) ||
    intent.value !== 0n
  ) {
    throw new Error('PONS_E0_SELL_CALLDATA_MISMATCH');
  }
}

function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

function assertSlippage(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > PONS_E0_MAX_SLIPPAGE_BPS) {
    throw new Error(`PONS_E0_SLIPPAGE_INVALID:${value}`);
  }
}

function assertAddress(value: string, label: string): void {
  try {
    getAddress(value);
  } catch {
    throw new Error(`PONS_E0_${label}_INVALID`);
  }
}
