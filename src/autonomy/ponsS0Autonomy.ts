import { sha256Hex } from '../evidence/canonical.js';
import type { CanonicalJsonValue } from '../multichain/domain.js';
import {
  PONS_S0_CAPACITY_SEMANTICS,
  PONS_S0_EXECUTION_PERSONA_PARITY,
  PONS_S0_FEATURE_PACKET_V1,
  type PonsS0FeaturePacket
} from '../research/ponsS0ResearchExport.js';

export const PONS_S0_FROZEN_STRATEGY_ARTIFACT_V1 =
  'PONS_S0_FROZEN_STRATEGY_ARTIFACT_V1' as const;
export const PONS_S0_PROSPECTIVE_DECISION_V1 =
  'PONS_S0_PROSPECTIVE_DECISION_V1' as const;
export const PONS_S0_PROSPECTIVE_WITNESS_CONTRACT_V1 =
  'PONS_S0_PROSPECTIVE_WITNESS_CONTRACT_V1' as const;
export const PONS_S0_SEQUENTIAL_CAPACITY_V1 =
  'PONS_S0_SEQUENTIAL_CAPACITY_V1' as const;

export type PonsS0StrategyKind = 'CONTROL' | 'MODEL';

export interface PonsS0FrozenStrategyArtifactInput {
  strategyId: string;
  strategyKind: PonsS0StrategyKind;
  familyId: string;
  featureNames: readonly string[];
  targetHorizonMs: number;
  trainingCutoffBlock: bigint;
  trainingManifestId: string;
  trainingOriginEvidenceDigest: string;
  qntylabSourceCommit: string;
  runtimeIdentity: Readonly<Record<string, string>>;
  decisionRule: CanonicalJsonValue;
  strategyPayload: CanonicalJsonValue;
  executionPersonaParity: typeof PONS_S0_EXECUTION_PERSONA_PARITY;
}

export interface PonsS0FrozenStrategyArtifact
  extends PonsS0FrozenStrategyArtifactInput {
  schemaVersion: typeof PONS_S0_FROZEN_STRATEGY_ARTIFACT_V1;
  artifactId: string;
  evidenceDigest: string;
  featureSchema: typeof PONS_S0_FEATURE_PACKET_V1;
  noAutoRetrain: true;
  mode: 'SHADOW_ONLY';
  liveMoneyAuthority: false;
  signingAuthority: false;
  broadcastAuthority: false;
  modelPromotionAuthority: false;
  edge: 'UNPROVEN';
}

export interface PonsS0PolicyOutput {
  action: 'WOULD_TRADE' | 'WOULD_SKIP';
  probability: number | null;
  score: number | null;
  reason: string;
  policyEvidence: CanonicalJsonValue;
}

export interface PonsS0PolicyEvaluator {
  readonly artifactId: string;
  evaluate(feature: PonsS0FeaturePacket): Promise<PonsS0PolicyOutput>;
}

export interface PonsS0ProspectiveDecisionReceipt {
  schemaVersion: typeof PONS_S0_PROSPECTIVE_DECISION_V1;
  decisionId: string;
  evidenceDigest: string;
  artifactId: string;
  artifactEvidenceDigest: string;
  featurePacketId: string;
  featureEvidenceDigest: string;
  launchId: string;
  baselineId: string;
  decisionBlock: bigint;
  decisionBlockHash: string;
  decidedAtMs: number;
  output: PonsS0PolicyOutput;
  oneShotKey: string;
  boundaries: {
    featureContainsTargetFutureOutcome: false;
    inferenceOnly: true;
    mutablePrediction: false;
    mode: 'SHADOW_ONLY';
    liveMoneyAuthority: false;
    signingAuthority: false;
    broadcastAuthority: false;
    edge: 'UNPROVEN';
  };
}

export interface PonsS0ProspectiveWitnessContractInput {
  artifact: PonsS0FrozenStrategyArtifact;
  registrationCutoffBlock: bigint;
  registeredAtMs: number;
  prospectiveOutcomesObservedAtRegistration: false;
  minEligibleDecisions: number;
  minResolvedOutcomes: number;
  maxUnresolvedBps: number;
  minObservationDurationMs: number;
  primaryEconomicEndpoint: string;
  secondaryMetrics: readonly string[];
}

