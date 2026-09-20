import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseTransaction, serializeTransaction } from 'viem';
import {
  PONS_E0_LIVE_CANARY_R0,
  PONS_E0_NOTIONAL_USD_MICROS,
  buildPonsE0ApprovalIntent,
  buildPonsE0BuyIntent,
  buildPonsE0SellIntent
} from '../dist/canary/ponsE0Intent.js';

const TOKEN = '0x1111111111111111111111111111111111111111';
const CURVE = '0x2222222222222222222222222222222222222222';
const WALLET = '0x3333333333333333333333333333333333333333';
const NATIVE = '0x0000000000000000000000000000000000000000';

const buy = buildPonsE0BuyIntent({
  token: TOKEN,
  curve: CURVE,
  recipient: WALLET,
  pairToken: NATIVE,
  notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
  quoteIn: 500_000_000_000_000n,
  quotedTokensOut: 1_000_000n,
  sellableTokens: 200_000_000n,
  snipeTaxBps: 0n,
  slippageBps: 500
});
assert.equal(buy.version, PONS_E0_LIVE_CANARY_R0);
assert.equal(buy.kind, 'BUY');
assert.equal(buy.notionalUsdMicros, 1_000_000n);
assert.equal(buy.value, buy.quoteIn);
assert.equal(buy.minTokensOut, 950_000n);

assert.throws(
  () => buildPonsE0BuyIntent({
    token: TOKEN,
    curve: CURVE,
    recipient: WALLET,
    pairToken: NATIVE,
    notionalUsdMicros: 1_000_001n,
    quoteIn: 1n,
    quotedTokensOut: 1n,
    sellableTokens: 10_000n,
    snipeTaxBps: 0n,
    slippageBps: 500
  }),
  /PONS_E0_NOTIONAL_MUST_EQUAL_ONE_DOLLAR/
);

assert.throws(
  () => buildPonsE0BuyIntent({
    token: TOKEN,
    curve: CURVE,
    recipient: WALLET,
    pairToken: NATIVE,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
    quoteIn: 1n,
    quotedTokensOut: 1n,
    sellableTokens: 10_000n,
    snipeTaxBps: 1n,
    slippageBps: 500
  }),
  /PONS_E0_SNIPE_TAX_MUST_BE_ZERO/
);

assert.throws(
  () => buildPonsE0BuyIntent({
    token: TOKEN,
    curve: CURVE,
    recipient: WALLET,
    pairToken: NATIVE,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
    quoteIn: 1n,
    quotedTokensOut: 101n,
    sellableTokens: 10_000n,
    snipeTaxBps: 0n,
    slippageBps: 500
  }),
  /PONS_E0_BUY_TOO_CLOSE_TO_GRADUATION/
);

assert.throws(
  () => buildPonsE0BuyIntent({
    token: TOKEN,
    curve: CURVE,
    recipient: WALLET,
    pairToken: NATIVE,
    notionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS,
    quoteIn: 1n,
    quotedTokensOut: 1n,
    sellableTokens: 10_000n,
    snipeTaxBps: 0n,
    slippageBps: 1001
  }),
  /PONS_E0_SLIPPAGE_INVALID/
);

const approval = buildPonsE0ApprovalIntent({
  token: TOKEN,
  curve: CURVE,
  owner: WALLET,
  amount: buy.quotedTokensOut
});
assert.equal(approval.kind, 'APPROVE_SELL_EXACT');
assert.equal(approval.amount, buy.quotedTokensOut);
assert.equal(approval.value, 0n);

const sell = buildPonsE0SellIntent({
  token: TOKEN,
  curve: CURVE,
  recipient: WALLET,
  tokensIn: buy.quotedTokensOut,
  quotedQuoteOut: 400_000_000_000_000n,
  slippageBps: 500
});
assert.equal(sell.kind, 'SELL_ALL');
assert.equal(sell.tokensIn, buy.quotedTokensOut);
assert.equal(sell.minQuoteOut, 380_000_000_000_000n);
assert.equal(sell.value, 0n);

const cliSource = fs.readFileSync('src/canary/ponsE0Cli.ts', 'utf8');
const executorSource = fs.readFileSync('src/canary/viemPonsE0CanaryExecutor.ts', 'utf8');
assert.ok(cliSource.includes("fs.openSync(file, 'wx', 0o600)"), 'live state must be atomically reserved');
assert.ok(cliSource.includes('PONS_E0_ENTRY_SPEND_NOT_EXACT_CALIBRATED_DOLLAR'));
assert.ok(cliSource.includes('PONS_E0_RECENT_LAUNCH_CARDINALITY'));
assert.ok(cliSource.includes('PONS_E0_LAUNCH_BLOCK_HINT_MISMATCH'));
assert.ok(
  cliSource.includes('await readRange(launchBlockHint, launchBlockHint)'),
  'exact launch block hint must query only that block instead of scanning the recent window'
);
assert.ok(
  cliSource.includes('client,\n  client,\n  historicalLaunchAdapter'),
  'recent-launch log uniqueness must use the current RPC while historical materialization uses archive RPC'
);
assert.ok(executorSource.includes('PONS_E0_EXACT_BUY_VALUE_NOT_AUTHORIZED'));
assert.ok(executorSource.includes('this.buyAuthorizationConsumed = true'));
assert.ok(
  executorSource.includes('(parsed.maxPriorityFeePerGas ?? 0n) !== signed.maxPriorityFeePerGas'),
  'signed zero priority fee must normalize omitted parsed field to zero'
);

const zeroTipSerialized = serializeTransaction({
  type: 'eip1559',
  chainId: 4663,
  nonce: 0,
  gas: 21_000n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 0n,
  to: TOKEN,
  value: 0n,
  data: '0x'
});
const zeroTipParsed = parseTransaction(zeroTipSerialized);
assert.equal(zeroTipParsed.maxPriorityFeePerGas, undefined);
assert.equal(zeroTipParsed.maxPriorityFeePerGas ?? 0n, 0n);

console.log(JSON.stringify({
  verdict: 'PONS_E0_LIVE_CANARY_R0_OFFLINE_PASS',
  exactNotionalUsdMicros: PONS_E0_NOTIONAL_USD_MICROS.toString(),
  maxSlippageBps: 1000,
  maxSellableShareBps: 100,
  exactSellApproval: true,
  exactLaunchHintSingleBlockLookup: true,
  noBroadcast: true
}, null, 2));
