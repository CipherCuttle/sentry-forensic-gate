import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, defineChain, http } from 'viem';
import {
  CREATOR_OUTCOME_HORIZON_MS,
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ViemPonsV2ForwardOutcomeAdapter,
  findPortableFirstBlockAtOrAfterTimestamp,
  sha256Hex
} from '../dist/index.js';
import {
  COHORT_PLAN_SCHEMA,
  DEFAULT_COHORT_TARGET_COUNT,
  DEFAULT_CONFIRMATIONS,
  DEFAULT_SHARD_COUNT,
  EXPECTED_SOURCE_COMMIT,
  HORIZON_MS,
  assertReviewedSourceCheckout,
  launchLogKey,
  loadIndexedLaunchLogs,
  pacedClient,
  parsePositiveInteger,
  progress,
  rawLaunchLogToProvenanceFact,
  sha256Utf8,
  systematicOrdinalSample
} from './pons-s0-cohort-lib.mjs';

assertReviewedSourceCheckout();

const rpcUrl = process.env.PONS_S0_RPC_URL;
assert.ok(rpcUrl, 'PONS_S0_RPC_URL is required');
const launchLogsPath = process.env.PONS_S0_LAUNCH_LOGS_PATH;
assert.ok(
  launchLogsPath,
  'PONS_S0_LAUNCH_LOGS_PATH is required'
);
const outputDir =
  process.env.PONS_S0_PLAN_OUTPUT_DIR ?? 'cohort-plan';
const minRpcIntervalMs = parsePositiveInteger(
  process.env.PONS_S0_RPC_MIN_INTERVAL_MS ?? '650',
  'PONS_S0_RPC_MIN_INTERVAL_MS'
);
const confirmations = BigInt(
  process.env.PONS_S0_CONFIRMATIONS ?? DEFAULT_CONFIRMATIONS.toString()
);
const cohortTargetCount = parsePositiveInteger(
  process.env.PONS_S0_COHORT_TARGET_COUNT ??
    String(DEFAULT_COHORT_TARGET_COUNT),
  'PONS_S0_COHORT_TARGET_COUNT'
);
const shardCount = parsePositiveInteger(
  process.env.PONS_S0_SHARD_COUNT ?? String(DEFAULT_SHARD_COUNT),
  'PONS_S0_SHARD_COUNT'
);
assert.ok(confirmations >= 2n, 'PONS_S0_CONFIRMATIONS must be >= 2');
assert.ok(
  cohortTargetCount >= 40,
  'PONS_S0_COHORT_TARGET_COUNT must remain >= frozen minimum 40'
);

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});

const rawClient = createPublicClient({
  chain: robinhood,
  transport: http(rpcUrl, {
    retryCount: 4,
    retryDelay: 1_500,
    timeout: 90_000
  })
});
const client = pacedClient(rawClient, minRpcIntervalMs);

const chainId = await client.getChainId();
assert.equal(chainId, ROBINHOOD_CHAIN_ID, 'PONS_S0_CHAIN_ID_MISMATCH');

const runtimeHeadBlock = await client.getBlockNumber();
assert.ok(
  runtimeHeadBlock > CURRENT_PONS_V2_AUTHORITY.fromBlock + confirmations,
  'PONS_S0_HEAD_BEFORE_REVIEWED_EPOCH'
);
const frozenAsOfBlockRaw = process.env.PONS_S0_FROZEN_AS_OF_BLOCK;
const asOfBlock = frozenAsOfBlockRaw
  ? BigInt(frozenAsOfBlockRaw)
  : runtimeHeadBlock - confirmations;
const headBlock = frozenAsOfBlockRaw
  ? asOfBlock + confirmations
  : runtimeHeadBlock;
assert.ok(
  runtimeHeadBlock >= headBlock,
  'PONS_S0_RUNTIME_HEAD_BEFORE_FROZEN_AS_OF_CONFIRMATION_HEAD'
);
const asOfRaw = await client.getBlock({ blockNumber: asOfBlock });
assert.ok(asOfRaw.hash, 'PONS_S0_AS_OF_BLOCK_HASH_MISSING');
const asOfBlockHash = asOfRaw.hash.toLowerCase();
const asOfTimestampMs = Number(asOfRaw.timestamp) * 1000;
assert.ok(
  Number.isSafeInteger(asOfTimestampMs) && asOfTimestampMs > 0,
  'PONS_S0_AS_OF_TIMESTAMP_INVALID'
);

