import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, defineChain, http } from 'viem';
import {
  CREATOR_OUTCOME_HORIZON_MS,
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPonsS0FeaturePacket,
  buildPonsS0OutcomePacket,
  buildPonsS0ResearchExportBundle,
  buildPortableBaselineBatch,
  buildPortableForwardOutcome
} from '../dist/index.js';

const SCHEMA = 'PONS_S0_REAL_COHORT_V1';
const COHORT_FROM_BLOCK = 65_000_000n;
const COHORT_THROUGH_BLOCK = 67_000_000n;
const DISCOVERY_CHUNK_BLOCKS = 20_000n;
const TARGET_LAUNCH_COUNT = 80;
const CONFIRMATIONS = 2n;
const CREATOR_FEATURE_POLICY = 'MISSING_V1_NO_RETROSPECTIVE_CREATOR_ENRICHMENT';
const EXECUTION_COST_POLICY = 'UNVERIFIED_V1_NO_FULL_PATH_COST_RECEIPT';

const rpcUrl = process.env.PONS_S0_RPC_URL;
assert.ok(rpcUrl, 'PONS_S0_RPC_URL is required');
const captureMsRaw = process.env.PONS_S0_CAPTURE_MS;
assert.ok(captureMsRaw && /^\d+$/.test(captureMsRaw), 'PONS_S0_CAPTURE_MS is required');
const captureMs = Number(captureMsRaw);
assert.ok(Number.isSafeInteger(captureMs) && captureMs > 0, 'PONS_S0_CAPTURE_MS invalid');

const outputDir = resolve(process.env.PONS_S0_OUTPUT_DIR ?? 'artifacts/pons-s0-real-cohort');
await mkdir(outputDir, { recursive: true });

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});
const client = createPublicClient({
  chain: robinhood,
  transport: http(rpcUrl, {
    retryCount: 0,
    timeout: 300_000
  })
});

const now = () => captureMs;
const launchAdapter = new ViemPonsV2LaunchAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  client,
  now
});
const quoteAdapter = new ViemPonsV2CurveQuoteAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  templateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  client
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

const head = await forwardAdapter.getHeadBlockNumber();
assert.ok(head > CONFIRMATIONS, 'PONS_S0_HEAD_TOO_EARLY');
const confirmedHead = await forwardAdapter.getBlockPoint(head - CONFIRMATIONS);

const launches = [];
const discoveryRanges = [];
for (
  let fromBlock = COHORT_FROM_BLOCK;
  fromBlock <= COHORT_THROUGH_BLOCK && launches.length < TARGET_LAUNCH_COUNT;
  fromBlock += DISCOVERY_CHUNK_BLOCKS
) {
  const toBlock = minBigInt(
    COHORT_THROUGH_BLOCK,
    fromBlock + DISCOVERY_CHUNK_BLOCKS - 1n
  );
  const batch = await launchAdapter.catchUp(fromBlock, toBlock);
  discoveryRanges.push({
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    launchCount: batch.length
  });
  launches.push(...batch);
}

launches.sort(compareLaunches);
assert.ok(
  launches.length >= TARGET_LAUNCH_COUNT,
  `PONS_S0_INSUFFICIENT_COHORT_LAUNCHES:required=${TARGET_LAUNCH_COUNT}:actual=${launches.length}`
);
const cohort = launches.slice(0, TARGET_LAUNCH_COUNT);

const featurePackets = [];
const outcomePackets = [];
const launchReceipts = [];

