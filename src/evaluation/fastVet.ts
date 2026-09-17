import type { CreatorOutcomeCoverage, CreatorOutcomeFeatureReceipt } from '../forensic/creatorOutcome.js';
import type { ExecutableBaselineBatch } from '../shadow/baselineTypes.js';

export const FAST_VET_R0 = 'FAST_VET_R0' as const;
export const FAST_VET_PRIMARY_NOTIONAL_USD_MICROS = 1_000_000n;

export const FAST_VET_R0_CONFIGURATION = Object.freeze({
  primaryNotionalUsdMicros: FAST_VET_PRIMARY_NOTIONAL_USD_MICROS,
  rejectCreatorAdverseHistory: true,
  requireCompleteBaseline: true,
  requireExecutablePrimaryEntry: true,
  requireExecutablePrimaryReverse: true,
  incompleteCreatorHistoryAction: 'UNKNOWN_SKIP',
  unknownAction: 'SKIP',
  authority: 'SHADOW_RESEARCH_ONLY_EDGE_UNPROVEN'
});

export type FastVetDecision = 'PASS' | 'REJECT' | 'UNKNOWN';
export type FastVetAction = 'BUY_ELIGIBLE' | 'SKIP';
export type FastVetReason =
  | 'BASELINE_MISSING'
  | 'BASELINE_UNVERIFIED'
  | 'PRIMARY_LEG_MISSING'
  | 'PRIMARY_ENTRY_NOT_EXECUTABLE'
  | 'PRIMARY_REVERSE_NOT_EXECUTABLE'
  | 'CREATOR_FEATURE_MISSING'
  | 'CREATOR_HISTORY_INCOMPLETE'
  | 'KNOWN_PRIOR_ADVERSE_CREATOR';

export interface FastVetInput {
  baseline: ExecutableBaselineBatch | null;
  creatorFeature: CreatorOutcomeFeatureReceipt | null;
}

export interface FastVetEvidenceSummary {
  baselineStatus: ExecutableBaselineBatch['status'] | 'MISSING';
  primaryEntryExecutable: boolean | null;
  primaryReverseExecutable: boolean | null;
  independentReverseRecoveryBps: bigint | null;
  creatorCoverage: CreatorOutcomeCoverage | 'MISSING';
  creatorPriorLaunchCount: number | null;
  creatorPriorAdverseCount: number | null;
}

export interface FastVetResult {
  policyVersion: typeof FAST_VET_R0;
  decision: FastVetDecision;
  action: FastVetAction;
  reasons: FastVetReason[];
  evidence: FastVetEvidenceSummary;
}

export function evaluateFastVet(input: FastVetInput): FastVetResult {
  const baseline = input.baseline;
  if (!baseline) {
    return result('UNKNOWN', ['BASELINE_MISSING'], {
      baselineStatus: 'MISSING',
      primaryEntryExecutable: null,
      primaryReverseExecutable: null,
      independentReverseRecoveryBps: null,
      creatorCoverage: input.creatorFeature?.coverage ?? 'MISSING',
      creatorPriorLaunchCount: input.creatorFeature?.priorLaunchCount ?? null,
      creatorPriorAdverseCount: input.creatorFeature ? adverseCreatorCount(input.creatorFeature) : null
    });
  }

  const feature = input.creatorFeature;
  if (feature && (feature.launchId !== baseline.launchId || feature.baselineId !== baseline.baselineId)) {
    throw new Error(`FAST_VET_BINDING_MISMATCH:${baseline.launchId}`);
  }

  if (baseline.status !== 'COMPLETE') {
    return result('UNKNOWN', ['BASELINE_UNVERIFIED'], evidenceFrom(baseline, feature));
  }

  const primaryLeg = baseline.legs.find((leg) => leg.notionalUsdMicros === FAST_VET_PRIMARY_NOTIONAL_USD_MICROS);
  if (!primaryLeg) {
    return result('UNKNOWN', ['PRIMARY_LEG_MISSING'], evidenceFrom(baseline, feature));
  }
  if (!primaryLeg.entry.executable) {
    return result('REJECT', ['PRIMARY_ENTRY_NOT_EXECUTABLE'], evidenceFrom(baseline, feature));
  }
  if (!primaryLeg.reverse?.executable || primaryLeg.independentReverseRecoveryBps === null) {
    return result('REJECT', ['PRIMARY_REVERSE_NOT_EXECUTABLE'], evidenceFrom(baseline, feature));
  }

  if (!feature) {
    return result('UNKNOWN', ['CREATOR_FEATURE_MISSING'], evidenceFrom(baseline, null));
  }

  if (adverseCreatorCount(feature) > 0) {
    return result('REJECT', ['KNOWN_PRIOR_ADVERSE_CREATOR'], evidenceFrom(baseline, feature));
  }

  if (feature.coverage === 'UNKNOWN' || feature.coverage === 'PARTIAL') {
    return result('UNKNOWN', ['CREATOR_HISTORY_INCOMPLETE'], evidenceFrom(baseline, feature));
  }

  return result('PASS', [], evidenceFrom(baseline, feature));
}

function adverseCreatorCount(feature: CreatorOutcomeFeatureReceipt): number {
  return feature.catastrophicLossCount + feature.exitFailureCount + feature.liquidityCollapseCount;
}

function evidenceFrom(
  baseline: ExecutableBaselineBatch,
  feature: CreatorOutcomeFeatureReceipt | null
): FastVetEvidenceSummary {
  const primaryLeg = baseline.legs.find((leg) => leg.notionalUsdMicros === FAST_VET_PRIMARY_NOTIONAL_USD_MICROS);
  return {
    baselineStatus: baseline.status,
    primaryEntryExecutable: primaryLeg?.entry.executable ?? null,
    primaryReverseExecutable: primaryLeg?.reverse?.executable ?? null,
    independentReverseRecoveryBps: primaryLeg?.independentReverseRecoveryBps ?? null,
    creatorCoverage: feature?.coverage ?? 'MISSING',
    creatorPriorLaunchCount: feature?.priorLaunchCount ?? null,
    creatorPriorAdverseCount: feature ? adverseCreatorCount(feature) : null
  };
}

function result(
  decision: FastVetDecision,
  reasons: FastVetReason[],
  evidence: FastVetEvidenceSummary
): FastVetResult {
  return {
    policyVersion: FAST_VET_R0,
    decision,
    action: decision === 'PASS' ? 'BUY_ELIGIBLE' : 'SKIP',
    reasons,
    evidence
  };
}
