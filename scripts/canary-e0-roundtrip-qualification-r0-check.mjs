import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createPublicClient,
  decodeFunctionData,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  getAddress,
  http
} from 'viem';
import { CanaryStore } from '../dist/canary/store.js';
import { CanaryExitStore } from '../dist/canary/exitStore.js';
import {
  buildCanaryExitIntent,
  CANARY_E0_ROUNDTRIP_R0,
  deriveCanaryExitActionId
} from '../dist/canary/roundTrip.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02,
  swapRouter02Abi
} from '../dist/canary/swapIntent.js';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from '../dist/sentry/contracts.js';
import {
  erc20DecimalsAbi,
  tsunamiFactoryReadAbi,
  tsunamiQuoterV2Abi,
  TSUNAMI_FEE_TIERS,
  TSUNAMI_QUOTER_V2,
  TSUNAMI_V3_FACTORY,
  USDT0,
  WETH9,
  ZERO_ADDRESS
} from '../dist/tsunami/contracts.js';

const HASH = `0x${'44'.repeat(32)}`;
const OTHER_HASH = `0x${'55'.repeat(32)}`;
const LAUNCHED = '0x1111111111111111111111111111111111111111';
const OTHER_LAUNCHED = '0x3333333333333333333333333333333333333333';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

const buy = await buildCanarySwapIntent({
  launchId: 'e0-launch', baselineId: 'e0-baseline', quoteBlockNumber: 100n, quoteBlockHash: HASH,
  tokenIn: WETH9, tokenOut: LAUNCHED, fee: 10_000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: 1_000_000n, quotedAmountOut: 2_000_000n,
  slippageBps: 500, chainTimestampSeconds: 1_700_000_000, deadlineSeconds: 30
});
const exit = await buildCanaryExitIntent({
  buyIntent: buy,
  quoteBlockNumber: 101n,
  quoteBlockHash: OTHER_HASH,
  amountIn: 2_000_000n,
  quotedAmountOut: 900_000n,
  slippageBps: 500,
  chainTimestampSeconds: 1_700_000_001,
  deadlineSeconds: 30
});
assert.equal(exit.roundTripVersion, CANARY_E0_ROUNDTRIP_R0);
assert.equal(exit.leg, 'EXIT');
assert.equal(exit.parentBuyActionId, buy.actionId);
assert.notEqual(exit.actionId, buy.actionId, 'exit EconomicActionID must not collide with singleton buy');
assert.equal(exit.actionId, await deriveCanaryExitActionId({
  parentBuyActionId: buy.actionId, launchId: buy.launchId, baselineId: buy.baselineId
}));
assert.equal(exit.tokenIn.toLowerCase(), buy.tokenOut.toLowerCase());
assert.equal(exit.tokenOut.toLowerCase(), buy.tokenIn.toLowerCase());
assert.equal(exit.recipient.toLowerCase(), buy.recipient.toLowerCase());
assert.equal(exit.fee, buy.fee);
assert.equal(exit.amountIn, 2_000_000n);
assert.equal(exit.amountOutMinimum, 855_000n);
assert.equal(exit.value, 0n);

const outer = decodeFunctionData({ abi: swapRouter02Abi, data: exit.calldata });
assert.equal(outer.functionName, 'multicall');
const inner = decodeFunctionData({ abi: swapRouter02Abi, data: outer.args[1][0] });
assert.equal(inner.functionName, 'exactInputSingle');
const params = inner.args[0];
assert.equal(params.tokenIn.toLowerCase(), LAUNCHED.toLowerCase());
assert.equal(params.tokenOut.toLowerCase(), WETH9.toLowerCase());
assert.equal(params.recipient.toLowerCase(), RECIPIENT.toLowerCase());
assert.equal(params.amountIn, 2_000_000n);
assert.equal(params.amountOutMinimum, 855_000n);

