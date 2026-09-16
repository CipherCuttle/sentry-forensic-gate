import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PHASE = 'FAST_VET_R0_HISTORICAL_SMOKE_R1';
export const ADAPTER_VERSION = 'FAST_VET_R0_HISTORICAL_ADAPTER_R1';
export const RULE_HEAD = '22fcce4c301e791a59c68b19b198bd1bea104138';
export const REPLAY_RECEIPT_SHA256 = '916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825';
export const BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
export const OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
export const FROZEN_FORWARD_POLICY = 'FORWARD_OUTCOMES_R1';
export const TARGET_HORIZON_MS = 86_400_000;
export const PRIMARY_NOTIONAL_USD_MICROS = 1_000_000n;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function bigint(value, label) {
  try { return BigInt(value); }
  catch { throw new Error(`FAST_VET_HISTORICAL_BIGINT_INVALID:${label}:${value}`); }
}

function nullableBigint(value, label) {
  return value === null || value === undefined ? null : bigint(value, label);
}

function sha256HexBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function digestObject(value) {
  return sha256HexBytes(Buffer.from(JSON.stringify(canonicalize(value))));
}

export function validateReplay(replay) {
  invariant(replay?.schema === 'historical-full-replay-r1-live-receipt/v1', 'FAST_VET_HISTORICAL_REPLAY_SCHEMA_DRIFT');
  invariant(replay?.phase === 'HISTORICAL_FULL_REPLAY_R1' && replay?.stage === 'STAGE_B_FULL_147_X_5_REPLAY', 'FAST_VET_HISTORICAL_REPLAY_PHASE_DRIFT');
  invariant(replay?.verdict === 'HISTORICAL_FULL_REPLAY_R1_ACCOUNTING_PASS' && replay?.shadowOnly === true, 'FAST_VET_HISTORICAL_REPLAY_VERDICT_DRIFT');
  invariant(replay?.baselinePolicyVersion === BASELINE_POLICY && replay?.outcomePolicyVersion === OUTCOME_POLICY, 'FAST_VET_HISTORICAL_REPLAY_POLICY_DRIFT');
  invariant(replay?.launchesAccounted === 147 && replay?.baselineComplete === 147 && replay?.baselineUnverified === 0, 'FAST_VET_HISTORICAL_REPLAY_BASELINE_ACCOUNTING_DRIFT');
  invariant(replay?.horizonCellsAccounted === 735 && replay?.outcomesComplete === 735 && replay?.outcomesUnverified === 0 && replay?.outcomesNotAttemptedBaselineUnverified === 0, 'FAST_VET_HISTORICAL_REPLAY_OUTCOME_ACCOUNTING_DRIFT');
  invariant(Array.isArray(replay?.rows) && replay.rows.length === 147, 'FAST_VET_HISTORICAL_REPLAY_ROW_COUNT_DRIFT');

  const rows = [...replay.rows].sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    invariant(row?.ordinal === index + 1, `FAST_VET_HISTORICAL_REPLAY_ORDINAL_DRIFT:${index + 1}`);
    invariant(row?.baselineStatus === 'COMPLETE' && row?.baseline?.status === 'COMPLETE', `FAST_VET_HISTORICAL_BASELINE_NOT_COMPLETE:${row?.ordinal}`);
    invariant(row?.baselinePolicyVersion === BASELINE_POLICY && row?.baseline?.policyVersion === BASELINE_POLICY, `FAST_VET_HISTORICAL_BASELINE_POLICY_DRIFT:${row?.ordinal}`);
    invariant(row?.baseline?.baselineId === row?.baselineId && row?.baseline?.launchId === row?.launchId, `FAST_VET_HISTORICAL_BASELINE_BINDING_DRIFT:${row?.ordinal}`);
    invariant(Array.isArray(row?.baseline?.legs) && row.baseline.legs.length === 5, `FAST_VET_HISTORICAL_BASELINE_LEG_COUNT_DRIFT:${row?.ordinal}`);
    const primary = row.baseline.legs.filter((leg) => bigint(leg.notionalUsdMicros, `baseline.${row.ordinal}.notional`) === PRIMARY_NOTIONAL_USD_MICROS);
    invariant(primary.length === 1, `FAST_VET_HISTORICAL_PRIMARY_LEG_COUNT:${row?.ordinal}:${primary.length}`);
    invariant(Array.isArray(row?.outcomes) && row.outcomes.length === 5, `FAST_VET_HISTORICAL_OUTCOME_COUNT_DRIFT:${row?.ordinal}`);
    const target = row.outcomes.filter((outcome) => outcome.horizonMs === TARGET_HORIZON_MS);
    invariant(target.length === 1, `FAST_VET_HISTORICAL_24H_OUTCOME_COUNT:${row?.ordinal}:${target.length}`);
    invariant(target[0]?.policyVersion === OUTCOME_POLICY && target[0]?.status === 'COMPLETE', `FAST_VET_HISTORICAL_24H_OUTCOME_POLICY_DRIFT:${row?.ordinal}`);
    invariant(typeof target[0]?.classification === 'string' && target[0]?.executableValueUsdMicros !== null && target[0]?.executableValueUsdMicros !== undefined, `FAST_VET_HISTORICAL_24H_OUTCOME_VALUE_MISSING:${row?.ordinal}`);
  }
  return rows;
}

