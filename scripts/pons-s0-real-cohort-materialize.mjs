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
  derivePonsV2EventId,
  derivePonsV2LaunchId,
  findPortableFirstBlockAtOrAfterTimestamp,
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
const DEFAULT_COHORT_TARGET_COUNT = 96;

const rpcUrl = process.env.PONS_S0_RPC_URL;
assert.ok(rpcUrl, 'PONS_S0_RPC_URL is required');
const launchLogsPath = process.env.PONS_S0_LAUNCH_LOGS_PATH;
assert.ok(
  launchLogsPath,
  'PONS_S0_LAUNCH_LOGS_PATH is required'
);

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
const cohortTargetCount = parsePositiveInteger(
  process.env.PONS_S0_COHORT_TARGET_COUNT ??
    String(DEFAULT_COHORT_TARGET_COUNT),
  'PONS_S0_COHORT_TARGET_COUNT'
);
assert.ok(confirmations >= 2n, 'PONS_S0_CONFIRMATIONS must be >= 2');
assert.ok(logChunkBlocks > 0n, 'PONS_S0_LOG_CHUNK_BLOCKS must be > 0');
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
const blockHashCache = new Map();
const universeFacts = await Promise.all(
  relevantRawLogs.map((log) =>
    rawLaunchLogToProvenanceFact(log, client, blockHashCache)
  )
);
const factByLaunch = new Map(
  universeFacts.map((fact) => [fact.launchId, fact])
);
assert.equal(
  factByLaunch.size,
  universeFacts.length,
  'PONS_S0_DUPLICATE_RELEVANT_LAUNCH_ID'
);

const selectedLaunchBlocks = [
  ...new Set(selectedRawLogs.map((log) => log.blockNumber.toString()))
]
  .map((value) => BigInt(value))
  .sort(compareBigInt);

const selectedLaunches = [];
for (const blockNumber of selectedLaunchBlocks) {
  const blockLaunches = await launchAdapter.catchUp(
    blockNumber,
    blockNumber
  );
  for (const launch of blockLaunches) {
    const key = [
      launch.blockNumber.toString(),
      launch.txHash.toLowerCase(),
      String(launch.logIndex)
    ].join(':');
    if (selectedRawKeys.has(key)) selectedLaunches.push(launch);
  }
}

selectedLaunches.sort(compareLaunches);
const selectedLaunchIds = new Set(
  selectedLaunches.map((launch) => launch.launchId)
);
assert.equal(
  selectedLaunchIds.size,
  selectedLaunches.length,
  'PONS_S0_DUPLICATE_SELECTED_MATERIALIZED_LAUNCH_ID'
);
assert.equal(
  selectedLaunches.length,
  selectedRawLogs.length,
  'PONS_S0_SELECTED_LAUNCH_MATERIALIZATION_CARDINALITY_MISMATCH'
);
for (const launch of selectedLaunches) {
  assert.ok(
    factByLaunch.has(launch.launchId),
    'PONS_S0_SELECTED_LAUNCH_FACT_MISSING:' + launch.launchId
  );
}

const featurePackets = [];
const outcomePackets = [];
const projectedOutcomeReceipts = [];
const baselineStatusCounts = { COMPLETE: 0, UNVERIFIED: 0 };
const outcomeStatusCounts = {
  COMPLETE: 0,
  UNVERIFIED: 0,
  ABSENT_BASELINE_UNVERIFIED: 0
};

