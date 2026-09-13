import assert from 'node:assert/strict';
import {
  CREATOR_OUTCOME_JOIN_V0,
  CREATOR_SIGNAL_EVAL_V0,
  CREATOR_SIGNAL_HORIZON_MS,
  CREATOR_SIGNAL_STRATEGY_LABEL,
  FORWARD_OUTCOMES_R1,
  buildCreatorSignalEvaluation,
  candidateDecision,
  evaluateCreatorSignal
} from '../dist/index.js';

const creator = '0xcccccccccccccccccccccccccccccccccccccccc';
const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const base = '0x0200c29006150606b650577bbe7b6248f58470c1';
const pool = '0x1111111111111111111111111111111111111111';

function hash(block, suffix = '') {
  return `0x${block.toString(16).padStart(64 - suffix.length, '0')}${suffix}`;
}

function digest(label) {
  return label.padEnd(64, '0').slice(0, 64);
}

function feature(i, adverseHistory = false, priorLaunchCount = 0) {
  const launchId = `launch-${i}`;
  return {
    receiptId: `feature-${launchId}`,
    derivationVersion: CREATOR_OUTCOME_JOIN_V0,
    chainId: 57073,
    launchId,
    creator,
    baselineId: `baseline-${launchId}`,
    decisionBlock: BigInt(100 + i),
    decisionBlockHash: hash(BigInt(100 + i)),
    horizonMs: CREATOR_SIGNAL_HORIZON_MS,
    coverage: priorLaunchCount === 0 ? 'NO_HISTORY' : 'COMPLETE',
    priorLaunchCount,
    outcomeReceiptCount: priorLaunchCount,
    classifiedOutcomeCount: priorLaunchCount,
    unresolvedOutcomeCount: 0,
    unsellableOutcomeCount: adverseHistory ? 1 : 0,
    catastrophicLossCount: adverseHistory ? 1 : 0,
    exitFailureCount: 0,
    liquidityCollapseCount: 0,
    normalLossCount: 0,
    normalWinCount: adverseHistory ? Math.max(0, priorLaunchCount - 1) : priorLaunchCount,
    fatTailWinCount: 0,
    sourceFactIds: [`fact-${launchId}`],
    sourceOutcomeIds: adverseHistory ? [`prior-adverse-${launchId}`] : [],
    inputDigest: digest(`in-${i}`),
    outputDigest: digest(`out-${i}`),
    evidenceDigest: digest(`feature-evidence-${i}`)
  };
}

function target(i, classification, valueUsdMicros) {
  const launchId = `launch-${i}`;
  const observedBlock = BigInt(1000 + i);
  return {
    outcomeId: `target-${launchId}`,
    launchId,
    horizonMs: CREATOR_SIGNAL_HORIZON_MS,
    observedBlock,
    policyVersion: FORWARD_OUTCOMES_R1,
    status: 'COMPLETE',
    observedBlockHash: hash(observedBlock),
    targetTimestampMs: 100_000_000 + i,
    observedTimestampMs: 100_000_000 + i,
    baselineId: `baseline-${launchId}`,
    entryNotionalUsdMicros: 1_000_000n,
    entryTokenAmount: 2_000_000n,
    marketPool: pool,
    marketFee: 10_000,
    baseToken: base,
    baseAmountOut: valueUsdMicros,
    executableValueUsdMicros: valueUsdMicros,
    executableReturnBps: (valueUsdMicros * 10_000n) / 1_000_000n,
    poolActiveLiquidity: 100n,
    sellable: valueUsdMicros > 0n,
    classification,
    evidenceDigest: digest(`target-evidence-${i}`)
  };
}

const matureLaunches = [];
const rows = [];
for (let i = 0; i < 30; i += 1) {
  const launchId = `launch-${i}`;
  matureLaunches.push({
    launchId,
    factId: `fact-${launchId}`,
    factEvidenceDigest: digest(`fact-evidence-${i}`),
    baselineId: `baseline-${launchId}`,
    baselineAuthorityDigest: digest(`baseline-authority-${i}`),
    baselineStatus: 'COMPLETE'
  });
  const adverseTarget = i < 10;
  const adverseHistory = i < 8;
  const priorLaunchCount = i < 12 ? 1 : 0;
  rows.push({
    launchId,
    baselineId: `baseline-${launchId}`,
    baselineAuthorityDigest: digest(`baseline-authority-${i}`),
    feature: feature(i, adverseHistory, priorLaunchCount),
    targetOutcome: adverseTarget
      ? target(i, 'CATASTROPHIC_LOSS', 100_000n)
      : target(i, 'NORMAL_WIN', 1_200_000n)
  });
}

