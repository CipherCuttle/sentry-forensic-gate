import type { CreatorOutcomeFeatureReceipt } from '../forensic/creatorOutcome.js';
import { DEFAULT_BASELINE_NOTIONALS_USD_MICROS } from '../shadow/baselineTypes.js';
import type { PortableFastVetBaselineEvidence } from '../multichain/domain.js';
import {
  assertPortableFastVetEvidence,
  evaluatePortableFastVet,
  type PortableFastVetInput
} from '../multichain/fastVetBridge.js';

export const FAST_VET_R1_CAPACITY_GATE = 'FAST_VET_R1_CAPACITY_GATE' as const;
export const FAST_VET_R1_CAPACITY_SEMANTICS =
  'INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL' as const;
export const FAST_VET_R1_MINIMUM_PROBE_USD_MICROS =
  DEFAULT_BASELINE_NOTIONALS_USD_MICROS[0]!;

export const FAST_VET_R1_CAPACITY_GATE_CONFIGURATION = Object.freeze({
  objective: 'MAXIMIZE_COVERAGE_SUBJECT_TO_CATASTROPHE_VETOES',
  minimumProbeUsdMicros: FAST_VET_R1_MINIMUM_PROBE_USD_MICROS,
  creatorFeatureMissingAction: 'ALLOW_WITH_UNCERTAINTY',
  creatorHistoryIncompleteAction: 'ALLOW_WITH_UNCERTAINTY',
  knownPriorAdverseCreatorAction: 'REJECT',
  requireMinimumExecutableEntry: true,
  requireMinimumExecutableReverse: true,
  capacityRule: 'LARGEST_CONTIGUOUS_BIDIRECTIONALLY_EXECUTABLE_PREFIX',
  capacitySemantics: FAST_VET_R1_CAPACITY_SEMANTICS,
  recoveryThresholdBps: null,
  mode: 'SHADOW_ONLY',
  liveMoneyAuthority: false,
  authority: 'SHADOW_RESEARCH_ONLY_EDGE_UNPROVEN'
} as const);

export type FastVetR1Decision = 'ELIGIBLE' | 'REJECT' | 'NO_DECISION';
export type FastVetR1HypotheticalAction = 'WOULD_TRADE' | 'WOULD_SKIP';
export type FastVetR1Reason =
  | 'BASELINE_MISSING'
  | 'BASELINE_UNVERIFIED'
  | 'MINIMUM_ENTRY_NOT_EXECUTABLE'
  | 'MINIMUM_REVERSE_NOT_EXECUTABLE'
  | 'KNOWN_PRIOR_ADVERSE_CREATOR';

export type FastVetR1Uncertainty =
  | 'CREATOR_FEATURE_MISSING'
  | 'CREATOR_HISTORY_INCOMPLETE'
  | 'CAPACITY_BELOW_MAXIMUM';

export interface FastVetR1EvidenceSummary {
  baselineStatus: PortableFastVetBaselineEvidence['status'] | 'MISSING';
  /** Diagnostic same-state probe capacity only; never a live position-size authority. */
  capacityUsdMicros: bigint | null;
  capacitySemantics: typeof FAST_VET_R1_CAPACITY_SEMANTICS;
  executablePrefixUsdMicros: readonly bigint[];
  creatorCoverage:
    | CreatorOutcomeFeatureReceipt['coverage']
    | 'MISSING';
  creatorPriorLaunchCount: number | null;
  creatorPriorAdverseCount: number | null;
}

export interface FastVetR1Result {
  policyVersion: typeof FAST_VET_R1_CAPACITY_GATE;
  decision: FastVetR1Decision;
  hypotheticalAction: FastVetR1HypotheticalAction;
  reasons: readonly FastVetR1Reason[];
  uncertainties: readonly FastVetR1Uncertainty[];
  evidence: FastVetR1EvidenceSummary;
  mode: 'SHADOW_ONLY';
  liveMoneyAuthority: false;
}

