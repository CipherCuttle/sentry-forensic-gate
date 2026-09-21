import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  defineChain,
  http
} from 'viem';
import {
  CREATOR_OUTCOME_HORIZON_MS,
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  PONS_S0_EXPORT_MANIFEST_V1,
  PONS_S0_FEATURE_PACKET_V1,
  PONS_S0_OUTCOME_PACKET_V1,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildNormalizedProvenanceFact,
  buildPonsS0FeaturePacket,
  buildPonsS0OutcomePacket,
  buildPonsS0ResearchExportBundle,
  buildPortableBaselineBatch,
  buildPortableForwardOutcome,
  ponsV2TokenLaunchedEvent,
  projectPortableCreatorOutcomeFeature,
  projectPortableOutcomeReceipt,
  sha256Hex
} from '../dist/index.js';

const SOURCE_REPOSITORY = 'CipherCuttle/sentry-forensic-gate';
const EXPECTED_SOURCE_COMMIT =
  '493c85b8d84565cedf6e936063549edfa02edf3a';
const MATERIALIZER_ID = 'PONS_S0_REAL_COHORT_MATERIALIZER_V1';
const ORIGIN_RECEIPT_SCHEMA = 'PONS_S0_EXTERNAL_ORIGIN_RECEIPT_V1';
const HORIZON_MS = 86_400_000;
const DEFAULT_CONFIRMATIONS = 12n;
const DEFAULT_LOG_CHUNK_BLOCKS = 1_000_000n;

const rpcUrl = process.env.PONS_S0_RPC_URL;
assert.ok(rpcUrl, 'PONS_S0_RPC_URL is required');

const sourceCommit =
  process.env.PONS_S0_SOURCE_COMMIT ?? EXPECTED_SOURCE_COMMIT;
assert.equal(
  sourceCommit,
  EXPECTED_SOURCE_COMMIT,
  'PONS_S0_SOURCE_COMMIT must remain pinned to the reviewed PR-A head'
);

const actualSourceCommit = execFileSync(
  'git',
  ['rev-parse', 'HEAD'],
  { encoding: 'utf8' }
).trim();
assert.equal(
  actualSourceCommit,
  EXPECTED_SOURCE_COMMIT,
  'materializer must execute against the exact reviewed PR-A source commit'
);

const outputDir =
  process.env.PONS_S0_OUTPUT_DIR ?? 'artifacts/pons-s0-real-cohort';
const minRpcIntervalMs = parsePositiveInteger(
  process.env.PONS_S0_RPC_MIN_INTERVAL_MS ?? '650',
  'PONS_S0_RPC_MIN_INTERVAL_MS'
);
const confirmations = BigInt(
  process.env.PONS_S0_CONFIRMATIONS ?? DEFAULT_CONFIRMATIONS.toString()
);
const logChunkBlocks = BigInt(
  process.env.PONS_S0_LOG_CHUNK_BLOCKS ?? DEFAULT_LOG_CHUNK_BLOCKS.toString()
);
assert.ok(confirmations >= 2n, 'PONS_S0_CONFIRMATIONS must be >= 2');
assert.ok(logChunkBlocks > 0n, 'PONS_S0_LOG_CHUNK_BLOCKS must be > 0');

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

const headBlock = await client.getBlockNumber();
assert.ok(
  headBlock > CURRENT_PONS_V2_AUTHORITY.fromBlock + confirmations,
  'PONS_S0_HEAD_BEFORE_REVIEWED_EPOCH'
);
const asOfBlock = headBlock - confirmations;
const asOfRaw = await client.getBlock({ blockNumber: asOfBlock });
assert.ok(asOfRaw.hash, 'PONS_S0_AS_OF_BLOCK_HASH_MISSING');
const asOfBlockHash = asOfRaw.hash.toLowerCase();
const asOfTimestampMs = Number(asOfRaw.timestamp) * 1000;
assert.ok(
  Number.isSafeInteger(asOfTimestampMs) && asOfTimestampMs > 0,
  'PONS_S0_AS_OF_TIMESTAMP_INVALID'
);

const fixedNow = () => asOfTimestampMs;
const launchAdapter = new ViemPonsV2LaunchAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  client,
  now: fixedNow
});
const quoteAdapter = new ViemPonsV2CurveQuoteAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  templateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  client,
  now: fixedNow
});
const usdAdapter = new ViemRobinhoodUsdCalibrationAdapter({
  authority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  client
});
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
  'PONS_S0_AS_OF_FORWARD_POINT_HASH_MISMATCH'
);
assert.equal(
  asOfPoint.timestampMs,
  asOfTimestampMs,
  'PONS_S0_AS_OF_FORWARD_POINT_TIMESTAMP_MISMATCH'
);