for (const launch of selectedLaunches) {
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

  const priorFacts = universeFacts.filter((fact) =>
    fact.creator.toLowerCase() === targetFact.creator.toLowerCase() &&
    (
      fact.observedBlock < launch.blockNumber ||
      (
        fact.observedBlock === launch.blockNumber &&
        fact.logIndex < launch.logIndex
      )
    )
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
  selectedLaunches.length,
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
  selectedLaunches.length,
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
    maturityCutoffTimestampMs,
    matureThroughBlock: matureThroughBlock.toString(),
    matureThroughBlockHash: matureThroughPoint.blockHash.toLowerCase(),
    matureUniverseLaunchCount: rawLaunchLogs.length,
    matureLaunchUniverseEvidenceDigest,
    cohortTargetCount,
    selectedLaunchCount: selectedLaunches.length,
    cohortSelection:
      rawLaunchLogs.length <= cohortTargetCount
        ? 'COMPLETE_MATURE_FACTORY_UNIVERSE'
        : 'SYSTEMATIC_ORDINAL_SAMPLE_OVER_COMPLETE_MATURE_FACTORY_UNIVERSE_V1',
    cohortSelectionRule:
      'k=min(N,96); index_i=floor(i*(N-1)/(k-1)); endpoints included',
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
    rpcTransportClass:
      'ROBINHOOD_OFFICIAL_PUBLIC_RPC_LOGS_PLUS_NODEFLARE_ARCHIVE_STATE_VIA_LOCAL_PROXY',
    launchDiscovery: 'ROBINHOOD_RPC_PONS_S0_LAUNCH_INDEX_V1',
    launchDiscoveryTransport:
      'ROBINHOOD_OFFICIAL_PUBLIC_RPC_TOPIC_FILTERED_LOGS',
    launchIndexSha256: launchIndex.sha256,
    launchDiscoveryHeadBlock:
      launchIndex.observedHeadBlock.toString(),
    launchDiscoveryThroughBlock:
      launchIndex.scannedThroughBlock.toString(),
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
  matureUniverseLaunchCount: rawLaunchLogs.length,
  matureLaunchUniverseEvidenceDigest,
  launchIndexSha256: launchIndex.sha256,
  launchDiscoveryHeadBlock:
    launchIndex.observedHeadBlock.toString(),
  cohortTargetCount,
  selectedLaunchCount: selectedLaunches.length,
  cohortSelection:
    rawLaunchLogs.length <= cohortTargetCount
      ? 'COMPLETE_MATURE_FACTORY_UNIVERSE'
      : 'SYSTEMATIC_ORDINAL_SAMPLE_OVER_COMPLETE_MATURE_FACTORY_UNIVERSE_V1',
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

async function rawLaunchLogToProvenanceFact(
  log,
  client,
  blockHashCache
) {
  assert.ok(log.blockNumber !== null, 'PONS_S0_LOG_BLOCK_MISSING');
  assert.ok(log.transactionHash, 'PONS_S0_LOG_TX_HASH_MISSING');
  assert.ok(log.logIndex !== null, 'PONS_S0_LOG_INDEX_MISSING');
  const args = log.args ?? {};
  assert.equal(
    typeof args.token,
    'string',
    'PONS_S0_LOG_TOKEN_MISSING'
  );
  assert.equal(
    typeof args.deployer,
    'string',
    'PONS_S0_LOG_DEPLOYER_MISSING'
  );

  const blockKey = log.blockNumber.toString();
  let blockHash = log.blockHash ?? blockHashCache.get(blockKey);
  if (!blockHash) {
    const block = await client.getBlock({
      blockNumber: log.blockNumber
    });
    assert.ok(
      block.hash,
      'PONS_S0_RELEVANT_LOG_BLOCK_HASH_MISSING:' + blockKey
    );
    blockHash = block.hash.toLowerCase();
  }
  blockHashCache.set(blockKey, blockHash);

  const factory = CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase();
  const txHash = log.transactionHash.toLowerCase();
  const token = args.token.toLowerCase();
  const creator = args.deployer.toLowerCase();
  const [launchId, eventId] = await Promise.all([
    derivePonsV2LaunchId({
      chainId: ROBINHOOD_CHAIN_ID,
      factory,
      txHash,
      token
    }),
    derivePonsV2EventId({
      chainId: ROBINHOOD_CHAIN_ID,
      factory,
      txHash,
      logIndex: log.logIndex
    })
  ]);
  return buildNormalizedProvenanceFact({
    chainId: ROBINHOOD_CHAIN_ID,
    launchId,
    creator,
    blockNumber: log.blockNumber,
    blockHash,
    logIndex: log.logIndex,
    eventId
  });
}

async function loadIndexedLaunchLogs(input) {
  const raw = await readFile(input.path);
  const sha256 = sha256Bytes(raw);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(
      'PONS_S0_LAUNCH_INDEX_MALFORMED:' +
      (error instanceof Error ? error.message : String(error))
    );
  }
  assert.equal(
    parsed.schema,
    'ROBINHOOD_RPC_PONS_S0_LAUNCH_INDEX_V1',
    'PONS_S0_LAUNCH_INDEX_SCHEMA_MISMATCH'
  );
  assert.equal(
    String(parsed.factory).toLowerCase(),
    CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(),
    'PONS_S0_LAUNCH_INDEX_FACTORY_MISMATCH'
  );
  assert.equal(
    BigInt(parsed.scannedFromBlock),
    input.authorityFromBlock,
    'PONS_S0_LAUNCH_INDEX_START_MISMATCH'
  );
  const scannedThroughBlock = BigInt(parsed.scannedThroughBlock);
  const observedHeadBlock = BigInt(
    parsed.observedHeadBlock
  );
  assert.ok(
    scannedThroughBlock >= input.matureThroughBlock,
    'PONS_S0_LAUNCH_INDEX_RANGE_TOO_SHORT'
  );
  assert.ok(
    observedHeadBlock >= input.matureThroughBlock,
    'PONS_S0_LAUNCH_INDEX_BEHIND_MATURITY_BOUNDARY'
  );
  assert.ok(
    Array.isArray(parsed.logs),
    'PONS_S0_LAUNCH_INDEX_LOGS_MISSING'
  );

  const logs = parsed.logs
    .map((item) => {
      assert.ok(
        item && typeof item === 'object' && !Array.isArray(item),
        'PONS_S0_LAUNCH_INDEX_LOG_INVALID'
      );
      const blockNumber = BigInt(item.blockNumber);
      const logIndex = Number(item.logIndex);
      assert.ok(
        Number.isSafeInteger(logIndex) && logIndex >= 0,
        'PONS_S0_LAUNCH_INDEX_LOG_INDEX_INVALID'
      );
      assert.match(
        String(item.blockHash),
        /^0x[0-9a-fA-F]{64}$/,
        'PONS_S0_LAUNCH_INDEX_BLOCK_HASH_INVALID'
      );
      assert.match(
        String(item.transactionHash),
        /^0x[0-9a-fA-F]{64}$/,
        'PONS_S0_LAUNCH_INDEX_TX_INVALID'
      );
      assert.match(
        String(item.token),
        /^0x[0-9a-fA-F]{40}$/,
        'PONS_S0_LAUNCH_INDEX_TOKEN_INVALID'
      );
      assert.match(
        String(item.deployer),
        /^0x[0-9a-fA-F]{40}$/,
        'PONS_S0_LAUNCH_INDEX_DEPLOYER_INVALID'
      );
      return {
        blockNumber,
        blockHash: String(item.blockHash).toLowerCase(),
        transactionHash: String(item.transactionHash).toLowerCase(),
        logIndex,
        args: {
          token: String(item.token).toLowerCase(),
          deployer: String(item.deployer).toLowerCase()
        }
      };
    })
    .filter((log) =>
      log.blockNumber >= input.authorityFromBlock &&
      log.blockNumber <= input.matureThroughBlock
    )
    .sort(compareLogs);

  return {
    sha256,
    scannedThroughBlock,
    observedHeadBlock,
    logs
  };
}

function systematicOrdinalSample(items, targetCount) {
  assert.ok(items.length > 0, 'PONS_S0_SAMPLE_EMPTY_UNIVERSE');
  const count = Math.min(items.length, targetCount);
  if (count === items.length) return [...items];
  if (count === 1) return [items[0]];
  const selected = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(
      (i * (items.length - 1)) / (count - 1)
    );
    selected.push(items[index]);
  }
  return selected;
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
