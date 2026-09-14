import { sha256Hex } from '../evidence/canonical.js';
import { CREATOR_OUTCOME_HORIZON_MS, type CreatorOutcomeFeatureReceipt } from '../forensic/creatorOutcome.js';
import {
  FORWARD_OUTCOMES_R1,
  PRIMARY_OUTCOME_NOTIONAL_USD_MICROS,
  type ForwardOutcomeReceipt
} from '../outcome/forwardTypes.js';
import type { ExecutableBaselineBatch } from '../shadow/baselineTypes.js';
import { FAST_VET_R0_CONFIGURATION, evaluateFastVet } from './fastVet.js';

export const FAST_VET_SHADOW_R0 = 'FAST_VET_SHADOW_R0' as const;
export const FAST_VET_SHADOW_STRATEGY_LABEL = 'EDGE_UNPROVEN' as const;

export interface FastVetShadowRow {
  launchId: string;
  baseline: ExecutableBaselineBatch | null;
  creatorFeature: CreatorOutcomeFeatureReceipt | null;
  targetOutcome: ForwardOutcomeReceipt | null;
}

export interface FastVetShadowMetrics {
  launchCount: number;
  passCount: number;
  rejectCount: number;
  unknownCount: number;
  tradeRetentionBps: number | null;
  resolvedOutcomeCount: number;
  outcomeCoverageBps: number | null;
  controlAdverseCount: number;
  retainedAdverseCount: number;
  adverseAvoidedCount: number;
  adverseExposureReductionBps: number | null;
  controlWinCount: number;
  retainedWinCount: number;
  winRetentionBps: number | null;
  controlUpsideExcessUsdMicros: bigint;
  retainedUpsideExcessUsdMicros: bigint;
  upsideCaptureBps: number | null;
}

export interface FastVetShadowReceipt {
  receiptVersion: typeof FAST_VET_SHADOW_R0;
  strategyLabel: typeof FAST_VET_SHADOW_STRATEGY_LABEL;
  status: 'SMOKE_ONLY';
  configurationDigest: string;
  inputDigest: string;
  outputDigest: string;
  evidenceDigest: string;
  metrics: FastVetShadowMetrics;
}