export interface PonsS0ProspectiveWitnessContract {
  schemaVersion: typeof PONS_S0_PROSPECTIVE_WITNESS_CONTRACT_V1;
  contractId: string;
  evidenceDigest: string;
  artifactId: string;
  artifactEvidenceDigest: string;
  registrationCutoffBlock: bigint;
  registeredAtMs: number;
  targetHorizonMs: number;
  stopRule: {
    minEligibleDecisions: number;
    minResolvedOutcomes: number;
    maxUnresolvedBps: number;
    minObservationDurationMs: number;
  };
  primaryEconomicEndpoint: string;
  secondaryMetrics: readonly string[];
  targetPerformanceInspectedAtRegistration: false;
  noEarlySuccessStop: true;
  policyMutationDuringWitness: false;
  liveMoneyAuthority: false;
  edge: 'UNPROVEN';
}

export interface PonsS0SequentialCapacityEvidenceInput {
  launchId: string;
  observationBlock: bigint;
  observationBlockHash: string;
  maxEntryUsdMicros: bigint;
  methodVersion: string;
  sourceEvidenceDigest: string;
}

export interface PonsS0SequentialCapacityEvidence
  extends PonsS0SequentialCapacityEvidenceInput {
  schemaVersion: typeof PONS_S0_SEQUENTIAL_CAPACITY_V1;
  semantics: 'SEQUENTIAL_STATE_TRANSITION_CAPACITY';
  evidenceDigest: string;
  liveMoneyAuthority: false;
}

export interface PonsS0RiskGovernorConfig {
  walletBudgetUsdMicros: bigint;
  fixedEntryUsdMicros: bigint;
  perTradeCapUsdMicros: bigint;
  maxOpenPositions: number;
  minGasReserveWei: bigint;
}

export interface PonsS0RiskHealth {
  chainFresh: boolean;
  discoveryFresh: boolean;
  providerAgreement: boolean;
  strategyArtifactMatches: boolean;
  runtimeSourceMatches: boolean;
  walletReconciled: boolean;
  allowancesReconciled: boolean;
  gasReserveWei: bigint;
  unresolvedTransactionCount: number;
}

export interface PonsS0CapitalState {
  walletCapitalUsdMicros: bigint;
  reservedCapitalUsdMicros: bigint;
  openPositionCount: number;
}

export interface PonsS0ShadowOpportunity {
  decisionId: string;
  launchId: string;
  decisionBlock: bigint;
  logIndex: number;
  action: 'WOULD_TRADE' | 'WOULD_SKIP';
  capacitySemantics:
    | typeof PONS_S0_CAPACITY_SEMANTICS
    | 'SEQUENTIAL_STATE_TRANSITION_CAPACITY';
  sequentialCapacity: PonsS0SequentialCapacityEvidence | null;
}

export interface PonsS0ReservationDecision {
  decisionId: string;
  launchId: string;
  status: 'WOULD_RESERVE' | 'WOULD_SKIP';
  reason: string;
  reserveUsdMicros: bigint;
  availableCapitalBeforeUsdMicros: bigint;
  liveMoneyAuthority: false;
}

export interface PonsS0AllocationResult {
  decisions: readonly PonsS0ReservationDecision[];
  finalReservedCapitalUsdMicros: bigint;
  finalOpenPositionCount: number;
  liveMoneyAuthority: false;
}

export type PonsS0WitnessState = 'NOT_STARTED' | 'RUNNING' | 'COMPLETE';

export interface PonsS0SupervisorInput {
  witnessState: PonsS0WitnessState;
  strategyLoaded: boolean;
  chainFresh: boolean;
  discoveryFresh: boolean;
  archiveProviderHealthy: boolean;
  providerAgreement: boolean;
  strategyArtifactMatches: boolean;
  runtimeSourceMatches: boolean;
  walletReconciled: boolean;
  allowancesReconciled: boolean;
  unresolvedTransactionCount: number;
  unresolvedPositionCount: number;
  engineeringLiveReady: boolean;
  liveMoneyAuthority: false;
}