export function adaptBaseline(row) {
  const baseline = row.baseline;
  return {
    baselineId: baseline.baselineId,
    authorityDigest: baseline.authorityDigest,
    launchId: baseline.launchId,
    policyVersion: baseline.policyVersion,
    decisionBlock: bigint(baseline.decisionBlock, `baseline.${row.ordinal}.decisionBlock`),
    decisionBlockHash: baseline.decisionBlockHash,
    status: baseline.status,
    legs: baseline.legs.map((leg, index) => ({
      notionalUsdMicros: bigint(leg.notionalUsdMicros, `baseline.${row.ordinal}.leg.${index}.notional`),
      entry: { executable: leg.entry?.executable === true },
      reverse: leg.reverse ? { executable: leg.reverse.executable === true } : null,
      independentReverseRecoveryBps: nullableBigint(leg.independentReverseRecoveryBps, `baseline.${row.ordinal}.leg.${index}.recovery`)
    }))
  };
}

function target24h(row) {
  const matches = row.outcomes.filter((outcome) => outcome.horizonMs === TARGET_HORIZON_MS);
  invariant(matches.length === 1, `FAST_VET_HISTORICAL_24H_OUTCOME_COUNT:${row.ordinal}:${matches.length}`);
  return matches[0];
}

function classifyPriorOutcomes(outcomes, priorLaunchCount) {
  let classifiedOutcomeCount = 0;
  let unsellableOutcomeCount = 0;
  let catastrophicLossCount = 0;
  let exitFailureCount = 0;
  let liquidityCollapseCount = 0;
  let normalLossCount = 0;
  let normalWinCount = 0;
  let fatTailWinCount = 0;

  for (const outcome of outcomes) {
    if (outcome.classification !== undefined && outcome.sellable === false) unsellableOutcomeCount += 1;
    switch (outcome.classification) {
      case 'CATASTROPHIC_LOSS': classifiedOutcomeCount += 1; catastrophicLossCount += 1; break;
      case 'EXIT_FAILURE': classifiedOutcomeCount += 1; exitFailureCount += 1; break;
      case 'LIQUIDITY_COLLAPSE': classifiedOutcomeCount += 1; liquidityCollapseCount += 1; break;
      case 'NORMAL_LOSS': classifiedOutcomeCount += 1; normalLossCount += 1; break;
      case 'NORMAL_WIN': classifiedOutcomeCount += 1; normalWinCount += 1; break;
      case 'FAT_TAIL_WIN': classifiedOutcomeCount += 1; fatTailWinCount += 1; break;
      case undefined: break;
      default: throw new Error(`FAST_VET_HISTORICAL_CLASSIFICATION_UNKNOWN:${outcome.classification}`);
    }
  }

  const coverage = priorLaunchCount === 0
    ? 'NO_HISTORY'
    : classifiedOutcomeCount === 0
      ? 'UNKNOWN'
      : classifiedOutcomeCount === priorLaunchCount
        ? 'COMPLETE'
        : 'PARTIAL';

  return {
    coverage,
    classifiedOutcomeCount,
    unsellableOutcomeCount,
    catastrophicLossCount,
    exitFailureCount,
    liquidityCollapseCount,
    normalLossCount,
    normalWinCount,
    fatTailWinCount
  };
}

