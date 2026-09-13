import assert from 'node:assert/strict';
import { evaluateFastVet } from '../dist/evaluation/fastVet.js';
import { evaluateFastVetShadow } from '../dist/evaluation/fastVetShadow.js';

const HEX = `0x${'11'.repeat(20)}`;
const HASH = `0x${'22'.repeat(32)}`;

function baseline(launchId, { reverse = true, status = 'COMPLETE' } = {}) {
  return {
    baselineId: `baseline-${launchId}`,
    authorityDigest: `authority-${launchId}`,
    launchId,
    policyVersion: 'EXECUTABLE_BASELINE_R1',
    decisionBlock: 10n,
    decisionBlockHash: HASH,
    observedAtMs: 1,
    status,
    market: status === 'COMPLETE' ? {
      launchId,
      launchedToken: HEX,
      baseToken: HEX,
      token0: HEX,
      token1: HEX,
      fee: 10000,
      pool: HEX,
      positionLiquidity: 1n,
      activeLiquidity: 1n,
      sqrtPriceX96Before: 1n
    } : null,
    legs: status === 'COMPLETE' ? [{
      notionalUsdMicros: 1_000_000n,
      calibration: { kind: 'USDT0_NOMINAL_PEG_V0', notionalUsdMicros: 1_000_000n, baseToken: HEX, baseAmount: 1n, baseDecimals: 6 },
      entry: quote(launchId, 'ENTRY', true),
      reverse: reverse ? quote(launchId, 'INDEPENDENT_REVERSE_EXIT', true) : null,
      independentReverseRecoveryBps: reverse ? 9_500n : null
    }] : [],
    reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL'
  };
}

function quote(launchId, kind, executable) {
  return {
    quoteId: `${kind}-${launchId}`,
    launchId,
    blockNumber: 10n,
    blockHash: HASH,
    observedAtMs: 1,
    kind,
    mode: 'EXACT_INPUT',
    notionalUsdMicros: 1_000_000n,
    pool: HEX,
    tokenIn: HEX,
    tokenOut: HEX,
    fee: 10000,
    amountIn: 1n,
    amountOut: 1n,
    executable
  };
}

function feature(launchId, { coverage = 'NO_HISTORY', adverse = 0 } = {}) {
  const b = baseline(launchId);
  return {
    receiptId: `feature-${launchId}`,
    derivationVersion: 'CREATOR_OUTCOME_JOIN_V0',
    chainId: 57073,
    launchId,
    creator: HEX,
    baselineId: b.baselineId,
    decisionBlock: 10n,
    decisionBlockHash: HASH,
    horizonMs: 86_400_000,
    coverage,
    priorLaunchCount: coverage === 'NO_HISTORY' ? 0 : 1,
    outcomeReceiptCount: coverage === 'NO_HISTORY' ? 0 : 1,
    classifiedOutcomeCount: coverage === 'UNKNOWN' ? 0 : coverage === 'NO_HISTORY' ? 0 : 1,
    unresolvedOutcomeCount: coverage === 'PARTIAL' ? 1 : 0,
    unsellableOutcomeCount: 0,
    catastrophicLossCount: adverse,
    exitFailureCount: 0,
    liquidityCollapseCount: 0,
    normalLossCount: 0,
    normalWinCount: adverse ? 0 : 1,
    fatTailWinCount: 0,
    sourceFactIds: [],
    sourceOutcomeIds: [],
    inputDigest: `in-${launchId}`,
    outputDigest: `out-${launchId}`,
    evidenceDigest: `feature-evidence-${launchId}`
  };
}

function outcome(launchId, classification, valueUsdMicros, horizonMs = 86_400_000) {
  return {
    outcomeId: `outcome-${launchId}-${horizonMs}`,
    launchId,
    horizonMs,
    observedBlock: 100n,
    sellable: !['EXIT_FAILURE', 'LIQUIDITY_COLLAPSE'].includes(classification),
    classification,
    policyVersion: 'FORWARD_OUTCOMES_R1',
    status: 'COMPLETE',
    observedBlockHash: HASH,
    targetTimestampMs: 1,
    observedTimestampMs: 2,
    baselineId: `baseline-${launchId}`,
    entryNotionalUsdMicros: 1_000_000n,
    entryTokenAmount: 1n,
    marketPool: HEX,
    marketFee: 10000,
    baseToken: HEX,
    baseAmountOut: valueUsdMicros,
    executableValueUsdMicros: valueUsdMicros,
    executableReturnBps: valueUsdMicros * 10_000n / 1_000_000n,
    poolActiveLiquidity: 1n,
    evidenceDigest: `outcome-evidence-${launchId}-${horizonMs}`
  };
}

