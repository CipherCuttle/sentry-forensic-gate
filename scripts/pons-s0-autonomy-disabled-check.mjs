import assert from 'node:assert/strict';
import {
  PONS_S0_CAPACITY_SEMANTICS,
  PONS_S0_EXECUTION_PERSONA_PARITY,
  allocatePonsS0ShadowReservations,
  assertPonsS0FrozenStrategyArtifact,
  buildPonsS0FrozenStrategyArtifact,
  buildPonsS0ProspectiveWitnessContract,
  buildPonsS0SequentialCapacityEvidence,
  derivePonsS0SupervisorStatus,
  evaluatePonsS0RiskReservation
} from '../dist/index.js';

const artifactInput = {
  strategyId: 'PONS_S0_TEST_CONTROL',
  strategyKind: 'CONTROL',
  familyId: 'PONS_S0_24H_SELECTION_V1',
  featureNames: ['decision_delay_blocks'],
  targetHorizonMs: 86_400_000,
  trainingCutoffBlock: 100n,
  trainingManifestId: 'manifest-test',
  trainingOriginEvidenceDigest: '1'.repeat(64),
  qntylabSourceCommit: '2'.repeat(40),
  runtimeIdentity: { node: '20', evaluator: 'NONE_DISABLED_SCAFFOLD' },
  decisionRule: { policy: 'TEST_ONLY' },
  strategyPayload: { kind: 'CONTROL', policy: 'TEST_ONLY' },
  executionPersonaParity: PONS_S0_EXECUTION_PERSONA_PARITY
};

const artifactA = await buildPonsS0FrozenStrategyArtifact(artifactInput);
const artifactB = await buildPonsS0FrozenStrategyArtifact(artifactInput);
assert.equal(artifactA.artifactId, artifactB.artifactId);
assert.equal(artifactA.evidenceDigest, artifactB.evidenceDigest);
assert.equal(artifactA.liveMoneyAuthority, false);
assert.equal(artifactA.noAutoRetrain, true);
await assert.rejects(
  assertPonsS0FrozenStrategyArtifact({
    ...artifactA,
    liveMoneyAuthority: true
  }),
  /PONS_S0_FROZEN_ARTIFACT_BOUNDARY_MISMATCH/
);

await assert.rejects(
  buildPonsS0ProspectiveWitnessContract({
    artifact: artifactA,
    registrationCutoffBlock: 101n,
    registeredAtMs: 1,
    prospectiveOutcomesObservedAtRegistration: false,
    minEligibleDecisions: 0,
    minResolvedOutcomes: 1,
    maxUnresolvedBps: 1000,
    minObservationDurationMs: 1,
    primaryEconomicEndpoint: 'NET_EXECUTABLE_TERMINAL_CAPITAL',
    secondaryMetrics: ['CATASTROPHIC_LOSS_EXPOSURE']
  }),
  /PONS_S0_WITNESS_MIN_ELIGIBLE_INVALID/
);

const witness = await buildPonsS0ProspectiveWitnessContract({
  artifact: artifactA,
  registrationCutoffBlock: 101n,
  registeredAtMs: 1,
  prospectiveOutcomesObservedAtRegistration: false,
  minEligibleDecisions: 40,
  minResolvedOutcomes: 30,
  maxUnresolvedBps: 2500,
  minObservationDurationMs: 86_400_000,
  primaryEconomicEndpoint: 'NET_EXECUTABLE_TERMINAL_CAPITAL',
  secondaryMetrics: ['CATASTROPHIC_LOSS_EXPOSURE']
});
assert.equal(witness.noEarlySuccessStop, true);
assert.equal(witness.liveMoneyAuthority, false);

const sequential = await buildPonsS0SequentialCapacityEvidence({
  launchId: 'launch-a',
  observationBlock: 200n,
  observationBlockHash: '0x' + '3'.repeat(64),
  maxEntryUsdMicros: 1_000_000n,
  methodVersion: 'TEST_SEQUENTIAL_V1',
  sourceEvidenceDigest: '4'.repeat(64)
});

const config = {
  walletBudgetUsdMicros: 2_000_000n,
  fixedEntryUsdMicros: 1_000_000n,
  perTradeCapUsdMicros: 1_000_000n,
  maxOpenPositions: 2,
  minGasReserveWei: 100n
};
const health = {
  chainFresh: true,
  discoveryFresh: true,
  providerAgreement: true,
  strategyArtifactMatches: true,
  runtimeSourceMatches: true,
  walletReconciled: true,
  allowancesReconciled: true,
  gasReserveWei: 1000n,
  unresolvedTransactionCount: 0
};
const state = {
  walletCapitalUsdMicros: 2_000_000n,
  reservedCapitalUsdMicros: 0n,
  openPositionCount: 0
};