export interface PonsS0SupervisorStatus {
  state:
    | 'SHADOW_HEALTHY'
    | 'LIVE_READY_BUT_DISABLED'
    | 'HALTED_FAIL_CLOSED'
    | 'RECONCILIATION_REQUIRED'
    | 'PROSPECTIVE_WITNESS_RUNNING'
    | 'PROSPECTIVE_WITNESS_COMPLETE';
  reasons: readonly string[];
  liveMoneyAuthority: false;
}

export async function buildPonsS0FrozenStrategyArtifact(
  input: PonsS0FrozenStrategyArtifactInput
): Promise<PonsS0FrozenStrategyArtifact> {
  assertNonEmpty(input.strategyId, 'PONS_S0_STRATEGY_ID_EMPTY');
  assertNonEmpty(input.familyId, 'PONS_S0_FAMILY_ID_EMPTY');
  assertPositiveInteger(input.targetHorizonMs, 'PONS_S0_TARGET_HORIZON_INVALID');
  if (input.trainingCutoffBlock < 0n) {
    throw new Error('PONS_S0_TRAINING_CUTOFF_INVALID');
  }
  assertHex64(input.trainingOriginEvidenceDigest, 'PONS_S0_TRAINING_ORIGIN_DIGEST_INVALID');
  assertCommit(input.qntylabSourceCommit, 'PONS_S0_QNTYLAB_COMMIT_INVALID');
  assertFeatureNames(input.featureNames);
  if (input.executionPersonaParity !== PONS_S0_EXECUTION_PERSONA_PARITY) {
    throw new Error('PONS_S0_EXECUTION_PERSONA_PARITY_MISMATCH');
  }
  if (Object.keys(input.runtimeIdentity).length === 0) {
    throw new Error('PONS_S0_RUNTIME_IDENTITY_EMPTY');
  }

  const core = artifactCore(input);
  const artifactId = await sha256Hex({
    kind: PONS_S0_FROZEN_STRATEGY_ARTIFACT_V1,
    strategyId: input.strategyId,
    familyId: input.familyId,
    trainingManifestId: input.trainingManifestId,
    trainingOriginEvidenceDigest: input.trainingOriginEvidenceDigest,
    qntylabSourceCommit: input.qntylabSourceCommit,
    decisionRule: input.decisionRule,
    strategyPayload: input.strategyPayload
  });
  const evidenceDigest = await sha256Hex({
    schemaVersion: PONS_S0_FROZEN_STRATEGY_ARTIFACT_V1,
    artifactId,
    ...core
  });
  return {
    schemaVersion: PONS_S0_FROZEN_STRATEGY_ARTIFACT_V1,
    artifactId,
    evidenceDigest,
    ...core
  };
}

export async function assertPonsS0FrozenStrategyArtifact(
  artifact: PonsS0FrozenStrategyArtifact
): Promise<void> {
  const rebuilt = await buildPonsS0FrozenStrategyArtifact({
    strategyId: artifact.strategyId,
    strategyKind: artifact.strategyKind,
    familyId: artifact.familyId,
    featureNames: artifact.featureNames,
    targetHorizonMs: artifact.targetHorizonMs,
    trainingCutoffBlock: artifact.trainingCutoffBlock,
    trainingManifestId: artifact.trainingManifestId,
    trainingOriginEvidenceDigest: artifact.trainingOriginEvidenceDigest,
    qntylabSourceCommit: artifact.qntylabSourceCommit,
    runtimeIdentity: artifact.runtimeIdentity,
    decisionRule: artifact.decisionRule,
    strategyPayload: artifact.strategyPayload,
    executionPersonaParity: artifact.executionPersonaParity
  });
  if (
    rebuilt.artifactId !== artifact.artifactId ||
    rebuilt.evidenceDigest !== artifact.evidenceDigest
  ) {
    throw new Error('PONS_S0_FROZEN_ARTIFACT_DIGEST_MISMATCH');
  }
}

