import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodeFunctionData } from 'viem';
import { CanaryStore } from '../dist/canary/store.js';
import {
  applyHistoricalCreatorSeed,
  historicalCreatorSeedSummary
} from '../dist/canary/historicalCreatorSeed.js';
import { evaluateFastVet } from '../dist/evaluation/fastVet.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02,
  swapRouter02Abi
} from '../dist/canary/swapIntent.js';
import {
  assertCanaryDeadlineAgainstChainClock,
  assertCanaryQuoteBlockHash
} from '../dist/canary/viemCanaryExecutor.js';

const HASH = `0x${'22'.repeat(32)}`;
const OTHER_HASH = `0x${'33'.repeat(32)}`;
const TOKEN_IN = '0x4200000000000000000000000000000000000006';
const TOKEN_OUT = '0x1111111111111111111111111111111111111111';
const RECIPIENT = '0x2222222222222222222222222222222222222222';

const seedSummary = historicalCreatorSeedSummary();
assert.deepEqual(seedSummary, { creators: 25, launches: 147, adverseCreators: 8 });
const freshFeature = creatorFeature('seed-launch', 'seed-baseline');
const seededBad = applyHistoricalCreatorSeed(freshFeature, '0x797dd748f4b1e28ff46f0ff4aa306ee99140b49a');
assert.equal(seededBad.coverage, 'COMPLETE');
assert.equal(seededBad.priorLaunchCount, 94);
assert.equal(seededBad.catastrophicLossCount + seededBad.exitFailureCount + seededBad.liquidityCollapseCount, 87);
const seedBaseline = executableBaseline('seed-launch', 'seed-baseline');
const badVet = evaluateFastVet({ baseline: seedBaseline, creatorFeature: seededBad });
assert.equal(badVet.decision, 'REJECT');
assert.deepEqual(badVet.reasons, ['KNOWN_PRIOR_ADVERSE_CREATOR']);

const seededClean = applyHistoricalCreatorSeed(freshFeature, '0x0ac3805f575af9c28e2cdb1e388d66e75be8ee7a');
assert.equal(seededClean.coverage, 'COMPLETE');
assert.equal(seededClean.priorLaunchCount, 2);
assert.equal(evaluateFastVet({ baseline: seedBaseline, creatorFeature: seededClean }).decision, 'PASS');
const unseen = applyHistoricalCreatorSeed(freshFeature, '0x1111111111111111111111111111111111111111');
assert.strictEqual(unseen, freshFeature);
assert.equal(evaluateFastVet({ baseline: seedBaseline, creatorFeature: unseen }).decision, 'PASS');

const first = await buildCanarySwapIntent({
  launchId: 'launch-1', baselineId: 'baseline-1', quoteBlockNumber: 100n, quoteBlockHash: HASH,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, fee: 10_000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: 1_000_000n, quotedAmountOut: 2_000_000n,
  slippageBps: 500, chainTimestampSeconds: 1_700_000_000, deadlineSeconds: 30
});
const second = await buildCanarySwapIntent({
  launchId: 'launch-1', baselineId: 'baseline-1', quoteBlockNumber: 101n, quoteBlockHash: OTHER_HASH,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, fee: 10_000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: 1_010_000n, quotedAmountOut: 2_020_000n,
  slippageBps: 500, chainTimestampSeconds: 1_700_000_001, deadlineSeconds: 30
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
  slippageBps: 100, chainTimestampSeconds: 1, deadlineSeconds: 30
}), /CANARY_NOTIONAL_MUST_BE_ONE_DOLLAR/);
await assert.rejects(() => buildCanarySwapIntent({
  launchId: 'x', baselineId: 'b', quoteBlockNumber: 1n, quoteBlockHash: HASH,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, fee: 3000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS, amountIn: 1n, quotedAmountOut: 1n,
  slippageBps: 2001, chainTimestampSeconds: 1, deadlineSeconds: 30
}), /CANARY_SLIPPAGE_BPS_OUT_OF_RANGE/);
await assert.rejects(() => buildCanarySwapIntent({
  launchId: 'x', baselineId: 'b', quoteBlockNumber: 1n, quoteBlockHash: HASH,
  tokenIn: TOKEN_IN, tokenOut: TOKEN_IN, fee: 3000, recipient: RECIPIENT,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS, amountIn: 1n, quotedAmountOut: 1n,
  slippageBps: 100, chainTimestampSeconds: 1, deadlineSeconds: 30
}), /CANARY_TOKEN_IDENTITY_INVALID/);

