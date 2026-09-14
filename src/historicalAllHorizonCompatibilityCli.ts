import fs from 'node:fs';
import { resolve } from 'node:path';
import type { Hex } from './domain.js';
import type { ReadAuthorityContext } from './authority/readAuthorityContext.js';
import { buildBaselineBatch, type ExecutableBlockAuthorizer } from './runtime/executableBaseline.js';
import {
  DEFAULT_BASELINE_NOTIONALS_USD_MICROS,
  HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1
} from './shadow/baselineTypes.js';
import { DEFAULT_INK_RPC_URL } from './sentry/contracts.js';
import { ViemSentryLaunchSource } from './sentry/viemSource.js';
import { HistoricalRedstoneBaselineSource } from './tsunami/historicalRedstoneBaselineSource.js';
import { OUTCOME_HORIZONS } from './outcome/horizons.js';
import {
  HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1,
  HistoricalRedstoneOutcomeSource,
  buildHistoricalForwardOutcome
} from './outcome/historicalRedstoneOutcomeSource.js';

const FIXTURE_PATH = resolve('fixtures/historical-compatibility-r1.json');
const OUTPUT_PATH = resolve(process.env.OUTPUT_PATH ?? 'historical-all-horizon-compatibility-r1-live-receipt.json');
const DECISION_DELAY_BLOCKS = 2n;
const OUTCOME_CONFIRMATIONS = 2n;
const EXPECTED_REPRESENTATIVES = 9;
const EXPECTED_HORIZONS = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '24h', ms: 86_400_000 }
] as const;
const EXPECTED_OUTCOME_CELLS = EXPECTED_REPRESENTATIVES * EXPECTED_HORIZONS.length;

if (process.env.SHADOW_ONLY !== 'true') throw new Error('HISTORICAL_ALL_HORIZON_COMPATIBILITY_REQUIRES_SHADOW_ONLY_TRUE');
if (JSON.stringify(OUTCOME_HORIZONS) !== JSON.stringify(EXPECTED_HORIZONS)) {
  throw new Error(`HISTORICAL_ALL_HORIZON_COMPATIBILITY_HORIZON_DRIFT:${JSON.stringify(OUTCOME_HORIZONS)}`);
}

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const fixture = parseFixture(JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as unknown);
if (fixture.representatives.length !== EXPECTED_REPRESENTATIVES) {
  throw new Error(`HISTORICAL_ALL_HORIZON_COMPATIBILITY_REPRESENTATIVE_COUNT:${fixture.representatives.length}`);
}

const firstAuthority = makeReadAuthority(fixture.representatives[0]!.implementation, fixture.historical_executable_tuple);
const headProbe = new HistoricalRedstoneOutcomeSource({ rpcUrl, authority: firstAuthority });
const headBlock = await headProbe.getHeadBlockNumber();
if (headBlock < OUTCOME_CONFIRMATIONS) throw new Error(`HISTORICAL_ALL_HORIZON_COMPATIBILITY_HEAD_TOO_LOW:${headBlock}`);
const confirmedHeadPoint = await headProbe.getBlockPoint(headBlock - OUTCOME_CONFIRMATIONS);

const rows: Array<Record<string, unknown>> = [];
let baselineAttempted = 0;
let baselineComplete = 0;
let baselineUnverified = 0;
let outcomesAttempted = 0;
let outcomesComplete = 0;
let outcomesUnverified = 0;

for (const representative of fixture.representatives) {
  const launchBlock = BigInt(representative.blockNumber);
  const tokenId = BigInt(representative.tokenId);
  const decisionBlock = launchBlock + DECISION_DELAY_BLOCKS;
  const authority = makeReadAuthority(representative.implementation, fixture.historical_executable_tuple);
  const authorizeExecutableBlock = makeScopedAuthorizer(launchBlock, decisionBlock);

  const launchSource = new ViemSentryLaunchSource({ rpcUrl, allowUnavailableGenericLaunchTypeFlags: true });
  const launches = await launchSource.catchUp(launchBlock, launchBlock);
  const matches = launches.filter((launch) => launch.tokenId === tokenId);
  if (matches.length !== 1) {
    throw new Error(`HISTORICAL_ALL_HORIZON_COMPATIBILITY_LAUNCH_IDENTITY_COUNT:block=${launchBlock}:tokenId=${tokenId}:count=${matches.length}`);
  }
  const launch = matches[0]!;

  const baselineSource = new HistoricalRedstoneBaselineSource({ rpcUrl, authority });
  baselineAttempted += 1;
  const baseline = await buildBaselineBatch(
    baselineSource,
    launch,
    DECISION_DELAY_BLOCKS,
    DEFAULT_BASELINE_NOTIONALS_USD_MICROS,
    authorizeExecutableBlock,
    HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1
  );

  const outcomeRows: Array<Record<string, unknown>> = [];
  const row: Record<string, unknown> = {
    implementation: representative.implementation,
    launchBlock,
    tokenId,
    launchId: launch.launchId,
    baselineId: baseline.baselineId,
    baselinePolicyVersion: baseline.policyVersion,
    baselineStatus: baseline.status,
    outcomes: outcomeRows
  };

  if (baseline.status !== 'COMPLETE') {
    baselineUnverified += 1;
    row.baselineReason = baseline.reason;
    rows.push(row);
    continue;
  }
  baselineComplete += 1;

  const source = new HistoricalRedstoneOutcomeSource({ rpcUrl, authority });
  for (const horizon of OUTCOME_HORIZONS) {
    outcomesAttempted += 1;
    const outcome = await buildHistoricalForwardOutcome(
      source,
      launch,
      baseline,
      horizon.ms,
      confirmedHeadPoint,
      authorizeExecutableBlock
    );

    if (!outcome) {
      outcomesUnverified += 1;
      outcomeRows.push({
        horizonLabel: horizon.label,
        horizonMs: horizon.ms,
        status: 'UNVERIFIED',
        reason: 'UNEXPECTED_NULL'
      });
      continue;
    }

    if (outcome.horizonMs !== horizon.ms) {
      throw new Error(`HISTORICAL_ALL_HORIZON_COMPATIBILITY_HORIZON_RECEIPT_DRIFT:label=${horizon.label}:expected=${horizon.ms}:actual=${outcome.horizonMs}`);
    }
    if (outcome.policyVersion !== HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1) {
      throw new Error(`HISTORICAL_ALL_HORIZON_COMPATIBILITY_POLICY_VERSION_DRIFT:${outcome.policyVersion}`);
    }

    const outcomeRow: Record<string, unknown> = {
      horizonLabel: horizon.label,
      horizonMs: horizon.ms,
      outcomeId: outcome.outcomeId,
      policyVersion: outcome.policyVersion,
      status: outcome.status,
      targetTimestampMs: outcome.targetTimestampMs,
      observedBlock: outcome.observedBlock,
      observedBlockHash: outcome.observedBlockHash,
      observedTimestampMs: outcome.observedTimestampMs,
      sellable: outcome.sellable,
      baseToken: outcome.baseToken,
      baseAmountOut: outcome.baseAmountOut,
      classification: outcome.classification,
      executableValueUsdMicros: outcome.executableValueUsdMicros,
      evidenceDigest: outcome.evidenceDigest
    };
    if (outcome.reason) outcomeRow.reason = outcome.reason;
    if (outcome.valuationEvidence) {
      outcomeRow.valuationKind = outcome.valuationEvidence.kind;
      outcomeRow.oracleAddress = outcome.valuationEvidence.oracleAddress;
      outcomeRow.oracleUpdatedAt = outcome.valuationEvidence.oracleUpdatedAt;
      outcomeRow.oracleAgeSeconds = outcome.valuationEvidence.ageSeconds;
    }
    outcomeRows.push(outcomeRow);

    if (outcome.status === 'COMPLETE') outcomesComplete += 1;
    else outcomesUnverified += 1;
  }
  rows.push(row);
}