const rawLaunchLogs = await scanLaunchLogs({
  client,
  fromBlock: CURRENT_PONS_V2_AUTHORITY.fromBlock,
  toBlock: asOfBlock,
  chunkBlocks: logChunkBlocks
});

const rawLogKeys = new Set(
  rawLaunchLogs.map((log) => launchLogKey(log))
);
assert.equal(
  rawLogKeys.size,
  rawLaunchLogs.length,
  'PONS_S0_DUPLICATE_RAW_LAUNCH_LOG'
);

const launchBlocks = [
  ...new Set(rawLaunchLogs.map((log) => log.blockNumber.toString()))
]
  .map((value) => BigInt(value))
  .sort(compareBigInt);

const launches = [];
for (const blockNumber of launchBlocks) {
  const blockLaunches = await launchAdapter.catchUp(blockNumber, blockNumber);
  for (const launch of blockLaunches) {
    const key = [
      launch.blockNumber.toString(),
      launch.txHash.toLowerCase(),
      String(launch.logIndex)
    ].join(':');
    if (!rawLogKeys.has(key)) {
      throw new Error('PONS_S0_MATERIALIZED_LAUNCH_NOT_IN_SCANNED_LOG_SET:' + key);
    }
    launches.push(launch);
  }
}

launches.sort(compareLaunches);
const launchIds = new Set(launches.map((launch) => launch.launchId));
assert.equal(
  launchIds.size,
  launches.length,
  'PONS_S0_DUPLICATE_MATERIALIZED_LAUNCH_ID'
);
assert.equal(
  launches.length,
  rawLaunchLogs.length,
  'PONS_S0_LAUNCH_SCAN_CARDINALITY_MISMATCH'
);

const matureLaunches = [];
for (const launch of launches) {
  const launchBlock = await client.getBlock({ blockNumber: launch.blockNumber });
  assert.ok(launchBlock.hash, 'PONS_S0_LAUNCH_BLOCK_HASH_MISSING');
  assert.equal(
    launchBlock.hash.toLowerCase(),
    launch.blockHash.toLowerCase(),
    'PONS_S0_LAUNCH_BLOCK_HASH_DRIFT:' + launch.launchId
  );
  const launchTimestampMs = Number(launchBlock.timestamp) * 1000;
  if (launchTimestampMs + HORIZON_MS <= asOfTimestampMs) {
    matureLaunches.push(launch);
  }
}

assert.ok(
  matureLaunches.length > 0,
  'PONS_S0_NO_MATURE_LAUNCHES_AT_FROZEN_AS_OF'
);

const facts = await Promise.all(
  matureLaunches.map((launch) => buildNormalizedProvenanceFact(launch))
);
const factByLaunch = new Map(
  facts.map((fact) => [fact.launchId, fact])
);

const featurePackets = [];
const outcomePackets = [];
const projectedOutcomeReceipts = [];
const baselineStatusCounts = { COMPLETE: 0, UNVERIFIED: 0 };
const outcomeStatusCounts = {
  COMPLETE: 0,
  UNVERIFIED: 0,
  ABSENT_BASELINE_UNVERIFIED: 0
};

for (let index = 0; index < matureLaunches.length; index += 1) {
  const launch = matureLaunches[index];
  const baseline = await buildPortableBaselineBatch(
    {
      launch: launchAdapter,
      marketQuotes: quoteAdapter,
      usdCalibration: usdAdapter
    },
    launch,
    fixedNow
  );
  baselineStatusCounts[baseline.status] += 1;

  const targetFact = factByLaunch.get(launch.launchId);
  assert.ok(targetFact, 'PONS_S0_TARGET_FACT_MISSING:' + launch.launchId);

  const priorFacts = facts
    .slice(0, index)
    .filter((fact) =>
      fact.creator.toLowerCase() === targetFact.creator.toLowerCase()
    );

  const creatorFeature = await projectPortableCreatorOutcomeFeature(
    baseline,
    targetFact,
    priorFacts,
    projectedOutcomeReceipts
  );

  const featurePacket = await buildPonsS0FeaturePacket({
    launch,
    baseline,
    creatorFeature,
    provenanceEdges: []
  });
  featurePackets.push(featurePacket);

  const portableOutcome = await buildPortableForwardOutcome(
    forwardAdapter,
    launch,
    baseline,
    CREATOR_OUTCOME_HORIZON_MS,
    asOfPoint
  );
  if (!portableOutcome) {
    outcomeStatusCounts.ABSENT_BASELINE_UNVERIFIED += 1;
    continue;
  }

  const projectedOutcome = await projectPortableOutcomeReceipt(portableOutcome);
  projectedOutcomeReceipts.push(projectedOutcome);

  const outcomePacket = await buildPonsS0OutcomePacket({
    launch,
    baseline,
    outcome: portableOutcome
  });
  outcomePackets.push(outcomePacket);
  outcomeStatusCounts[portableOutcome.status] += 1;
}