export function buildCreatorFeature(row, orderedRows) {
  const decisionBlock = bigint(row.baseline.decisionBlock, `baseline.${row.ordinal}.decisionBlock`);
  const creator = String(row.creator).toLowerCase();
  const priorRows = orderedRows.filter((candidate) => candidate.ordinal < row.ordinal && String(candidate.creator).toLowerCase() === creator);
  const eligible = [];
  for (const prior of priorRows) {
    const outcome = target24h(prior);
    invariant(outcome.policyVersion === OUTCOME_POLICY && outcome.status === 'COMPLETE', `FAST_VET_HISTORICAL_PRIOR_OUTCOME_POLICY_DRIFT:${prior.ordinal}`);
    if (bigint(outcome.observedBlock, `outcome.${prior.ordinal}.observedBlock`) <= decisionBlock) eligible.push(outcome);
  }

  const counts = classifyPriorOutcomes(eligible, priorRows.length);
  const sourceLaunchIds = priorRows.map((prior) => prior.launchId);
  const sourceOutcomeIds = eligible.map((outcome) => outcome.outcomeId);
  const evidenceDigest = digestObject({
    adapterVersion: ADAPTER_VERSION,
    launchId: row.launchId,
    baselineId: row.baselineId,
    decisionBlock,
    creator,
    sourceLaunchIds,
    sourceOutcomeIds,
    counts
  });

  return {
    receiptId: digestObject({ kind: ADAPTER_VERSION, launchId: row.launchId, baselineId: row.baselineId }),
    derivationVersion: ADAPTER_VERSION,
    chainId: 57073,
    launchId: row.launchId,
    creator,
    baselineId: row.baselineId,
    decisionBlock,
    decisionBlockHash: row.baseline.decisionBlockHash,
    horizonMs: TARGET_HORIZON_MS,
    coverage: counts.coverage,
    priorLaunchCount: priorRows.length,
    outcomeReceiptCount: eligible.length,
    classifiedOutcomeCount: counts.classifiedOutcomeCount,
    unresolvedOutcomeCount: priorRows.length - counts.classifiedOutcomeCount,
    unsellableOutcomeCount: counts.unsellableOutcomeCount,
    catastrophicLossCount: counts.catastrophicLossCount,
    exitFailureCount: counts.exitFailureCount,
    liquidityCollapseCount: counts.liquidityCollapseCount,
    normalLossCount: counts.normalLossCount,
    normalWinCount: counts.normalWinCount,
    fatTailWinCount: counts.fatTailWinCount,
    sourceFactIds: [],
    sourceOutcomeIds,
    sourceLaunchIds,
    inputDigest: evidenceDigest,
    outputDigest: digestObject(counts),
    evidenceDigest
  };
}

export function adaptTargetOutcome(row) {
  const source = target24h(row);
  invariant(source.policyVersion === OUTCOME_POLICY, `FAST_VET_HISTORICAL_SOURCE_OUTCOME_POLICY_DRIFT:${row.ordinal}`);
  invariant(source.status === 'COMPLETE', `FAST_VET_HISTORICAL_SOURCE_OUTCOME_NOT_COMPLETE:${row.ordinal}`);
  return {
    analyzer: {
      outcomeId: source.outcomeId,
      launchId: row.launchId,
      horizonMs: TARGET_HORIZON_MS,
      observedBlock: bigint(source.observedBlock, `outcome.${row.ordinal}.observedBlock`),
      sellable: source.sellable,
      classification: source.classification,
      policyVersion: FROZEN_FORWARD_POLICY,
      status: 'COMPLETE',
      baselineId: row.baselineId,
      entryNotionalUsdMicros: PRIMARY_NOTIONAL_USD_MICROS,
      executableValueUsdMicros: bigint(source.executableValueUsdMicros, `outcome.${row.ordinal}.executableValueUsdMicros`),
      evidenceDigest: source.evidenceDigest
    },
    sourceBinding: {
      sourcePolicyVersion: source.policyVersion,
      sourceOutcomeId: source.outcomeId,
      sourceEvidenceDigest: source.evidenceDigest,
      classification: source.classification,
      executableValueUsdMicros: String(source.executableValueUsdMicros),
      observedBlock: String(source.observedBlock),
      projectionPolicyVersion: FROZEN_FORWARD_POLICY,
      projectionIsEvidenceAuthority: false
    }
  };
}