assert.equal(candidateDecision(rows[0].feature), 'REJECT');
assert.equal(candidateDecision(rows[11].feature), 'PASS');
assert.equal(candidateDecision(rows[20].feature), 'PASS');

const input = {
  chainId: 57073,
  asOfBlock: 2_000n,
  asOfBlockHash: hash(2_000n),
  asOfTimestampMs: 2_000_000_000,
  confirmations: 2n,
  matureLaunches,
  rows
};
const receipt = await evaluateCreatorSignal(input);
const replay = await evaluateCreatorSignal({
  ...input,
  matureLaunches: [...matureLaunches].reverse(),
  rows: [...rows].reverse()
});
assert.deepEqual(replay, receipt, 'evaluation must be deterministic across input ordering');
assert.equal(receipt.evaluationVersion, CREATOR_SIGNAL_EVAL_V0);
assert.equal(receipt.strategyLabel, CREATOR_SIGNAL_STRATEGY_LABEL);
assert.equal(receipt.strategyLabel, 'EDGE_UNPROVEN');
assert.equal(receipt.status, 'COMPLETE');
assert.equal(receipt.verdict, 'DESCRIPTIVE_WORTH_PROSPECTIVE_TEST');
assert.deepEqual(receipt.sampleFailures, []);
assert.equal(receipt.metrics.matureLaunchCount, 30);
assert.equal(receipt.metrics.baselineReceiptCoverageBps, 10_000);
assert.equal(receipt.metrics.resolvedTargetCount, 30);
assert.equal(receipt.metrics.outcomeCoverageBps, 10_000);
assert.equal(receipt.metrics.priorHistoryDecisionCount, 12);
assert.equal(receipt.metrics.controlAdverseCount, 10);
assert.equal(receipt.metrics.candidateAdverseCount, 2);
assert.equal(receipt.metrics.adverseAvoidedCount, 8);
assert.equal(receipt.metrics.adverseExposureReductionBps, 8_000);
assert.equal(receipt.metrics.candidateDecisionRejectCount, 8);
assert.equal(receipt.metrics.rejectedNonAdverseCount, 0);
assert.equal(receipt.metrics.controlTerminalUsdMicros, 25_000_000n);
assert.equal(receipt.metrics.candidateTerminalUsdMicros, 32_200_000n);
assert.equal(receipt.metrics.capitalDeltaUsdMicros, 7_200_000n);
assert.equal(receipt.metrics.winnerCaptureBps, 10_000);
assert.ok(receipt.configurationDigest.length === 64);
assert.ok(receipt.inputDigest.length === 64);
assert.ok(receipt.outputDigest.length === 64);
assert.ok(receipt.evidenceDigest.length === 64);

const insufficient = await evaluateCreatorSignal({
  ...input,
  matureLaunches: matureLaunches.slice(0, 5),
  rows: rows.slice(0, 5)
});
assert.equal(insufficient.status, 'INSUFFICIENT_SAMPLE');
assert.equal(insufficient.verdict, null, 'insufficient evidence must never masquerade as a signal verdict');
assert.ok(insufficient.sampleFailures.includes('MIN_MATURE_LAUNCHES'));
assert.ok(insufficient.sampleFailures.includes('MIN_RESOLVED_TARGETS'));

const fatTailRows = rows.map((row, i) => i === 0 ? {
  ...row,
  targetOutcome: { ...row.targetOutcome, classification: 'FAT_TAIL_WIN' }
} : row);
await assert.rejects(
  evaluateCreatorSignal({ ...input, rows: fatTailRows }),
  /UNEXPECTED_R1_FAT_TAIL_LABEL/,
  'R1 must not silently acquire a post-hoc fat-tail class'
);