assert.equal(
  featurePackets.length,
  matureLaunches.length,
  'PONS_S0_FEATURE_COHORT_CARDINALITY_MISMATCH'
);

const bundle = await buildPonsS0ResearchExportBundle({
  featurePackets,
  outcomePackets
});

assert.equal(bundle.manifest.schemaVersion, PONS_S0_EXPORT_MANIFEST_V1);
assert.equal(bundle.manifest.featureSchema, PONS_S0_FEATURE_PACKET_V1);
assert.equal(bundle.manifest.outcomeSchema, PONS_S0_OUTCOME_PACKET_V1);
assert.equal(
  bundle.manifest.featurePacketCount,
  matureLaunches.length,
  'PONS_S0_MANIFEST_FEATURE_COUNT_MISMATCH'
);
assert.equal(bundle.manifest.liveMoneyAuthority, false);
assert.equal(bundle.manifest.edge, 'UNPROVEN');

await mkdir(outputDir, { recursive: true });

const featurePath = outputDir + '/features.jsonl';
const outcomePath = outputDir + '/outcomes.jsonl';
const manifestPath = outputDir + '/manifest.json';
const originPath = outputDir + '/origin-receipt.json';
const summaryPath = outputDir + '/summary.json';

const manifestText = JSON.stringify(jsonSafe(bundle.manifest), null, 2) + '\n';
await writeFile(featurePath, bundle.featuresJsonl, 'utf8');
await writeFile(outcomePath, bundle.outcomesJsonl, 'utf8');
await writeFile(manifestPath, manifestText, 'utf8');

const materializerBytes = await readFile(fileURLToPath(import.meta.url));
const materializerSha256 = sha256Bytes(materializerBytes);
const manifestFileSha256 = sha256Utf8(manifestText);

const originCore = {
  schemaVersion: ORIGIN_RECEIPT_SCHEMA,
  source: {
    repository: SOURCE_REPOSITORY,
    repositoryCommit: EXPECTED_SOURCE_COMMIT,
    sourceTreeVerifiedByGit: true
  },
  exportContract: {
    feature: PONS_S0_FEATURE_PACKET_V1,
    outcome: PONS_S0_OUTCOME_PACKET_V1,
    manifest: PONS_S0_EXPORT_MANIFEST_V1
  },
  artifacts: {
    featureStreamSha256: bundle.manifest.featureStreamSha256,
    outcomeStreamSha256: bundle.manifest.outcomeStreamSha256,
    manifestFileSha256,
    manifestId: bundle.manifest.manifestId,
    manifestEvidenceDigest: bundle.manifest.evidenceDigest,
    featurePacketCount: bundle.manifest.featurePacketCount,
    outcomePacketCount: bundle.manifest.outcomePacketCount
  },
  frozenAuthority: {
    chainId: ROBINHOOD_CHAIN_ID,
    ponsAuthorityId: CURRENT_PONS_V2_AUTHORITY.authorityId,
    factory: CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(),
    authorityFromBlock: CURRENT_PONS_V2_AUTHORITY.fromBlock.toString(),
    asOfBlock: asOfBlock.toString(),
    asOfBlockHash,
    asOfTimestampMs,
    headObservedBlock: headBlock.toString(),
    confirmations: confirmations.toString(),
    maturityHorizonMs: HORIZON_MS,
    cohortSelection:
      'COMPLETE_REVIEWED_FACTORY_EPOCH_LAUNCH_UNIVERSE_MATURE_AT_24H_AS_OF_FROZEN_BLOCK',
    targetPerformanceInspectedForSelection: false
  },
  materialization: {
    materializerId: MATERIALIZER_ID,
    materializerSha256,
    command: 'node scripts/pons-s0-real-cohort-materialize.mjs',
    harnessRepository:
      process.env.PONS_S0_HARNESS_REPOSITORY ?? SOURCE_REPOSITORY,
    harnessCommit:
      process.env.PONS_S0_HARNESS_COMMIT ?? null,
    rpcTransportClass: 'PUBLIC_READ_ONLY_ARCHIVE_RPC',
    logScanChunkBlocks: logChunkBlocks.toString(),
    minRpcIntervalMs
  },
  boundaries: {
    readOnly: true,
    signer: false,
    wallet: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoneyAuthority: false,
    modelPromotionAuthority: false,
    mergeAuthority: false,
    edge: 'UNPROVEN'
  }
};
const originEvidenceDigest = await sha256Hex(originCore);
const originReceipt = {
  ...originCore,
  evidenceDigest: originEvidenceDigest
};
const originText = JSON.stringify(originReceipt, null, 2) + '\n';
await writeFile(originPath, originText, 'utf8');

