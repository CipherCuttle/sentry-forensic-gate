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

const MAP_PATH = resolve(process.env.AUTHORITY_MAP_PATH ?? 'historical-full-replay-authority-map-r1-decoded.json');
const COMPAT_PATH = resolve('fixtures/historical-compatibility-r1.json');
const OUTPUT_PATH = resolve(process.env.OUTPUT_PATH ?? 'historical-full-replay-r1-shard.json');
const DECISION_DELAY_BLOCKS = 2n;
const OUTCOME_CONFIRMATIONS = 2n;
const SCOPE_DIGEST = 'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211';
const MAP_DIGEST = 'c5346e572255385acd1744552633d5ad533d86d3821a8d857a432471e6022275';
const EXPECTED_HORIZONS = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '24h', ms: 86_400_000 }
] as const;

if (process.env.SHADOW_ONLY !== 'true') throw new Error('HISTORICAL_FULL_REPLAY_REQUIRES_SHADOW_ONLY_TRUE');
if (JSON.stringify(OUTCOME_HORIZONS) !== JSON.stringify(EXPECTED_HORIZONS)) {
  throw new Error(`HISTORICAL_FULL_REPLAY_HORIZON_DRIFT:${JSON.stringify(OUTCOME_HORIZONS)}`);
}
const startOrdinal = Number(process.env.SHARD_START_ORDINAL);
const endOrdinal = Number(process.env.SHARD_END_ORDINAL);
if (!Number.isInteger(startOrdinal) || !Number.isInteger(endOrdinal) || startOrdinal < 1 || endOrdinal > 147 || startOrdinal > endOrdinal) {
  throw new Error(`HISTORICAL_FULL_REPLAY_INVALID_SHARD_RANGE:${startOrdinal}:${endOrdinal}`);
}

type MapRow = {
  ordinal: number;
  event: string;
  blockNumber: string;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  tokenId: string;
  token: string;
  creator: string;
  implementation: Hex;
};
type AuthorityMap = {
  schema: string;
  sourceScopeIdentitySha256: string;
  launchCount: number;
  cohortCount: number;
  authorityMapSha256: string;
  rows: MapRow[];
};
type Compatibility = {
  historical_executable_tuple: { npm: Hex; factory: Hex; quoterV2: Hex; weth: Hex };
};

const map = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) as AuthorityMap;
if (map.schema !== 'historical-full-replay-authority-map-r1/v1' || map.launchCount !== 147 || map.rows?.length !== 147) {
  throw new Error('HISTORICAL_FULL_REPLAY_AUTHORITY_MAP_INVALID');
}
if (map.sourceScopeIdentitySha256 !== SCOPE_DIGEST || map.authorityMapSha256 !== MAP_DIGEST) {
  throw new Error('HISTORICAL_FULL_REPLAY_AUTHORITY_MAP_DIGEST_DRIFT');
}
const compatibility = JSON.parse(fs.readFileSync(COMPAT_PATH, 'utf8')) as Compatibility;
const rows = map.rows.slice(startOrdinal - 1, endOrdinal);
if (rows.length !== endOrdinal - startOrdinal + 1 || rows.some((row, index) => row.ordinal !== startOrdinal + index)) {
  throw new Error('HISTORICAL_FULL_REPLAY_SHARD_ORDINAL_DRIFT');
}

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const firstAuthority = makeReadAuthority(rows[0]!.implementation, compatibility.historical_executable_tuple);
const headProbe = new HistoricalRedstoneOutcomeSource({ rpcUrl, authority: firstAuthority });
const headBlock = await headProbe.getHeadBlockNumber();
if (headBlock < OUTCOME_CONFIRMATIONS) throw new Error(`HISTORICAL_FULL_REPLAY_HEAD_TOO_LOW:${headBlock}`);
const confirmedHeadPoint = await headProbe.getBlockPoint(headBlock - OUTCOME_CONFIRMATIONS);

const receiptRows: Array<Record<string, unknown>> = [];
let baselineComplete = 0;
let baselineUnverified = 0;
let outcomesAttempted = 0;
let outcomesComplete = 0;
let outcomesUnverified = 0;
let outcomesNotAttemptedBaselineUnverified = 0;

for (const expected of rows) {
  const launchBlock = BigInt(expected.blockNumber);
  const tokenId = BigInt(expected.tokenId);
  const decisionBlock = launchBlock + DECISION_DELAY_BLOCKS;
  const authority = makeReadAuthority(expected.implementation, compatibility.historical_executable_tuple);
  const authorizeExecutableBlock = makeScopedAuthorizer(launchBlock, decisionBlock);

  const launchSource = new ViemSentryLaunchSource({ rpcUrl, allowUnavailableGenericLaunchTypeFlags: true });
  const launches = await launchSource.catchUp(launchBlock, launchBlock);
  const matches = launches.filter((launch) => launch.tokenId === tokenId);
  if (matches.length !== 1) {
    throw new Error(`HISTORICAL_FULL_REPLAY_LAUNCH_IDENTITY_COUNT:ordinal=${expected.ordinal}:block=${launchBlock}:tokenId=${tokenId}:count=${matches.length}`);
  }
  const launch = matches[0]!;
  assertLaunchIdentity(expected, launch);

  const baselineSource = new HistoricalRedstoneBaselineSource({ rpcUrl, authority });
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
    ordinal: expected.ordinal,
    implementation: expected.implementation,
    launchBlock,
    tokenId,
    launchId: launch.launchId,
    token: launch.token,
    creator: launch.creator,
    baselineId: baseline.baselineId,
    baselinePolicyVersion: baseline.policyVersion,
    baselineStatus: baseline.status,
    outcomes: outcomeRows
  };

  if (baseline.status !== 'COMPLETE') {
    baselineUnverified += 1;
    row.baselineReason = baseline.reason;
    for (const horizon of OUTCOME_HORIZONS) {
      outcomesNotAttemptedBaselineUnverified += 1;
      outcomeRows.push({
        horizonLabel: horizon.label,
        horizonMs: horizon.ms,
        status: 'NOT_ATTEMPTED_BASELINE_UNVERIFIED',
        reason: baseline.reason
      });
    }
    receiptRows.push(row);
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
      outcomeRows.push({ horizonLabel: horizon.label, horizonMs: horizon.ms, status: 'UNVERIFIED', reason: 'UNEXPECTED_NULL' });
      continue;
    }
    if (outcome.horizonMs !== horizon.ms || outcome.policyVersion !== HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1) {
      throw new Error(`HISTORICAL_FULL_REPLAY_OUTCOME_POLICY_DRIFT:ordinal=${expected.ordinal}:horizon=${horizon.label}`);
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
  receiptRows.push(row);
}

