import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  createPublicClient,
  defineChain,
  http
} from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPortableBaselineBatch,
  buildPortableForwardOutcome,
  buildPonsS0FeaturePacket,
  buildPonsS0OutcomePacket,
  buildPonsS0ResearchExportBundle,
  canonicalJson,
  ponsV2TokenLaunchedEvent,
  sha256Hex
} from '../dist/index.js';

const SCHEMA = 'PONS_S0_HISTORICAL_COHORT_ORIGIN_V1';
const SELECTION_SCHEMA = 'PONS_S0_HISTORICAL_COHORT_SELECTION_V1';
const SOURCE_COMMIT = process.env.SENTRY_SOURCE_COMMIT;
const OUTPUT_DIR = resolve(process.env.PONS_S0_COHORT_OUTPUT_DIR ?? 'artifacts/pons-s0-historical-cohort-v1');
const RPC_URL = process.env.PONS_S0_COHORT_RPC_URL ?? 'https://rpc.nodeflare.app/robinhood/public';
const MIN_RPC_INTERVAL_MS = Number(process.env.PONS_S0_COHORT_RPC_MIN_INTERVAL_MS ?? '650');

const CHAIN_ID = 4663;
const FROM_BLOCK = 63_500_000n;
const THROUGH_BLOCK_EXCLUSIVE = 67_500_000n;
const BUCKET_BLOCKS = 50_000n;
const LOG_CHUNK_BLOCKS = 5_000n;
const CONFIRMATIONS = 2n;
const HORIZON_MS = 86_400_000;
const EXPECTED_BUCKETS = Number((THROUGH_BLOCK_EXCLUSIVE - FROM_BLOCK) / BUCKET_BLOCKS);

assert.match(
  SOURCE_COMMIT ?? '',
  /^[0-9a-f]{40}$/i,
  'SENTRY_SOURCE_COMMIT must be the exact 40-character source commit'
);
assert.equal(EXPECTED_BUCKETS, 80, 'PONS_S0_COHORT_BUCKET_COUNT_DRIFT');
assert.ok(Number.isSafeInteger(MIN_RPC_INTERVAL_MS) && MIN_RPC_INTERVAL_MS >= 100);

const robinhood = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } }
});

const rawClient = createPublicClient({
  chain: robinhood,
  transport: http(RPC_URL, {
    retryCount: 3,
    retryDelay: 1_500,
    timeout: 120_000
  })
});
const client = pacedClient(rawClient, MIN_RPC_INTERVAL_MS);

const forwardAdapter = new ViemPonsV2ForwardOutcomeAdapter({
  ponsAuthority: CURRENT_PONS_V2_AUTHORITY,
  curveTemplateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  usdAuthority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  outcomeAuthority: CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  client
});

await mkdir(OUTPUT_DIR, { recursive: true });

const selectionRule = Object.freeze({
  schema: SELECTION_SCHEMA,
  chainId: CHAIN_ID,
  factory: CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(),
  fromBlockInclusive: FROM_BLOCK.toString(),
  throughBlockExclusive: THROUGH_BLOCK_EXCLUSIVE.toString(),
  bucketBlocks: BUCKET_BLOCKS.toString(),
  logChunkBlocks: LOG_CHUNK_BLOCKS.toString(),
  expectedBucketCount: EXPECTED_BUCKETS,
  candidateRule: 'FIRST_NATIVE_PAIR_TOKEN_LAUNCHED_EVENT_PER_BUCKET',
  order: 'BLOCK_ASC_LOG_INDEX_ASC',
  nativePairToken: PONS_V2_NATIVE_PAIR_TOKEN.toLowerCase(),
  targetHorizonMs: HORIZON_MS,
  creatorFeaturePolicy: 'EXPLICIT_NULL_NO_HISTORICAL_CREATOR_BACKFILL_V1',
  outcomeIndependentSelection: true,
  mode: 'SHADOW_ONLY',
  liveMoneyAuthority: false,
  edge: 'UNPROVEN'
});
const selectionRuleDigest = await sha256Hex(selectionRule);

await assertWindowAuthorityAndMaturity();

