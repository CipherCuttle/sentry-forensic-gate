import assert from 'node:assert/strict';
import {
  DEFAULT_BASELINE_NOTIONALS_USD_MICROS,
  EXECUTABLE_BASELINE_R1
} from '../dist/shadow/baselineTypes.js';
import {
  evaluatePortableFastVet
} from '../dist/multichain/fastVetBridge.js';
import {
  PORTABLE_BASELINE_CONFIRMATIONS,
  PORTABLE_BASELINE_DECISION_DELAY_BLOCKS,
  PORTABLE_BASELINE_NOTIONALS_USD_MICROS,
  buildPortableBaselineBatch
} from '../dist/multichain/portableBaseline.js';

const chainId = 4663;
const launchBlock = 100n;
const decisionBlock = 102n;
const decisionHash = `0x${'aa'.repeat(32)}`;
const token = '0x1111111111111111111111111111111111111111';
const factory = '0x2222222222222222222222222222222222222222';
const creator = '0x3333333333333333333333333333333333333333';
const baseAsset = '0x0000000000000000000000000000000000000000';

const launch = {
  chainId,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchId: 'pons-launch-1',
  eventId: 'pons-event-1',
  factory,
  txHash: `0x${'bb'.repeat(32)}`,
  blockNumber: launchBlock,
  blockHash: `0x${'cc'.repeat(32)}`,
  logIndex: 1,
  token,
  creator,
  name: 'Portable Candidate',
  symbol: 'PCAN',
  sourceEventName: 'TokenLaunched',
  observedAtMs: 1,
  sourceAuthority: {
    schema: 'TEST_LAUNCH_AUTHORITY',
    payload: { authorityId: 'TEST_PONS_AUTHORITY' }
  }
};

const market = {
  marketId: 'market-1',
  launchId: launch.launchId,
  chainId,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchedToken: token,
  baseAsset,
  venue: 'PONS_V2_BONDING_CURVE',
  sourceAuthority: {
    schema: 'TEST_MARKET_AUTHORITY',
    payload: { state: 'CURVE_ACTIVE' }
  }
};

function makeAdapters({
  headBlock = 104n,
  finalHash = decisionHash,
  marketError,
  calibrationError,
  primaryReverseExecutable = true,
  observedAtStart = 1000
} = {}) {
  let hashReads = 0;
  let observedAt = observedAtStart;
  return {
    launch: {
      chainId,
      ecosystem: 'ROBINHOOD',
      launchProtocol: 'PONS',
      mode: 'SHADOW_ONLY',
      async getHeadBlockNumber() { return headBlock; },
      async getBlockHash(blockNumber) {
        assert.equal(blockNumber, decisionBlock);
        hashReads += 1;
        return hashReads === 1 ? decisionHash : finalHash;
      },
      async assertAuthority(blockNumber) {
        assert.ok(blockNumber === launchBlock || blockNumber === decisionBlock);
      },
      async catchUp() { return []; }
    },
    marketQuotes: {
      chainId,
      ecosystem: 'ROBINHOOD',
      launchProtocol: 'PONS',
      mode: 'SHADOW_ONLY',
      async resolveMarket(candidate, blockNumber) {
        assert.equal(candidate.launchId, launch.launchId);
        assert.equal(blockNumber, decisionBlock);
        if (marketError) throw new Error(marketError);
        return market;
      },
      async quoteEntry(params) {
        const amountOut = params.notionalUsdMicros * 10n;
        const partial = params.notionalUsdMicros === 5_000_000n;
        const amountIn = partial ? params.amountIn - 7n : params.amountIn;
        return {
          quoteId: `entry-${params.notionalUsdMicros}`,
          launchId: launch.launchId,
          marketId: market.marketId,
          blockNumber: decisionBlock,
          blockHash: decisionHash,
          observedAtMs: observedAt++,
          kind: 'ENTRY',
          notionalUsdMicros: params.notionalUsdMicros,
          tokenIn: baseAsset,
          tokenOut: token,
          amountIn,
          amountOut,
          executable: true,
          sourceAuthority: {
            schema: 'TEST_ENTRY_AUTHORITY',
            payload: {
              requested: params.amountIn.toString(),
              spent: amountIn.toString(),
              partial
            }
          }
        };
      },
      async quoteIndependentReverse(params) {
        const primary = params.notionalUsdMicros === 1_000_000n;
        const executable = primary ? primaryReverseExecutable : true;
        const entrySpent = params.notionalUsdMicros === 5_000_000n
          ? params.notionalUsdMicros * 1000n - 7n
          : params.notionalUsdMicros * 1000n;
        return {
          quoteId: `reverse-${params.notionalUsdMicros}`,
          launchId: launch.launchId,
          marketId: market.marketId,
          blockNumber: decisionBlock,
          blockHash: decisionHash,
          observedAtMs: observedAt++,
          kind: 'INDEPENDENT_REVERSE_EXIT',
          notionalUsdMicros: params.notionalUsdMicros,
          tokenIn: token,
          tokenOut: baseAsset,
          amountIn: params.amountIn,
          amountOut: executable ? (entrySpent * 9n) / 10n : 0n,
          executable,
          ...(executable ? {} : { failureReason: 'TEST_REVERSE_UNAVAILABLE' }),
          sourceAuthority: {
            schema: 'TEST_REVERSE_AUTHORITY',
            payload: { executable }
          }
        };
      }
    },
    usdCalibration: {
      chainId,
      ecosystem: 'ROBINHOOD',
      launchProtocol: 'PONS',
      mode: 'SHADOW_ONLY',
      async calibrateUsd(params) {
        if (calibrationError) throw new Error(calibrationError);
        return {
          notionalUsdMicros: params.notionalUsdMicros,
          baseAsset,
          baseAmount: params.notionalUsdMicros * 1000n,
          baseDecimals: 18,
          sourceAuthority: {
            schema: 'TEST_USD_AUTHORITY',
            payload: { notional: params.notionalUsdMicros.toString() }
          }
        };
      }
    }
  };
}