const horizonCellsAccounted = receiptRows.reduce((sum, row) => sum + ((row.outcomes as unknown[])?.length ?? 0), 0);
const expectedLaunches = endOrdinal - startOrdinal + 1;
const accountingPass =
  receiptRows.length === expectedLaunches &&
  horizonCellsAccounted === expectedLaunches * OUTCOME_HORIZONS.length &&
  baselineComplete + baselineUnverified === expectedLaunches &&
  outcomesAttempted + outcomesNotAttemptedBaselineUnverified === expectedLaunches * OUTCOME_HORIZONS.length &&
  outcomesComplete + outcomesUnverified === outcomesAttempted;

const receipt = {
  schema: 'historical-full-replay-r1-shard-receipt/v1',
  phase: 'HISTORICAL_FULL_REPLAY_R1',
  stage: 'STAGE_B_FULL_REPLAY_SHARD',
  sourceMode: 'LIVE_ARCHIVE_RPC_REVIEWED_HISTORICAL_PIPELINES',
  shadowOnly: true,
  sourceScopeIdentitySha256: SCOPE_DIGEST,
  authorityMapSha256: MAP_DIGEST,
  shard: { startOrdinal, endOrdinal },
  baselinePolicyVersion: HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1,
  outcomePolicyVersion: HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1,
  horizons: OUTCOME_HORIZONS,
  launchesAccounted: receiptRows.length,
  baselineComplete,
  baselineUnverified,
  horizonCellsAccounted,
  outcomesAttempted,
  outcomesComplete,
  outcomesUnverified,
  outcomesNotAttemptedBaselineUnverified,
  rows: receiptRows,
  verdict: accountingPass ? 'HISTORICAL_FULL_REPLAY_SHARD_ACCOUNTING_PASS' : 'HISTORICAL_FULL_REPLAY_SHARD_ACCOUNTING_FAIL'
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(jsonSafe(receipt), null, 2)}\n`, 'utf8');
console.log(JSON.stringify(jsonSafe({
  verdict: receipt.verdict,
  shard: receipt.shard,
  launchesAccounted: receipt.launchesAccounted,
  baselineComplete,
  baselineUnverified,
  horizonCellsAccounted,
  outcomesComplete,
  outcomesUnverified,
  outcomesNotAttemptedBaselineUnverified
}), null, 2));
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
if (!accountingPass) process.exitCode = 1;

function makeReadAuthority(sentryImplementation: Hex, tuple: Compatibility['historical_executable_tuple']): ReadAuthorityContext {
  return { sentryImplementation, npm: tuple.npm, factory: tuple.factory, quoterV2: tuple.quoterV2, weth: tuple.weth };
}
function makeScopedAuthorizer(launchBlock: bigint, decisionBlock: bigint): ExecutableBlockAuthorizer {
  const allowed = new Set([launchBlock.toString(), decisionBlock.toString()]);
  return (blockNumber: bigint): void => {
    if (!allowed.has(blockNumber.toString())) {
      throw new Error(`HISTORICAL_FULL_REPLAY_SCOPE_VIOLATION:block=${blockNumber}:launch=${launchBlock}:decision=${decisionBlock}`);
    }
  };
}
function assertLaunchIdentity(expected: MapRow, launch: {
  blockNumber: bigint; blockHash: string; txHash: string; logIndex: number; tokenId: bigint; token: string; creator: string; sourceEvent: string;
}): void {
  const checks: Array<[string, string, string]> = [
    ['blockNumber', launch.blockNumber.toString(), expected.blockNumber],
    ['blockHash', launch.blockHash.toLowerCase(), expected.blockHash.toLowerCase()],
    ['transactionHash', launch.txHash.toLowerCase(), expected.transactionHash.toLowerCase()],
    ['logIndex', String(launch.logIndex), String(expected.logIndex)],
    ['tokenId', launch.tokenId.toString(), expected.tokenId],
    ['token', launch.token.toLowerCase(), expected.token.toLowerCase()],
    ['creator', launch.creator.toLowerCase(), expected.creator.toLowerCase()],
    ['event', launch.sourceEvent, expected.event]
  ];
  for (const [field, actual, wanted] of checks) {
    if (actual !== wanted) throw new Error(`HISTORICAL_FULL_REPLAY_LAUNCH_IDENTITY_DRIFT:ordinal=${expected.ordinal}:field=${field}:actual=${actual}:expected=${wanted}`);
  }
}
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key,item]) => [key,jsonSafe(item)]));
  }
  return value;
}
