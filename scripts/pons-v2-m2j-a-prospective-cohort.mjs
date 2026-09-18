import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { decodeEventLog } from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  PONS_V2_NATIVE_PAIR_TOKEN,
  derivePonsV2EventId,
  derivePonsV2LaunchId,
  ponsV2TokenLaunchedEvent,
  sha256Hex
} from '../dist/index.js';

const evidenceDir = process.env.PONS_M2J_A_EVIDENCE_DIR ?? 'artifacts/m2j-a-acquisition';
const scanBackBlocks = BigInt(process.env.PONS_M2J_A_SCAN_BACK_BLOCKS ?? '30000');
const windowSeconds = BigInt(process.env.PONS_M2J_A_WINDOW_SECONDS ?? '43200');
const maxMembers = Number(process.env.PONS_M2J_A_MAX_MEMBERS ?? '20');

assert.equal(scanBackBlocks, 30_000n);
assert.equal(windowSeconds, 43_200n);
assert.equal(maxMembers, 20);

const acquisition = await readJson(path.join(evidenceDir, 'acquisition.json'));
assert.equal(acquisition.schema, 'ROBINHOOD_PONS_M2J_A_ACQUISITION/1.0');
assert.equal(acquisition.factory.toLowerCase(), CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase());
assert.equal(BigInt(acquisition.scanBackBlocks), scanBackBlocks);
assert.equal(BigInt(acquisition.windowSeconds), windowSeconds);
assert.equal(acquisition.maxMembers, maxMembers);

const headRpc = await readJson(path.join(evidenceDir, 'head.json'));
const head = requireRpcResult(headRpc, 'head');
const headBlock = BigInt(head.number);
const headHash = requireHash(head.hash, 'M2J_A_HEAD_HASH_INVALID');
const headTimestamp = BigInt(head.timestamp);

assert.equal(BigInt(acquisition.headBlock), headBlock);
assert.equal(acquisition.headBlockHash.toLowerCase(), headHash);
assert.equal(BigInt(acquisition.headTimestamp), headTimestamp);

const expectedFromBlock = headBlock > scanBackBlocks ? headBlock - scanBackBlocks : 0n;
assert.equal(BigInt(acquisition.fromBlock), expectedFromBlock);
assert.equal(BigInt(acquisition.throughBlock), headBlock);

const rangeLines = (await readFile(path.join(evidenceDir, 'ranges.tsv'), 'utf8'))
  .trim()
  .split(/\n+/)
  .filter(Boolean);

const logs = [];
for (const line of rangeLines) {
  const [fromRaw, toRaw] = line.split('\t');
  const from = BigInt(fromRaw);
  const to = BigInt(toRaw);
  const body = await readJson(path.join(evidenceDir, 'ranges', `${from}-${to}.json`));
  const result = requireRpcResult(body, `range:${from}:${to}`);
  assert.ok(Array.isArray(result), `M2J_A_LOG_RESULT_NOT_ARRAY:${from}:${to}`);
  for (const raw of result) logs.push(raw);
}

const seenLogKeys = new Set();
const decoded = [];
for (const log of logs) {
  const address = String(log.address ?? '').toLowerCase();
  assert.equal(address, CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(), 'M2J_A_FACTORY_FILTER_BREACH');

  const blockNumber = BigInt(log.blockNumber);
  const logIndex = Number(BigInt(log.logIndex));
  const txHash = requireHash(log.transactionHash, 'M2J_A_TX_HASH_INVALID');
  const blockHash = requireHash(log.blockHash, 'M2J_A_LOG_BLOCK_HASH_INVALID');
  const key = `${txHash}:${logIndex}`;
  assert.ok(!seenLogKeys.has(key), `M2J_A_DUPLICATE_LOG:${key}`);
  seenLogKeys.add(key);

  const event = decodeEventLog({
    abi: [ponsV2TokenLaunchedEvent],
    data: log.data,
    topics: log.topics,
    strict: true
  });
  assert.equal(event.eventName, 'TokenLaunched');

  const blockRpc = await readJson(path.join(evidenceDir, 'blocks', `${blockNumber}.json`));
  const block = requireRpcResult(blockRpc, `block:${blockNumber}`);
  assert.equal(BigInt(block.number), blockNumber, `M2J_A_BLOCK_NUMBER_MISMATCH:${blockNumber}`);
  const canonicalHash = requireHash(block.hash, `M2J_A_BLOCK_HASH_INVALID:${blockNumber}`);
  assert.equal(canonicalHash, blockHash, `M2J_A_BLOCK_HASH_MISMATCH:${blockNumber}`);
  const timestamp = BigInt(block.timestamp);

  decoded.push({
    blockNumber,
    blockHash,
    logIndex,
    txHash,
    timestamp,
    args: event.args
  });
}

