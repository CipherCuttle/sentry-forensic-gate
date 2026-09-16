import assert from 'node:assert/strict';
import {
  ADAPTER_VERSION,
  BASELINE_POLICY,
  OUTCOME_POLICY,
  adaptBaseline,
  adaptTargetOutcome,
  buildCreatorFeature
} from './fast-vet-r0-historical-smoke-r1.mjs';

const HASH = `0x${'11'.repeat(32)}`;
const CREATOR_A = `0x${'aa'.repeat(20)}`;
const CREATOR_B = `0x${'bb'.repeat(20)}`;

function row({ ordinal, creator, decisionBlock, outcomeObservedBlock, classification, value = '1000000' }) {
  const launchId = `launch-${ordinal}`;
  const baselineId = `baseline-${ordinal}`;
  return {
    ordinal,
    launchId,
    creator,
    baselineId,
    baselineStatus: 'COMPLETE',
    baselinePolicyVersion: BASELINE_POLICY,
    baseline: {
      baselineId,
      launchId,
      policyVersion: BASELINE_POLICY,
      decisionBlock: String(decisionBlock),
      decisionBlockHash: HASH,
      authorityDigest: `authority-${ordinal}`,
      status: 'COMPLETE',
      legs: [
        { notionalUsdMicros: '250000', entry: { executable: true }, reverse: { executable: true }, independentReverseRecoveryBps: '9000' },
        { notionalUsdMicros: '500000', entry: { executable: true }, reverse: { executable: true }, independentReverseRecoveryBps: '9000' },
        { notionalUsdMicros: '1000000', entry: { executable: true }, reverse: { executable: true }, independentReverseRecoveryBps: '9000' },
        { notionalUsdMicros: '2000000', entry: { executable: true }, reverse: { executable: true }, independentReverseRecoveryBps: '9000' },
        { notionalUsdMicros: '5000000', entry: { executable: true }, reverse: { executable: true }, independentReverseRecoveryBps: '9000' }
      ]
    },
    outcomes: [
      { horizonMs: 60000, policyVersion: OUTCOME_POLICY, status: 'COMPLETE', classification: 'NORMAL_WIN', executableValueUsdMicros: '1000000', observedBlock: String(outcomeObservedBlock), outcomeId: `o-${ordinal}-1m`, evidenceDigest: `e-${ordinal}-1m`, sellable: true },
      { horizonMs: 300000, policyVersion: OUTCOME_POLICY, status: 'COMPLETE', classification: 'NORMAL_WIN', executableValueUsdMicros: '1000000', observedBlock: String(outcomeObservedBlock), outcomeId: `o-${ordinal}-5m`, evidenceDigest: `e-${ordinal}-5m`, sellable: true },
      { horizonMs: 1800000, policyVersion: OUTCOME_POLICY, status: 'COMPLETE', classification: 'NORMAL_WIN', executableValueUsdMicros: '1000000', observedBlock: String(outcomeObservedBlock), outcomeId: `o-${ordinal}-30m`, evidenceDigest: `e-${ordinal}-30m`, sellable: true },
      { horizonMs: 7200000, policyVersion: OUTCOME_POLICY, status: 'COMPLETE', classification: 'NORMAL_WIN', executableValueUsdMicros: '1000000', observedBlock: String(outcomeObservedBlock), outcomeId: `o-${ordinal}-2h`, evidenceDigest: `e-${ordinal}-2h`, sellable: true },
      { horizonMs: 86400000, policyVersion: OUTCOME_POLICY, status: 'COMPLETE', classification, executableValueUsdMicros: value, observedBlock: String(outcomeObservedBlock), outcomeId: `o-${ordinal}-24h`, evidenceDigest: `e-${ordinal}-24h`, sellable: classification !== 'EXIT_FAILURE' && classification !== 'LIQUIDITY_COLLAPSE' }
    ]
  };
}

const rows = [
  row({ ordinal: 1, creator: CREATOR_A, decisionBlock: 10, outcomeObservedBlock: 90, classification: 'CATASTROPHIC_LOSS', value: '100000' }),
  row({ ordinal: 2, creator: CREATOR_A, decisionBlock: 60, outcomeObservedBlock: 110, classification: 'NORMAL_WIN', value: '3000000' }),
  row({ ordinal: 3, creator: CREATOR_A, decisionBlock: 100, outcomeObservedBlock: 200, classification: 'NORMAL_WIN', value: '2000000' }),
  row({ ordinal: 4, creator: CREATOR_B, decisionBlock: 120, outcomeObservedBlock: 220, classification: 'NORMAL_LOSS', value: '700000' }),
  row({ ordinal: 5, creator: CREATOR_A, decisionBlock: 220, outcomeObservedBlock: 230, classification: 'NORMAL_WIN', value: '2500000' })
];

const noHistory = buildCreatorFeature(rows[0], rows);
assert.equal(noHistory.coverage, 'NO_HISTORY');
assert.equal(noHistory.priorLaunchCount, 0);
assert.equal(noHistory.outcomeReceiptCount, 0);

const partial = buildCreatorFeature(rows[2], rows);
assert.equal(partial.coverage, 'PARTIAL');
assert.equal(partial.priorLaunchCount, 2);
assert.equal(partial.outcomeReceiptCount, 1);
assert.equal(partial.classifiedOutcomeCount, 1);
assert.equal(partial.catastrophicLossCount, 1);
assert.equal(partial.unresolvedOutcomeCount, 1);
assert.equal(partial.derivationVersion, ADAPTER_VERSION);

const complete = buildCreatorFeature(rows[4], rows);
assert.equal(complete.coverage, 'COMPLETE');
assert.equal(complete.priorLaunchCount, 3);
assert.equal(complete.outcomeReceiptCount, 3);
assert.equal(complete.classifiedOutcomeCount, 3);
assert.equal(complete.catastrophicLossCount, 1);
assert.equal(complete.normalWinCount, 2);
assert.equal(complete.unresolvedOutcomeCount, 0);

const baseline = adaptBaseline(rows[0]);
assert.equal(baseline.decisionBlock, 10n);
assert.equal(baseline.legs.find((leg) => leg.notionalUsdMicros === 1_000_000n)?.entry.executable, true);

const target = adaptTargetOutcome(rows[0]);
assert.equal(target.analyzer.policyVersion, 'FORWARD_OUTCOMES_R1');
assert.equal(target.sourceBinding.sourcePolicyVersion, OUTCOME_POLICY);
assert.equal(target.sourceBinding.projectionIsEvidenceAuthority, false);
assert.equal(target.analyzer.executableValueUsdMicros, 100000n);
assert.equal(target.sourceBinding.executableValueUsdMicros, '100000');

console.log('fast-vet-r0-historical-smoke-r1-check: PASS');
