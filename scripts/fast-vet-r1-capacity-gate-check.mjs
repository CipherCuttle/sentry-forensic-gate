import assert from 'node:assert/strict';
import {
  DEFAULT_BASELINE_NOTIONALS_USD_MICROS,
  EXECUTABLE_BASELINE_R1
} from '../dist/shadow/baselineTypes.js';
import {
  FAST_VET_R1_CAPACITY_GATE_CONFIGURATION,
  evaluateFastVetR1CapacityGate,
  evaluateShadowPolicyComparison
} from '../dist/evaluation/fastVetR1CapacityGate.js';

const ladder = [...DEFAULT_BASELINE_NOTIONALS_USD_MICROS];

function leg(notionalUsdMicros, {
  entry = true,
  reverse = true,
  recovery = 1n
} = {}) {
  return {
    notionalUsdMicros,
    entry: { executable: entry },
    reverse: entry
      ? { executable: reverse }
      : null,
    independentReverseRecoveryBps: reverse ? recovery : null
  };
}

function baseline(overrides = {}) {
  return {
    baselineId: 'baseline-r1-1',
    authorityDigest: 'authority-r1-1',
    launchId: 'launch-r1-1',
    policyVersion: EXECUTABLE_BASELINE_R1,
    decisionBlock: 102n,
    decisionBlockHash: '0x1234',
    status: 'COMPLETE',
    legs: ladder.map((value) => leg(value)),
    reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
    ...overrides
  };
}

function creator(overrides = {}) {
  return {
    receiptId: 'creator-r1-1',
    derivationVersion: 'CREATOR_OUTCOME_JOIN_V0',
    chainId: 4663,
    launchId: 'launch-r1-1',
    creator: '0x3333333333333333333333333333333333333333',
    baselineId: 'baseline-r1-1',
    decisionBlock: 102n,
    decisionBlockHash: '0x1234',
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
    evidenceDigest: 'evidence',
    ...overrides
  };
}

assert.equal(FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.mode, 'SHADOW_ONLY');
assert.equal(FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.liveMoneyAuthority, false);
assert.equal(FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.recoveryThresholdBps, null);
assert.equal(
  FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.minimumProbeUsdMicros,
  250_000n
);

const comparisonMissingCreator = evaluateShadowPolicyComparison({
  baseline: baseline(),
  creatorFeature: null
});
assert.equal(comparisonMissingCreator.r0.decision, 'UNKNOWN');
assert.equal(comparisonMissingCreator.r1.decision, 'ELIGIBLE');
assert.equal(
  comparisonMissingCreator.r1.evidence.capacityUsdMicros,
  5_000_000n
);
assert.deepEqual(
  comparisonMissingCreator.r1.uncertainties,
  ['CREATOR_FEATURE_MISSING']
);
assert.equal(
  comparisonMissingCreator.buyEveryExecutableControl.decision,
  'ELIGIBLE'
);

const partialCreator = evaluateFastVetR1CapacityGate({
  baseline: baseline(),
  creatorFeature: creator({
    coverage: 'PARTIAL',
    priorLaunchCount: 3,
    classifiedOutcomeCount: 1,
    unresolvedOutcomeCount: 2,
    normalWinCount: 1
  })
});
assert.equal(partialCreator.decision, 'ELIGIBLE');
assert.deepEqual(
  partialCreator.uncertainties,
  ['CREATOR_HISTORY_INCOMPLETE']
);

const adverseCreator = evaluateShadowPolicyComparison({
  baseline: baseline(),
  creatorFeature: creator({
    coverage: 'PARTIAL',
    priorLaunchCount: 2,
    classifiedOutcomeCount: 1,
    unresolvedOutcomeCount: 1,
    catastrophicLossCount: 1
  })
});
assert.equal(adverseCreator.r1.decision, 'REJECT');
assert.deepEqual(adverseCreator.r1.reasons, ['KNOWN_PRIOR_ADVERSE_CREATOR']);
assert.equal(
  adverseCreator.buyEveryExecutableControl.decision,
  'ELIGIBLE',
  'naive control must ignore creator evidence by design'
);

