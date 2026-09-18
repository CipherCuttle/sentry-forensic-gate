import assert from 'node:assert/strict';
import {
  buildPortableForwardOutcome
} from '../dist/multichain/portableForwardOutcomes.js';
import {
  buildShadowPolicyComparisonReceipt
} from '../dist/evaluation/shadowPolicyReceipts.js';
import {
  DEFAULT_BASELINE_NOTIONALS_USD_MICROS,
  EXECUTABLE_BASELINE_R1
} from '../dist/shadow/baselineTypes.js';

const chainId = 4663;
const launchBlock = 100n;
const decisionBlock = 102n;
const baseAsset = '0x0000000000000000000000000000000000000000';
const token = '0x1111111111111111111111111111111111111111';

function hash(blockNumber) {
  return `0x${blockNumber.toString(16).padStart(64, '0')}`;
}

const launch = {
  chainId,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchId: 'launch-portable-outcome-1',
  eventId: 'event-portable-outcome-1',
  factory: '0x2222222222222222222222222222222222222222',
  txHash: `0x${'ab'.repeat(32)}`,
  blockNumber: launchBlock,
  blockHash: hash(launchBlock),
  logIndex: 1,
  token,
  creator: '0x3333333333333333333333333333333333333333',
  name: 'Outcome Candidate',
  symbol: 'OUT',
  sourceEventName: 'TokenLaunched',
  observedAtMs: 1,
  sourceAuthority: {
    schema: 'TEST_LAUNCH',
    payload: { id: 'launch-portable-outcome-1' }
  }
};

const market = {
  marketId: 'market-portable-outcome-1',
  launchId: launch.launchId,
  chainId,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchedToken: token,
  baseAsset,
  venue: 'PONS_V2_BONDING_CURVE',
  sourceAuthority: {
    schema: 'TEST_MARKET',
    payload: { venue: 'curve' }
  }
};

function baseline() {
  return {
    baselineId: 'baseline-portable-outcome-1',
    authorityDigest: 'baseline-authority-digest',
    launchId: launch.launchId,
    policyVersion: EXECUTABLE_BASELINE_R1,
    decisionBlock,
    decisionBlockHash: hash(decisionBlock),
    observedAtMs: 2,
    status: 'COMPLETE',
    market,
    legs: DEFAULT_BASELINE_NOTIONALS_USD_MICROS.map((notional) => ({
      notionalUsdMicros: notional,
      calibration: {
        notionalUsdMicros: notional,
        baseAsset,
        baseAmount: notional * 1000n,
        baseDecimals: 18,
        sourceAuthority: { schema: 'TEST_CAL', payload: { n: notional.toString() } }
      },
      entry: {
        quoteId: `entry-${notional}`,
        launchId: launch.launchId,
        marketId: market.marketId,
        blockNumber: decisionBlock,
        blockHash: hash(decisionBlock),
        observedAtMs: 3,
        kind: 'ENTRY',
        notionalUsdMicros: notional,
        tokenIn: baseAsset,
        tokenOut: token,
        amountIn: notional * 1000n,
        amountOut: notional * 10n,
        executable: true,
        sourceAuthority: { schema: 'TEST_ENTRY', payload: { n: notional.toString() } }
      },
      reverse: {
        quoteId: `reverse-${notional}`,
        launchId: launch.launchId,
        marketId: market.marketId,
        blockNumber: decisionBlock,
        blockHash: hash(decisionBlock),
        observedAtMs: 4,
        kind: 'INDEPENDENT_REVERSE_EXIT',
        notionalUsdMicros: notional,
        tokenIn: token,
        tokenOut: baseAsset,
        amountIn: notional * 10n,
        amountOut: notional * 900n,
        executable: true,
        sourceAuthority: { schema: 'TEST_REVERSE', payload: { n: notional.toString() } }
      },
      independentReverseRecoveryBps: 9000n
    })),
    reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
    chainId,
    ecosystem: 'ROBINHOOD',
    launchProtocol: 'PONS',
    sourceAuthority: {
      schema: 'TEST_BASELINE',
      payload: { frozen: true }
    }
  };
}

