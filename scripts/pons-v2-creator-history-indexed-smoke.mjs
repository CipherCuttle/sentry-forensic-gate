import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  CURRENT_PONS_V2_AUTHORITY,
  buildNormalizedProvenanceFact,
  derivePonsV2EventId,
  derivePonsV2LaunchId,
  evaluatePortableFastVet,
  projectPortableCreatorOutcomeFeature
} from '../dist/index.js';

const receipt = JSON.parse(await readFile(
  new URL('../evidence/robinhood/pons/m2f-hmn-fast-vet-baseline.json', import.meta.url),
  'utf8'
));
const factory = CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase();
const creator = receipt.launch.creator.toLowerCase();
const targetBlock = BigInt(receipt.launch.blockNumber);
const fromBlock = CURRENT_PONS_V2_AUTHORITY.fromBlock;
const chunkSize = 1_000_000n;
const evidenceDir = process.env.PONS_INDEXED_EVIDENCE_DIR ?? 'artifacts/m2g-indexed';
const eventTopic = '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607';
const creatorTopic = `0x${creator.slice(2).padStart(64, '0')}`;

assert.equal(receipt.schema, 'SENTRY_PORTABLE_FAST_VET_BASELINE_RECEIPT/1.0');
assert.equal(receipt.source.runId, 35294153203);
assert.equal(receipt.baseline.launchId, receipt.launch.launchId);
assert.equal(receipt.baseline.status, 'COMPLETE');

const acquisition = await readJson(path.join(evidenceDir, 'acquisition.json'));
assert.equal(acquisition.schema, 'ROBINHOOD_BLOCKSCOUT_INDEXED_ACQUISITION_R0');
assert.equal(acquisition.factory.toLowerCase(), factory);
assert.equal(acquisition.eventTopic.toLowerCase(), eventTopic);
assert.equal(acquisition.creatorTopic.toLowerCase(), creatorTopic);
assert.equal(BigInt(acquisition.scannedFromBlock), fromBlock);
assert.equal(BigInt(acquisition.scannedThroughBlock), targetBlock);
assert.equal(BigInt(acquisition.chunkSize), chunkSize);

const ranges = [];
for (let start = fromBlock; start <= targetBlock; start += chunkSize) {
  ranges.push({ fromBlock: start, toBlock: min(targetBlock, start + chunkSize - 1n) });
}

assert.equal(acquisition.rangeCount, ranges.length);

const rangeResults = [];
for (const range of ranges) {
  const body = await readJson(
    path.join(evidenceDir, 'ranges', `${range.fromBlock}-${range.toBlock}.json`)
  );
  rangeResults.push({
    ...range,
    logs: parseIndexedLogResponse(body, range.fromBlock, range.toBlock)
  });
}

const allLogs = rangeResults
  .flatMap((range) => range.logs)
  .sort((a, b) => a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex);

const seen = new Set();
const launches = [];
for (const log of allLogs) {
  const key = `${log.transactionHash.toLowerCase()}:${log.logIndex}`;
  if (seen.has(key)) throw new Error(`PONS_BLOCKSCOUT_DUPLICATE_LOG:${key}`);
  seen.add(key);

  const token = `0x${log.topics[1].slice(-40)}`.toLowerCase();
  const curve = `0x${log.topics[2].slice(-40)}`.toLowerCase();
  const deployer = `0x${log.topics[3].slice(-40)}`.toLowerCase();
  if (deployer !== creator) throw new Error('PONS_BLOCKSCOUT_CREATOR_FILTER_BREACH');
  const [launchId, eventId] = await Promise.all([
    derivePonsV2LaunchId({
      chainId: 4663,
      factory,
      txHash: log.transactionHash.toLowerCase(),
      token
    }),
    derivePonsV2EventId({
      chainId: 4663,
      factory,
      txHash: log.transactionHash.toLowerCase(),
      logIndex: log.logIndex
    })
  ]);
  const block = await readJson(
    path.join(evidenceDir, 'blocks', `${log.blockNumber}.json`)
  );
  const blockHash = requireBlockHash(block, log.blockNumber);
  launches.push({
    chainId: 4663,
    ecosystem: 'ROBINHOOD',
    launchProtocol: 'PONS',
    launchId,
    eventId,
    factory,
    txHash: log.transactionHash.toLowerCase(),
    blockNumber: log.blockNumber,
    blockHash,
    logIndex: log.logIndex,
    token,
    creator: deployer,
    name: '',
    symbol: '',
    sourceEventName: 'TokenLaunched',
    observedAtMs: log.timestampMs,
    sourceAuthority: {
      schema: 'ROBINHOOD_BLOCKSCOUT_INDEXED_TOKEN_LAUNCHED_R0',
      payload: {
        acquisitionSchema: acquisition.schema,
        factory,
        eventTopic,
        creator,
        fromBlock: log.blockNumber.toString(),
        txHash: log.transactionHash.toLowerCase(),
        logIndex: log.logIndex,
        token,
        curve
      }
    }
  });
}

const target = launches.filter((x) =>
  x.blockNumber === targetBlock &&
  x.logIndex === receipt.launch.logIndex &&
  x.txHash === receipt.launch.txHash &&
  x.token === receipt.launch.token
);
assert.equal(target.length, 1, `PONS_BLOCKSCOUT_TARGET_CARDINALITY:${target.length}`);
assert.equal(target[0].launchId, receipt.launch.launchId);
assert.equal(target[0].eventId, receipt.launch.eventId);
assert.equal(target[0].blockHash, receipt.launch.blockHash);