for (let index = 0; index < cohort.length; index += 1) {
  const launch = cohort[index];
  const launchPoint = await forwardAdapter.getBlockPoint(launch.blockNumber);
  assert.ok(
    confirmedHead.timestampMs >= launchPoint.timestampMs + CREATOR_OUTCOME_HORIZON_MS,
    `PONS_S0_TARGET_NOT_24H_MATURE:${launch.launchId}`
  );

  const baseline = await buildPortableBaselineBatch(
    {
      launch: launchAdapter,
      marketQuotes: quoteAdapter,
      usdCalibration: usdAdapter
    },
    launch,
    now
  );

  const feature = await buildPonsS0FeaturePacket({
    launch,
    baseline,
    creatorFeature: null,
    provenanceEdges: []
  });
  featurePackets.push(feature);

  let portableOutcome = null;
  let outcomePacket = null;
  if (baseline.status === 'COMPLETE') {
    portableOutcome = await buildPortableForwardOutcome(
      forwardAdapter,
      launch,
      baseline,
      CREATOR_OUTCOME_HORIZON_MS,
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

  launchReceipts.push({
    ordinal: index,
    launchId: launch.launchId,
    eventId: launch.eventId,
    token: launch.token,
    creator: launch.creator,
    launchBlock: launch.blockNumber.toString(),
    launchBlockHash: launch.blockHash,
    logIndex: launch.logIndex,
    baselineId: baseline.baselineId,
    baselineDecisionBlock: baseline.decisionBlock.toString(),
    baselineDecisionBlockHash: baseline.decisionBlockHash,
    baselineStatus: baseline.status,
    baselineReason: baseline.reason ?? null,
    featurePacketId: feature.packetId,
    featureEvidenceDigest: feature.evidenceDigest,
    creatorHistoryPresent: feature.creatorHistory !== null,
    outcomeId: portableOutcome?.outcomeId ?? null,
    outcomePacketId: outcomePacket?.packetId ?? null,
    outcomeEvidenceDigest: outcomePacket?.evidenceDigest ?? null,
    outcomeStatus: portableOutcome?.status ?? null,
    outcomeClassification: portableOutcome?.classification ?? null,
    grossExecutableValueUsdMicros:
      portableOutcome?.executableValueUsdMicros?.toString() ?? null,
    executionCostStatus:
      outcomePacket?.costProjection.status ?? null
  });
}

const bundle = await buildPonsS0ResearchExportBundle({
  featurePackets,
  outcomePackets
});
assert.equal(
  bundle.manifest.featurePacketCount,
  TARGET_LAUNCH_COUNT,
  'PONS_S0_FEATURE_PACKET_COUNT_DRIFT'
);

await writeFile(resolve(outputDir, 'features.jsonl'), bundle.featuresJsonl, 'utf8');
await writeFile(resolve(outputDir, 'outcomes.jsonl'), bundle.outcomesJsonl, 'utf8');
await writeFile(
  resolve(outputDir, 'manifest.json'),
  JSON.stringify(jsonSafe(bundle.manifest), null, 2) + '\n',
  'utf8'
);

const completeBaselines = launchReceipts.filter((row) => row.baselineStatus === 'COMPLETE').length;
const completeOutcomes = launchReceipts.filter((row) => row.outcomeStatus === 'COMPLETE').length;
const classifiedOutcomes = launchReceipts.filter((row) => row.outcomeClassification !== null).length;
const classificationCounts = Object.fromEntries(
  [...new Set(launchReceipts.map((row) => row.outcomeClassification).filter(Boolean))]
    .sort()
    .map((label) => [
      label,
      launchReceipts.filter((row) => row.outcomeClassification === label).length
    ])
);

const cohortCore = {
  schema: SCHEMA,
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  cohortRule: {
    selection: 'FIRST_N_LAUNCHES_ASCENDING_BLOCK_LOG_WITHIN_FROZEN_RANGE',
    fromBlock: COHORT_FROM_BLOCK.toString(),
    throughBlock: COHORT_THROUGH_BLOCK.toString(),
    discoveryChunkBlocks: DISCOVERY_CHUNK_BLOCKS.toString(),
    targetLaunchCount: TARGET_LAUNCH_COUNT,
    outcomeBlindSelection: true
  },
  researchSemantics: {
    targetHorizonMs: CREATOR_OUTCOME_HORIZON_MS,
    creatorFeaturePolicy: CREATOR_FEATURE_POLICY,
    executionCostPolicy: EXECUTION_COST_POLICY,
    creatorAwareStrategyClaimAllowed: false,
    netProfitabilityClaimAllowed: false
  },
  capture: {
    captureMs,
    observedHeadBlock: head.toString(),
    confirmedHeadBlock: confirmedHead.blockNumber.toString(),
    confirmedHeadHash: confirmedHead.blockHash,
    confirmedHeadTimestampMs: confirmedHead.timestampMs,
    confirmations: CONFIRMATIONS.toString()
  },
  discoveryRanges,
  counts: {
    featurePackets: bundle.manifest.featurePacketCount,
    outcomePackets: bundle.manifest.outcomePacketCount,
    completeBaselines,
    completeOutcomes,
    classifiedOutcomes,
    classificationCounts
  },
  export: {
    manifestId: bundle.manifest.manifestId,
    manifestEvidenceDigest: bundle.manifest.evidenceDigest,
    featureStreamSha256: bundle.manifest.featureStreamSha256,
    outcomeStreamSha256: bundle.manifest.outcomeStreamSha256
  },
  launches: launchReceipts,
  boundaries: {
    wallet: false,
    signer: false,
    approvals: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoney: false,
    promotionAuthority: 'NONE'
  }
};
const cohortReceipt = {
  ...cohortCore,
  evidenceDigest: sha256Canonical(cohortCore)
};
await writeFile(
  resolve(outputDir, 'cohort_receipt.json'),
  JSON.stringify(jsonSafe(cohortReceipt), null, 2) + '\n',
  'utf8'
);

const fileDigests = {};
for (const name of ['features.jsonl', 'outcomes.jsonl', 'manifest.json', 'cohort_receipt.json']) {
  fileDigests[name] = sha256Bytes(await readFile(resolve(outputDir, name)));
}
await writeFile(
  resolve(outputDir, 'file_digests.json'),
  JSON.stringify({
    schema: 'PONS_S0_REAL_COHORT_FILE_DIGESTS_V1',
    files: fileDigests
  }, null, 2) + '\n',
  'utf8'
);

console.log(JSON.stringify({
  verdict: 'PONS_S0_REAL_COHORT_MATERIALIZED',
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  featurePackets: bundle.manifest.featurePacketCount,
  outcomePackets: bundle.manifest.outcomePacketCount,
  completeBaselines,
  completeOutcomes,
  classifiedOutcomes,
  classificationCounts,
  manifestId: bundle.manifest.manifestId,
  outputDir,
  creatorAwareStrategyClaimAllowed: false,
  netProfitabilityClaimAllowed: false,
  liveMoneyAuthority: false
}, null, 2));

function compareLaunches(a, b) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.launchId.localeCompare(b.launchId);
}

function minBigInt(a, b) {
  return a < b ? a : b;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'));
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalize(value[key])])
    );
  }
  if (typeof value === 'bigint') return value.toString(10);
  return value;
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