const baselinePass = baselineAttempted === EXPECTED_REPRESENTATIVES && baselineComplete === EXPECTED_REPRESENTATIVES && baselineUnverified === 0;
const outcomePass = baselinePass && outcomesAttempted === EXPECTED_OUTCOME_CELLS && outcomesComplete === EXPECTED_OUTCOME_CELLS && outcomesUnverified === 0;
const receipt = {
  schema: 'historical-all-horizon-compatibility-r1-live-receipt/v1',
  phase: 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1',
  stage: 'IMPLEMENTATION_REPRESENTATIVE_ALL_HORIZON_GATE',
  sourceMode: 'LIVE_ARCHIVE_RPC_EXISTING_BASELINE_AND_OUTCOME_PIPELINES_REDSTONE_ASOF_VALUATION',
  shadowOnly: true,
  selectionRule: fixture.selection_rule,
  representativesAttempted: fixture.representatives.length,
  baselinePolicyVersion: HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1,
  outcomePolicyVersion: HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1,
  horizons: OUTCOME_HORIZONS,
  expectedOutcomeCells: EXPECTED_OUTCOME_CELLS,
  baselineAttempted,
  baselineComplete,
  baselineUnverified,
  outcomesAttempted,
  outcomesComplete,
  outcomesUnverified,
  rows,
  verdict: outcomePass ? 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS' : 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_FAIL'
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(jsonSafe(receipt), null, 2)}\n`, 'utf8');
console.log(JSON.stringify(jsonSafe(receipt), null, 2));
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
if (!outcomePass) process.exitCode = 1;

type Fixture = {
  schema: 'historical-compatibility-r1-fixtures/v1';
  selection_rule: string;
  historical_executable_tuple: { npm: Hex; factory: Hex; quoterV2: Hex; weth: Hex };
  representatives: Array<{ implementation: Hex; blockNumber: string; tokenId: string }>;
};

function parseFixture(value: unknown): Fixture {
  if (!value || typeof value !== 'object') throw new Error('HISTORICAL_ALL_HORIZON_COMPATIBILITY_FIXTURE_INVALID');
  const record = value as Partial<Fixture>;
  if (record.schema !== 'historical-compatibility-r1-fixtures/v1') {
    throw new Error(`HISTORICAL_ALL_HORIZON_COMPATIBILITY_FIXTURE_SCHEMA:${String(record.schema)}`);
  }
  if (!record.historical_executable_tuple || !Array.isArray(record.representatives)) {
    throw new Error('HISTORICAL_ALL_HORIZON_COMPATIBILITY_FIXTURE_INCOMPLETE');
  }
  return record as Fixture;
}

function makeReadAuthority(sentryImplementation: Hex, tuple: Fixture['historical_executable_tuple']): ReadAuthorityContext {
  return { sentryImplementation, npm: tuple.npm, factory: tuple.factory, quoterV2: tuple.quoterV2, weth: tuple.weth };
}

function makeScopedAuthorizer(launchBlock: bigint, decisionBlock: bigint): ExecutableBlockAuthorizer {
  const allowed = new Set([launchBlock.toString(), decisionBlock.toString()]);
  return (blockNumber: bigint): void => {
    if (!allowed.has(blockNumber.toString())) {
      throw new Error(`HISTORICAL_ALL_HORIZON_COMPATIBILITY_SCOPE_VIOLATION:block=${blockNumber}:launch=${launchBlock}:decision=${decisionBlock}`);
    }
  };
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