const bucketSelections = [];
for (let bucketIndex = 0; bucketIndex < EXPECTED_BUCKETS; bucketIndex += 1) {
  const bucketFrom = FROM_BLOCK + BigInt(bucketIndex) * BUCKET_BLOCKS;
  const bucketThroughExclusive = bucketFrom + BUCKET_BLOCKS;
  const selection = await selectFirstNativeLaunchInBucket({
    bucketIndex,
    bucketFrom,
    bucketThroughExclusive
  });
  bucketSelections.push(selection);
  console.error(
    `bucket ${bucketIndex + 1}/${EXPECTED_BUCKETS}: ${selection.selected ? `block=${selection.selected.blockNumber} token=${selection.selected.token}` : 'EMPTY'}`
  );
}

const selected = bucketSelections
  .filter((bucket) => bucket.selected !== null)
  .map((bucket) => bucket.selected);

const selectionCore = {
  schema: SELECTION_SCHEMA,
  sourceCommit: SOURCE_COMMIT.toLowerCase(),
  selectionRule,
  selectionRuleDigest,
  selectedCount: selected.length,
  emptyBucketCount: bucketSelections.filter((bucket) => bucket.selected === null).length,
  buckets: bucketSelections,
  selected
};
const selectionEvidenceDigest = await sha256Hex(selectionCore);
const selectionReceipt = {
  ...selectionCore,
  evidenceDigest: selectionEvidenceDigest
};
const selectionPath = resolve(OUTPUT_DIR, 'selection.json');
await writeFile(selectionPath, `${canonicalJson(selectionReceipt)}\n`, 'utf8');

const featurePackets = [];
const outcomePackets = [];
const materializationRows = [];

for (let index = 0; index < selected.length; index += 1) {
  const selectedEvent = selected[index];
  console.error(
    `materialize ${index + 1}/${selected.length}: block=${selectedEvent.blockNumber} token=${selectedEvent.token}`
  );

  const launchBlock = BigInt(selectedEvent.blockNumber);
  const launchPoint = await forwardAdapter.getBlockPoint(launchBlock);
  const decisionBlock = launchBlock + 2n;
  const decisionPoint = await forwardAdapter.getBlockPoint(decisionBlock);

  const launchAdapter = new ViemPonsV2LaunchAdapter({
    authority: CURRENT_PONS_V2_AUTHORITY,
    client,
    now: () => launchPoint.timestampMs
  });
  const quoteAdapter = new ViemPonsV2CurveQuoteAdapter({
    authority: CURRENT_PONS_V2_AUTHORITY,
    templateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
    client,
    now: () => decisionPoint.timestampMs
  });
  const usdAdapter = new ViemRobinhoodUsdCalibrationAdapter({
    authority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
    client
  });

  const launches = await launchAdapter.catchUp(launchBlock, launchBlock);
  const launch = launches.find((candidate) =>
    candidate.logIndex === selectedEvent.logIndex &&
    candidate.token.toLowerCase() === selectedEvent.token.toLowerCase()
  );
  assert.ok(
    launch,
    `PONS_S0_COHORT_MATERIALIZATION_MISMATCH:block=${launchBlock}:log=${selectedEvent.logIndex}`
  );

  const baseline = await buildPortableBaselineBatch(
    {
      launch: launchAdapter,
      marketQuotes: quoteAdapter,
      usdCalibration: usdAdapter
    },
    launch,
    () => decisionPoint.timestampMs
  );

  // V1 deliberately does not reconstruct creator history from an incomplete
  // pre-window universe. Missing creator history stays explicit rather than
  // becoming false NO_HISTORY.
  const featurePacket = await buildPonsS0FeaturePacket({
    launch,
    baseline,
    creatorFeature: null,
    provenanceEdges: []
  });
  featurePackets.push(featurePacket);

  let portableOutcome = null;
  let outcomePacket = null;
  if (baseline.status === 'COMPLETE') {
    const headBlock = await forwardAdapter.getHeadBlockNumber();
    assert.ok(headBlock > CONFIRMATIONS, 'PONS_S0_COHORT_HEAD_BELOW_CONFIRMATIONS');
    const confirmedHead = await forwardAdapter.getBlockPoint(headBlock - CONFIRMATIONS);
    portableOutcome = await buildPortableForwardOutcome(
      forwardAdapter,
      launch,
      baseline,
      HORIZON_MS,
      confirmedHead
    );
    if (portableOutcome) {
      outcomePacket = await buildPonsS0OutcomePacket({
        launch,
        baseline,
        outcome: portableOutcome
      });
      outcomePackets.push(outcomePacket);
    }
  }

  materializationRows.push({
    bucketIndex: selectedEvent.bucketIndex,
    launchId: launch.launchId,
    eventId: launch.eventId,
    token: launch.token,
    creator: launch.creator,
    blockNumber: launch.blockNumber.toString(),
    blockHash: launch.blockHash,
    logIndex: launch.logIndex,
    decisionBlock: baseline.decisionBlock.toString(),
    decisionBlockHash: baseline.decisionBlockHash,
    baselineId: baseline.baselineId,
    baselineStatus: baseline.status,
    baselineReason: baseline.reason ?? null,
    featurePacketId: featurePacket.packetId,
    featureEvidenceDigest: featurePacket.evidenceDigest,
    creatorFeature: null,
    outcomeId: portableOutcome?.outcomeId ?? null,
    outcomeStatus: portableOutcome?.status ?? null,
    outcomeClassification: portableOutcome?.classification ?? null,
    outcomePacketId: outcomePacket?.packetId ?? null,
    outcomeEvidenceDigest: outcomePacket?.evidenceDigest ?? null
  });
}