export function buildAnalyzerRows(replayRows) {
  return replayRows.map((row) => {
    const projected = adaptTargetOutcome(row);
    return {
      ordinal: row.ordinal,
      launchId: row.launchId,
      creator: row.creator,
      baseline: adaptBaseline(row),
      creatorFeature: buildCreatorFeature(row, replayRows),
      targetOutcome: projected.analyzer,
      sourceOutcomeBinding: projected.sourceBinding
    };
  });
}

async function loadFrozenAnalyzer(pr13Dist) {
  invariant(pr13Dist, 'FAST_VET_HISTORICAL_PR13_DIST_REQUIRED');
  const fastVetPath = path.resolve(pr13Dist, 'evaluation/fastVet.js');
  const shadowPath = path.resolve(pr13Dist, 'evaluation/fastVetShadow.js');
  invariant(fs.existsSync(fastVetPath) && fs.existsSync(shadowPath), 'FAST_VET_HISTORICAL_FROZEN_ANALYZER_MISSING');
  const [{ evaluateFastVet }, { evaluateFastVetShadow }] = await Promise.all([
    import(pathToFileURL(fastVetPath).href),
    import(pathToFileURL(shadowPath).href)
  ]);
  invariant(typeof evaluateFastVet === 'function' && typeof evaluateFastVetShadow === 'function', 'FAST_VET_HISTORICAL_FROZEN_ANALYZER_EXPORT_MISSING');
  return { evaluateFastVet, evaluateFastVetShadow };
}