const forgedBuy = { ...buy, actionId: 'forged-buy-id' };
await assert.rejects(() => buildCanaryExitIntent({
  buyIntent: forgedBuy, quoteBlockNumber: 101n, quoteBlockHash: OTHER_HASH,
  amountIn: 1n, quotedAmountOut: 100n, slippageBps: 100,
  chainTimestampSeconds: 1_700_000_001, deadlineSeconds: 30
}), /CANARY_EXIT_PARENT_BUY_IDENTITY_DRIFT/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-e0-roundtrip-r0-'));
const dbPath = path.join(tempDir, 'roundtrip.sqlite');
const buyStore = new CanaryStore(dbPath);
const exitStoreA = new CanaryExitStore(dbPath);
const exitStoreB = new CanaryExitStore(dbPath);
try {
  const now = 1_700_000_000_000;
  assert.equal(buyStore.insert({
    actionId: buy.actionId,
    launchId: buy.launchId,
    baselineId: buy.baselineId,
    decision: 'PASS',
    reasons: [],
    state: 'INCLUDED',
    originDecisionBlock: 100n,
    originDecisionBlockHash: HASH,
    intent: buy,
    nonce: 7,
    transactionHash: `0x${'66'.repeat(32)}`,
    serializedTransaction: '0x01',
    lastError: null,
    outputBalanceBefore: 10_000n,
    outputBalanceAfter: 2_010_000n,
    createdAtMs: now,
    updatedAtMs: now
  }), 'INSERTED');
  const exitRecord = {
    actionId: exit.actionId,
    parentBuyActionId: buy.actionId,
    launchId: buy.launchId,
    baselineId: buy.baselineId,
    state: 'RESERVED',
    intent: exit,
    nonce: null,
    transactionHash: null,
    serializedTransaction: null,
    lastError: null,
    outputBalanceBefore: null,
    outputBalanceAfter: null,
    createdAtMs: now + 1,
    updatedAtMs: now + 1
  };
  assert.equal(exitStoreA.insertReserved(exitRecord), 'INSERTED');
  assert.equal(exitStoreB.insertReserved(exitRecord), 'DUPLICATE', 'two processes must converge on one exit identity');
  assert.equal(buyStore.countCommittedBuys(), 1, 'exit ledger must not weaken or consume another buy slot');
  const unresolved = exitStoreA.listUnresolved();
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].actionId, exit.actionId);
  assert.equal(unresolved[0].intent.parentBuyActionId, buy.actionId);

  const partial = await buildCanaryExitIntent({
    buyIntent: buy, quoteBlockNumber: 102n, quoteBlockHash: OTHER_HASH,
    amountIn: 1_999_999n, quotedAmountOut: 100n, slippageBps: 100,
    chainTimestampSeconds: 1_700_000_002, deadlineSeconds: 30
  });
  assert.throws(() => exitStoreA.insertReserved({
    ...exitRecord,
    actionId: partial.actionId,
    intent: partial,
    createdAtMs: now + 2,
    updatedAtMs: now + 2
  }), /CANARY_EXIT_AMOUNT_MUST_EQUAL_ACQUIRED/);

  const tooLarge = await buildCanaryExitIntent({
    buyIntent: buy, quoteBlockNumber: 103n, quoteBlockHash: OTHER_HASH,
    amountIn: 2_000_001n, quotedAmountOut: 100n, slippageBps: 100,
    chainTimestampSeconds: 1_700_000_003, deadlineSeconds: 30
  });
  assert.throws(() => exitStoreA.insertReserved({
    ...exitRecord,
    actionId: tooLarge.actionId,
    intent: tooLarge,
    createdAtMs: now + 3,
    updatedAtMs: now + 3
  }), /CANARY_EXIT_AMOUNT_MUST_EQUAL_ACQUIRED/);

  // Buy EconomicActionID intentionally ignores quote/market details. Prove that a
  // caller cannot exploit that by presenting a different buy-shaped intent with
  // the same parent action ID and exiting the wrong token.
  const tamperedBuy = { ...buy, tokenOut: OTHER_LAUNCHED };
  assert.equal(tamperedBuy.actionId, buy.actionId);
  const tamperedExit = await buildCanaryExitIntent({
    buyIntent: tamperedBuy, quoteBlockNumber: 104n, quoteBlockHash: OTHER_HASH,
    amountIn: 2_000_000n, quotedAmountOut: 100n, slippageBps: 100,
    chainTimestampSeconds: 1_700_000_004, deadlineSeconds: 30
  });
  assert.throws(() => exitStoreA.insertReserved({
    ...exitRecord,
    actionId: tamperedExit.actionId,
    intent: tamperedExit,
    createdAtMs: now + 4,
    updatedAtMs: now + 4
  }), /CANARY_EXIT_PERSISTED_PARENT_INTENT_BINDING_MISMATCH/);
} finally {
  exitStoreB.close();
  exitStoreA.close();
  buyStore.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// Current-chain, read-only authority qualification. No wallet client, key, signing or broadcast.
const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL] } }
});
const client = createPublicClient({ chain: ink, transport: http(process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL) });
assert.equal(await client.getChainId(), INK_CHAIN_ID);
for (const [name, address] of [
  ['router', INK_SWAP_ROUTER_02], ['factory', TSUNAMI_V3_FACTORY], ['quoter', TSUNAMI_QUOTER_V2], ['weth', WETH9]
]) {
  const code = await client.getBytecode({ address });
  assert.ok(code && code !== '0x', `${name} code must exist at ${address}`);
}
const [routerFactory, routerWeth] = await Promise.all([
  client.readContract({ address: INK_SWAP_ROUTER_02, abi: swapRouter02Abi, functionName: 'factory' }),
  client.readContract({ address: INK_SWAP_ROUTER_02, abi: swapRouter02Abi, functionName: 'WETH9' })
]);
assert.equal(getAddress(routerFactory), getAddress(TSUNAMI_V3_FACTORY));
assert.equal(getAddress(routerWeth), getAddress(WETH9));