export async function buildPonsS0ProspectiveDecisionReceipt(input: {
  artifact: PonsS0FrozenStrategyArtifact;
  feature: PonsS0FeaturePacket;
  output: PonsS0PolicyOutput;
  decidedAtMs: number;
}): Promise<PonsS0ProspectiveDecisionReceipt> {
  await assertPonsS0FrozenStrategyArtifact(input.artifact);
  assertFeatureForProspectiveInference(input.feature, input.artifact);
  assertPolicyOutput(input.output);
  assertPositiveInteger(input.decidedAtMs, 'PONS_S0_DECIDED_AT_INVALID');

  const oneShotKey = await sha256Hex({
    kind: 'PONS_S0_PROSPECTIVE_ONE_SHOT_V1',
    artifactId: input.artifact.artifactId,
    featurePacketId: input.feature.packetId,
    featureEvidenceDigest: input.feature.evidenceDigest
  });
  const decisionId = await sha256Hex({
    kind: PONS_S0_PROSPECTIVE_DECISION_V1,
    oneShotKey,
    launchId: input.feature.launch.launchId,
    baselineId: input.feature.baseline.baselineId,
    decisionBlock: input.feature.baseline.decisionBlock,
    decisionBlockHash: input.feature.baseline.decisionBlockHash
  });
  const core = {
    artifactId: input.artifact.artifactId,
    artifactEvidenceDigest: input.artifact.evidenceDigest,
    featurePacketId: input.feature.packetId,
    featureEvidenceDigest: input.feature.evidenceDigest,
    launchId: input.feature.launch.launchId,
    baselineId: input.feature.baseline.baselineId,
    decisionBlock: input.feature.baseline.decisionBlock,
    decisionBlockHash: input.feature.baseline.decisionBlockHash.toLowerCase(),
    decidedAtMs: input.decidedAtMs,
    output: input.output,
    oneShotKey,
    boundaries: {
      featureContainsTargetFutureOutcome: false as const,
      inferenceOnly: true as const,
      mutablePrediction: false as const,
      mode: 'SHADOW_ONLY' as const,
      liveMoneyAuthority: false as const,
      signingAuthority: false as const,
      broadcastAuthority: false as const,
      edge: 'UNPROVEN' as const
    }
  };
  return {
    schemaVersion: PONS_S0_PROSPECTIVE_DECISION_V1,
    decisionId,
    evidenceDigest: await sha256Hex({
      schemaVersion: PONS_S0_PROSPECTIVE_DECISION_V1,
      decisionId,
      ...core
    }),
    ...core
  };
}

export async function buildPonsS0ProspectiveWitnessContract(
  input: PonsS0ProspectiveWitnessContractInput
): Promise<PonsS0ProspectiveWitnessContract> {
  await assertPonsS0FrozenStrategyArtifact(input.artifact);
  if (input.prospectiveOutcomesObservedAtRegistration !== false) {
    throw new Error('PONS_S0_WITNESS_REGISTRATION_AFTER_OUTCOME');
  }
  if (input.registrationCutoffBlock < input.artifact.trainingCutoffBlock) {
    throw new Error('PONS_S0_WITNESS_CUTOFF_BEFORE_TRAINING_CUTOFF');
  }
  assertPositiveInteger(input.registeredAtMs, 'PONS_S0_WITNESS_REGISTERED_AT_INVALID');
  assertPositiveInteger(input.minEligibleDecisions, 'PONS_S0_WITNESS_MIN_ELIGIBLE_INVALID');
  assertPositiveInteger(input.minResolvedOutcomes, 'PONS_S0_WITNESS_MIN_RESOLVED_INVALID');
  if (input.minResolvedOutcomes > input.minEligibleDecisions) {
    throw new Error('PONS_S0_WITNESS_RESOLVED_EXCEEDS_ELIGIBLE');
  }
  if (
    !Number.isInteger(input.maxUnresolvedBps) ||
    input.maxUnresolvedBps < 0 ||
    input.maxUnresolvedBps > 10_000
  ) {
    throw new Error('PONS_S0_WITNESS_MAX_UNRESOLVED_BPS_INVALID');
  }
  assertPositiveInteger(
    input.minObservationDurationMs,
    'PONS_S0_WITNESS_MIN_DURATION_INVALID'
  );
  assertNonEmpty(input.primaryEconomicEndpoint, 'PONS_S0_WITNESS_ENDPOINT_EMPTY');
  if (input.secondaryMetrics.length === 0) {
    throw new Error('PONS_S0_WITNESS_SECONDARY_METRICS_EMPTY');
  }

  const core = {
    artifactId: input.artifact.artifactId,
    artifactEvidenceDigest: input.artifact.evidenceDigest,
    registrationCutoffBlock: input.registrationCutoffBlock,
    registeredAtMs: input.registeredAtMs,
    targetHorizonMs: input.artifact.targetHorizonMs,
    stopRule: {
      minEligibleDecisions: input.minEligibleDecisions,
      minResolvedOutcomes: input.minResolvedOutcomes,
      maxUnresolvedBps: input.maxUnresolvedBps,
      minObservationDurationMs: input.minObservationDurationMs
    },
    primaryEconomicEndpoint: input.primaryEconomicEndpoint,
    secondaryMetrics: [...input.secondaryMetrics],
    targetPerformanceInspectedAtRegistration: false as const,
    noEarlySuccessStop: true as const,
    policyMutationDuringWitness: false as const,
    liveMoneyAuthority: false as const,
    edge: 'UNPROVEN' as const
  };
  const contractId = await sha256Hex({
    kind: PONS_S0_PROSPECTIVE_WITNESS_CONTRACT_V1,
    ...core
  });
  return {
    schemaVersion: PONS_S0_PROSPECTIVE_WITNESS_CONTRACT_V1,
    contractId,
    evidenceDigest: await sha256Hex({
      schemaVersion: PONS_S0_PROSPECTIVE_WITNESS_CONTRACT_V1,
      contractId,
      ...core
    }),
    ...core
  };
}