export async function evaluateFastVetShadow(rowsInput: readonly FastVetShadowRow[]): Promise<FastVetShadowReceipt> {
  const suppliedRows = [...rowsInput].sort((a, b) => a.launchId.localeCompare(b.launchId));
  const seen = new Set<string>();
  for (const row of suppliedRows) {
    if (seen.has(row.launchId)) throw new Error(`FAST_VET_SHADOW_DUPLICATE_LAUNCH:${row.launchId}`);
    seen.add(row.launchId);
    if (row.baseline && row.baseline.launchId !== row.launchId) {
      throw new Error(`FAST_VET_SHADOW_BASELINE_BINDING_MISMATCH:${row.launchId}`);
    }
    if (row.creatorFeature && row.creatorFeature.launchId !== row.launchId) {
      throw new Error(`FAST_VET_SHADOW_FEATURE_BINDING_MISMATCH:${row.launchId}`);
    }
  }

  // Match the existing creator-signal control: buy every COMPLETE executable
  // baseline. UNVERIFIED/missing baselines are outside the control cohort and
  // must not depress retention or outcome-coverage denominators.
  const rows = suppliedRows.filter((row) => row.baseline?.status === 'COMPLETE');

  let passCount = 0;
  let rejectCount = 0;
  let unknownCount = 0;
  let resolvedOutcomeCount = 0;
  let controlAdverseCount = 0;
  let retainedAdverseCount = 0;
  let adverseAvoidedCount = 0;
  let controlWinCount = 0;
  let retainedWinCount = 0;
  let controlUpsideExcessUsdMicros = 0n;
  let retainedUpsideExcessUsdMicros = 0n;

  const decisions: Array<{ launchId: string; decision: string; action: string; reasons: readonly string[] }> = [];

  for (const row of rows) {
    const vet = evaluateFastVet({ baseline: row.baseline, creatorFeature: row.creatorFeature });
    decisions.push({ launchId: row.launchId, decision: vet.decision, action: vet.action, reasons: vet.reasons });
    if (vet.decision === 'PASS') passCount += 1;
    else if (vet.decision === 'REJECT') rejectCount += 1;
    else unknownCount += 1;

    const target = resolvedOutcome(row);
    if (!target) continue;
    resolvedOutcomeCount += 1;
    const adverse = isAdverse(target.classification!);
    const win = target.classification === 'NORMAL_WIN';
    if (adverse) controlAdverseCount += 1;
    if (win) controlWinCount += 1;

    const upside = target.executableValueUsdMicros! > PRIMARY_OUTCOME_NOTIONAL_USD_MICROS
      ? target.executableValueUsdMicros! - PRIMARY_OUTCOME_NOTIONAL_USD_MICROS
      : 0n;
    controlUpsideExcessUsdMicros += upside;

    if (vet.decision === 'PASS') {
      if (adverse) retainedAdverseCount += 1;
      if (win) retainedWinCount += 1;
      retainedUpsideExcessUsdMicros += upside;
    } else if (adverse) {
      adverseAvoidedCount += 1;
    }
  }

  const launchCount = rows.length;
  const metrics: FastVetShadowMetrics = {
    launchCount,
    passCount,
    rejectCount,
    unknownCount,
    tradeRetentionBps: ratioBps(passCount, launchCount),
    resolvedOutcomeCount,
    outcomeCoverageBps: ratioBps(resolvedOutcomeCount, launchCount),
    controlAdverseCount,
    retainedAdverseCount,
    adverseAvoidedCount,
    adverseExposureReductionBps: ratioBps(adverseAvoidedCount, controlAdverseCount),
    controlWinCount,
    retainedWinCount,
    winRetentionBps: ratioBps(retainedWinCount, controlWinCount),
    controlUpsideExcessUsdMicros,
    retainedUpsideExcessUsdMicros,
    upsideCaptureBps: ratioBigintBps(retainedUpsideExcessUsdMicros, controlUpsideExcessUsdMicros)
  };

  const configurationDigest = await sha256Hex({
    fastVet: FAST_VET_R0_CONFIGURATION,
    outcomeHorizonMs: CREATOR_OUTCOME_HORIZON_MS,
    shadowSemantics: 'CONTROL_COMPLETE_BASELINE_WITH_RESOLVED_24H_R1_CANDIDATE_PASS_ONLY_UNKNOWN_SKIPS'
  });
  const inputDigest = await sha256Hex({
    receiptVersion: FAST_VET_SHADOW_R0,
    rows: rows.map((row) => ({
      launchId: row.launchId,
      baselineId: row.baseline?.baselineId ?? null,
      baselineAuthorityDigest: row.baseline?.authorityDigest ?? null,
      creatorEvidenceDigest: row.creatorFeature?.evidenceDigest ?? null,
      outcomeId: row.targetOutcome?.outcomeId ?? null,
      outcomeEvidenceDigest: row.targetOutcome?.evidenceDigest ?? null
    }))
  });
  const outputDigest = await sha256Hex({ decisions, metrics });
  const evidenceDigest = await sha256Hex({
    receiptVersion: FAST_VET_SHADOW_R0,
    strategyLabel: FAST_VET_SHADOW_STRATEGY_LABEL,
    configurationDigest,
    inputDigest,
    outputDigest
  });

  return {
    receiptVersion: FAST_VET_SHADOW_R0,
    strategyLabel: FAST_VET_SHADOW_STRATEGY_LABEL,
    status: 'SMOKE_ONLY',
    configurationDigest,
    inputDigest,
    outputDigest,
    evidenceDigest,
    metrics
  };
}

function resolvedOutcome(row: FastVetShadowRow): ForwardOutcomeReceipt | null {
  const outcome = row.targetOutcome;
  if (!outcome || outcome.status !== 'COMPLETE') return null;
  if (!row.baseline || row.baseline.status !== 'COMPLETE') return null;
  if (outcome.policyVersion !== FORWARD_OUTCOMES_R1) return null;
  if (outcome.horizonMs !== CREATOR_OUTCOME_HORIZON_MS) return null;
  if (outcome.launchId !== row.launchId) throw new Error(`FAST_VET_SHADOW_OUTCOME_BINDING_MISMATCH:${row.launchId}`);
  if (outcome.baselineId !== row.baseline.baselineId) {
    throw new Error(`FAST_VET_SHADOW_OUTCOME_BASELINE_MISMATCH:${row.launchId}`);
  }
  if (
    outcome.entryNotionalUsdMicros !== PRIMARY_OUTCOME_NOTIONAL_USD_MICROS ||
    outcome.executableValueUsdMicros === undefined ||
    outcome.classification === undefined
  ) return null;
  return outcome;
}

function isAdverse(classification: NonNullable<ForwardOutcomeReceipt['classification']>): boolean {
  return classification === 'CATASTROPHIC_LOSS' ||
    classification === 'EXIT_FAILURE' ||
    classification === 'LIQUIDITY_COLLAPSE';
}

function ratioBps(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.floor((numerator * 10_000) / denominator) : null;
}

function ratioBigintBps(numerator: bigint, denominator: bigint): number | null {
  return denominator > 0n ? Number((numerator * 10_000n) / denominator) : null;
}