const summary = {
  verdict: 'REAL_COHORT_READY_FOR_QNTYLAB',
  scientificState: 'EDGE_UNPROVEN',
  asOfBlock: asOfBlock.toString(),
  asOfBlockHash,
  asOfTimestampMs,
  scannedLaunchCount: launches.length,
  matureLaunchCount: matureLaunches.length,
  featurePacketCount: featurePackets.length,
  outcomePacketCount: outcomePackets.length,
  baselineStatusCounts,
  outcomeStatusCounts,
  manifestId: bundle.manifest.manifestId,
  originEvidenceDigest,
  boundaries: originReceipt.boundaries
};
await writeFile(
  summaryPath,
  JSON.stringify(summary, null, 2) + '\n',
  'utf8'
);

console.log(JSON.stringify(summary, null, 2));

async function scanLaunchLogs(input) {
  const logs = [];
  let fromBlock = input.fromBlock;
  while (fromBlock <= input.toBlock) {
    const toBlock = minBigInt(
      input.toBlock,
      fromBlock + input.chunkBlocks - 1n
    );
    const rangeLogs = await getLogsAdaptive(
      input.client,
      fromBlock,
      toBlock
    );
    logs.push(...rangeLogs);
    fromBlock = toBlock + 1n;
  }
  return logs.sort(compareLogs);
}

async function getLogsAdaptive(client, fromBlock, toBlock) {
  try {
    return await client.getLogs({
      address: CURRENT_PONS_V2_AUTHORITY.factory,
      event: ponsV2TokenLaunchedEvent,
      fromBlock,
      toBlock,
      strict: true
    });
  } catch (error) {
    if (fromBlock === toBlock) throw error;
    const midpoint = fromBlock + ((toBlock - fromBlock) / 2n);
    const left = await getLogsAdaptive(client, fromBlock, midpoint);
    const right = await getLogsAdaptive(client, midpoint + 1n, toBlock);
    return [...left, ...right];
  }
}

function launchLogKey(log) {
  assert.ok(log.blockNumber !== null, 'PONS_S0_LOG_BLOCK_MISSING');
  assert.ok(log.transactionHash, 'PONS_S0_LOG_TX_HASH_MISSING');
  assert.ok(log.logIndex !== null, 'PONS_S0_LOG_INDEX_MISSING');
  return [
    log.blockNumber.toString(),
    log.transactionHash.toLowerCase(),
    String(log.logIndex)
  ].join(':');
}

function compareLogs(a, b) {
  assert.ok(a.blockNumber !== null && b.blockNumber !== null);
  assert.ok(a.logIndex !== null && b.logIndex !== null);
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }
  return a.logIndex - b.logIndex;
}

function compareLaunches(a, b) {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.launchId.localeCompare(b.launchId);
}

function compareBigInt(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function minBigInt(a, b) {
  return a < b ? a : b;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  assert.ok(
    Number.isSafeInteger(parsed) && parsed > 0,
    label + ' must be a positive safe integer'
  );
  return parsed;
}

function sha256Utf8(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pacedClient(rawClient, minIntervalMs) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;

  const paced = (operation) => {
    const run = tail.then(async () => {
      const waitMs = Math.max(
        0,
        lastStartedAt + minIntervalMs - Date.now()
      );
      if (waitMs > 0) await sleep(waitMs);
      lastStartedAt = Date.now();
      return operation();
    });
    tail = run.catch(() => undefined);
    return run;
  };

  return new Proxy(rawClient, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof value !== 'function' ||
        ![
          'getChainId',
          'getBlockNumber',
          'getBlock',
          'getBytecode',
          'getLogs',
          'getStorageAt',
          'readContract',
          'call'
        ].includes(String(property))
      ) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (...args) => paced(() => value.apply(target, args));
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)])
    );
  }
  return value;
}
