import type { Hex } from '../domain.js';
import { sha256Hex } from '../evidence/canonical.js';
import type { CreatorOutcomeFeatureReceipt } from '../forensic/creatorOutcome.js';
import type { ForwardOutcomeReceipt } from '../outcome/forwardTypes.js';
import { FORWARD_OUTCOMES_R1, PRIMARY_OUTCOME_NOTIONAL_USD_MICROS } from '../outcome/forwardTypes.js';
import type { BaselineStatus } from '../shadow/baselineTypes.js';

export const CREATOR_SIGNAL_EVAL_V0 = 'CREATOR_SIGNAL_EVAL_V0' as const;
export const CREATOR_SIGNAL_STRATEGY_LABEL = 'EDGE_UNPROVEN' as const;
export const CREATOR_SIGNAL_HORIZON_MS = 86_400_000 as const;
export const CREATOR_SIGNAL_CONFIRMATIONS = 2n;

export const CREATOR_SIGNAL_EVAL_CONFIGURATION = Object.freeze({
  candidateRule: 'REJECT_IF_ANY_PRIOR_CANONICAL_ADVERSE_CREATOR_OUTCOME',
  horizonMs: CREATOR_SIGNAL_HORIZON_MS,
  adverseClassifications: ['CATASTROPHIC_LOSS', 'EXIT_FAILURE', 'LIQUIDITY_COLLAPSE'] as const,
  controlPolicy: 'BUY_EVERY_COMPLETE_BASELINE',
  candidateRejectedCapitalPolicy: 'RETAIN_1_USD_CASH',
  upsideMetric: 'SUM_MAX_EXECUTABLE_VALUE_MINUS_1_USD_ZERO_FLOOR',
  sampleAdequacy: Object.freeze({
    minMatureLaunches: 30,
    minBaselineReceiptCoverageBps: 9_000,
    minCompleteBaselines: 30,
    minResolvedTargets: 30,
    minOutcomeCoverageBps: 9_000,
    minPriorHistoryDecisions: 10,
    minControlAdverseEvents: 10
  }),
  verdictSemantics: 'RETROSPECTIVE_DESCRIPTIVE_ONLY_EDGE_UNPROVEN'
});

export type CreatorSignalEvaluationStatus = 'COMPLETE' | 'INSUFFICIENT_SAMPLE';
export type CreatorSignalVerdict = 'DESCRIPTIVE_WORTH_PROSPECTIVE_TEST' | 'DESCRIPTIVE_NOT_SUPPORTED';
export type CreatorSignalDecision = 'PASS' | 'REJECT';

type ResolvedForwardOutcomeReceipt = ForwardOutcomeReceipt & {
  policyVersion: typeof FORWARD_OUTCOMES_R1;
  status: 'COMPLETE';
  executableValueUsdMicros: bigint;
  executableReturnBps: bigint;
  classification: Exclude<NonNullable<ForwardOutcomeReceipt['classification']>, 'FAT_TAIL_WIN'>;
};

export interface MatureLaunchEvidence {
  launchId: string;
  factId: string;
  factEvidenceDigest: string;
  baselineId: string | null;
  baselineAuthorityDigest: string | null;
  baselineStatus: BaselineStatus | null;
}

export interface CreatorSignalComparableRow {
  launchId: string;
  baselineId: string;
  baselineAuthorityDigest: string;
  feature: CreatorOutcomeFeatureReceipt;
  targetOutcome: ForwardOutcomeReceipt | null;
}

export interface CreatorSignalEvaluationInput {
  chainId: number;
  asOfBlock: bigint;
  asOfBlockHash: Hex;
  asOfTimestampMs: number;
  confirmations: bigint;
  matureLaunches: readonly MatureLaunchEvidence[];
  rows: readonly CreatorSignalComparableRow[];
}