export async function buildPonsS0SequentialCapacityEvidence(
  input: PonsS0SequentialCapacityEvidenceInput
): Promise<PonsS0SequentialCapacityEvidence> {
  assertNonEmpty(input.launchId, 'PONS_S0_SEQUENTIAL_CAPACITY_LAUNCH_EMPTY');
  if (input.observationBlock < 0n) {
    throw new Error('PONS_S0_SEQUENTIAL_CAPACITY_BLOCK_INVALID');
  }
  assertHex66(input.observationBlockHash, 'PONS_S0_SEQUENTIAL_CAPACITY_BLOCK_HASH_INVALID');
  if (input.maxEntryUsdMicros <= 0n) {
    throw new Error('PONS_S0_SEQUENTIAL_CAPACITY_AMOUNT_INVALID');
  }
  assertNonEmpty(input.methodVersion, 'PONS_S0_SEQUENTIAL_CAPACITY_METHOD_EMPTY');
  assertHex64(input.sourceEvidenceDigest, 'PONS_S0_SEQUENTIAL_CAPACITY_SOURCE_INVALID');
  const core = {
    ...input,
    observationBlockHash: input.observationBlockHash.toLowerCase(),
    semantics: 'SEQUENTIAL_STATE_TRANSITION_CAPACITY' as const,
    liveMoneyAuthority: false as const
  };
  return {
    schemaVersion: PONS_S0_SEQUENTIAL_CAPACITY_V1,
    ...core,
    evidenceDigest: await sha256Hex({
      schemaVersion: PONS_S0_SEQUENTIAL_CAPACITY_V1,
      ...core
    })
  };
}