function adapter({
  liquidity = 'SURVIVED',
  exitExecutable = true,
  valueUsdMicros = 1_200_000n,
  valuationUnavailable = false,
  mutateObservedHash = false
} = {}) {
  const reads = new Map();
  return {
    chainId,
    ecosystem: 'ROBINHOOD',
    launchProtocol: 'PONS',
    mode: 'SHADOW_ONLY',
    async getHeadBlockNumber() { return 120n; },
    async getBlockPoint(blockNumber) {
      const count = (reads.get(blockNumber) ?? 0) + 1;
      reads.set(blockNumber, count);
      const shouldMutate =
        mutateObservedHash && blockNumber === 110n && count > 1;
      return {
        blockNumber,
        blockHash: shouldMutate ? hash(999n) : hash(blockNumber),
        timestampMs: Number(blockNumber) * 1000
      };
    },
    async assertMarketAuthority(m, blockNumber) {
      assert.equal(m.marketId, market.marketId);
      assert.equal(blockNumber, 110n);
    },
    async readLiquidity() {
      return {
        state: liquidity,
        sourceAuthority: {
          schema: 'TEST_LIQUIDITY',
          payload: { state: liquidity }
        }
      };
    },
    async quoteExit({ tokenAmount, blockNumber }) {
      assert.equal(tokenAmount, 10_000_000n);
      assert.equal(blockNumber, 110n);
      return {
        executable: exitExecutable,
        amountOut: exitExecutable ? 1_000_000_000n : 0n,
        ...(exitExecutable ? {} : { failureReason: 'TEST_EXIT_UNAVAILABLE' }),
        sourceAuthority: {
          schema: 'TEST_EXIT',
          payload: { executable: exitExecutable }
        }
      };
    },
    async valueBaseAmountUsdMicros({ baseAmount, blockNumber }) {
      if (valuationUnavailable) {
        throw new Error('PORTABLE_USD_VALUATION_UNAVAILABLE:TEST');
      }
      assert.equal(baseAmount, 1_000_000_000n);
      assert.equal(blockNumber, 110n);
      return {
        usdMicros: valueUsdMicros,
        sourceAuthority: {
          schema: 'TEST_USD_VALUE',
          payload: { usdMicros: valueUsdMicros.toString() }
        }
      };
    }
  };
}

const confirmed = {
  blockNumber: 120n,
  blockHash: hash(120n),
  timestampMs: 120_000
};

const win = await buildPortableForwardOutcome(
  adapter(),
  launch,
  baseline(),
  10_000,
  confirmed
);
assert.ok(win);
assert.equal(win.status, 'COMPLETE');
assert.equal(win.observedBlock, 110n);
assert.equal(win.exitExecutable, true);
assert.equal(win.executableValueUsdMicros, 1_200_000n);
assert.equal(win.executableReturnBps, 12_000n);
assert.equal(win.classification, 'NORMAL_WIN');

const winAgain = await buildPortableForwardOutcome(
  adapter(),
  launch,
  baseline(),
  10_000,
  confirmed
);
assert.equal(winAgain.outcomeId, win.outcomeId);
assert.equal(winAgain.authorityDigest, win.authorityDigest);

const exitFailure = await buildPortableForwardOutcome(
  adapter({ exitExecutable: false, liquidity: 'SURVIVED' }),
  launch,
  baseline(),
  10_000,
  confirmed
);
assert.equal(exitFailure.status, 'COMPLETE');
assert.equal(exitFailure.classification, 'EXIT_FAILURE');
assert.equal(exitFailure.executableValueUsdMicros, 0n);

const collapse = await buildPortableForwardOutcome(
  adapter({ exitExecutable: false, liquidity: 'COLLAPSED' }),
  launch,
  baseline(),
  10_000,
  confirmed
);
assert.equal(collapse.status, 'COMPLETE');
assert.equal(collapse.classification, 'LIQUIDITY_COLLAPSE');