const bundle = await buildPonsS0ResearchExportBundle({
  featurePackets,
  outcomePackets
});

const manifestPath = resolve(OUTPUT_DIR, 'manifest.json');
const featuresPath = resolve(OUTPUT_DIR, 'features.jsonl');
const outcomesPath = resolve(OUTPUT_DIR, 'outcomes.jsonl');
await Promise.all([
  writeFile(manifestPath, `${canonicalJson(bundle.manifest)}\n`, 'utf8'),
  writeFile(featuresPath, bundle.featuresJsonl, 'utf8'),
  writeFile(outcomesPath, bundle.outcomesJsonl, 'utf8')
]);

const headBlock = await forwardAdapter.getHeadBlockNumber();
const confirmedHead = await forwardAdapter.getBlockPoint(headBlock - CONFIRMATIONS);
const providerClass =
  RPC_URL === 'https://rpc.nodeflare.app/robinhood/public'
    ? 'NODEFLARE_PUBLIC_ARCHIVE'
    : 'CUSTOM_ARCHIVE_ENDPOINT_REDACTED';

const originCore = {
  schema: SCHEMA,
  sourceRepository: 'CipherCuttle/sentry-forensic-gate',
  sourceCommit: SOURCE_COMMIT.toLowerCase(),
  chainId: CHAIN_ID,
  acquisition: {
    providerClass,
    credentialRequired: false,
    rpcEndpointRecorded: providerClass === 'NODEFLARE_PUBLIC_ARCHIVE'
      ? RPC_URL
      : null,
    minRpcIntervalMs: MIN_RPC_INTERVAL_MS,
    confirmedHeadBlock: confirmedHead.blockNumber.toString(),
    confirmedHeadHash: confirmedHead.blockHash,
    confirmedHeadTimestampMs: confirmedHead.timestampMs
  },
  selection: {
    path: 'selection.json',
    evidenceDigest: selectionEvidenceDigest,
    ruleDigest: selectionRuleDigest,
    selectedCount: selected.length,
    expectedBucketCount: EXPECTED_BUCKETS
  },
  export: {
    manifestId: bundle.manifest.manifestId,
    manifestEvidenceDigest: bundle.manifest.evidenceDigest,
    featurePacketCount: bundle.manifest.featurePacketCount,
    outcomePacketCount: bundle.manifest.outcomePacketCount,
    featureStreamSha256: bundle.manifest.featureStreamSha256,
    outcomeStreamSha256: bundle.manifest.outcomeStreamSha256
  },
  materializationRows,
  limitations: {
    creatorHistory: 'EXPLICIT_NULL_NO_HISTORICAL_CREATOR_BACKFILL_V1',
    executionCost: 'UNVERIFIED_UNLESS_PRESENT_IN_SENTRY_OUTCOME_PACKET',
    modelEvaluation: false,
    promotionAuthority: 'NONE'
  },
  boundaries: {
    wallet: false,
    signer: false,
    approvals: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoney: false,
    mode: 'SHADOW_ONLY',
    edge: 'UNPROVEN'
  }
};
const originEvidenceDigest = await sha256Hex(originCore);
const origin = {
  ...originCore,
  evidenceDigest: originEvidenceDigest
};
const originPath = resolve(OUTPUT_DIR, 'origin.json');
await writeFile(originPath, `${canonicalJson(origin)}\n`, 'utf8');

