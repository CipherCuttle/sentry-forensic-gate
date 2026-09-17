import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { evaluateFastVet } from '../dist/evaluation/fastVet.js';

const INPUT_PATH = process.env.REPLAY_RECEIPT ?? process.argv[2];
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'fast-vet-r0-historical-smoke-r1-receipt.json';
const BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
const PRIMARY_NOTIONAL = 1_000_000n;
const TARGET_HORIZON_MS = 86_400_000;
const RULE_HEAD = '22fcce4c301e791a59c68b19b198bd1bea104138';
const RULE_FIXTURE_SHA256 = '48704fd4692016a7fae73bcd63841686788f837d3001d43c9cf5cb3841172665';

if (!INPUT_PATH) throw new Error('REPLAY_RECEIPT path required');
const inputBytes = fs.readFileSync(INPUT_PATH);
const replay = JSON.parse(inputBytes.toString('utf8'));

function invariant(condition, message) { if (!condition) throw new Error(message); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function ratioBps(numerator, denominator) { return denominator > 0 ? Math.floor((numerator * 10_000) / denominator) : null; }
function ratioBigintBps(numerator, denominator) { return denominator > 0n ? Number((numerator * 10_000n) / denominator) : null; }
function isAdverse(classification) {
  return classification === 'CATASTROPHIC_LOSS' || classification === 'EXIT_FAILURE' || classification === 'LIQUIDITY_COLLAPSE';
}
function reviveBaseline(raw) {
  if (!raw) return null;
  const baseline = structuredClone(raw);
  baseline.decisionBlock = BigInt(baseline.decisionBlock);
  for (const leg of baseline.legs ?? []) {
    leg.notionalUsdMicros = BigInt(leg.notionalUsdMicros);
    if (leg.independentReverseRecoveryBps !== null && leg.independentReverseRecoveryBps !== undefined) {
      leg.independentReverseRecoveryBps = BigInt(leg.independentReverseRecoveryBps);
    }
  }
  return baseline;
}
function target24h(row) {
  const cells = row.outcomes ?? [];
  const matches = cells.filter((cell) => cell.horizonMs === TARGET_HORIZON_MS);
  invariant(matches.length === 1, `FAST_VET_SMOKE_24H_CELL_COUNT:ordinal=${row.ordinal}:count=${matches.length}`);
  return matches[0];
}
function classifyPriorOutcomes(outcomes, priorLaunchCount) {
  const counts = {
    classifiedOutcomeCount: 0,
    unsellableOutcomeCount: 0,
    catastrophicLossCount: 0,
    exitFailureCount: 0,
    liquidityCollapseCount: 0,
    normalLossCount: 0,
    normalWinCount: 0,
    fatTailWinCount: 0
  };
  for (const outcome of outcomes) {
    if (outcome.classification !== undefined && outcome.sellable === false) counts.unsellableOutcomeCount += 1;
    switch (outcome.classification) {
      case 'CATASTROPHIC_LOSS': counts.classifiedOutcomeCount += 1; counts.catastrophicLossCount += 1; break;
      case 'EXIT_FAILURE': counts.classifiedOutcomeCount += 1; counts.exitFailureCount += 1; break;
      case 'LIQUIDITY_COLLAPSE': counts.classifiedOutcomeCount += 1; counts.liquidityCollapseCount += 1; break;
      case 'NORMAL_LOSS': counts.classifiedOutcomeCount += 1; counts.normalLossCount += 1; break;
      case 'NORMAL_WIN': counts.classifiedOutcomeCount += 1; counts.normalWinCount += 1; break;
      case 'FAT_TAIL_WIN': counts.classifiedOutcomeCount += 1; counts.fatTailWinCount += 1; break;
      case undefined: break;
      default: throw new Error(`FAST_VET_SMOKE_UNKNOWN_CLASSIFICATION:${outcome.classification}`);
    }
  }
  const coverage = priorLaunchCount === 0
    ? 'NO_HISTORY'
    : counts.classifiedOutcomeCount === 0
      ? 'UNKNOWN'
      : counts.classifiedOutcomeCount === priorLaunchCount
        ? 'COMPLETE'
        : 'PARTIAL';
  return { ...counts, coverage };
}
function buildCreatorFeature(row, baseline, orderedRows) {
  const creator = String(row.creator).toLowerCase();
  const prior = orderedRows.filter((candidate) => candidate.ordinal < row.ordinal && String(candidate.creator).toLowerCase() === creator);
  const eligibleOutcomes = [];
  for (const candidate of prior) {
    const outcome = target24h(candidate);
    if (outcome.status !== 'COMPLETE') continue;
    if (outcome.policyVersion !== OUTCOME_POLICY) throw new Error(`FAST_VET_SMOKE_OUTCOME_POLICY_DRIFT:ordinal=${candidate.ordinal}`);
    if (BigInt(outcome.observedBlock) > baseline.decisionBlock) continue;
    eligibleOutcomes.push(outcome);
  }
  const counts = classifyPriorOutcomes(eligibleOutcomes, prior.length);
  return {
    launchId: row.launchId,
    baselineId: baseline.baselineId,
    coverage: counts.coverage,
    priorLaunchCount: prior.length,
    catastrophicLossCount: counts.catastrophicLossCount,
    exitFailureCount: counts.exitFailureCount,
    liquidityCollapseCount: counts.liquidityCollapseCount,
    normalLossCount: counts.normalLossCount,
    normalWinCount: counts.normalWinCount,
    fatTailWinCount: counts.fatTailWinCount,
    outcomeReceiptCount: eligibleOutcomes.length,
    classifiedOutcomeCount: counts.classifiedOutcomeCount,
    unresolvedOutcomeCount: prior.length - counts.classifiedOutcomeCount,
    unsellableOutcomeCount: counts.unsellableOutcomeCount
  };
}

invariant(replay.schema === 'historical-full-replay-r1-live-receipt/v1', `unexpected replay schema:${replay.schema}`);
invariant(replay.verdict === 'HISTORICAL_FULL_REPLAY_R1_ACCOUNTING_PASS', `replay verdict drift:${replay.verdict}`);
invariant(replay.baselinePolicyVersion === BASELINE_POLICY, `baseline policy drift:${replay.baselinePolicyVersion}`);
invariant(replay.outcomePolicyVersion === OUTCOME_POLICY, `outcome policy drift:${replay.outcomePolicyVersion}`);
invariant(replay.launchesAccounted === 147 && replay.baselineComplete === 147 && replay.baselineUnverified === 0, 'closed replay baseline accounting drift');
invariant(replay.outcomesComplete === 735 && replay.outcomesUnverified === 0, 'closed replay outcome accounting drift');

const rows = [...replay.rows].sort((a, b) => a.ordinal - b.ordinal);
invariant(rows.length === 147, `expected 147 rows:actual=${rows.length}`);
invariant(rows.every((row, index) => row.ordinal === index + 1), 'ordinal coverage drift');

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
const decisions = [];

for (const row of rows) {
  const baseline = reviveBaseline(row.baseline);
  invariant(baseline?.status === 'COMPLETE', `baseline must be COMPLETE:ordinal=${row.ordinal}`);
  invariant(baseline.policyVersion === BASELINE_POLICY, `baseline source-policy drift:ordinal=${row.ordinal}`);
  const creatorFeature = buildCreatorFeature(row, baseline, rows);
  const vet = evaluateFastVet({ baseline, creatorFeature });
  if (vet.decision === 'PASS') passCount += 1;
  else if (vet.decision === 'REJECT') rejectCount += 1;
  else unknownCount += 1;

  const target = target24h(row);
  invariant(target.status === 'COMPLETE', `target outcome must be COMPLETE:ordinal=${row.ordinal}`);
  invariant(target.policyVersion === OUTCOME_POLICY, `target source-policy drift:ordinal=${row.ordinal}`);
  invariant(target.classification !== undefined, `target classification missing:ordinal=${row.ordinal}`);
  invariant(target.executableValueUsdMicros !== undefined && target.executableValueUsdMicros !== null, `target executable value missing:ordinal=${row.ordinal}`);
  resolvedOutcomeCount += 1;
  const adverse = isAdverse(target.classification);
  const win = target.classification === 'NORMAL_WIN';
  if (adverse) controlAdverseCount += 1;
  if (win) controlWinCount += 1;
  const value = BigInt(target.executableValueUsdMicros);
  const upside = value > PRIMARY_NOTIONAL ? value - PRIMARY_NOTIONAL : 0n;
  controlUpsideExcessUsdMicros += upside;
  if (vet.decision === 'PASS') {
    if (adverse) retainedAdverseCount += 1;
    if (win) retainedWinCount += 1;
    retainedUpsideExcessUsdMicros += upside;
  } else if (adverse) adverseAvoidedCount += 1;

  decisions.push({
    ordinal: row.ordinal,
    launchId: row.launchId,
    creator: row.creator,
    decision: vet.decision,
    action: vet.action,
    reasons: vet.reasons,
    creatorCoverage: creatorFeature.coverage,
    priorLaunchCount: creatorFeature.priorLaunchCount,
    priorAdverseCount: creatorFeature.catastrophicLossCount + creatorFeature.exitFailureCount + creatorFeature.liquidityCollapseCount,
    targetClassification: target.classification,
    targetExecutableValueUsdMicros: String(target.executableValueUsdMicros)
  });
}

const metrics = {
  launchCount: rows.length,
  passCount,
  rejectCount,
  unknownCount,
  tradeRetentionBps: ratioBps(passCount, rows.length),
  resolvedOutcomeCount,
  outcomeCoverageBps: ratioBps(resolvedOutcomeCount, rows.length),
  controlAdverseCount,
  retainedAdverseCount,
  adverseAvoidedCount,
  adverseExposureReductionBps: ratioBps(adverseAvoidedCount, controlAdverseCount),
  controlWinCount,
  retainedWinCount,
  winRetentionBps: ratioBps(retainedWinCount, controlWinCount),
  controlUpsideExcessUsdMicros: controlUpsideExcessUsdMicros.toString(),
  retainedUpsideExcessUsdMicros: retainedUpsideExcessUsdMicros.toString(),
  upsideCaptureBps: ratioBigintBps(retainedUpsideExcessUsdMicros, controlUpsideExcessUsdMicros)
};

invariant(passCount + rejectCount + unknownCount === rows.length, 'decision accounting drift');
const outputDigest = sha256(JSON.stringify({ decisions, metrics }));
const receipt = {
  schema: 'fast-vet-r0-historical-smoke-r1/v1',
  phase: 'FAST_VET_R0_HISTORICAL_SMOKE_R1',
  status: 'SMOKE_ONLY',
  strategyLabel: 'EDGE_UNPROVEN',
  sourceRuleHead: RULE_HEAD,
  normalizedRuleFixtureSha256: RULE_FIXTURE_SHA256,
  sourceReplayPhase: replay.phase,
  sourceReplayReceiptSha256: sha256(inputBytes),
  baselinePolicyVersion: BASELINE_POLICY,
  outcomePolicyVersion: OUTCOME_POLICY,
  historicalAdapter: 'REPAIRED_AGGREGATE_SHAPE_ADAPTER_ONLY',
  unknownAction: 'SKIP',
  metrics,
  outputDigest,
  decisions,
  verdict: 'FAST_VET_R0_HISTORICAL_SMOKE_R1_COMPLETE_NO_PROMOTION_CLAIM'
};
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ verdict: receipt.verdict, metrics }, null, 2));
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