export interface CreatorSignalMetrics {
  matureLaunchCount: number;
  baselineReceiptCount: number;
  baselineReceiptCoverageBps: number | null;
  completeBaselineCount: number;
  resolvedTargetCount: number;
  unresolvedTargetCount: number;
  outcomeCoverageBps: number | null;
  priorHistoryDecisionCount: number;
  candidateDecisionPassCount: number;
  candidateDecisionRejectCount: number;
  resolvedCandidatePassCount: number;
  resolvedCandidateRejectCount: number;
  resolvedTradeRetentionBps: number | null;
  controlAdverseCount: number;
  candidateAdverseCount: number;
  adverseAvoidedCount: number;
  adverseExposureReductionBps: number | null;
  rejectedNonAdverseCount: number;
  rejectionAdversePrecisionBps: number | null;
  controlTerminalUsdMicros: bigint;
  candidateTerminalUsdMicros: bigint;
  capitalDeltaUsdMicros: bigint;
  controlUpsideExcessUsdMicros: bigint;
  candidateUpsideExcessUsdMicros: bigint;
  winnerCaptureBps: number | null;
}

export interface CreatorSignalEvaluationReceipt {
  receiptId: string;
  evaluationVersion: typeof CREATOR_SIGNAL_EVAL_V0;
  strategyLabel: typeof CREATOR_SIGNAL_STRATEGY_LABEL;
  status: CreatorSignalEvaluationStatus;
  verdict: CreatorSignalVerdict | null;
  sampleFailures: string[];
  configurationDigest: string;
  chainId: number;
  asOfBlock: bigint;
  asOfBlockHash: Hex;
  asOfTimestampMs: number;
  confirmations: bigint;
  metrics: CreatorSignalMetrics;
  inputDigest: string;
  outputDigest: string;
  evidenceDigest: string;
}