console.log(JSON.stringify({
  verdict: 'PONS_S0_HISTORICAL_COHORT_MATERIALIZED',
  sourceCommit: SOURCE_COMMIT.toLowerCase(),
  selectionRuleDigest,
  selectionEvidenceDigest,
  originEvidenceDigest,
  selectedCount: selected.length,
  featurePacketCount: bundle.manifest.featurePacketCount,
  outcomePacketCount: bundle.manifest.outcomePacketCount,
  completeBaselineCount: materializationRows.filter((row) => row.baselineStatus === 'COMPLETE').length,
  completeOutcomeCount: materializationRows.filter((row) => row.outcomeStatus === 'COMPLETE').length,
  classifiedOutcomeCount: materializationRows.filter((row) => row.outcomeClassification !== null).length,
  outputDir: OUTPUT_DIR,
  liveMoneyAuthority: false,
  edge: 'UNPROVEN'
}, null, 2));

async function assertWindowAuthorityAndMaturity() {
  assert.ok(FROM_BLOCK >= CURRENT_PONS_V2_AUTHORITY.fromBlock);
  assert.ok(FROM_BLOCK >= CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY.fromBlock);
  assert.ok(FROM_BLOCK >= CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY.fromBlock);
  assert.ok(FROM_BLOCK >= CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY.fromBlock);

  const headBlock = await forwardAdapter.getHeadBlockNumber();
  assert.ok(headBlock > CONFIRMATIONS, 'PONS_S0_COHORT_HEAD_BELOW_CONFIRMATIONS');
  const confirmed = await forwardAdapter.getBlockPoint(headBlock - CONFIRMATIONS);
  const lastWindowPoint = await forwardAdapter.getBlockPoint(THROUGH_BLOCK_EXCLUSIVE - 1n);
  assert.ok(
    lastWindowPoint.timestampMs + HORIZON_MS <= confirmed.timestampMs,
    `PONS_S0_COHORT_WINDOW_NOT_MATURE:last=${lastWindowPoint.timestampMs}:confirmed=${confirmed.timestampMs}`
  );
}

async function selectFirstNativeLaunchInBucket({
  bucketIndex,
  bucketFrom,
  bucketThroughExclusive
}) {
  let scannedThrough = bucketFrom - 1n;
  for (
    let chunkFrom = bucketFrom;
    chunkFrom < bucketThroughExclusive;
    chunkFrom += LOG_CHUNK_BLOCKS
  ) {
    const chunkToCandidate = chunkFrom + LOG_CHUNK_BLOCKS - 1n;
    const chunkTo = chunkToCandidate < bucketThroughExclusive
      ? chunkToCandidate
      : bucketThroughExclusive - 1n;
    const logs = await client.getLogs({
      address: CURRENT_PONS_V2_AUTHORITY.factory,
      event: ponsV2TokenLaunchedEvent,
      fromBlock: chunkFrom,
      toBlock: chunkTo,
      strict: true
    });
    scannedThrough = chunkTo;
    const native = logs
      .filter((log) =>
        log.blockNumber !== null &&
        log.logIndex !== null &&
        typeof log.args?.token === 'string' &&
        typeof log.args?.pairToken === 'string' &&
        log.args.pairToken.toLowerCase() === PONS_V2_NATIVE_PAIR_TOKEN.toLowerCase()
      )
      .sort((a, b) => {
        if (a.blockNumber < b.blockNumber) return -1;
        if (a.blockNumber > b.blockNumber) return 1;
        return a.logIndex - b.logIndex;
      });
    if (native.length > 0) {
      const first = native[0];
      return {
        bucketIndex,
        bucketFrom: bucketFrom.toString(),
        bucketThroughExclusive: bucketThroughExclusive.toString(),
        scannedThrough: scannedThrough.toString(),
        selected: {
          bucketIndex,
          blockNumber: first.blockNumber.toString(),
          logIndex: first.logIndex,
          token: String(first.args.token).toLowerCase(),
          pairToken: String(first.args.pairToken).toLowerCase(),
          transactionHash: first.transactionHash?.toLowerCase() ?? null
        }
      };
    }
  }
  return {
    bucketIndex,
    bucketFrom: bucketFrom.toString(),
    bucketThroughExclusive: bucketThroughExclusive.toString(),
    scannedThrough: scannedThrough.toString(),
    selected: null
  };
}

function pacedClient(raw, intervalMs) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;

  const paced = (operation) => {
    const run = tail.then(async () => {
      const waitMs = Math.max(0, lastStartedAt + intervalMs - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      lastStartedAt = Date.now();
      return operation();
    });
    tail = run.catch(() => undefined);
    return run;
  };

  return new Proxy(raw, {
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
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