export async function evaluatePonsS0RiskReservation(
  config: PonsS0RiskGovernorConfig,
  health: PonsS0RiskHealth,
  state: PonsS0CapitalState,
  opportunity: PonsS0ShadowOpportunity
): Promise<PonsS0ReservationDecision> {
  assertRiskConfig(config);
  assertCapitalState(state);
  const effectiveCapital =
    state.walletCapitalUsdMicros < config.walletBudgetUsdMicros
      ? state.walletCapitalUsdMicros
      : config.walletBudgetUsdMicros;
  const available = effectiveCapital - state.reservedCapitalUsdMicros;
  const skip = (reason: string): PonsS0ReservationDecision => ({
    decisionId: opportunity.decisionId,
    launchId: opportunity.launchId,
    status: 'WOULD_SKIP',
    reason,
    reserveUsdMicros: 0n,
    availableCapitalBeforeUsdMicros: available > 0n ? available : 0n,
    liveMoneyAuthority: false
  });

  if (opportunity.action !== 'WOULD_TRADE') return skip('STRATEGY_WOULD_SKIP');
  const healthReason = riskHealthFailure(health, config);
  if (healthReason) return skip(healthReason);
  if (state.openPositionCount >= config.maxOpenPositions) {
    return skip('MAX_OPEN_POSITIONS');
  }
  if (opportunity.capacitySemantics === PONS_S0_CAPACITY_SEMANTICS) {
    return skip('INDEPENDENT_PROBE_CAPACITY_NOT_SIZING_AUTHORITY');
  }
  if (!opportunity.sequentialCapacity) {
    return skip('SEQUENTIAL_CAPACITY_EVIDENCE_MISSING');
  }
  await assertSequentialCapacity(opportunity.sequentialCapacity, opportunity.launchId);
  if (config.fixedEntryUsdMicros > opportunity.sequentialCapacity.maxEntryUsdMicros) {
    return skip('SEQUENTIAL_CAPACITY_BELOW_FIXED_ENTRY');
  }
  if (available < config.fixedEntryUsdMicros) {
    return skip('INSUFFICIENT_UNRESERVED_CAPITAL');
  }

  return {
    decisionId: opportunity.decisionId,
    launchId: opportunity.launchId,
    status: 'WOULD_RESERVE',
    reason: 'RISK_ENVELOPE_SATISFIED_SHADOW_ONLY',
    reserveUsdMicros: config.fixedEntryUsdMicros,
    availableCapitalBeforeUsdMicros: available,
    liveMoneyAuthority: false
  };
}

export async function allocatePonsS0ShadowReservations(input: {
  config: PonsS0RiskGovernorConfig;
  health: PonsS0RiskHealth;
  state: PonsS0CapitalState;
  opportunities: readonly PonsS0ShadowOpportunity[];
}): Promise<PonsS0AllocationResult> {
  const sorted = [...input.opportunities].sort(compareOpportunities);
  const decisions: PonsS0ReservationDecision[] = [];
  let reservedCapitalUsdMicros = input.state.reservedCapitalUsdMicros;
  let openPositionCount = input.state.openPositionCount;

  for (const opportunity of sorted) {
    const decision = await evaluatePonsS0RiskReservation(
      input.config,
      input.health,
      {
        walletCapitalUsdMicros: input.state.walletCapitalUsdMicros,
        reservedCapitalUsdMicros,
        openPositionCount
      },
      opportunity
    );
    decisions.push(decision);
    if (decision.status === 'WOULD_RESERVE') {
      reservedCapitalUsdMicros += decision.reserveUsdMicros;
      openPositionCount += 1;
    }
  }

  return {
    decisions,
    finalReservedCapitalUsdMicros: reservedCapitalUsdMicros,
    finalOpenPositionCount: openPositionCount,
    liveMoneyAuthority: false
  };
}

export function derivePonsS0SupervisorStatus(
  input: PonsS0SupervisorInput
): PonsS0SupervisorStatus {
  const reconciliationReasons = [
    ...(!input.walletReconciled ? ['WALLET_RECONCILIATION_REQUIRED'] : []),
    ...(!input.allowancesReconciled ? ['ALLOWANCE_RECONCILIATION_REQUIRED'] : []),
    ...(input.unresolvedPositionCount > 0 ? ['UNRESOLVED_POSITION'] : [])
  ];
  if (reconciliationReasons.length > 0) {
    return {
      state: 'RECONCILIATION_REQUIRED',
      reasons: reconciliationReasons,
      liveMoneyAuthority: false
    };
  }

  const haltReasons = [
    ...(!input.strategyLoaded ? ['STRATEGY_NOT_LOADED'] : []),
    ...(!input.chainFresh ? ['CHAIN_STALE'] : []),
    ...(!input.discoveryFresh ? ['DISCOVERY_STALE'] : []),
    ...(!input.archiveProviderHealthy ? ['ARCHIVE_PROVIDER_UNHEALTHY'] : []),
    ...(!input.providerAgreement ? ['PROVIDER_DISAGREEMENT'] : []),
    ...(!input.strategyArtifactMatches ? ['STRATEGY_ARTIFACT_MISMATCH'] : []),
    ...(!input.runtimeSourceMatches ? ['RUNTIME_SOURCE_MISMATCH'] : []),
    ...(input.unresolvedTransactionCount > 0 ? ['UNRESOLVED_TRANSACTION'] : []),
    ...(input.liveMoneyAuthority ? ['UNEXPECTED_LIVE_AUTHORITY'] : [])
  ];
  if (haltReasons.length > 0) {
    return {
      state: 'HALTED_FAIL_CLOSED',
      reasons: haltReasons,
      liveMoneyAuthority: false
    };
  }

  if (input.witnessState === 'RUNNING') {
    return {
      state: 'PROSPECTIVE_WITNESS_RUNNING',
      reasons: [],
      liveMoneyAuthority: false
    };
  }
  if (input.witnessState === 'COMPLETE' && input.engineeringLiveReady) {
    return {
      state: 'LIVE_READY_BUT_DISABLED',
      reasons: ['LIVE_AUTHORITY_NOT_GRANTED'],
      liveMoneyAuthority: false
    };
  }
  if (input.witnessState === 'COMPLETE') {
    return {
      state: 'PROSPECTIVE_WITNESS_COMPLETE',
      reasons: [],
      liveMoneyAuthority: false
    };
  }
  return {
    state: 'SHADOW_HEALTHY',
    reasons: [],
    liveMoneyAuthority: false
  };
}