const independent = await evaluatePonsS0RiskReservation(
  config,
  health,
  state,
  {
    decisionId: 'd0',
    launchId: 'launch-a',
    decisionBlock: 200n,
    logIndex: 0,
    action: 'WOULD_TRADE',
    capacitySemantics: PONS_S0_CAPACITY_SEMANTICS,
    sequentialCapacity: null
  }
);
assert.equal(independent.status, 'WOULD_SKIP');
assert.equal(independent.reason, 'INDEPENDENT_PROBE_CAPACITY_NOT_SIZING_AUTHORITY');

const allocation = await allocatePonsS0ShadowReservations({
  config,
  health,
  state,
  opportunities: [
    {
      decisionId: 'd2',
      launchId: 'launch-b',
      decisionBlock: 201n,
      logIndex: 1,
      action: 'WOULD_TRADE',
      capacitySemantics: 'SEQUENTIAL_STATE_TRANSITION_CAPACITY',
      sequentialCapacity: await buildPonsS0SequentialCapacityEvidence({
        launchId: 'launch-b',
        observationBlock: 201n,
        observationBlockHash: '0x' + '5'.repeat(64),
        maxEntryUsdMicros: 1_000_000n,
        methodVersion: 'TEST_SEQUENTIAL_V1',
        sourceEvidenceDigest: '6'.repeat(64)
      })
    },
    {
      decisionId: 'd1',
      launchId: 'launch-a',
      decisionBlock: 200n,
      logIndex: 0,
      action: 'WOULD_TRADE',
      capacitySemantics: 'SEQUENTIAL_STATE_TRANSITION_CAPACITY',
      sequentialCapacity: sequential
    },
    {
      decisionId: 'd3',
      launchId: 'launch-c',
      decisionBlock: 202n,
      logIndex: 2,
      action: 'WOULD_TRADE',
      capacitySemantics: 'SEQUENTIAL_STATE_TRANSITION_CAPACITY',
      sequentialCapacity: await buildPonsS0SequentialCapacityEvidence({
        launchId: 'launch-c',
        observationBlock: 202n,
        observationBlockHash: '0x' + '7'.repeat(64),
        maxEntryUsdMicros: 1_000_000n,
        methodVersion: 'TEST_SEQUENTIAL_V1',
        sourceEvidenceDigest: '8'.repeat(64)
      })
    }
  ]
});
assert.deepEqual(
  allocation.decisions.map((item) => item.status),
  ['WOULD_RESERVE', 'WOULD_RESERVE', 'WOULD_SKIP']
);
assert.equal(allocation.finalReservedCapitalUsdMicros, 2_000_000n);
assert.equal(allocation.finalOpenPositionCount, 2);
assert.equal(allocation.liveMoneyAuthority, false);

const reconciliation = derivePonsS0SupervisorStatus({
  witnessState: 'RUNNING',
  strategyLoaded: true,
  chainFresh: true,
  discoveryFresh: true,
  archiveProviderHealthy: true,
  providerAgreement: true,
  strategyArtifactMatches: true,
  runtimeSourceMatches: true,
  walletReconciled: false,
  allowancesReconciled: true,
  unresolvedTransactionCount: 0,
  unresolvedPositionCount: 0,
  engineeringLiveReady: false,
  liveMoneyAuthority: false
});
assert.equal(reconciliation.state, 'RECONCILIATION_REQUIRED');

const witnessRunning = derivePonsS0SupervisorStatus({
  witnessState: 'RUNNING',
  strategyLoaded: true,
  chainFresh: true,
  discoveryFresh: true,
  archiveProviderHealthy: true,
  providerAgreement: true,
  strategyArtifactMatches: true,
  runtimeSourceMatches: true,
  walletReconciled: true,
  allowancesReconciled: true,
  unresolvedTransactionCount: 0,
  unresolvedPositionCount: 0,
  engineeringLiveReady: false,
  liveMoneyAuthority: false
});
assert.equal(witnessRunning.state, 'PROSPECTIVE_WITNESS_RUNNING');

const disabled = derivePonsS0SupervisorStatus({
  witnessState: 'COMPLETE',
  strategyLoaded: true,
  chainFresh: true,
  discoveryFresh: true,
  archiveProviderHealthy: true,
  providerAgreement: true,
  strategyArtifactMatches: true,
  runtimeSourceMatches: true,
  walletReconciled: true,
  allowancesReconciled: true,
  unresolvedTransactionCount: 0,
  unresolvedPositionCount: 0,
  engineeringLiveReady: true,
  liveMoneyAuthority: false
});
assert.equal(disabled.state, 'LIVE_READY_BUT_DISABLED');
assert.equal(disabled.liveMoneyAuthority, false);

console.log('PONS_S0_AUTONOMY_DISABLED_SCAFFOLD=PASS');
