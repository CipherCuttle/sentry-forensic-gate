import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createPublicClient, defineChain, http } from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPonsS0OutcomePacket,
  buildPortableBaselineBatch,
  buildPortableForwardOutcome,
  projectPortableOutcomeReceipt
} from '../dist/index.js';
import {
  SHARD_FRAGMENT_SCHEMA,
  assertReviewedSourceCheckout,
  compareBigInt,
  decodeJson,
  encodeJson,
  pacedClient,
  parsePositiveInteger,
  progress,
  sha256Utf8
} from './pons-s0-cohort-lib.mjs';

assertReviewedSourceCheckout();

const rpcUrl = process.env.PONS_S0_RPC_URL;
assert.ok(rpcUrl, 'PONS_S0_RPC_URL is required');
const planPath = process.env.PONS_S0_PLAN_PATH;
assert.ok(planPath, 'PONS_S0_PLAN_PATH is required');
const shardIndex = parsePositiveInteger(
  process.env.PONS_S0_SHARD_INDEX,
  'PONS_S0_SHARD_INDEX'
);
const shardCount = parsePositiveInteger(
  process.env.PONS_S0_SHARD_COUNT,
  'PONS_S0_SHARD_COUNT'
);
const outputDir =
  process.env.PONS_S0_SHARD_OUTPUT_DIR ?? 'shard-output';
const minRpcIntervalMs = parsePositiveInteger(
  process.env.PONS_S0_RPC_MIN_INTERVAL_MS ?? '650',
  'PONS_S0_RPC_MIN_INTERVAL_MS'
);
assert.ok(shardIndex >= 1, 'PONS_S0_SHARD_INDEX_MUST_BE_ONE_BASED');
assert.ok(shardIndex <= shardCount, 'PONS_S0_SHARD_INDEX_OUT_OF_RANGE');

const plan = decodeJson(await readFile(planPath, 'utf8'));
assert.equal(plan.schemaVersion, 'PONS_S0_COHORT_PLAN_V1');
assert.equal(
  plan.source.repositoryCommit,
  '493c85b8d84565cedf6e936063549edfa02edf3a'
);
assert.equal(plan.shardCount, shardCount);

const perShard = Math.ceil(plan.selectedRawLogs.length / shardCount);
const shardStartOffset = (shardIndex - 1) * perShard;
const assigned = plan.selectedRawLogs.slice(
  shardStartOffset,
  Math.min(shardIndex * perShard, plan.selectedRawLogs.length)
);
assert.ok(
  assigned.length > 0,
  'PONS_S0_EMPTY_SHARD_NOT_ALLOWED'
);
progress('SHARD_PLAN', {
  shard: shardIndex,
  assignedCount: assigned.length
});

const factByLaunch = new Map(
  plan.universeFacts.map((fact) => [fact.launchId, fact])
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

const asOfBlock = BigInt(plan.asOf.block);
assert.ok(
  (await client.getBlockNumber()) >= BigInt(plan.headObservedBlock),
  'PONS_S0_RUNTIME_HEAD_BEFORE_FROZEN_PLAN_HEAD'
);

const fixedNow = () => plan.asOf.timestampMs;
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
  plan.asOf.blockHash,
  'PONS_S0_SHARD_AS_OF_HASH_MISMATCH'
);

const assignedByBlock = new Map();
for (const [localOffset, log] of assigned.entries()) {
  const offset = shardStartOffset + localOffset;
  assert.equal(
    plan.selectedRawLogs[offset],
    log,
    'PONS_S0_SHARD_GLOBAL_OFFSET_MISMATCH'
  );
  const blockKey = BigInt(log.blockNumber).toString();
  let bucket = assignedByBlock.get(blockKey);
  if (!bucket) {
    bucket = [];
    assignedByBlock.set(blockKey, bucket);
  }
  bucket.push({ offset, log });
}
const sortedBlocks = [...assignedByBlock.keys()]
  .map((value) => BigInt(value))
  .sort(compareBigInt);

const fragments = [];
for (const blockNumber of sortedBlocks) {
  progress('SHARD_CATCH_UP', {
    shard: shardIndex,
    block: blockNumber.toString()
  });
  const blockLaunches = await launchAdapter.catchUp(
    blockNumber,
    blockNumber
  );
  const wanted = assignedByBlock.get(blockNumber.toString());
  for (const entry of wanted) {
    const key = [
      blockNumber.toString(),
      entry.log.transactionHash.toLowerCase(),
      String(entry.log.logIndex)
    ].join(':');
    const launch = blockLaunches.find(
      (candidate) =>
        [
          candidate.blockNumber.toString(),
          candidate.txHash.toLowerCase(),
          String(candidate.logIndex)
        ].join(':') === key
    );
    assert.ok(
      launch,
      'PONS_S0_SHARD_LAUNCH_NOT_MATERIALIZED:' + key
    );
    fragments.push(await materializeAssignedLaunch(entry, launch));
  }
}

async function materializeAssignedLaunch(entry, launch) {
  progress('SHARD_LAUNCH', {
    shard: shardIndex,
    index: entry.offset,
    launchId: launch.launchId
  });
  const baseline = await buildPortableBaselineBatch(
    {
      launch: launchAdapter,
      marketQuotes: quoteAdapter,
      usdCalibration: usdAdapter
    },
    launch,
    fixedNow
  );
  const targetFact = factByLaunch.get(launch.launchId);
  assert.ok(
    targetFact,
    'PONS_S0_SHARD_TARGET_FACT_MISSING:' + launch.launchId
  );

  const portableOutcome = await buildPortableForwardOutcome(
    forwardAdapter,
    launch,
    baseline,
    plan.outcomeHorizonMs,
    asOfPoint
  );
  let projectedReceipt = null;
  let outcomePacket = null;
  let outcomeStatus = 'ABSENT_BASELINE_UNVERIFIED';
  if (portableOutcome) {
    projectedReceipt = await projectPortableOutcomeReceipt(portableOutcome);
    outcomePacket = await buildPonsS0OutcomePacket({
      launch,
      baseline,
      outcome: portableOutcome
    });
    outcomeStatus = portableOutcome.status;
  }
  return {
    schemaVersion: SHARD_FRAGMENT_SCHEMA,
    shard: shardIndex,
    offset: entry.offset,
    launchKey: [
      launch.blockNumber.toString(),
      launch.txHash.toLowerCase(),
      String(launch.logIndex)
    ].join(':'),
    launchId: launch.launchId,
    launch,
    baseline,
    targetFact,
    outcomePacket,
    projectedReceipt,
    baselineStatus: baseline.status,
    outcomeStatus
  };
}

assert.equal(
  fragments.length,
  assigned.length,
  'PONS_S0_SHARD_FRAGMENT_CARDINALITY_MISMATCH'
);

await mkdir(outputDir, { recursive: true });
const fragmentsText =
  fragments.map((fragment) => encodeJson(fragment)).join('\n') +
  (fragments.length > 0 ? '\n' : '');
await writeFile(outputDir + '/fragments.jsonl', fragmentsText, 'utf8');

const shardReceipt = {
  schemaVersion: 'PONS_S0_SHARD_RECEIPT_V1',
  shard: shardIndex,
  shardCount,
  assignedCount: assigned.length,
  materializedCount: fragments.length,
  fragmentsFileSha256: sha256Utf8(fragmentsText),
  launchIds: fragments.map((fragment) => fragment.launchId)
};
await writeFile(
  outputDir + '/shard-receipt.json',
  JSON.stringify(shardReceipt, null, 2) + '\n',
  'utf8'
);
console.log(JSON.stringify(shardReceipt, null, 2));