assert.doesNotThrow(() => assertCanaryDeadlineAgainstChainClock(1_120n, 1_000));
assert.throws(() => assertCanaryDeadlineAgainstChainClock(1_121n, 1_000), /CANARY_DEADLINE_EXCEEDS_MAX/);
assert.throws(() => assertCanaryDeadlineAgainstChainClock(1_000n, 1_000), /CANARY_DEADLINE_EXPIRED/);
assert.doesNotThrow(() => assertCanaryQuoteBlockHash(HASH, HASH));
assert.throws(() => assertCanaryQuoteBlockHash(HASH, OTHER_HASH), /CANARY_QUOTE_BLOCK_REORG/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-canary-r0-'));
const dbPath = path.join(tempDir, 'race.sqlite');
const storeA = new CanaryStore(dbPath);
const storeB = new CanaryStore(dbPath);
try {
  const recordA = canaryRecord('action-a', 'launch-a', 'baseline-a', 'RESERVED');
  const recordB = canaryRecord('action-b', 'launch-b', 'baseline-b', 'RESERVED');
  assert.equal(storeA.countCommittedBuys(), 0);
  assert.equal(storeB.countCommittedBuys(), 0);
  assert.equal(storeA.insert(recordA), 'INSERTED');
  assert.equal(storeB.insert(recordB), 'BUY_LIMIT', 'second process must lose the global one-buy race');
  assert.equal(storeB.insert(recordA), 'DUPLICATE', 'same action must never become a second signer');
  assert.equal(storeA.countCommittedBuys(), 1);

  const skipped = canaryRecord('action-skip', 'launch-skip', 'baseline-skip', 'SKIPPED');
  assert.equal(storeB.insert(skipped), 'INSERTED', 'non-economic skipped rows must not consume the singleton slot');
  assert.equal(storeB.countCommittedBuys(), 1);
} finally {
  storeB.close();
  storeA.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('canary-sniper-r0-check: PASS');

function creatorFeature(launchId, baselineId) {
  return {
    receiptId: 'seed-test',
    derivationVersion: 'CREATOR_OUTCOME_JOIN_V0',
    chainId: 57073,
    launchId,
    creator: '0x1111111111111111111111111111111111111111',
    baselineId,
    decisionBlock: 100n,
    decisionBlockHash: HASH,
    horizonMs: 86_400_000,
    coverage: 'NO_HISTORY',
    priorLaunchCount: 0,
    outcomeReceiptCount: 0,
    classifiedOutcomeCount: 0,
    unresolvedOutcomeCount: 0,
    unsellableOutcomeCount: 0,
    catastrophicLossCount: 0,
    exitFailureCount: 0,
    liquidityCollapseCount: 0,
    normalLossCount: 0,
    normalWinCount: 0,
    fatTailWinCount: 0,
    sourceFactIds: [],
    sourceOutcomeIds: [],
    inputDigest: 'x',
    outputDigest: 'x',
    evidenceDigest: 'x'
  };
}

function executableBaseline(launchId, baselineId) {
  return {
    launchId,
    baselineId,
    status: 'COMPLETE',
    legs: [{
      notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
      entry: { executable: true },
      reverse: { executable: true },
      independentReverseRecoveryBps: 10_000n
    }]
  };
}

function canaryRecord(actionId, launchId, baselineId, state) {
  const now = 1_700_000_000_000;
  return {
    actionId,
    launchId,
    baselineId,
    decision: 'PASS',
    reasons: [],
    state,
    originDecisionBlock: 100n,
    originDecisionBlockHash: HASH,
    intent: null,
    nonce: null,
    transactionHash: null,
    serializedTransaction: null,
    lastError: null,
    outputBalanceBefore: null,
    outputBalanceAfter: null,
    createdAtMs: now,
    updatedAtMs: now
  };
}