decoded.sort((a, b) => {
  if (a.blockNumber < b.blockNumber) return -1;
  if (a.blockNumber > b.blockNumber) return 1;
  return a.logIndex - b.logIndex;
});

const cutoffTimestamp = headTimestamp - windowSeconds;
const eligible = decoded.filter((log) =>
  String(log.args.pairToken).toLowerCase() === PONS_V2_NATIVE_PAIR_TOKEN.toLowerCase() &&
  log.timestamp >= cutoffTimestamp &&
  log.timestamp <= headTimestamp &&
  log.timestamp + 86_400n > headTimestamp
);

assert.ok(
  eligible.length <= maxMembers,
  `M2J_A_COHORT_CAP_EXCEEDED:eligible=${eligible.length}:max=${maxMembers}`
);

const members = [];
for (const log of eligible) {
  const token = String(log.args.token).toLowerCase();
  const curve = String(log.args.curve).toLowerCase();
  const creator = String(log.args.deployer).toLowerCase();
  const pairToken = String(log.args.pairToken).toLowerCase();

  const [launchId, eventId] = await Promise.all([
    derivePonsV2LaunchId({
      chainId: 4663,
      factory: CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(),
      txHash: log.txHash,
      token
    }),
    derivePonsV2EventId({
      chainId: 4663,
      factory: CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(),
      txHash: log.txHash,
      logIndex: log.logIndex
    })
  ]);

  members.push({
    launchId,
    eventId,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    logIndex: log.logIndex,
    txHash: log.txHash,
    token,
    curve,
    creator,
    pairToken,
    launchTimestampMs: Number(log.timestamp * 1000n),
    target24hTimestampMs: Number((log.timestamp + 86_400n) * 1000n)
  });
}

const rule = {
  schema: 'ROBINHOOD_PONS_M2J_A_MEMBERSHIP_RULE/1.0',
  scanBackBlocks: scanBackBlocks.toString(),
  windowSeconds: windowSeconds.toString(),
  maxMembers,
  nativePairOnly: true,
  includeAllEligible: true,
  require24hUnmaturedAtFreeze: true,
  ordering: 'BLOCK_NUMBER_LOG_INDEX_ASC',
  policyBlind: true,
  outcomeBlind: true
};
const ruleDigest = await sha256Hex(rule);

const cohortCore = {
  chainId: 4663,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  factory: CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(),
  headBlock: headBlock.toString(),
  headBlockHash: headHash,
  headTimestampMs: Number(headTimestamp * 1000n),
  fromBlock: expectedFromBlock.toString(),
  throughBlock: headBlock.toString(),
  cutoffTimestampMs: Number(cutoffTimestamp * 1000n),
  ruleDigest,
  members
};
const cohortId = await sha256Hex(cohortCore);

const receipt = {
  schema: 'ROBINHOOD_PONS_M2J_A_PROSPECTIVE_COHORT/1.0',
  verdict: members.length > 0
    ? 'PROSPECTIVE_COHORT_FROZEN'
    : 'NO_ELIGIBLE_LAUNCHES_IN_WINDOW',
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  cohortId,
  rule,
  ruleDigest,
  acquisition: {
    source: 'ROBINHOOD_READ_ONLY_JSON_RPC',
    scannedLogCount: decoded.length,
    eligibleMemberCount: members.length
  },
  cohort: cohortCore,
  boundaries: {
    policyEvaluated: false,
    creatorHistoryRead: false,
    forwardOutcomeRead: false,
    wallet: false,
    signer: false,
    approvals: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoney: false,
    robinhoodLiveAuthority: false,
    arcLiveAuthority: false
  }
};

console.log(JSON.stringify(jsonSafe(receipt), null, 2));

function requireRpcResult(body, label) {
  assert.ok(body && typeof body === 'object', `M2J_A_RPC_ENVELOPE_INVALID:${label}`);
  assert.ok(!('error' in body), `M2J_A_RPC_ERROR:${label}:${JSON.stringify(body.error)}`);
  assert.ok('result' in body, `M2J_A_RPC_RESULT_MISSING:${label}`);
  return body.result;
}

function requireHash(value, label) {
  const normalized = String(value ?? '').toLowerCase();
  assert.match(normalized, /^0x[0-9a-f]{64}$/, label);
  return normalized;
}

async function readJson(file) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`M2J_A_EVIDENCE_FILE_MISSING:${file}`, { cause: error });
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`M2J_A_EVIDENCE_JSON_INVALID:${file}`, { cause: error });
  }
}

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}