export async function evaluateCreatorSignal(
  input: CreatorSignalEvaluationInput
): Promise<CreatorSignalEvaluationReceipt> {
  validateInput(input);
  const mature = [...input.matureLaunches].sort((a, b) => a.launchId.localeCompare(b.launchId));
  const rows = [...input.rows].sort((a, b) => a.launchId.localeCompare(b.launchId));
  const matureByLaunch = new Map(mature.map((item) => [item.launchId, item]));
  const rowIds = new Set<string>();

  const expectedComplete = mature.filter((item) => item.baselineStatus === 'COMPLETE').length;
  if (rows.length !== expectedComplete) {
    throw new Error(`CREATOR_SIGNAL_COMPLETE_BASELINE_ROW_MISMATCH:expected=${expectedComplete}:actual=${rows.length}`);
  }

  let resolvedTargetCount = 0;
  let priorHistoryDecisionCount = 0;
  let candidateDecisionPassCount = 0;
  let candidateDecisionRejectCount = 0;
  let resolvedCandidatePassCount = 0;
  let resolvedCandidateRejectCount = 0;
  let controlAdverseCount = 0;
  let candidateAdverseCount = 0;
  let adverseAvoidedCount = 0;
  let rejectedNonAdverseCount = 0;
  let controlTerminalUsdMicros = 0n;
  let candidateTerminalUsdMicros = 0n;
  let controlUpsideExcessUsdMicros = 0n;
  let candidateUpsideExcessUsdMicros = 0n;

  for (const row of rows) {
    if (rowIds.has(row.launchId)) throw new Error(`CREATOR_SIGNAL_DUPLICATE_ROW:${row.launchId}`);
    rowIds.add(row.launchId);
    const matureEvidence = matureByLaunch.get(row.launchId);
    if (!matureEvidence || matureEvidence.baselineStatus !== 'COMPLETE') {
      throw new Error(`CREATOR_SIGNAL_ROW_OUTSIDE_COMPLETE_MATURE_UNIVERSE:${row.launchId}`);
    }
    if (
      matureEvidence.baselineId !== row.baselineId ||
      matureEvidence.baselineAuthorityDigest !== row.baselineAuthorityDigest
    ) {
      throw new Error(`CREATOR_SIGNAL_BASELINE_BINDING_MISMATCH:${row.launchId}`);
    }
    validateFeature(row);

    if (row.feature.priorLaunchCount > 0) priorHistoryDecisionCount += 1;
    const decision = candidateDecision(row.feature);
    if (decision === 'REJECT') candidateDecisionRejectCount += 1;
    else candidateDecisionPassCount += 1;

    const target = resolvedTarget(row);
    if (!target) continue;
    resolvedTargetCount += 1;
    if (decision === 'REJECT') resolvedCandidateRejectCount += 1;
    else resolvedCandidatePassCount += 1;

    const adverse = isAdverse(target.classification);
    if (adverse) controlAdverseCount += 1;
    if (adverse && decision === 'PASS') candidateAdverseCount += 1;
    if (adverse && decision === 'REJECT') adverseAvoidedCount += 1;
    if (!adverse && decision === 'REJECT') rejectedNonAdverseCount += 1;

    const value = target.executableValueUsdMicros;
    controlTerminalUsdMicros += value;
    const candidateValue = decision === 'PASS' ? value : PRIMARY_OUTCOME_NOTIONAL_USD_MICROS;
    candidateTerminalUsdMicros += candidateValue;

    const upside = value > PRIMARY_OUTCOME_NOTIONAL_USD_MICROS
      ? value - PRIMARY_OUTCOME_NOTIONAL_USD_MICROS
      : 0n;
    controlUpsideExcessUsdMicros += upside;
    if (decision === 'PASS') candidateUpsideExcessUsdMicros += upside;
  }

  const matureLaunchCount = mature.length;
  const baselineReceiptCount = mature.filter((item) => item.baselineStatus !== null).length;
  const completeBaselineCount = rows.length;
  const unresolvedTargetCount = completeBaselineCount - resolvedTargetCount;
  const baselineReceiptCoverageBps = ratioBps(baselineReceiptCount, matureLaunchCount);
  const outcomeCoverageBps = ratioBps(resolvedTargetCount, completeBaselineCount);
  const resolvedTradeRetentionBps = ratioBps(resolvedCandidatePassCount, resolvedTargetCount);
  const adverseExposureReductionBps = ratioBps(adverseAvoidedCount, controlAdverseCount);
  const rejectionAdversePrecisionBps = ratioBps(adverseAvoidedCount, resolvedCandidateRejectCount);
  const winnerCaptureBps = ratioBigintBps(candidateUpsideExcessUsdMicros, controlUpsideExcessUsdMicros);
  const capitalDeltaUsdMicros = candidateTerminalUsdMicros - controlTerminalUsdMicros;

  const metrics: CreatorSignalMetrics = {
    matureLaunchCount,
    baselineReceiptCount,
    baselineReceiptCoverageBps,
    completeBaselineCount,
    resolvedTargetCount,
    unresolvedTargetCount,
    outcomeCoverageBps,
    priorHistoryDecisionCount,
    candidateDecisionPassCount,
    candidateDecisionRejectCount,
    resolvedCandidatePassCount,
    resolvedCandidateRejectCount,
    resolvedTradeRetentionBps,
    controlAdverseCount,
    candidateAdverseCount,
    adverseAvoidedCount,
    adverseExposureReductionBps,
    rejectedNonAdverseCount,
    rejectionAdversePrecisionBps,
    controlTerminalUsdMicros,
    candidateTerminalUsdMicros,
    capitalDeltaUsdMicros,
    controlUpsideExcessUsdMicros,
    candidateUpsideExcessUsdMicros,
    winnerCaptureBps
  };

  const sampleFailures = sampleAdequacyFailures(metrics);
  const status: CreatorSignalEvaluationStatus = sampleFailures.length === 0 ? 'COMPLETE' : 'INSUFFICIENT_SAMPLE';
  const verdict: CreatorSignalVerdict | null = status === 'COMPLETE'
    ? (adverseAvoidedCount > 0 && capitalDeltaUsdMicros >= 0n
      ? 'DESCRIPTIVE_WORTH_PROSPECTIVE_TEST'
      : 'DESCRIPTIVE_NOT_SUPPORTED')
    : null;

  const configurationDigest = await sha256Hex(CREATOR_SIGNAL_EVAL_CONFIGURATION);
  const inputDigest = await sha256Hex({
    evaluationVersion: CREATOR_SIGNAL_EVAL_V0,
    configurationDigest,
    chainId: input.chainId,
    asOfBlock: input.asOfBlock,
    asOfBlockHash: input.asOfBlockHash.toLowerCase(),
    asOfTimestampMs: input.asOfTimestampMs,
    confirmations: input.confirmations,
    matureLaunches: mature,
    rows: rows.map((row) => ({
      launchId: row.launchId,
      baselineId: row.baselineId,
      baselineAuthorityDigest: row.baselineAuthorityDigest,
      featureReceiptId: row.feature.receiptId,
      featureEvidenceDigest: row.feature.evidenceDigest,
      targetOutcome: row.targetOutcome ? {
        outcomeId: row.targetOutcome.outcomeId,
        evidenceDigest: row.targetOutcome.evidenceDigest,
        status: row.targetOutcome.status,
        classification: row.targetOutcome.classification ?? null
      } : null
    }))
  });
  const outputDigest = await sha256Hex({ status, verdict, sampleFailures, metrics });
  const receiptId = await sha256Hex({
    kind: CREATOR_SIGNAL_EVAL_V0,
    configurationDigest,
    asOfBlockHash: input.asOfBlockHash.toLowerCase(),
    inputDigest
  });
  const evidenceDigest = await sha256Hex({
    receiptId,
    evaluationVersion: CREATOR_SIGNAL_EVAL_V0,
    strategyLabel: CREATOR_SIGNAL_STRATEGY_LABEL,
    configurationDigest,
    inputDigest,
    outputDigest
  });

  return {
    receiptId,
    evaluationVersion: CREATOR_SIGNAL_EVAL_V0,
    strategyLabel: CREATOR_SIGNAL_STRATEGY_LABEL,
    status,
    verdict,
    sampleFailures,
    configurationDigest,
    chainId: input.chainId,
    asOfBlock: input.asOfBlock,
    asOfBlockHash: input.asOfBlockHash.toLowerCase() as Hex,
    asOfTimestampMs: input.asOfTimestampMs,
    confirmations: input.confirmations,
    metrics,
    inputDigest,
    outputDigest,
    evidenceDigest
  };
}