export interface BuyEveryExecutableControlResult {
  policyVersion: 'BUY_EVERY_EXECUTABLE_CONTROL_R1';
  decision: FastVetR1Decision;
  hypotheticalAction: FastVetR1HypotheticalAction;
  reasons: readonly Exclude<FastVetR1Reason, 'KNOWN_PRIOR_ADVERSE_CREATOR'>[];
  /** Diagnostic same-state probe capacity only; never a live position-size authority. */
  capacityUsdMicros: bigint | null;
  capacitySemantics: typeof FAST_VET_R1_CAPACITY_SEMANTICS;
  mode: 'SHADOW_ONLY';
  liveMoneyAuthority: false;
}

export interface ShadowPolicyComparison {
  r0: ReturnType<typeof evaluatePortableFastVet>;
  r1: FastVetR1Result;
  buyEveryExecutableControl: BuyEveryExecutableControlResult;
}

export function evaluateFastVetR1CapacityGate(
  input: PortableFastVetInput
): FastVetR1Result {
  const baseline = input.baseline;
  if (!baseline) {
    return result('NO_DECISION', ['BASELINE_MISSING'], [], {
      baselineStatus: 'MISSING',
      capacityUsdMicros: null,
      capacitySemantics: FAST_VET_R1_CAPACITY_SEMANTICS,
      executablePrefixUsdMicros: [],
      creatorCoverage: input.creatorFeature?.coverage ?? 'MISSING',
      creatorPriorLaunchCount: input.creatorFeature?.priorLaunchCount ?? null,
      creatorPriorAdverseCount: input.creatorFeature
        ? adverseCreatorCount(input.creatorFeature)
        : null
    });
  }

  assertPortableFastVetEvidence(baseline);
  if (input.creatorFeature) assertCreatorReceiptSanity(input.creatorFeature);
  assertCreatorBinding(baseline, input.creatorFeature);

  if (baseline.status !== 'COMPLETE') {
    return result(
      'NO_DECISION',
      ['BASELINE_UNVERIFIED'],
      creatorUncertainties(input.creatorFeature),
      evidenceFrom(baseline, input.creatorFeature, null, [])
    );
  }

  assertExactFrozenLadder(baseline);
  const executablePrefix = executableBidirectionalPrefix(baseline);
  const minimum = baseline.legs[0]!;

  if (!minimum.entry.executable) {
    return result(
      'REJECT',
      ['MINIMUM_ENTRY_NOT_EXECUTABLE'],
      creatorUncertainties(input.creatorFeature),
      evidenceFrom(baseline, input.creatorFeature, null, executablePrefix)
    );
  }
  if (!minimum.reverse?.executable) {
    return result(
      'REJECT',
      ['MINIMUM_REVERSE_NOT_EXECUTABLE'],
      creatorUncertainties(input.creatorFeature),
      evidenceFrom(baseline, input.creatorFeature, null, executablePrefix)
    );
  }

  const capacityUsdMicros = executablePrefix.at(-1) ?? null;
  const uncertainties = creatorUncertainties(input.creatorFeature);
  if (executablePrefix.length < DEFAULT_BASELINE_NOTIONALS_USD_MICROS.length) {
    uncertainties.push('CAPACITY_BELOW_MAXIMUM');
  }

  if (input.creatorFeature && adverseCreatorCount(input.creatorFeature) > 0) {
    return result(
      'REJECT',
      ['KNOWN_PRIOR_ADVERSE_CREATOR'],
      uncertainties,
      evidenceFrom(
        baseline,
        input.creatorFeature,
        capacityUsdMicros,
        executablePrefix
      )
    );
  }

  return result(
    'ELIGIBLE',
    [],
    uncertainties,
    evidenceFrom(
      baseline,
      input.creatorFeature,
      capacityUsdMicros,
      executablePrefix
    )
  );
}