const fixedNow = () => asOfTimestampMs;
const forwardAdapter = new ViemPonsV2ForwardOutcomeAdapter({
  ponsAuthority: CURRENT_PONS_V2_AUTHORITY,
  curveTemplateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  usdAuthority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  outcomeAuthority: CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  client
});

const asOfPoint = await forwardAdapter.getBlockPoint(asOfBlock);
assert.equal(
  asOfPoint.blockHash.toLowerCase(),
  asOfBlockHash,
  'PONS_S0_AS_OF_POINT_HASH_MISMATCH'
);
assert.equal(asOfPoint.timestampMs, asOfTimestampMs);

const maturityCutoffTimestampMs = asOfTimestampMs - HORIZON_MS;
const firstImmaturePoint = await findPortableFirstBlockAtOrAfterTimestamp(
  forwardAdapter,
  CURRENT_PONS_V2_AUTHORITY.fromBlock,
  asOfBlock,
  maturityCutoffTimestampMs + 1
);
assert.ok(
  firstImmaturePoint,
  'PONS_S0_MATURITY_BOUNDARY_NOT_FOUND_AT_FROZEN_AS_OF'
);
assert.ok(
  firstImmaturePoint.blockNumber > CURRENT_PONS_V2_AUTHORITY.fromBlock,
  'PONS_S0_NO_MATURE_FACTORY_EPOCH_AT_FROZEN_AS_OF'
);
const matureThroughBlock = firstImmaturePoint.blockNumber - 1n;
const matureThroughPoint = await forwardAdapter.getBlockPoint(
  matureThroughBlock
);
assert.ok(
  matureThroughPoint.timestampMs <= maturityCutoffTimestampMs,
  'PONS_S0_MATURE_THROUGH_TIMESTAMP_AFTER_CUTOFF'
);
assert.ok(
  firstImmaturePoint.timestampMs > maturityCutoffTimestampMs,
  'PONS_S0_FIRST_IMMATURE_TIMESTAMP_NOT_AFTER_CUTOFF'
);

const launchIndex = await loadIndexedLaunchLogs({
  path: launchLogsPath,
  authorityFromBlock: CURRENT_PONS_V2_AUTHORITY.fromBlock,
  matureThroughBlock
});
const expectedLaunchIndexSha256 =
  process.env.PONS_S0_FROZEN_LAUNCH_INDEX_SHA256 ?? null;
if (expectedLaunchIndexSha256 !== null) {
  assert.equal(
    launchIndex.sha256,
    expectedLaunchIndexSha256,
    'PONS_S0_FROZEN_LAUNCH_INDEX_SHA256_MISMATCH'
  );
  assert.equal(
    launchIndex.observedHeadBlock,
    headBlock,
    'PONS_S0_FROZEN_LAUNCH_INDEX_HEAD_MISMATCH'
  );
}
const rawLaunchLogs = launchIndex.logs;
assert.ok(
  rawLaunchLogs.length > 0,
  'PONS_S0_NO_MATURE_LAUNCHES_AT_FROZEN_AS_OF'
);
assert.ok(
  launchIndex.observedHeadBlock >= matureThroughBlock,
  'PONS_S0_LAUNCH_INDEX_BEHIND_MATURITY_BOUNDARY'
);

const rawLogKeys = new Set(
  rawLaunchLogs.map((log) => launchLogKey(log))
);
assert.equal(
  rawLogKeys.size,
  rawLaunchLogs.length,
  'PONS_S0_DUPLICATE_RAW_LAUNCH_LOG'
);

