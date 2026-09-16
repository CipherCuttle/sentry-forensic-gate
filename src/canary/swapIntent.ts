import { encodeFunctionData, getAddress, type Address, type Hex } from 'viem';
import { sha256Hex } from '../evidence/canonical.js';

export const CANARY_SNIPER_R0 = 'CANARY_SNIPER_R0' as const;
export const CANARY_PRIMARY_NOTIONAL_USD_MICROS = 1_000_000n;
export const INK_SWAP_ROUTER_02 = getAddress('0x177778F19E89dD1012BdBe603F144088A95C4B53');
export const CANARY_MAX_SLIPPAGE_BPS = 2_000;
export const CANARY_MAX_DEADLINE_SECONDS = 120;

export const swapRouter02Abi = [
  {
    type: 'function', name: 'exactInputSingle', stateMutability: 'payable',
    inputs: [{ name: 'params', type: 'tuple', components: [
      { name: 'tokenIn', type: 'address' }, { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' }, { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' }
    ] }], outputs: [{ name: 'amountOut', type: 'uint256' }]
  },
  {
    type: 'function', name: 'multicall', stateMutability: 'payable',
    inputs: [{ name: 'deadline', type: 'uint256' }, { name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }]
  },
  { type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'WETH9', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }
] as const;

export interface CanarySwapIntentInput {
  launchId: string;
  baselineId: string;
  quoteBlockNumber: bigint;
  quoteBlockHash: Hex;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  notionalUsdMicros: bigint;
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippageBps: number;
  nowEpochSeconds: number;
  deadlineSeconds: number;
}

export interface CanarySwapIntent {
  version: typeof CANARY_SNIPER_R0;
  actionId: string;
  launchId: string;
  baselineId: string;
  router: Address;
  quoteBlockNumber: bigint;
  quoteBlockHash: Hex;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  recipient: Address;
  notionalUsdMicros: typeof CANARY_PRIMARY_NOTIONAL_USD_MICROS;
  amountIn: bigint;
  quotedAmountOut: bigint;
  amountOutMinimum: bigint;
  slippageBps: number;
  deadlineEpochSeconds: bigint;
  calldata: Hex;
  value: 0n;
}

export async function buildCanarySwapIntent(input: CanarySwapIntentInput): Promise<CanarySwapIntent> {
  if (!input.launchId || !input.baselineId) throw new Error('CANARY_IDENTITY_REQUIRED');
  if (input.notionalUsdMicros !== CANARY_PRIMARY_NOTIONAL_USD_MICROS) {
    throw new Error(`CANARY_NOTIONAL_MUST_BE_ONE_DOLLAR:${input.notionalUsdMicros}`);
  }
  if (!Number.isInteger(input.fee) || input.fee < 0 || input.fee > 1_000_000) throw new Error(`CANARY_INVALID_FEE:${input.fee}`);
  if (input.amountIn <= 0n || input.quotedAmountOut <= 0n) throw new Error('CANARY_QUOTE_MUST_BE_POSITIVE');
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > CANARY_MAX_SLIPPAGE_BPS) {
    throw new Error(`CANARY_SLIPPAGE_BPS_OUT_OF_RANGE:${input.slippageBps}`);
  }
  if (!Number.isInteger(input.nowEpochSeconds) || input.nowEpochSeconds <= 0) throw new Error('CANARY_NOW_INVALID');
  if (!Number.isInteger(input.deadlineSeconds) || input.deadlineSeconds < 1 || input.deadlineSeconds > CANARY_MAX_DEADLINE_SECONDS) {
    throw new Error(`CANARY_DEADLINE_SECONDS_OUT_OF_RANGE:${input.deadlineSeconds}`);
  }

  const tokenIn = getAddress(input.tokenIn);
  const tokenOut = getAddress(input.tokenOut);
  const recipient = getAddress(input.recipient);
  if (tokenIn === tokenOut) throw new Error('CANARY_TOKEN_IDENTITY_INVALID');
  const amountOutMinimum = (input.quotedAmountOut * BigInt(10_000 - input.slippageBps)) / 10_000n;
  if (amountOutMinimum <= 0n) throw new Error('CANARY_MIN_OUT_ROUNDS_TO_ZERO');
  const deadlineEpochSeconds = BigInt(input.nowEpochSeconds + input.deadlineSeconds);

  const exactInputCalldata = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: 'exactInputSingle',
    args: [{ tokenIn, tokenOut, fee: input.fee, recipient, amountIn: input.amountIn, amountOutMinimum, sqrtPriceLimitX96: 0n }]
  });
  const calldata = encodeFunctionData({
    abi: swapRouter02Abi,
    functionName: 'multicall',
    args: [deadlineEpochSeconds, [exactInputCalldata]]
  });
  const actionId = await sha256Hex({
    kind: CANARY_SNIPER_R0,
    launchId: input.launchId,
    baselineId: input.baselineId,
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS
  });

  return {
    version: CANARY_SNIPER_R0, actionId, launchId: input.launchId, baselineId: input.baselineId,
    router: INK_SWAP_ROUTER_02, quoteBlockNumber: input.quoteBlockNumber,
    quoteBlockHash: input.quoteBlockHash.toLowerCase() as Hex,
    tokenIn, tokenOut, fee: input.fee, recipient,
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
    amountIn: input.amountIn, quotedAmountOut: input.quotedAmountOut, amountOutMinimum,
    slippageBps: input.slippageBps, deadlineEpochSeconds, calldata, value: 0n
  };
}