assert.equal(PORTABLE_BASELINE_DECISION_DELAY_BLOCKS, 2n);
assert.equal(PORTABLE_BASELINE_CONFIRMATIONS, 2n);
assert.deepEqual(
  [...PORTABLE_BASELINE_NOTIONALS_USD_MICROS],
  [...DEFAULT_BASELINE_NOTIONALS_USD_MICROS]
);
assert.equal(Object.isFrozen(PORTABLE_BASELINE_NOTIONALS_USD_MICROS), true);
assert.throws(
  () => PORTABLE_BASELINE_NOTIONALS_USD_MICROS.push(10_000_000n),
  TypeError,
  'the translated ladder must be runtime-immutable, not merely TypeScript-readonly'
);

const baseline = await buildPortableBaselineBatch(makeAdapters(), launch, () => 5000);
assert.equal(baseline.status, 'COMPLETE');
assert.equal(baseline.policyVersion, EXECUTABLE_BASELINE_R1);
assert.equal(baseline.decisionBlock, decisionBlock);
assert.equal(baseline.decisionBlockHash, decisionHash);
assert.equal(baseline.legs.length, 5);
assert.deepEqual(
  baseline.legs.map((leg) => leg.notionalUsdMicros),
  [...DEFAULT_BASELINE_NOTIONALS_USD_MICROS]
);

const primary = baseline.legs.find((leg) => leg.notionalUsdMicros === 1_000_000n);
assert.ok(primary);
assert.equal(primary.entry.executable, true);
assert.equal(primary.reverse?.executable, true);
assert.equal(primary.independentReverseRecoveryBps, 9000n);

const fiveDollar = baseline.legs.find((leg) => leg.notionalUsdMicros === 5_000_000n);
assert.ok(fiveDollar);
assert.equal(fiveDollar.entry.amountIn, fiveDollar.calibration.baseAmount - 7n);
assert.equal(
  fiveDollar.independentReverseRecoveryBps,
  (fiveDollar.reverse.amountOut * 10_000n) / fiveDollar.entry.amountIn,
  'recovery must use actual spent input after a partial fill'
);

const sameEvidenceDifferentClock = await buildPortableBaselineBatch(
  makeAdapters({ observedAtStart: 9000 }),
  launch,
  () => 9999
);
assert.equal(
  sameEvidenceDifferentClock.authorityDigest,
  baseline.authorityDigest,
  'wall-clock observation times must not change authority digest'
);