const matureLaunchUniverseEvidenceDigest = await sha256Hex({
  kind: 'PONS_S0_MATURE_LAUNCH_UNIVERSE_V1',
  authorityId: CURRENT_PONS_V2_AUTHORITY.authorityId,
  authorityFromBlock: CURRENT_PONS_V2_AUTHORITY.fromBlock,
  matureThroughBlock,
  matureThroughBlockHash: matureThroughPoint.blockHash,
  maturityCutoffTimestampMs,
  launchCount: rawLaunchLogs.length,
  launchIndexSha256: launchIndex.sha256,
  logs: rawLaunchLogs.map((log) => ({
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex: log.logIndex,
    token: log.args.token.toLowerCase(),
    deployer: log.args.deployer.toLowerCase()
  }))
});

const selectedRawLogs = systematicOrdinalSample(
  rawLaunchLogs,
  cohortTargetCount
);
const selectedRawKeys = new Set(
  selectedRawLogs.map((log) => launchLogKey(log))
);
assert.equal(
  selectedRawKeys.size,
  selectedRawLogs.length,
  'PONS_S0_SYSTEMATIC_SAMPLE_DUPLICATE'
);

const selectedCreators = new Set(
  selectedRawLogs.map((log) => log.args.deployer.toLowerCase())
);
const relevantRawLogs = rawLaunchLogs.filter((log) =>
  selectedRawKeys.has(launchLogKey(log)) ||
  selectedCreators.has(log.args.deployer.toLowerCase())
);
progress('UNIVERSE_FACTS', {
  relevantRawLogCount: relevantRawLogs.length
});
const blockHashCache = new Map();
const universeFacts = [];
const UNIVERSE_FACT_BATCH_SIZE = 256;
for (
  let offset = 0;
  offset < relevantRawLogs.length;
  offset += UNIVERSE_FACT_BATCH_SIZE
) {
  const batch = relevantRawLogs.slice(
    offset,
    offset + UNIVERSE_FACT_BATCH_SIZE
  );
  const batchFacts = await Promise.all(
    batch.map((log) =>
      rawLaunchLogToProvenanceFact(log, client, blockHashCache)
    )
  );
  universeFacts.push(...batchFacts);
  progress('UNIVERSE_FACTS', {
    done: Math.min(offset + batch.length, relevantRawLogs.length),
    total: relevantRawLogs.length
  });
}
const factByLaunch = new Map(
  universeFacts.map((fact) => [fact.launchId, fact])
);
assert.equal(
  factByLaunch.size,
  universeFacts.length,
  'PONS_S0_DUPLICATE_RELEVANT_LAUNCH_ID'
);

const cohortSelection =
  rawLaunchLogs.length <= cohortTargetCount
    ? 'COMPLETE_MATURE_FACTORY_UNIVERSE'
    : 'SYSTEMATIC_ORDINAL_SAMPLE_OVER_COMPLETE_MATURE_FACTORY_UNIVERSE_V1';

const selectedBlockKeys = new Set(
  selectedRawLogs.map((log) => log.blockNumber.toString())
);

const planCore = {
  schemaVersion: COHORT_PLAN_SCHEMA,
  source: {
    repository: 'CipherCuttle/sentry-forensic-gate',
    repositoryCommit: EXPECTED_SOURCE_COMMIT
  },
  chainId: ROBINHOOD_CHAIN_ID,
  factory,
  authorityFromBlock: CURRENT_PONS_V2_AUTHORITY.fromBlock.toString(),
  asOf: {
    block: asOfBlock.toString(),
    blockHash: asOfBlockHash,
    timestampMs: asOfTimestampMs
  },
  confirmations: confirmations.toString(),
  horizonMs: HORIZON_MS,
  outcomeHorizonMs: CREATOR_OUTCOME_HORIZON_MS,
  maturityCutoffTimestampMs,
  matureThroughBlock: matureThroughBlock.toString(),
  matureThroughBlockHash: matureThroughPoint.blockHash.toLowerCase(),
  matureThroughTimestampMs: matureThroughPoint.timestampMs,
  headObservedBlock: headBlock.toString(),
  runtimeHeadObservedBlock: runtimeHeadBlock.toString(),
  launchIndexSha256: launchIndex.sha256,
  launchDiscoveryHeadBlock: launchIndex.observedHeadBlock.toString(),
  launchDiscoveryThroughBlock: launchIndex.scannedThroughBlock.toString(),
  matureUniverseLaunchCount: rawLaunchLogs.length,
  matureLaunchUniverseEvidenceDigest,
  cohortTargetCount,
  selectedLaunchCount: selectedRawLogs.length,
  cohortSelection,
  cohortSelectionRule:
    'k=min(N,96); index_i=floor(i*(N-1)/(k-1)); endpoints included',
  targetPerformanceInspectedForSelection: false,
  shardCount,
  selectedRawLogs: selectedRawLogs.map((log) => ({
    blockNumber: log.blockNumber.toString(),
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
    token: log.args.token,
    deployer: log.args.deployer
  })),
  universeFactCount: universeFacts.length
};
const planDigest = await sha256Hex({
  kind: 'PONS_S0_COHORT_PLAN_V1',
  planCore
});
const plan = {
  ...planCore,
  universeFacts,
  planDigest
};