export async function executeHistoricalSmoke({ replay, sourceReceiptSha256, pr13Dist }) {
  invariant(sourceReceiptSha256 === REPLAY_RECEIPT_SHA256, `FAST_VET_HISTORICAL_SOURCE_RECEIPT_SHA_DRIFT:${sourceReceiptSha256}`);
  const rows = validateReplay(replay);
  const analyzerRows = buildAnalyzerRows(rows);
  const { evaluateFastVet, evaluateFastVetShadow } = await loadFrozenAnalyzer(pr13Dist);

  const decisions = analyzerRows.map((row) => {
    const result = evaluateFastVet({ baseline: row.baseline, creatorFeature: row.creatorFeature });
    invariant(result.policyVersion === 'FAST_VET_R0', `FAST_VET_HISTORICAL_DECISION_POLICY_DRIFT:${row.ordinal}`);
    invariant(result.action === (result.decision === 'PASS' ? 'BUY_ELIGIBLE' : 'SKIP'), `FAST_VET_HISTORICAL_DECISION_ACTION_DRIFT:${row.ordinal}`);
    if (result.decision === 'UNKNOWN') invariant(result.action === 'SKIP', `FAST_VET_HISTORICAL_UNKNOWN_NOT_SKIP:${row.ordinal}`);
    return {
      ordinal: row.ordinal,
      launchId: row.launchId,
      creator: row.creator,
      decision: result.decision,
      action: result.action,
      reasons: result.reasons,
      creatorCoverage: row.creatorFeature.coverage,
      creatorPriorLaunchCount: row.creatorFeature.priorLaunchCount,
      creatorPriorOutcomeCountVisibleAtDecision: row.creatorFeature.outcomeReceiptCount,
      sourceOutcome: row.sourceOutcomeBinding
    };
  });

  const shadowRows = analyzerRows.map(({ launchId, baseline, creatorFeature, targetOutcome }) => ({ launchId, baseline, creatorFeature, targetOutcome }));
  const shadowReceipt = await evaluateFastVetShadow(shadowRows);
  invariant(shadowReceipt?.receiptVersion === 'FAST_VET_SHADOW_R0' && shadowReceipt?.status === 'SMOKE_ONLY' && shadowReceipt?.strategyLabel === 'EDGE_UNPROVEN', 'FAST_VET_HISTORICAL_SHADOW_IDENTITY_DRIFT');
  invariant(shadowReceipt?.metrics?.launchCount === 147, `FAST_VET_HISTORICAL_CONTROL_DENOMINATOR_DRIFT:${shadowReceipt?.metrics?.launchCount}`);
  invariant(shadowReceipt.metrics.passCount + shadowReceipt.metrics.rejectCount + shadowReceipt.metrics.unknownCount === 147, 'FAST_VET_HISTORICAL_DECISION_ACCOUNTING_DRIFT');

  const directCounts = decisions.reduce((acc, row) => {
    acc[row.decision] = (acc[row.decision] ?? 0) + 1;
    return acc;
  }, {});
  invariant((directCounts.PASS ?? 0) === shadowReceipt.metrics.passCount, 'FAST_VET_HISTORICAL_PASS_COUNT_MISMATCH');
  invariant((directCounts.REJECT ?? 0) === shadowReceipt.metrics.rejectCount, 'FAST_VET_HISTORICAL_REJECT_COUNT_MISMATCH');
  invariant((directCounts.UNKNOWN ?? 0) === shadowReceipt.metrics.unknownCount, 'FAST_VET_HISTORICAL_UNKNOWN_COUNT_MISMATCH');

  const outerCore = {
    schema: 'fast-vet-r0-historical-smoke-r1-receipt/v1',
    phase: PHASE,
    status: 'SMOKE_ONLY',
    strategyLabel: 'EDGE_UNPROVEN',
    scientificBoundary: 'DIRECTIONAL_HISTORICAL_SMOKE_ONLY_NO_PROMOTION',
    source: {
      replayReceiptSha256: sourceReceiptSha256,
      replayBaselinePolicyVersion: BASELINE_POLICY,
      replayOutcomePolicyVersion: OUTCOME_POLICY,
      replayLaunches: 147,
      replayHorizonCells: 735
    },
    frozenRule: {
      sourceHead: RULE_HEAD,
      decisionPolicyVersion: 'FAST_VET_R0',
      shadowReceiptVersion: 'FAST_VET_SHADOW_R0',
      primaryNotionalUsdMicros: PRIMARY_NOTIONAL_USD_MICROS.toString(),
      targetHorizonMs: TARGET_HORIZON_MS,
      unknownAction: 'SKIP'
    },
    adapter: {
      version: ADAPTER_VERSION,
      sourceMode: 'PINNED_REPAIRED_HISTORICAL_REPLAY_AGGREGATE_ONLY',
      noChainRefetch: true,
      noSqliteRunner: true,
      creatorHistoryOrder: 'FROZEN_CANONICAL_REPLAY_ORDINAL',
      creatorOutcomeAvailableRule: '24H_COMPLETE_AND_OBSERVED_BLOCK_LTE_TARGET_DECISION_BLOCK',
      projection: 'HISTORICAL_OUTCOME_TO_FROZEN_FORWARD_OUTCOMES_R1_ANALYZER_SHAPE_ONLY',
      projectionIsEvidenceAuthority: false,
      sourcePolicyIdentityPreservedInOuterReceipt: true
    },
    decisions,
    frozenShadowReceipt: canonicalize(shadowReceipt)
  };

  return {
    ...outerCore,
    evidenceDigest: digestObject(outerCore),
    verdict: 'FAST_VET_R0_HISTORICAL_SMOKE_R1_COMPLETE'
  };
}

async function main() {
  const inputPath = path.resolve(process.env.INPUT_PATH ?? 'historical-full-replay-r1-live-receipt.json');
  const outputPath = path.resolve(process.env.OUTPUT_PATH ?? 'fast-vet-r0-historical-smoke-r1-receipt.json');
  const pr13Dist = process.env.PR13_DIST ? path.resolve(process.env.PR13_DIST) : null;
  invariant(fs.existsSync(inputPath), `FAST_VET_HISTORICAL_INPUT_MISSING:${inputPath}`);
  const raw = fs.readFileSync(inputPath);
  const sourceReceiptSha256 = sha256HexBytes(raw);
  const replay = JSON.parse(raw.toString('utf8'));
  const receipt = await executeHistoricalSmoke({ replay, sourceReceiptSha256, pr13Dist });
  fs.writeFileSync(outputPath, `${JSON.stringify(canonicalize(receipt), null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    verdict: receipt.verdict,
    status: receipt.status,
    strategyLabel: receipt.strategyLabel,
    evidenceDigest: receipt.evidenceDigest,
    metrics: receipt.frozenShadowReceipt.metrics
  }, null, 2));
  console.log(`RECEIPT_PATH=${outputPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAST_VET_R0_HISTORICAL_SMOKE_R1=FAIL ${error.message}`);
    process.exit(1);
  });
}
