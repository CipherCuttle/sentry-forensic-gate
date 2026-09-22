import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  PONS_S0_EXPORT_MANIFEST_V1,
  PONS_S0_FEATURE_PACKET_V1,
  PONS_S0_OUTCOME_PACKET_V1,
  ROBINHOOD_CHAIN_ID,
  buildPonsS0FeaturePacket,
  buildPonsS0ResearchExportBundle,
  projectPortableCreatorOutcomeFeature,
  sha256Hex
} from '../dist/index.js';
import {
  DEFAULT_SHARD_COUNT,
  EXPECTED_SOURCE_COMMIT,
  ORIGIN_RECEIPT_SCHEMA,
  SOURCE_REPOSITORY,
  assertReviewedSourceCheckout,
  decodeJson,
  jsonSafe,
  parsePositiveInteger,
  progress,
  sha256Bytes,
  sha256Utf8
} from './pons-s0-cohort-lib.mjs';

assertReviewedSourceCheckout();

const planPath = process.env.PONS_S0_PLAN_PATH;
assert.ok(planPath, 'PONS_S0_PLAN_PATH is required');
const fragmentsDir = process.env.PONS_S0_FRAGMENTS_DIR;
assert.ok(fragmentsDir, 'PONS_S0_FRAGMENTS_DIR is required');
const outputDir =
  process.env.PONS_S0_OUTPUT_DIR ?? 'artifacts/pons-s0-real-cohort';
const shardCount = parsePositiveInteger(
  process.env.PONS_S0_SHARD_COUNT ?? String(DEFAULT_SHARD_COUNT),
  'PONS_S0_SHARD_COUNT'
);

const plan = decodeJson(await readFile(planPath, 'utf8'));
assert.equal(plan.schemaVersion, 'PONS_S0_COHORT_PLAN_V1');
assert.equal(
  plan.source.repositoryCommit,
  '493c85b8d84565cedf6e936063549edfa02edf3a'
);
assert.equal(plan.shardCount, shardCount);

// Load and verify every shard receipt + fragment stream.
const shardReceipts = [];
const fragments = [];
for (let shard = 1; shard <= shardCount; shard += 1) {
  const padded = String(shard).padStart(2, '0');
  const dir = `${fragmentsDir}/pons-s0-shard-${padded}`;
  const receipt = JSON.parse(
    await readFile(`${dir}/shard-receipt.json`, 'utf8')
  );
  assert.equal(receiptShard(receipt), shard);
  const fragmentsText = await readFile(`${dir}/fragments.jsonl`, 'utf8');
  assert.equal(
    sha256Utf8(fragmentsText),
    receipt.fragmentsFileSha256,
    'PONS_S0_SHARD_FRAGMENT_DIGEST_MISMATCH:shard-' + padded
  );
  const shardFragments = fragmentsText
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => decodeJson(line));
  assert.equal(
    shardFragments.length,
    receipt.materializedCount,
    'PONS_S0_SHARD_FRAGMENT_COUNT_MISMATCH:shard-' + padded
  );
  for (const fragment of shardFragments) {
    assert.equal(fragment.schemaVersion, 'PONS_S0_SHARD_FRAGMENT_V1');
    assert.equal(fragment.shard, shard);
  }
  shardReceipts.push(receipt);
  fragments.push(...shardFragments);
}
assert.equal(
  shardReceipts.length,
  shardCount,
  'PONS_S0_SHARD_RECEIPT_COUNT_MISMATCH'
);

// Canonical order + plan binding.
fragments.sort((a, b) => a.offset - b.offset);
assert.equal(
  fragments.length,
  plan.selectedLaunchCount,
  'PONS_S0_ASSEMBLED_FRAGMENT_COUNT_MISMATCH'
);
const seenOffsets = new Set();
for (const [index, fragment] of fragments.entries()) {
  assert.equal(
    fragment.offset,
    index,
    'PONS_S0_FRAGMENT_OFFSET_MISMATCH:' + fragment.launchId
  );
  assert.ok(!seenOffsets.has(fragment.offset));
  seenOffsets.add(fragment.offset);
  const expected = plan.selectedRawLogs[index];
  const actualKey = [
    expected.blockNumber,
    expected.transactionHash.toLowerCase(),
    String(expected.logIndex)
  ].join(':');
  assert.equal(
    fragment.launchKey,
    actualKey,
    'PONS_S0_FRAGMENT_PLAN_BINDING_MISMATCH:' + fragment.launchId
  );
}