// Runtime snapshot test: mature facts/baselines and R1 outcomes are hash-bound,
// future launches are excluded, and the final as-of block anchors the read window.
function runtimeFact(id, block, logIndex) {
  return {
    factId: `fact-${id}`,
    kind: 'LAUNCH_DEPLOYED_BY_CREATOR',
    chainId: 57073,
    launchId: id,
    creator,
    observedBlock: block,
    observedBlockHash: hash(block),
    logIndex,
    sourceEventId: `event-${id}`,
    evidenceDigest: digest(`fact-${id}`)
  };
}

function runtimeBaseline(id, decisionBlock) {
  return {
    baselineId: `baseline-${id}`,
    authorityDigest: digest(`authority-${id}`),
    launchId: id,
    decisionBlock,
    decisionBlockHash: hash(decisionBlock),
    status: 'COMPLETE'
  };
}

function runtimeOutcome(id, block, classification = 'NORMAL_WIN') {
  const value = classification === 'NORMAL_WIN' ? 1_200_000n : 100_000n;
  return {
    outcomeId: `outcome-${id}`,
    launchId: id,
    horizonMs: CREATOR_SIGNAL_HORIZON_MS,
    observedBlock: block,
    policyVersion: FORWARD_OUTCOMES_R1,
    status: 'COMPLETE',
    observedBlockHash: hash(block),
    targetTimestampMs: Number(block) * 1_000_000,
    observedTimestampMs: Number(block) * 1_000_000,
    baselineId: `baseline-${id}`,
    entryNotionalUsdMicros: 1_000_000n,
    entryTokenAmount: 2_000_000n,
    marketPool: pool,
    marketFee: 10_000,
    baseToken: base,
    baseAmountOut: value,
    executableValueUsdMicros: value,
    executableReturnBps: (value * 10_000n) / 1_000_000n,
    poolActiveLiquidity: 100n,
    sellable: true,
    classification,
    evidenceDigest: digest(`outcome-${id}`)
  };
}

const runtimeFacts = [
  runtimeFact('r1', 1n, 0),
  runtimeFact('r2', 2n, 0),
  runtimeFact('future', 20n, 0)
];
const runtimeBaselines = [
  runtimeBaseline('r1', 3n),
  runtimeBaseline('r2', 4n),
  runtimeBaseline('future', 21n)
];
const runtimeOutcomes = [
  runtimeOutcome('r1', 88n, 'CATASTROPHIC_LOSS'),
  runtimeOutcome('r2', 89n, 'NORMAL_WIN')
];
const runtimeStore = {
  async listProvenanceFacts() { return runtimeFacts; },
  async listBaselineDecisionPoints() { return runtimeBaselines; },
  async listOutcomes() { return runtimeOutcomes; }
};

class RuntimeSource {
  finalReorg = false;
  asOfReads = 0;
  async getHeadBlockNumber() { return 100n; }
  async getBlockPoint(blockNumber) {
    if (blockNumber === 98n) {
      this.asOfReads += 1;
      const suffix = this.finalReorg && this.asOfReads >= 2 ? 'ff' : '';
      return { blockNumber, blockHash: hash(blockNumber, suffix), timestampMs: Number(blockNumber) * 1_000_000 };
    }
    return { blockNumber, blockHash: hash(blockNumber), timestampMs: Number(blockNumber) * 1_000_000 };
  }
}

const runtimeReceipt = await buildCreatorSignalEvaluation(new RuntimeSource(), runtimeStore);
assert.equal(runtimeReceipt.status, 'INSUFFICIENT_SAMPLE');
assert.equal(runtimeReceipt.metrics.matureLaunchCount, 2, '24h maturity must exclude the future launch');
assert.equal(runtimeReceipt.metrics.completeBaselineCount, 2);
assert.equal(runtimeReceipt.metrics.resolvedTargetCount, 2);
assert.equal(runtimeReceipt.strategyLabel, 'EDGE_UNPROVEN');

const raceSource = new RuntimeSource();
raceSource.finalReorg = true;
await assert.rejects(
  buildCreatorSignalEvaluation(raceSource, runtimeStore),
  /CREATOR_SIGNAL_ASOF_REORG/,
  'evaluation must fail if the canonical as-of anchor moves during evidence reads'
);

console.log('creator-signal-eval-check: PASS');