const prior = launches.filter((x) =>
  x.blockNumber < targetBlock ||
  (x.blockNumber === targetBlock && x.logIndex < receipt.launch.logIndex)
);
const targetFact = await buildNormalizedProvenanceFact(target[0]);
const priorFacts = await Promise.all(prior.map(buildNormalizedProvenanceFact));

const baseline = {
  ...receipt.baseline,
  chainId: receipt.chainId,
  ecosystem: receipt.ecosystem,
  launchProtocol: receipt.launchProtocol,
  decisionBlock: BigInt(receipt.baseline.decisionBlock),
  decisionBlockHash: receipt.baseline.decisionBlockHash,
  legs: receipt.baseline.legs.map((leg) => ({
    notionalUsdMicros: BigInt(leg.notionalUsdMicros),
    entry: leg.entry,
    reverse: leg.reverse,
    independentReverseRecoveryBps: leg.independentReverseRecoveryBps === null
      ? null
      : BigInt(leg.independentReverseRecoveryBps)
  }))
};

const feature = await projectPortableCreatorOutcomeFeature(
  baseline,
  targetFact,
  priorFacts,
  []
);
const vet = evaluatePortableFastVet({ baseline, creatorFeature: feature });

assert.equal(feature.priorLaunchCount, prior.length);
if (prior.length === 0) {
  assert.equal(feature.coverage, 'NO_HISTORY');
  assert.equal(vet.decision, 'PASS');
} else {
  assert.equal(feature.coverage, 'UNKNOWN');
  assert.equal(vet.decision, 'UNKNOWN');
  assert.deepEqual(vet.reasons, ['CREATOR_HISTORY_INCOMPLETE']);
}

console.log(JSON.stringify(jsonSafe({
  verdict: 'PONS_V2_INDEXED_CREATOR_HISTORY_PASS',
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  target: {
    launchId: receipt.launch.launchId,
    creator,
    blockNumber: receipt.launch.blockNumber
  },
  scan: {
    source: 'ROBINHOOD_BLOCKSCOUT_INDEXED_LOGS',
    acquisitionSchema: acquisition.schema,
    scannedFromBlock: fromBlock,
    scannedThroughBlock: targetBlock,
    requestedRangeCount: ranges.length,
    completedRangeCount: rangeResults.length,
    matchingLaunchCount: launches.length,
    priorLaunchCount: prior.length
  },
  priorLaunches: prior.map((x) => ({
    launchId: x.launchId,
    eventId: x.eventId,
    blockNumber: x.blockNumber,
    blockHash: x.blockHash,
    txHash: x.txHash,
    token: x.token,
    timestampMs: x.observedAtMs,
    horizon24hMaturedBeforeTarget: x.observedAtMs + 86_400_000 <= target[0].observedAtMs
  })),
  creatorFeature: {
    coverage: feature.coverage,
    priorLaunchCount: feature.priorLaunchCount,
    classifiedOutcomeCount: feature.classifiedOutcomeCount,
    unresolvedOutcomeCount: feature.unresolvedOutcomeCount,
    evidenceDigest: feature.evidenceDigest
  },
  fastVet: vet,
  frozenBaseline: {
    sourceRunId: receipt.source.runId,
    baselineId: baseline.baselineId,
    authorityDigest: baseline.authorityDigest,
    decisionBlock: baseline.decisionBlock,
    decisionBlockHash: baseline.decisionBlockHash
  }
}), null, 2));

function parseIndexedLogResponse(body, from, to) {
  if (
    body.status === '0' &&
    body.message === 'No logs found' &&
    Array.isArray(body.result) &&
    body.result.length === 0
  ) {
    return [];
  }
  if (body.status !== '1' || body.message !== 'OK' || !Array.isArray(body.result)) {
    throw new Error(
      `PONS_BLOCKSCOUT_LOG_RESPONSE_INVALID:${from}:${to}:${JSON.stringify(body).slice(0, 256)}`
    );
  }
  if (body.result.length >= 1000) {
    throw new Error(`PONS_BLOCKSCOUT_LOG_CAP_REACHED:${from}:${to}`);
  }
  return body.result.map((log) => ({
    address: String(log.address).toLowerCase(),
    blockNumber: BigInt(log.blockNumber),
    logIndex: Number(BigInt(log.logIndex)),
    timestampMs: Number(BigInt(log.timeStamp)) * 1000,
    topics: log.topics.map((value) => String(value).toLowerCase()),
    transactionHash: String(log.transactionHash).toLowerCase()
  }));
}

function requireBlockHash(block, expectedBlockNumber) {
  const hash = typeof block.hash === 'string' ? block.hash.toLowerCase() : '';
  if (!/^0x[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`PONS_BLOCKSCOUT_BLOCK_HASH_INVALID:${expectedBlockNumber}`);
  }
  const observedNumber =
    block.height ?? block.block_number ?? block.number ?? expectedBlockNumber.toString();
  if (BigInt(observedNumber) !== expectedBlockNumber) {
    throw new Error(
      `PONS_BLOCKSCOUT_BLOCK_NUMBER_MISMATCH:${expectedBlockNumber}:${observedNumber}`
    );
  }
  return hash;
}

async function readJson(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`PONS_INDEXED_EVIDENCE_FILE_MISSING:${file}`, { cause: error });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`PONS_INDEXED_EVIDENCE_JSON_INVALID:${file}`, { cause: error });
  }
}

function min(a, b) { return a < b ? a : b; }

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}