/**
 * Deliberately naive control for the prospective experiment. It ignores creator
 * evidence entirely and participates whenever the minimum probe is
 * bidirectionally executable. This is not a live strategy.
 */
export function evaluateBuyEveryExecutableControl(
  baseline: PortableFastVetBaselineEvidence | null
): BuyEveryExecutableControlResult {
  if (!baseline) {
    return controlResult('NO_DECISION', ['BASELINE_MISSING'], null);
  }

  assertPortableFastVetEvidence(baseline);
  if (baseline.status !== 'COMPLETE') {
    return controlResult('NO_DECISION', ['BASELINE_UNVERIFIED'], null);
  }

  assertExactFrozenLadder(baseline);
  const executablePrefix = executableBidirectionalPrefix(baseline);
  const minimum = baseline.legs[0]!;

  if (!minimum.entry.executable) {
    return controlResult('REJECT', ['MINIMUM_ENTRY_NOT_EXECUTABLE'], null);
  }
  if (!minimum.reverse?.executable) {
    return controlResult('REJECT', ['MINIMUM_REVERSE_NOT_EXECUTABLE'], null);
  }

  return controlResult('ELIGIBLE', [], executablePrefix.at(-1) ?? null);
}

export function evaluateShadowPolicyComparison(
  input: PortableFastVetInput
): ShadowPolicyComparison {
  return {
    r0: evaluatePortableFastVet(input),
    r1: evaluateFastVetR1CapacityGate(input),
    buyEveryExecutableControl: evaluateBuyEveryExecutableControl(input.baseline)
  };
}

function assertExactFrozenLadder(
  baseline: PortableFastVetBaselineEvidence
): void {
  if (baseline.legs.length !== DEFAULT_BASELINE_NOTIONALS_USD_MICROS.length) {
    throw new Error('FAST_VET_R1_COMPLETE_LADDER_MISMATCH');
  }

  for (
    let index = 0;
    index < DEFAULT_BASELINE_NOTIONALS_USD_MICROS.length;
    index += 1
  ) {
    if (
      baseline.legs[index]?.notionalUsdMicros !==
      DEFAULT_BASELINE_NOTIONALS_USD_MICROS[index]
    ) {
      throw new Error('FAST_VET_R1_COMPLETE_LADDER_MISMATCH');
    }
  }
}

function executableBidirectionalPrefix(
  baseline: PortableFastVetBaselineEvidence
): bigint[] {
  const notionals: bigint[] = [];
  for (const leg of baseline.legs) {
    if (!leg.entry.executable || !leg.reverse?.executable) break;
    notionals.push(leg.notionalUsdMicros);
  }
  return notionals;
}

function assertCreatorReceiptSanity(
  feature: CreatorOutcomeFeatureReceipt
): void {
  const counts = [
    feature.priorLaunchCount,
    feature.outcomeReceiptCount,
    feature.classifiedOutcomeCount,
    feature.unresolvedOutcomeCount,
    feature.unsellableOutcomeCount,
    feature.catastrophicLossCount,
    feature.exitFailureCount,
    feature.liquidityCollapseCount,
    feature.normalLossCount,
    feature.normalWinCount,
    feature.fatTailWinCount
  ];
  if (counts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('FAST_VET_R1_CREATOR_RECEIPT_INVALID:COUNT');
  }

  const classified =
    feature.catastrophicLossCount +
    feature.exitFailureCount +
    feature.liquidityCollapseCount +
    feature.normalLossCount +
    feature.normalWinCount +
    feature.fatTailWinCount;
  if (
    classified !== feature.classifiedOutcomeCount ||
    feature.classifiedOutcomeCount > feature.outcomeReceiptCount ||
    feature.classifiedOutcomeCount > feature.priorLaunchCount ||
    feature.unresolvedOutcomeCount !==
      feature.priorLaunchCount - feature.classifiedOutcomeCount ||
    feature.unsellableOutcomeCount > feature.classifiedOutcomeCount
  ) {
    throw new Error('FAST_VET_R1_CREATOR_RECEIPT_INVALID:ACCOUNTING');
  }

  const expectedCoverage =
    feature.priorLaunchCount === 0
      ? 'NO_HISTORY'
      : feature.classifiedOutcomeCount === 0
        ? 'UNKNOWN'
        : feature.classifiedOutcomeCount === feature.priorLaunchCount
          ? 'COMPLETE'
          : 'PARTIAL';
  if (feature.coverage !== expectedCoverage) {
    throw new Error('FAST_VET_R1_CREATOR_RECEIPT_INVALID:COVERAGE');
  }
}