const capacityBaseline = baseline({
  legs: [
    leg(250_000n),
    leg(500_000n),
    leg(1_000_000n),
    leg(2_000_000n, { reverse: false }),
    leg(5_000_000n)
  ]
});
const capacity = evaluateFastVetR1CapacityGate({
  baseline: capacityBaseline,
  creatorFeature: null
});
assert.equal(capacity.decision, 'ELIGIBLE');
assert.equal(capacity.evidence.capacityUsdMicros, 1_000_000n);
assert.deepEqual(
  capacity.evidence.executablePrefixUsdMicros,
  [250_000n, 500_000n, 1_000_000n]
);
assert.ok(capacity.uncertainties.includes('CAPACITY_BELOW_MAXIMUM'));

const minimumExitFailure = evaluateFastVetR1CapacityGate({
  baseline: baseline({
    legs: [
      leg(250_000n, { reverse: false }),
      leg(500_000n),
      leg(1_000_000n),
      leg(2_000_000n),
      leg(5_000_000n)
    ]
  }),
  creatorFeature: null
});
assert.equal(minimumExitFailure.decision, 'REJECT');
assert.deepEqual(
  minimumExitFailure.reasons,
  ['MINIMUM_REVERSE_NOT_EXECUTABLE']
);

const terribleRecoveryStillEligible = evaluateFastVetR1CapacityGate({
  baseline: baseline({
    legs: ladder.map((value) => leg(value, { recovery: 1n }))
  }),
  creatorFeature: null
});
assert.equal(
  terribleRecoveryStillEligible.decision,
  'ELIGIBLE',
  'R1 must not smuggle in an unregistered recovery threshold'
);

const unverified = evaluateFastVetR1CapacityGate({
  baseline: baseline({ status: 'UNVERIFIED', legs: [] }),
  creatorFeature: null
});
assert.equal(unverified.decision, 'NO_DECISION');
assert.deepEqual(unverified.reasons, ['BASELINE_UNVERIFIED']);

assert.throws(
  () => evaluateFastVetR1CapacityGate({
    baseline: baseline({
      legs: [leg(1_000_000n)]
    }),
    creatorFeature: null
  }),
  /FAST_VET_R1_COMPLETE_LADDER_MISMATCH/,
  'COMPLETE evidence may not omit frozen ladder rungs'
);

assert.throws(
  () => evaluateFastVetR1CapacityGate({
    baseline: baseline(),
    creatorFeature: creator({ baselineId: 'wrong-baseline' })
  }),
  /FAST_VET_R1_BINDING_MISMATCH/
);

assert.throws(
  () => evaluateFastVetR1CapacityGate({
    baseline: baseline(),
    creatorFeature: creator({ catastrophicLossCount: -1 })
  }),
  /FAST_VET_R1_CREATOR_RECEIPT_INVALID:COUNT/,
  'malformed negative creator counts must not neutralize the adverse-history veto'
);

assert.throws(
  () => evaluateFastVetR1CapacityGate({
    baseline: baseline(),
    creatorFeature: creator({
      coverage: 'COMPLETE',
      priorLaunchCount: 1,
      classifiedOutcomeCount: 0,
      unresolvedOutcomeCount: 1
    })
  }),
  /FAST_VET_R1_CREATOR_RECEIPT_INVALID:COVERAGE/,
  'creator coverage must agree with the receipt accounting'
);

console.log(JSON.stringify({
  verdict: 'FAST_VET_R1_CAPACITY_GATE_PASS',
  mode: FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.mode,
  liveMoneyAuthority: FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.liveMoneyAuthority,
  objective: FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.objective,
  minimumProbeUsdMicros:
    FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.minimumProbeUsdMicros.toString(),
  missingCreatorAllowed: comparisonMissingCreator.r1.decision,
  partialCreatorAllowed: partialCreator.decision,
  knownAdverseCreatorRejected: adverseCreator.r1.decision,
  contiguousCapacityUsdMicros: capacity.evidence.capacityUsdMicros.toString(),
  recoveryThresholdBps:
    FAST_VET_R1_CAPACITY_GATE_CONFIGURATION.recoveryThresholdBps,
  r0Frozen: comparisonMissingCreator.r0.policyVersion === 'FAST_VET_R0',
  edge: 'UNPROVEN'
}, null, 2));