assert.equal(evaluateFastVet({ baseline: baseline('clean'), creatorFeature: feature('clean') }).decision, 'PASS');
assert.equal(evaluateFastVet({ baseline: baseline('bad'), creatorFeature: feature('bad', { coverage: 'COMPLETE', adverse: 1 }) }).decision, 'REJECT');
assert.equal(evaluateFastVet({ baseline: baseline('partial'), creatorFeature: feature('partial', { coverage: 'PARTIAL' }) }).decision, 'UNKNOWN');
assert.equal(evaluateFastVet({ baseline: baseline('nosell', { reverse: false }), creatorFeature: feature('nosell') }).decision, 'REJECT');
assert.equal(evaluateFastVet({ baseline: null, creatorFeature: null }).action, 'SKIP');
const staleFeature = feature('stale');
staleFeature.baselineId = 'baseline-other';
assert.throws(
  () => evaluateFastVet({ baseline: baseline('stale', { reverse: false }), creatorFeature: staleFeature }),
  /FAST_VET_BINDING_MISMATCH/
);

const rows = [
  { launchId: 'a', baseline: baseline('a'), creatorFeature: feature('a'), targetOutcome: outcome('a', 'NORMAL_WIN', 3_000_000n) },
  { launchId: 'b', baseline: baseline('b'), creatorFeature: feature('b', { coverage: 'COMPLETE', adverse: 1 }), targetOutcome: outcome('b', 'CATASTROPHIC_LOSS', 100_000n) },
  { launchId: 'c', baseline: baseline('c'), creatorFeature: feature('c', { coverage: 'PARTIAL' }), targetOutcome: outcome('c', 'NORMAL_WIN', 2_000_000n) },
  { launchId: 'd', baseline: baseline('d'), creatorFeature: feature('d'), targetOutcome: outcome('d', 'EXIT_FAILURE', 0n) }
];
const first = await evaluateFastVetShadow(rows);
const second = await evaluateFastVetShadow(rows);
assert.equal(first.evidenceDigest, second.evidenceDigest);
assert.deepEqual(first.metrics, {
  launchCount: 4,
  passCount: 2,
  rejectCount: 1,
  unknownCount: 1,
  tradeRetentionBps: 5000,
  resolvedOutcomeCount: 4,
  outcomeCoverageBps: 10000,
  controlAdverseCount: 2,
  retainedAdverseCount: 1,
  adverseAvoidedCount: 1,
  adverseExposureReductionBps: 5000,
  controlWinCount: 2,
  retainedWinCount: 1,
  winRetentionBps: 5000,
  controlUpsideExcessUsdMicros: 3_000_000n,
  retainedUpsideExcessUsdMicros: 2_000_000n,
  upsideCaptureBps: 6666
});

const withOutsideControl = await evaluateFastVetShadow([
  ...rows,
  {
    launchId: 'unverified',
    baseline: baseline('unverified', { status: 'UNVERIFIED' }),
    creatorFeature: null,
    targetOutcome: outcome('unverified', 'CATASTROPHIC_LOSS', 0n)
  }
]);
assert.deepEqual(withOutsideControl.metrics, first.metrics);

const wrongHorizon = await evaluateFastVetShadow([
  { launchId: 'short', baseline: baseline('short'), creatorFeature: feature('short'), targetOutcome: outcome('short', 'CATASTROPHIC_LOSS', 0n, 300_000) }
]);
assert.equal(wrongHorizon.metrics.resolvedOutcomeCount, 0);
assert.equal(wrongHorizon.metrics.controlAdverseCount, 0);

console.log('fast-vet-check: PASS');