// Pass B: creator features in canonical order (pure computation).
const factByLaunch = new Map(
  plan.universeFacts.map((fact) => [fact.launchId, fact])
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

for (const fragment of fragments) {
  progress('ASSEMBLE_FEATURE', {
    index: fragment.offset,
    launchId: fragment.launchId
  });
  baselineStatusCounts[fragment.baselineStatus] += 1;

  const priorFacts = plan.universeFacts.filter((fact) =>
    fact.creator.toLowerCase() === fragment.targetFact.creator.toLowerCase() &&
    (
      fact.observedBlock < fragment.launch.blockNumber ||
      (
        fact.observedBlock === fragment.launch.blockNumber &&
        fact.logIndex < fragment.launch.logIndex
      )
    )
  );

  const creatorFeature = await projectPortableCreatorOutcomeFeature(
    fragment.baseline,
    fragment.targetFact,
    priorFacts,
    projectedOutcomeReceipts
  );

  const featurePacket = await buildPonsS0FeaturePacket({
    launch: fragment.launch,
    baseline: fragment.baseline,
    creatorFeature,
    provenanceEdges: []
  });
  featurePackets.push(featurePacket);

  if (fragment.outcomePacket) {
    outcomePackets.push(fragment.outcomePacket);
    outcomeStatusCounts[fragment.outcomeStatus] += 1;
  } else {
    outcomeStatusCounts.ABSENT_BASELINE_UNVERIFIED += 1;
  }
  if (fragment.projectedReceipt) {
    projectedOutcomeReceipts.push(fragment.projectedReceipt);
  }
}

assert.equal(
  featurePackets.length,
  plan.selectedLaunchCount,
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
  plan.selectedLaunchCount,
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

const materializerScriptsSha256 = {};
for (const name of [
  'pons-s0-cohort-lib.mjs',
  'pons-s0-prepare-cohort-plan.mjs',
  'pons-s0-materialize-shard.mjs',
  'pons-s0-assemble-cohort.mjs'
]) {
  materializerScriptsSha256[name] = sha256Bytes(
    await readFile(fileURLToPath(new URL('./' + name, import.meta.url)))
  );
}
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
    factory: plan.factory,
    authorityFromBlock: plan.authorityFromBlock,
    asOfBlock: plan.asOf.block,
    asOfBlockHash: plan.asOf.blockHash,
    asOfTimestampMs: plan.asOf.timestampMs,
    headObservedBlock: plan.headObservedBlock,
    confirmations: plan.confirmations,
    maturityHorizonMs: plan.horizonMs,
    maturityCutoffTimestampMs: plan.maturityCutoffTimestampMs,
    matureThroughBlock: plan.matureThroughBlock,
    matureThroughBlockHash: plan.matureThroughBlockHash,
    matureUniverseLaunchCount: plan.matureUniverseLaunchCount,
    matureLaunchUniverseEvidenceDigest:
      plan.matureLaunchUniverseEvidenceDigest,
    cohortTargetCount: plan.cohortTargetCount,
    selectedLaunchCount: plan.selectedLaunchCount,
    cohortSelection: plan.cohortSelection,
    cohortSelectionRule: plan.cohortSelectionRule,
    targetPerformanceInspectedForSelection: false
  },
  materialization: {
    materializerId: 'PONS_S0_REAL_COHORT_MATERIALIZER_SHARDED_V1',
    materializerScriptsSha256,
    planDigest: plan.planDigest,
    shardCount,
    shardReceipts,
    command:
      'node scripts/pons-s0-prepare-cohort-plan.mjs && ' +
      'node scripts/pons-s0-materialize-shard.mjs (matrix) && ' +
      'node scripts/pons-s0-assemble-cohort.mjs',
    harnessRepository:
      process.env.PONS_S0_HARNESS_REPOSITORY ?? SOURCE_REPOSITORY,
    harnessCommit:
      process.env.PONS_S0_HARNESS_COMMIT ?? null,
    rpcTransportClass:
      'ROBINHOOD_OFFICIAL_PUBLIC_RPC_LOGS_PLUS_NODEFLARE_ARCHIVE_STATE_VIA_LOCAL_PROXY',
    launchDiscovery: 'ROBINHOOD_RPC_PONS_S0_LAUNCH_INDEX_V1',
    launchDiscoveryTransport:
      'ROBINHOOD_OFFICIAL_PUBLIC_RPC_TOPIC_FILTERED_LOGS',
    launchIndexSha256: plan.launchIndexSha256,
    frozenDiscoveryRunId:
      process.env.PONS_S0_FROZEN_DISCOVERY_RUN_ID ?? null,
    frozenDiscoveryArtifactId:
      process.env.PONS_S0_FROZEN_DISCOVERY_ARTIFACT_ID ?? null,
    frozenAsOfBlock: plan.asOf.block,
    runtimeHeadObservedBlock: plan.runtimeHeadObservedBlock,
    launchDiscoveryHeadBlock: plan.launchDiscoveryHeadBlock,
    launchDiscoveryThroughBlock: plan.launchDiscoveryThroughBlock,
    minRpcIntervalMs: parsePositiveInteger(
      process.env.PONS_S0_RPC_MIN_INTERVAL_MS ?? '650',
      'PONS_S0_RPC_MIN_INTERVAL_MS'
    )
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
  asOfBlock: plan.asOf.block,
  asOfBlockHash: plan.asOf.blockHash,
  asOfTimestampMs: plan.asOf.timestampMs,
  matureUniverseLaunchCount: plan.matureUniverseLaunchCount,
  matureLaunchUniverseEvidenceDigest:
    plan.matureLaunchUniverseEvidenceDigest,
  launchIndexSha256: plan.launchIndexSha256,
  launchDiscoveryHeadBlock: plan.launchDiscoveryHeadBlock,
  cohortTargetCount: plan.cohortTargetCount,
  selectedLaunchCount: plan.selectedLaunchCount,
  cohortSelection: plan.cohortSelection,
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

function receiptShard(receipt) {
  return receipt.shard;
}