export function candidateDecision(feature: CreatorOutcomeFeatureReceipt): CreatorSignalDecision {
  const adverseHistory =
    feature.catastrophicLossCount +
    feature.exitFailureCount +
    feature.liquidityCollapseCount;
  return adverseHistory > 0 ? 'REJECT' : 'PASS';
}

export function sampleAdequacyFailures(metrics: CreatorSignalMetrics): string[] {
  const gate = CREATOR_SIGNAL_EVAL_CONFIGURATION.sampleAdequacy;
  const failures: string[] = [];
  if (metrics.matureLaunchCount < gate.minMatureLaunches) failures.push('MIN_MATURE_LAUNCHES');
  if ((metrics.baselineReceiptCoverageBps ?? -1) < gate.minBaselineReceiptCoverageBps) failures.push('BASELINE_RECEIPT_COVERAGE');
  if (metrics.completeBaselineCount < gate.minCompleteBaselines) failures.push('MIN_COMPLETE_BASELINES');
  if (metrics.resolvedTargetCount < gate.minResolvedTargets) failures.push('MIN_RESOLVED_TARGETS');
  if ((metrics.outcomeCoverageBps ?? -1) < gate.minOutcomeCoverageBps) failures.push('OUTCOME_COVERAGE');
  if (metrics.priorHistoryDecisionCount < gate.minPriorHistoryDecisions) failures.push('MIN_PRIOR_HISTORY_DECISIONS');
  if (metrics.controlAdverseCount < gate.minControlAdverseEvents) failures.push('MIN_CONTROL_ADVERSE_EVENTS');
  return failures;
}

