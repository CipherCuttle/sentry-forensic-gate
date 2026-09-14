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
import {
  HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1,
  HistoricalRedstoneOutcomeSource,
  buildHistoricalForwardOutcome
} from './outcome/historicalRedstoneOutcomeSource.js';

const FIXTURE_PATH = resolve('fixtures/historical-compatibility-r1.json');
const OUTPUT_PATH = resolve(process.env.OUTPUT_PATH ?? 'historical-outcome-policy-r1-live-receipt.json');
const DECISION_DELAY_BLOCKS = 2n;
const OUTCOME_HORIZON_MS = 86_400_000;
const OUTCOME_CONFIRMATIONS = 2n;
const EXPECTED_REPRESENTATIVES = 9;
const EXPECTED_OBSERVED_BLOCKS = [
  40029876n,
  40118660n,
  42146879n,
  44224383n,
  45720972n,
  45900260n,
  46697772n,
  46723560n,
  46753934n
];

if (process.env.SHADOW_ONLY !== 'true') throw new Error('HISTORICAL_OUTCOME_POLICY_REQUIRES_SHADOW_ONLY_TRUE');

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const fixture = parseFixture(JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as unknown);
if (fixture.representatives.length !== EXPECTED_REPRESENTATIVES) {
  throw new Error(`HISTORICAL_OUTCOME_POLICY_REPRESENTATIVE_COUNT:${fixture.representatives.length}`);
}

const firstAuthority = makeReadAuthority(fixture.representatives[0]!.implementation, fixture.historical_executable_tuple);
const headProbe = new HistoricalRedstoneOutcomeSource({ rpcUrl, authority: firstAuthority });
const headBlock = await headProbe.getHeadBlockNumber();
if (headBlock < OUTCOME_CONFIRMATIONS) throw new Error(`HISTORICAL_OUTCOME_POLICY_HEAD_TOO_LOW:${headBlock}`);
const confirmedHeadPoint = await headProbe.getBlockPoint(headBlock - OUTCOME_CONFIRMATIONS);

const rows: Array<Record<string, unknown>> = [];
let baselineAttempted = 0;
let baselineComplete = 0;
let baselineUnverified = 0;
let outcomesAttempted = 0;
let outcomesComplete = 0;
let outcomesUnverified = 0;

