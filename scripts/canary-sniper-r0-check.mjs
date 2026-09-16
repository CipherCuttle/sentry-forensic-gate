import assert from 'node:assert/strict';
import { decodeFunctionData } from 'viem';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02,
  swapRouter02Abi
} from '../dist/canary/swapIntent.js';

const HASH = `0x${'22'.repeat(32)}`;
const TOKEN_IN = '0x4200000000000000000000000000000000000006';
const TOKEN_OUT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

const first = await buildCanarySwapIntent({
  launchId: 'launch-1', baselineId: 'baseline-1', quoteBlockNumber: 100n, quoteBlockHash: HASH,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, fee: 10_000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: 1_000_000n, quotedAmountOut: 2_000_000n,
  slippageBps: 500, nowEpochSeconds: 1_700_000_000, deadlineSeconds: 30
});
const second = await buildCanarySwapIntent({
  launchId: 'launch-1', baselineId: 'baseline-1', quoteBlockNumber: 101n, quoteBlockHash: `0x${'33'.repeat(32)}`,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, fee: 10_000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: 1_010_000n, quotedAmountOut: 2_020_000n,
  slippageBps: 500, nowEpochSeconds: 1_700_000_001, deadlineSeconds: 30
});
assert.equal(first.actionId, second.actionId, 'EconomicActionID must not change when the fresh quote changes');
assert.equal(first.router, INK_SWAP_ROUTER_02);
assert.equal(first.amountOutMinimum, 1_900_000n);
assert.equal(first.deadlineEpochSeconds, 1_700_000_030n);
assert.equal(first.value, 0n);

const outer = decodeFunctionData({ abi: swapRouter02Abi, data: first.calldata });
assert.equal(outer.functionName, 'multicall');
assert.equal(outer.args[0], 1_700_000_030n);
assert.equal(outer.args[1].length, 1);
const inner = decodeFunctionData({ abi: swapRouter02Abi, data: outer.args[1][0] });
assert.equal(inner.functionName, 'exactInputSingle');
const params = inner.args[0];
assert.equal(params.tokenIn.toLowerCase(), TOKEN_IN.toLowerCase());
assert.equal(params.tokenOut.toLowerCase(), TOKEN_OUT.toLowerCase());
assert.equal(params.fee, 10_000);
assert.equal(params.recipient.toLowerCase(), RECIPIENT.toLowerCase());
assert.equal(params.amountIn, 1_000_000n);
assert.equal(params.amountOutMinimum, 1_900_000n);
assert.equal(params.sqrtPriceLimitX96, 0n);

await assert.rejects(() => buildCanarySwapIntent({
  launchId: 'x', baselineId: 'b', quoteBlockNumber: 1n, quoteBlockHash: HASH,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, fee: 3000, recipient: RECIPIENT,
  notionalUsdMicros: 2_000_000n, amountIn: 1n, quotedAmountOut: 1n,
  slippageBps: 100, nowEpochSeconds: 1, deadlineSeconds: 30
}), /CANARY_NOTIONAL_MUST_BE_ONE_DOLLAR/);
await assert.rejects(() => buildCanarySwapIntent({
  launchId: 'x', baselineId: 'b', quoteBlockNumber: 1n, quoteBlockHash: HASH,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, fee: 3000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS, amountIn: 1n, quotedAmountOut: 1n,
  slippageBps: 2001, nowEpochSeconds: 1, deadlineSeconds: 30
}), /CANARY_SLIPPAGE_BPS_OUT_OF_RANGE/);
await assert.rejects(() => buildCanarySwapIntent({
  launchId: 'x', baselineId: 'b', quoteBlockNumber: 1n, quoteBlockHash: HASH,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_IN, fee: 3000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS, amountIn: 1n, quotedAmountOut: 1n,
  slippageBps: 100, nowEpochSeconds: 1, deadlineSeconds: 30
}), /CANARY_TOKEN_IDENTITY_INVALID/);

console.log('canary-sniper-r0-check: PASS');