function validateInput(input: CreatorSignalEvaluationInput): void {
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) throw new Error('CREATOR_SIGNAL_INVALID_CHAIN_ID');
  if (input.asOfBlock < 0n) throw new Error('CREATOR_SIGNAL_INVALID_AS_OF_BLOCK');
  if (!Number.isFinite(input.asOfTimestampMs) || input.asOfTimestampMs < 0) throw new Error('CREATOR_SIGNAL_INVALID_AS_OF_TIMESTAMP');
  if (input.confirmations < 0n) throw new Error('CREATOR_SIGNAL_INVALID_CONFIRMATIONS');
  const seen = new Set<string>();
  for (const item of input.matureLaunches) {
    if (seen.has(item.launchId)) throw new Error(`CREATOR_SIGNAL_DUPLICATE_MATURE_LAUNCH:${item.launchId}`);
    seen.add(item.launchId);
    if (item.baselineStatus === null) {
      if (item.baselineId !== null || item.baselineAuthorityDigest !== null) {
        throw new Error(`CREATOR_SIGNAL_PARTIAL_BASELINE_BINDING:${item.launchId}`);
      }
    } else if (!item.baselineId || !item.baselineAuthorityDigest) {
      throw new Error(`CREATOR_SIGNAL_PARTIAL_BASELINE_BINDING:${item.launchId}`);
    }
  }
}

function validateFeature(row: CreatorSignalComparableRow): void {
  if (row.feature.launchId !== row.launchId || row.feature.baselineId !== row.baselineId) {
    throw new Error(`CREATOR_SIGNAL_FEATURE_BINDING_MISMATCH:${row.launchId}`);
  }
  if (row.feature.horizonMs !== CREATOR_SIGNAL_HORIZON_MS) {
    throw new Error(`CREATOR_SIGNAL_FEATURE_HORIZON_MISMATCH:${row.launchId}`);
  }
}

function resolvedTarget(row: CreatorSignalComparableRow): ResolvedForwardOutcomeReceipt | null {
  const target = row.targetOutcome;
  if (!target || target.status !== 'COMPLETE') return null;
  if (
    target.policyVersion !== FORWARD_OUTCOMES_R1 ||
    target.horizonMs !== CREATOR_SIGNAL_HORIZON_MS ||
    target.launchId !== row.launchId ||
    target.baselineId !== row.baselineId
  ) {
    throw new Error(`CREATOR_SIGNAL_TARGET_BINDING_MISMATCH:${row.launchId}`);
  }
  if (
    target.entryNotionalUsdMicros !== PRIMARY_OUTCOME_NOTIONAL_USD_MICROS ||
    target.executableValueUsdMicros === undefined ||
    target.executableReturnBps === undefined ||
    target.classification === undefined
  ) {
    throw new Error(`CREATOR_SIGNAL_RESOLVED_TARGET_INCOMPLETE:${row.launchId}`);
  }
  if (target.classification === 'FAT_TAIL_WIN') {
    throw new Error(`CREATOR_SIGNAL_UNEXPECTED_R1_FAT_TAIL_LABEL:${row.launchId}`);
  }
  return target as ResolvedForwardOutcomeReceipt;
}

function isAdverse(classification: NonNullable<ForwardOutcomeReceipt['classification']>): boolean {
  return classification === 'CATASTROPHIC_LOSS' ||
    classification === 'EXIT_FAILURE' ||
    classification === 'LIQUIDITY_COLLAPSE';
}

function ratioBps(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.floor((numerator * 10_000) / denominator);
}

function ratioBigintBps(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  return Number((numerator * 10_000n) / denominator);
}