for (const [index, representative] of fixture.representatives.entries()) {
  const launchBlock = BigInt(representative.blockNumber);
  const tokenId = BigInt(representative.tokenId);
  const decisionBlock = launchBlock + DECISION_DELAY_BLOCKS;
  const authority = makeReadAuthority(representative.implementation, fixture.historical_executable_tuple);
  const authorizeExecutableBlock = makeScopedAuthorizer(launchBlock, decisionBlock);

  const launchSource = new ViemSentryLaunchSource({ rpcUrl, allowUnavailableGenericLaunchTypeFlags: true });
  const launches = await launchSource.catchUp(launchBlock, launchBlock);
  const matches = launches.filter((launch) => launch.tokenId === tokenId);
  if (matches.length !== 1) {
    throw new Error(`HISTORICAL_OUTCOME_POLICY_LAUNCH_IDENTITY_COUNT:block=${launchBlock}:tokenId=${tokenId}:count=${matches.length}`);
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

  const row: Record<string, unknown> = {
    implementation: representative.implementation,
    launchBlock,
    tokenId,
    launchId: launch.launchId,
    baselineId: baseline.baselineId,
    baselinePolicyVersion: baseline.policyVersion,
    baselineStatus: baseline.status
  };

  if (baseline.status !== 'COMPLETE') {
    baselineUnverified += 1;
    row.outcome24hStatus = 'NOT_ATTEMPTED_BASELINE_UNVERIFIED';
    row.baselineReason = baseline.reason;
    rows.push(row);
    continue;
  }
  baselineComplete += 1;

  const source = new HistoricalRedstoneOutcomeSource({ rpcUrl, authority });
  outcomesAttempted += 1;
  const outcome = await buildHistoricalForwardOutcome(
    source,
    launch,
    baseline,
    OUTCOME_HORIZON_MS,
    confirmedHeadPoint,
    authorizeExecutableBlock
  );
  if (!outcome) {
    outcomesUnverified += 1;
    row.outcome24hStatus = 'UNVERIFIED';
    row.outcome24hReason = 'UNEXPECTED_NULL';
    rows.push(row);
    continue;
  }

  const expectedObservedBlock = EXPECTED_OBSERVED_BLOCKS[index]!;
  if (outcome.observedBlock !== expectedObservedBlock) {
    throw new Error(`HISTORICAL_OUTCOME_POLICY_OBSERVED_BLOCK_DRIFT:index=${index}:expected=${expectedObservedBlock}:actual=${outcome.observedBlock}`);
  }
  if (outcome.policyVersion !== HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1) {
    throw new Error(`HISTORICAL_OUTCOME_POLICY_VERSION_DRIFT:${outcome.policyVersion}`);
  }

  row.outcomeId = outcome.outcomeId;
  row.outcomePolicyVersion = outcome.policyVersion;
  row.outcome24hStatus = outcome.status;
  row.outcome24hObservedBlock = outcome.observedBlock;
  row.outcome24hSellable = outcome.sellable;
  row.outcome24hClassification = outcome.classification;
  row.outcome24hExecutableValueUsdMicros = outcome.executableValueUsdMicros;
  row.outcome24hEvidenceDigest = outcome.evidenceDigest;
  if (outcome.valuationEvidence) {
    row.outcomeValuationKind = outcome.valuationEvidence.kind;
    row.outcomeOracleAgeSeconds = outcome.valuationEvidence.ageSeconds;
    row.outcomeOracleUpdatedAt = outcome.valuationEvidence.oracleUpdatedAt;
  }
  if (outcome.reason) row.outcome24hReason = outcome.reason;

  if (outcome.status === 'COMPLETE') outcomesComplete += 1;
  else outcomesUnverified += 1;
  rows.push(row);
}

const baselinePass = baselineAttempted === 9 && baselineComplete === 9 && baselineUnverified === 0;
const outcomePass = baselinePass && outcomesAttempted === 9 && outcomesComplete === 9 && outcomesUnverified === 0;
const receipt = {
  schema: 'historical-outcome-policy-r1-live-receipt/v1',
  phase: 'HISTORICAL_OUTCOME_POLICY_R1',
  stage: 'IMPLEMENTATION_REPRESENTATIVE_GATE',
  sourceMode: 'LIVE_ARCHIVE_RPC_EXISTING_OUTCOME_PIPELINE_REDSTONE_ASOF_VALUATION',
  shadowOnly: true,
  policyVersion: HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1,
  selectionRule: fixture.selection_rule,
  representativesAttempted: fixture.representatives.length,
  baselinePolicyVersion: HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1,
  baselineAttempted,
  baselineComplete,
  baselineUnverified,
  outcomeHorizonMs: OUTCOME_HORIZON_MS,
  expectedObservedBlocks: EXPECTED_OBSERVED_BLOCKS,
  outcomes24hAttempted: outcomesAttempted,
  outcomes24hComplete: outcomesComplete,
  outcomes24hUnverified: outcomesUnverified,
  rows,
  verdict: outcomePass ? 'HISTORICAL_OUTCOME_POLICY_PASS' : 'HISTORICAL_OUTCOME_POLICY_FAIL'
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
  if (!value || typeof value !== 'object') throw new Error('HISTORICAL_OUTCOME_POLICY_FIXTURE_INVALID');
  const record = value as Partial<Fixture>;
  if (record.schema !== 'historical-compatibility-r1-fixtures/v1') throw new Error(`HISTORICAL_OUTCOME_POLICY_FIXTURE_SCHEMA:${String(record.schema)}`);
  if (!record.historical_executable_tuple || !Array.isArray(record.representatives)) throw new Error('HISTORICAL_OUTCOME_POLICY_FIXTURE_INCOMPLETE');
  return record as Fixture;
}

function makeReadAuthority(sentryImplementation: Hex, tuple: Fixture['historical_executable_tuple']): ReadAuthorityContext {
  return { sentryImplementation, npm: tuple.npm, factory: tuple.factory, quoterV2: tuple.quoterV2, weth: tuple.weth };
}

function makeScopedAuthorizer(launchBlock: bigint, decisionBlock: bigint): ExecutableBlockAuthorizer {
  const allowed = new Set([launchBlock.toString(), decisionBlock.toString()]);
  return (blockNumber: bigint): void => {
    if (!allowed.has(blockNumber.toString())) {
      throw new Error(`HISTORICAL_OUTCOME_POLICY_SCOPE_VIOLATION:block=${blockNumber}:launch=${launchBlock}:decision=${decisionBlock}`);
    }
  };
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}