function artifactCore(input: PonsS0FrozenStrategyArtifactInput) {
  return {
    strategyId: input.strategyId,
    strategyKind: input.strategyKind,
    familyId: input.familyId,
    featureSchema: PONS_S0_FEATURE_PACKET_V1,
    featureNames: [...input.featureNames],
    targetHorizonMs: input.targetHorizonMs,
    trainingCutoffBlock: input.trainingCutoffBlock,
    trainingManifestId: input.trainingManifestId,
    trainingOriginEvidenceDigest: input.trainingOriginEvidenceDigest,
    qntylabSourceCommit: input.qntylabSourceCommit,
    runtimeIdentity: { ...input.runtimeIdentity },
    decisionRule: input.decisionRule,
    strategyPayload: input.strategyPayload,
    executionPersonaParity: input.executionPersonaParity,
    noAutoRetrain: true as const,
    mode: 'SHADOW_ONLY' as const,
    liveMoneyAuthority: false as const,
    signingAuthority: false as const,
    broadcastAuthority: false as const,
    modelPromotionAuthority: false as const,
    edge: 'UNPROVEN' as const
  };
}

function assertFeatureForProspectiveInference(
  feature: PonsS0FeaturePacket,
  artifact: PonsS0FrozenStrategyArtifact
): void {
  if (feature.schemaVersion !== artifact.featureSchema) {
    throw new Error('PONS_S0_PROSPECTIVE_FEATURE_SCHEMA_MISMATCH');
  }
  if (
    feature.boundaries.containsTargetLaunchFutureOutcome !== false ||
    feature.boundaries.liveMoneyAuthority !== false ||
    feature.boundaries.mode !== 'SHADOW_ONLY' ||
    feature.boundaries.edge !== 'UNPROVEN'
  ) {
    throw new Error('PONS_S0_PROSPECTIVE_FEATURE_BOUNDARY_MISMATCH');
  }
  if (feature.baseline.decisionBlock <= artifact.trainingCutoffBlock) {
    throw new Error('PONS_S0_PROSPECTIVE_FEATURE_NOT_AFTER_TRAINING_CUTOFF');
  }
}

function assertPolicyOutput(output: PonsS0PolicyOutput): void {
  assertNonEmpty(output.reason, 'PONS_S0_POLICY_REASON_EMPTY');
  for (const [label, value] of [
    ['PROBABILITY', output.probability],
    ['SCORE', output.score]
  ] as const) {
    if (value !== null && !Number.isFinite(value)) {
      throw new Error(`PONS_S0_POLICY_${label}_INVALID`);
    }
  }
  if (
    output.probability !== null &&
    (output.probability < 0 || output.probability > 1)
  ) {
    throw new Error('PONS_S0_POLICY_PROBABILITY_OUT_OF_RANGE');
  }
}