const [quoterFactory, quoterWeth] = await Promise.all([
  client.readContract({ address: TSUNAMI_QUOTER_V2, abi: tsunamiQuoterV2Abi, functionName: 'factory' }),
  client.readContract({ address: TSUNAMI_QUOTER_V2, abi: tsunamiQuoterV2Abi, functionName: 'WETH9' })
]);
assert.equal(getAddress(quoterFactory), getAddress(TSUNAMI_V3_FACTORY));
assert.equal(getAddress(quoterWeth), getAddress(WETH9));

let poolFee = null;
let pool = null;
for (const fee of TSUNAMI_FEE_TIERS) {
  const candidate = await client.readContract({
    address: TSUNAMI_V3_FACTORY, abi: tsunamiFactoryReadAbi, functionName: 'getPool', args: [USDT0, WETH9, fee]
  });
  if (getAddress(candidate) !== getAddress(ZERO_ADDRESS)) { poolFee = fee; pool = getAddress(candidate); break; }
}
assert.ok(pool && poolFee !== null, 'current factory must expose a canonical USDT0/WETH roundtrip pool');
const usdtDecimals = await client.readContract({ address: USDT0, abi: erc20DecimalsAbi, functionName: 'decimals' });
const forwardAmountIn = 10n ** BigInt(usdtDecimals);
const forward = await quoteExactInput(client, USDT0, WETH9, forwardAmountIn, poolFee);
assert.ok(forward > 0n, 'forward read-only quote must be positive');
const reverse = await quoteExactInput(client, WETH9, USDT0, forward, poolFee);
assert.ok(reverse > 0n, 'reverse read-only quote must be positive');

console.log(JSON.stringify({
  verdict: 'CANARY_E0_ROUNDTRIP_QUALIFICATION_R0_PASS',
  chainId: INK_CHAIN_ID,
  router: INK_SWAP_ROUTER_02,
  factory: TSUNAMI_V3_FACTORY,
  quoter: TSUNAMI_QUOTER_V2,
  weth: WETH9,
  canonicalRoundTripPool: pool,
  canonicalRoundTripFee: poolFee,
  forwardAmountIn: forwardAmountIn.toString(),
  forwardAmountOut: forward.toString(),
  reverseAmountOut: reverse.toString(),
  live: false,
  walletAuthorityUsed: false
}, null, 2));

async function quoteExactInput(client, tokenIn, tokenOut, amountIn, fee) {
  const data = encodeFunctionData({
    abi: tsunamiQuoterV2Abi,
    functionName: 'quoteExactInputSingle',
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }]
  });
  const result = await client.call({ to: TSUNAMI_QUOTER_V2, data });
  assert.ok(result.data, 'quoter eth_call must return data');
  const decoded = decodeFunctionResult({ abi: tsunamiQuoterV2Abi, functionName: 'quoteExactInputSingle', data: result.data });
  return decoded[0];
}