await mkdir(outputDir, { recursive: true });
const planText = encodeJson(plan) + '\n';
await writeFile(outputDir + '/plan.json', planText, 'utf8');

// Per-shard mini launch indexes: raw logs for the shard's selected blocks so
// the local RPC proxy can serve single-block eth_getLogs without the full
// chronology artifact.
const rawLogsByBlock = new Map();
{
  const raw = await readFile(launchLogsPath, 'utf8');
  const parsed = JSON.parse(raw);
  for (const item of parsed.logs) {
    const blockKey = BigInt(item.blockNumber).toString();
    if (!selectedBlockKeys.has(blockKey)) continue;
    let bucket = rawLogsByBlock.get(blockKey);
    if (!bucket) {
      bucket = [];
      rawLogsByBlock.set(blockKey, bucket);
    }
    bucket.push(item);
  }
}
assert.equal(
  rawLogsByBlock.size,
  selectedBlockKeys.size,
  'PONS_S0_MINI_INDEX_BLOCK_COVERAGE_MISMATCH'
);

const perShard = Math.ceil(selectedRawLogs.length / shardCount);
const shardAssignments = [];
for (let shard = 0; shard < shardCount; shard += 1) {
  const slice = selectedRawLogs.slice(
    shard * perShard,
    Math.min((shard + 1) * perShard, selectedRawLogs.length)
  );
  const blockKeys = [...new Set(slice.map((log) => log.blockNumber.toString()))];
  const logs = [];
  for (const blockKey of blockKeys) {
    logs.push(...rawLogsByBlock.get(blockKey));
  }
  const miniIndex = {
    schema: 'ROBINHOOD_RPC_PONS_S0_LAUNCH_INDEX_V1',
    factory: CURRENT_PONS_V2_AUTHORITY.factory,
    eventTopic: process.env.PONS_S0_EVENT_TOPIC,
    scannedFromBlock: CURRENT_PONS_V2_AUTHORITY.fromBlock.toString(),
    scannedThroughBlock: matureThroughBlock.toString(),
    observedHeadBlock: launchIndex.observedHeadBlock.toString(),
    logs
  };
  await writeFile(
    `${outputDir}/mini-index-shard-${String(shard + 1).padStart(2, '0')}.json`,
    JSON.stringify(miniIndex, null, 2) + '\n',
    'utf8'
  );
}

const planFileSha256 = sha256Utf8(planText);
const prepareReceipt = {
  schemaVersion: 'PONS_S0_COHORT_PLAN_RECEIPT_V1',
  planFileSha256,
  planDigest,
  selectedLaunchCount: selectedRawLogs.length,
  universeFactCount: universeFacts.length,
  matureUniverseLaunchCount: rawLaunchLogs.length,
  matureLaunchUniverseEvidenceDigest,
  launchIndexSha256: launchIndex.sha256,
  shardCount,
  shardLaunchCounts: Array.from(
    { length: shardCount },
    (_value, shard) =>
      selectedRawLogs.slice(
        shard * perShard,
        Math.min((shard + 1) * perShard, selectedRawLogs.length)
      ).length
  )
};
await writeFile(
  outputDir + '/prepare-receipt.json',
  JSON.stringify(prepareReceipt, null, 2) + '\n',
  'utf8'
);

console.log(JSON.stringify(prepareReceipt, null, 2));