async function assertSequentialCapacity(
  evidence: PonsS0SequentialCapacityEvidence,
  launchId: string
): Promise<void> {
  if (
    evidence.schemaVersion !== PONS_S0_SEQUENTIAL_CAPACITY_V1 ||
    evidence.semantics !== 'SEQUENTIAL_STATE_TRANSITION_CAPACITY' ||
    evidence.liveMoneyAuthority !== false ||
    evidence.launchId !== launchId
  ) {
    throw new Error('PONS_S0_SEQUENTIAL_CAPACITY_BINDING_MISMATCH');
  }
  const rebuilt = await buildPonsS0SequentialCapacityEvidence({
    launchId: evidence.launchId,
    observationBlock: evidence.observationBlock,
    observationBlockHash: evidence.observationBlockHash,
    maxEntryUsdMicros: evidence.maxEntryUsdMicros,
    methodVersion: evidence.methodVersion,
    sourceEvidenceDigest: evidence.sourceEvidenceDigest
  });
  if (rebuilt.evidenceDigest !== evidence.evidenceDigest) {
    throw new Error('PONS_S0_SEQUENTIAL_CAPACITY_DIGEST_MISMATCH');
  }
}

function riskHealthFailure(
  health: PonsS0RiskHealth,
  config: PonsS0RiskGovernorConfig
): string | null {
  if (!health.chainFresh) return 'CHAIN_STALE';
  if (!health.discoveryFresh) return 'DISCOVERY_STALE';
  if (!health.providerAgreement) return 'PROVIDER_DISAGREEMENT';
  if (!health.strategyArtifactMatches) return 'STRATEGY_ARTIFACT_MISMATCH';
  if (!health.runtimeSourceMatches) return 'RUNTIME_SOURCE_MISMATCH';
  if (!health.walletReconciled) return 'WALLET_RECONCILIATION_REQUIRED';
  if (!health.allowancesReconciled) return 'ALLOWANCE_RECONCILIATION_REQUIRED';
  if (health.unresolvedTransactionCount !== 0) return 'UNRESOLVED_TRANSACTION';
  if (health.gasReserveWei < config.minGasReserveWei) return 'GAS_RESERVE_BELOW_FLOOR';
  return null;
}

function assertRiskConfig(config: PonsS0RiskGovernorConfig): void {
  if (
    config.walletBudgetUsdMicros <= 0n ||
    config.fixedEntryUsdMicros <= 0n ||
    config.perTradeCapUsdMicros <= 0n ||
    config.fixedEntryUsdMicros > config.perTradeCapUsdMicros ||
    config.fixedEntryUsdMicros > config.walletBudgetUsdMicros ||
    !Number.isSafeInteger(config.maxOpenPositions) ||
    config.maxOpenPositions <= 0 ||
    config.minGasReserveWei < 0n
  ) {
    throw new Error('PONS_S0_RISK_CONFIG_INVALID');
  }
}

function assertCapitalState(state: PonsS0CapitalState): void {
  if (
    state.walletCapitalUsdMicros < 0n ||
    state.reservedCapitalUsdMicros < 0n ||
    state.reservedCapitalUsdMicros > state.walletCapitalUsdMicros ||
    !Number.isSafeInteger(state.openPositionCount) ||
    state.openPositionCount < 0
  ) {
    throw new Error('PONS_S0_CAPITAL_STATE_INVALID');
  }
}

function compareOpportunities(
  a: PonsS0ShadowOpportunity,
  b: PonsS0ShadowOpportunity
): number {
  if (a.decisionBlock !== b.decisionBlock) {
    return a.decisionBlock < b.decisionBlock ? -1 : 1;
  }
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  const launch = a.launchId.localeCompare(b.launchId);
  return launch !== 0 ? launch : a.decisionId.localeCompare(b.decisionId);
}

function assertFeatureNames(values: readonly string[]): void {
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error('PONS_S0_FEATURE_NAMES_INVALID');
  }
  for (const value of values) {
    assertNonEmpty(value, 'PONS_S0_FEATURE_NAME_EMPTY');
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(label);
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(label);
}

function assertHex64(value: string, label: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error(label);
}

function assertHex66(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(label);
}

function assertCommit(value: string, label: string): void {
  if (!/^[0-9a-fA-F]{40}$/.test(value)) throw new Error(label);
}