function assertCreatorBinding(
  baseline: PortableFastVetBaselineEvidence,
  feature: CreatorOutcomeFeatureReceipt | null
): void {
  if (
    feature &&
    (feature.launchId !== baseline.launchId ||
      feature.baselineId !== baseline.baselineId)
  ) {
    throw new Error(`FAST_VET_R1_BINDING_MISMATCH:${baseline.launchId}`);
  }
}

function creatorUncertainties(
  feature: CreatorOutcomeFeatureReceipt | null
): FastVetR1Uncertainty[] {
  if (!feature) return ['CREATOR_FEATURE_MISSING'];
  if (feature.coverage === 'UNKNOWN' || feature.coverage === 'PARTIAL') {
    return ['CREATOR_HISTORY_INCOMPLETE'];
  }
  return [];
}

function adverseCreatorCount(feature: CreatorOutcomeFeatureReceipt): number {
  return (
    feature.catastrophicLossCount +
    feature.exitFailureCount +
    feature.liquidityCollapseCount
  );
}

function evidenceFrom(
  baseline: PortableFastVetBaselineEvidence,
  feature: CreatorOutcomeFeatureReceipt | null,
  capacityUsdMicros: bigint | null,
  executablePrefixUsdMicros: readonly bigint[]
): FastVetR1EvidenceSummary {
  return {
    baselineStatus: baseline.status,
    capacityUsdMicros,
    capacitySemantics: FAST_VET_R1_CAPACITY_SEMANTICS,
    executablePrefixUsdMicros,
    creatorCoverage: feature?.coverage ?? 'MISSING',
    creatorPriorLaunchCount: feature?.priorLaunchCount ?? null,
    creatorPriorAdverseCount: feature ? adverseCreatorCount(feature) : null
  };
}

function result(
  decision: FastVetR1Decision,
  reasons: readonly FastVetR1Reason[],
  uncertainties: readonly FastVetR1Uncertainty[],
  evidence: FastVetR1EvidenceSummary
): FastVetR1Result {
  return {
    policyVersion: FAST_VET_R1_CAPACITY_GATE,
    decision,
    hypotheticalAction: decision === 'ELIGIBLE' ? 'WOULD_TRADE' : 'WOULD_SKIP',
    reasons,
    uncertainties,
    evidence,
    mode: 'SHADOW_ONLY',
    liveMoneyAuthority: false
  };
}

function controlResult(
  decision: FastVetR1Decision,
  reasons: readonly Exclude<FastVetR1Reason, 'KNOWN_PRIOR_ADVERSE_CREATOR'>[],
  capacityUsdMicros: bigint | null
): BuyEveryExecutableControlResult {
  return {
    policyVersion: 'BUY_EVERY_EXECUTABLE_CONTROL_R1',
    decision,
    hypotheticalAction: decision === 'ELIGIBLE' ? 'WOULD_TRADE' : 'WOULD_SKIP',
    reasons,
    capacityUsdMicros,
    capacitySemantics: FAST_VET_R1_CAPACITY_SEMANTICS,
    mode: 'SHADOW_ONLY',
    liveMoneyAuthority: false
  };
}