const unknownWithoutCreator = evaluatePortableFastVet({
  baseline,
  creatorFeature: null
});
assert.equal(unknownWithoutCreator.decision, 'UNKNOWN');
assert.deepEqual(unknownWithoutCreator.reasons, ['CREATOR_FEATURE_MISSING']);

const creatorFeature = {
  receiptId: 'creator-feature-1',
  derivationVersion: 'CREATOR_OUTCOME_JOIN_V0',
  chainId,
  launchId: launch.launchId,
  creator,
  baselineId: baseline.baselineId,
  decisionBlock: baseline.decisionBlock,
  decisionBlockHash: baseline.decisionBlockHash,
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
  inputDigest: 'input',
  outputDigest: 'output',
  evidenceDigest: 'evidence'
};
const pass = evaluatePortableFastVet({ baseline, creatorFeature });
assert.equal(pass.decision, 'PASS');
assert.equal(pass.action, 'BUY_ELIGIBLE');
assert.deepEqual(pass.reasons, []);

const reverseFailBaseline = await buildPortableBaselineBatch(
  makeAdapters({ primaryReverseExecutable: false }),
  launch
);
const reject = evaluatePortableFastVet({
  baseline: reverseFailBaseline,
  creatorFeature: { ...creatorFeature, baselineId: reverseFailBaseline.baselineId }
});
assert.equal(reject.decision, 'REJECT');
assert.deepEqual(reject.reasons, ['PRIMARY_REVERSE_NOT_EXECUTABLE']);

const unverified = await buildPortableBaselineBatch(
  makeAdapters({ marketError: 'PONS_V2_QUOTE_MARKET_NOT_ACTIVE:SWEPT_PENDING_V4:test' }),
  launch
);
assert.equal(unverified.status, 'UNVERIFIED');
assert.equal(unverified.legs.length, 0);
const unverifiedVet = evaluatePortableFastVet({
  baseline: unverified,
  creatorFeature: null
});
assert.equal(unverifiedVet.decision, 'UNKNOWN');
assert.deepEqual(unverifiedVet.reasons, ['BASELINE_UNVERIFIED']);

await assert.rejects(
  () => buildPortableBaselineBatch(
    makeAdapters({ calibrationError: 'RPC Request failed.' }),
    launch
  ),
  /RPC Request failed/,
  'provider errors must escape instead of becoming terminal evidence'
);

await assert.rejects(
  () => buildPortableBaselineBatch(
    makeAdapters({ headBlock: 103n }),
    launch
  ),
  /PORTABLE_BASELINE_LAUNCH_NOT_MATURE/
);

await assert.rejects(
  () => buildPortableBaselineBatch(
    makeAdapters({ finalHash: `0x${'dd'.repeat(32)}` }),
    launch
  ),
  /PORTABLE_BASELINE_REORG_DURING_READ/
);

await assert.rejects(
  () => buildPortableBaselineBatch({
    ...makeAdapters(),
    usdCalibration: {
      ...makeAdapters().usdCalibration,
      chainId: 57073
    }
  }, launch),
  /PORTABLE_BASELINE_ADAPTER_IDENTITY_MISMATCH/
);

console.log(JSON.stringify({
  verdict: 'PONS_V2_PORTABLE_BASELINE_PASS',
  mode: 'SHADOW_ONLY',
  decisionDelayBlocks: PORTABLE_BASELINE_DECISION_DELAY_BLOCKS.toString(),
  confirmations: PORTABLE_BASELINE_CONFIRMATIONS.toString(),
  notionalsUsdMicros: PORTABLE_BASELINE_NOTIONALS_USD_MICROS.map(String),
  primaryRecoveryBps: primary.independentReverseRecoveryBps.toString(),
  fastVetPassWithNoHistory: pass.decision,
  fastVetRejectOnPrimaryReverseFailure: reject.decision,
  unverifiedRemainsUnknown: unverifiedVet.decision,
  providerFailureEscapes: true,
  liveMoneyAuthority: false,
  edge: 'UNPROVEN'
}, null, 2));