const migratedUnsupported = await buildPortableForwardOutcome(
  adapter({ exitExecutable: false, liquidity: 'UNKNOWN' }),
  launch,
  baseline(),
  10_000,
  confirmed
);
assert.equal(migratedUnsupported.status, 'UNVERIFIED');
assert.equal(migratedUnsupported.classification, undefined);
assert.equal(migratedUnsupported.executableValueUsdMicros, undefined);

const valuationGap = await buildPortableForwardOutcome(
  adapter({ valuationUnavailable: true }),
  launch,
  baseline(),
  10_000,
  confirmed
);
assert.equal(valuationGap.status, 'UNVERIFIED');
assert.equal(valuationGap.classification, undefined);
assert.equal(valuationGap.executableValueUsdMicros, undefined);
assert.match(valuationGap.reason, /^PORTABLE_USD_VALUATION_UNAVAILABLE:/);

await assert.rejects(
  () => buildPortableForwardOutcome(
    adapter({ mutateObservedHash: true }),
    launch,
    baseline(),
    10_000,
    confirmed
  ),
  /PORTABLE_OUTCOME_OBSERVED_FINAL_REORG/
);

function creator(overrides = {}) {
  return {
    receiptId: 'creator-receipt-1',
    derivationVersion: 'CREATOR_OUTCOME_JOIN_V0',
    chainId,
    launchId: launch.launchId,
    creator: launch.creator,
    baselineId: baseline().baselineId,
    decisionBlock,
    decisionBlockHash: hash(decisionBlock),
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
    inputDigest: 'creator-input',
    outputDigest: 'creator-output',
    evidenceDigest: 'creator-evidence',
    ...overrides
  };
}

const receipt = await buildShadowPolicyComparisonReceipt({
  launchId: launch.launchId,
  baseline: baseline(),
  creatorFeature: null
});
assert.equal(receipt.mode, 'SHADOW_ONLY');
assert.equal(receipt.liveMoneyAuthority, false);
assert.equal(receipt.edge, 'UNPROVEN');
assert.equal(receipt.receipts.r0.decision, 'UNKNOWN');
assert.equal(receipt.receipts.r1.decision, 'ELIGIBLE');
assert.equal(
  receipt.receipts.buyEveryExecutableControl.decision,
  'ELIGIBLE'
);
assert.equal(receipt.receipts.r1.capacityUsdMicros, 5_000_000n);

const receiptAgain = await buildShadowPolicyComparisonReceipt({
  launchId: launch.launchId,
  baseline: baseline(),
  creatorFeature: null
});
assert.equal(receiptAgain.comparisonId, receipt.comparisonId);
assert.equal(receiptAgain.evidenceDigest, receipt.evidenceDigest);
assert.equal(
  receiptAgain.receipts.r1.receiptId,
  receipt.receipts.r1.receiptId
);

const adverseReceipt = await buildShadowPolicyComparisonReceipt({
  launchId: launch.launchId,
  baseline: baseline(),
  creatorFeature: creator({
    coverage: 'COMPLETE',
    priorLaunchCount: 1,
    outcomeReceiptCount: 1,
    classifiedOutcomeCount: 1,
    catastrophicLossCount: 1
  })
});
assert.equal(adverseReceipt.receipts.r1.decision, 'REJECT');
assert.equal(
  adverseReceipt.receipts.buyEveryExecutableControl.decision,
  'ELIGIBLE'
);

console.log(JSON.stringify({
  verdict: 'PORTABLE_OUTCOMES_AND_POLICY_RECEIPTS_PASS',
  portableOutcome: {
    deterministic: true,
    executableClassification: win.classification,
    exitFailureClassification: exitFailure.classification,
    collapseClassification: collapse.classification,
    unsupportedMigrationStatus: migratedUnsupported.status
  },
  policyReceipts: {
    r0: receipt.receipts.r0.decision,
    r1: receipt.receipts.r1.decision,
    control: receipt.receipts.buyEveryExecutableControl.decision,
    contentAddressed: true
  },
  liveMoneyAuthority: false,
  edge: 'UNPROVEN'
}, null, 2));
