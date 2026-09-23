import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const BATCH_SCHEMA = 'PONS_S1_PRE_OUTCOME_BATCH_V0';
export const ACTIVATION_SCHEMA = 'PONS_S1_PROSPECTIVE_ACTIVATION_V0';
export const SEAL_SCHEMA = 'PONS_S1_EXTERNAL_IMMUTABLE_SEAL_V0';
export const MAX_NATIVE_PER_BATCH = 4;
export const MAX_SCAN_BLOCKS = 16;
const SIX_HOURS_MS = 6 * 3600_000;
const ONE_DAY_MS = 24 * 3600_000;
const FIVE_MINUTES_MS = 300_000;
const HEX64 = /^0x[0-9a-f]{64}$/i;
const HEX40 = /^0x[0-9a-f]{40}$/i;

export function canonical(value) {
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
export function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
const integer = (v, label) => {
  const n = typeof v === 'bigint' ? v : BigInt(v);
  assert.ok(n >= 0n, label + '_NEGATIVE');
  return n;
};
const address = v => {
  assert.match(v, HEX40, 'PONS_S1_BAD_ADDRESS');
  return v.toLowerCase();
};
const hash = v => {
  assert.match(v, HEX64, 'PONS_S1_BAD_HASH');
  return v.toLowerCase();
};
export function assertFrozenSpec(spec) {
  assert.equal(spec.schemaVersion, 'PONS_S1_FIVE_MINUTE_FEASIBILITY_PREREG_V0');
  assert.equal(spec.prospective.chainId, 4663);
  assert.equal(spec.prospective.primaryExit.horizonMs, FIVE_MINUTES_MS);
  assert.equal(spec.prospective.maxUniqueNativePairLaunches, 96);
  assert.equal(spec.prospective.confirmations, 12);
  assert.equal(spec.prospective.windowHours, 24);
  assert.equal(spec.prospective.decisionDelayBlocks, 2);
  assert.equal(spec.prospective.entryNotionalUsdMicros, 1_000_000);
  assert.equal(spec.prospective.forbiddenHistoricalReuse, true);
  assert.equal(spec.prospective.learningOrModelFitting, false);
  assert.equal(spec.prospective.pilotSampleIsNotConfirmatory, true);
  assert.equal(spec.prospective.primaryExitSuccessDenominator,
    'ALL_MECHANICALLY_C0_ADMISSIBLE_INCLUDING_UNKNOWN_OUTCOME');
  assert.equal(spec.source.immutableS0EvidenceCommit,
    'd711943a25693baee504d2bfe89ae398b75a690a');
  return digest(spec);
}

// This branch has no activation receipt, and the current prereg explicitly
// denies collection. An arbitrary CLI flag cannot cross this boundary.
export function assertActivated(spec, activation, context) {
  const specSha256 = assertFrozenSpec(spec);
  assert.equal(spec.state, 'ACTIVE_REVIEWED', 'PONS_S1_SPEC_INACTIVE');
  assert.equal(spec.authority.dataCollectionAuthorized, true, 'PONS_S1_COLLECTION_NOT_AUTHORIZED');
  for (const key of ['executionAuthorized', 'liveMoneyAuthorized', 'signerAuthorized',
    'broadcasterAuthorized', 'modelPromotionAuthorized', 'mergeAuthorized',
    'unattendedOperationAuthorized']) {
    assert.equal(spec.authority[key], false, 'PONS_S1_FORBIDDEN_AUTHORITY:' + key);
  }
  assert.equal(activation?.schemaVersion, ACTIVATION_SCHEMA);
  assert.equal(activation.studyId, spec.prospective.studyId);
  assert.equal(activation.specSha256, specSha256);
  assert.equal(activation.chainId, 4663);
  assert.equal(activation.canonicalRef, 'refs/heads/main');
  assert.equal(activation.collectorImplementationSha, context.collectorImplementationSha);
  assert.match(activation.canonicalMergeSha, /^[0-9a-f]{40}$/);
  assert.equal(context.checkoutSha, activation.canonicalMergeSha, 'PONS_S1_NOT_CANONICAL_ACTIVATION_SHA');
  const mergedAt = Date.parse(activation.canonicalMergedAtUtc);
  assert.ok(Number.isSafeInteger(mergedAt) && mergedAt > 0, 'PONS_S1_MERGE_TIME_UNVERIFIED');
  assert.equal(activation.originEarliestTimestampMs, mergedAt + SIX_HOURS_MS);
  assert.equal(activation.authority.dataCollectionAuthorized, true);
  assert.equal(activation.authority.liveMoneyAuthorized, false);
  assert.equal(activation.authority.unattendedOperationAuthorized, false);
  return { specSha256, activationDigest: digest(activation),
    originEarliestTimestampMs: activation.originEarliestTimestampMs };
}
export function assertOrigin(activation, originBlock, predecessor, confirmedHeadBlock) {
  const origin = integer(originBlock.number, 'ORIGIN_BLOCK');
  assert.ok(origin > 0n);
  const previous = integer(predecessor.number, 'PREDECESSOR_BLOCK');
  assert.equal(previous + 1n, origin, 'PONS_S1_ORIGIN_NOT_CONTIGUOUS');
  assert.ok(predecessor.timestampMs < activation.originEarliestTimestampMs,
    'PONS_S1_ORIGIN_NOT_FIRST_BLOCK');
  assert.ok(originBlock.timestampMs >= activation.originEarliestTimestampMs,
    'PONS_S1_ORIGIN_EARLY');
  assert.ok(integer(confirmedHeadBlock, 'CONFIRMED_HEAD') >= origin,
    'PONS_S1_ORIGIN_UNCONFIRMED');
  hash(originBlock.hash);
  hash(predecessor.hash);
  return origin;
}
export function normalizeLog(log, factory) {
  assert.equal(log.removed ?? false, false, 'PONS_S1_REMOVED_REORG_LOG');
  const number = integer(log.blockNumber, 'LOG_BLOCK');
  assert.ok(Number.isSafeInteger(log.logIndex) && log.logIndex >= 0, 'PONS_S1_BAD_LOG_INDEX');
  const args = log.args ?? {};
  const nativePair = address(args.pairToken) === '0x0000000000000000000000000000000000000000';
  const event = {
    eventKey: [String(number), hash(log.transactionHash), String(log.logIndex)].join(':'),
    blockNumber: String(number),
    blockHash: hash(log.blockHash),
    transactionHash: hash(log.transactionHash),
    logIndex: log.logIndex,
    factory: address(factory),
    token: address(args.token),
    curve: address(args.curve),
    deployer: address(args.deployer),
    pairToken: address(args.pairToken),
    nativePair,
    launchConfigId: String(integer(args.launchConfigId, 'CONFIG_ID')),
    graduationThreshold: String(integer(args.graduationThreshold, 'GRADUATION_THRESHOLD'))
  };
  assert.ok(event.token !== event.curve, 'PONS_S1_TOKEN_CURVE_ALIAS');
  return event;
}
const cmp = (a, b) => BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 :
  BigInt(a.blockNumber) > BigInt(b.blockNumber) ? 1 : a.logIndex - b.logIndex;
export function checkBatch(batch) {
  assert.equal(batch.schemaVersion, BATCH_SCHEMA);
  assert.equal(batch.phase, 'PENDING_EXTERNAL_IMMUTABLE_SEAL');
  assert.equal(batch.outcomesRead, false);
  assert.ok(batch.selectionCount >= 0 && batch.selectionCount <= 96);
  assert.ok(batch.newEvents.length <= MAX_NATIVE_PER_BATCH);
  assert.deepEqual(batch.newEvents, [...batch.newEvents].sort(cmp), 'PONS_S1_BATCH_UNSORTED');
  assert.ok(new Set(batch.newEvents.map(e => e.eventKey)).size === batch.newEvents.length);
  const { batchDigest, ...payload } = batch;
  assert.equal(batchDigest, digest(payload), 'PONS_S1_BATCH_DIGEST_MISMATCH');
  return batchDigest;
}
export function freezeNextBatch(input) {
  const { spec, activation, origin, previous, scanFrom, scanThrough, confirmedHead,
    blocks, logs, capturedAtMs } = input;
  const specSha256 = assertFrozenSpec(spec);
  assert.equal(activation.schemaVersion, ACTIVATION_SCHEMA);
  assert.equal(activation.specSha256, specSha256);
  const originNumber = assertOrigin(activation, origin.block, origin.predecessor,
    confirmedHead.blockNumber);
  const from = integer(scanFrom, 'SCAN_FROM'), through = integer(scanThrough, 'SCAN_TO');
  const head = integer(confirmedHead.blockNumber, 'CONFIRMED_HEAD');
  assert.ok(from >= originNumber && through >= from && through <= head,
    'PONS_S1_SCAN_RANGE_INVALID');
  assert.ok(through - from < BigInt(MAX_SCAN_BLOCKS), 'PONS_S1_UNBOUNDED_SCAN');
  assert.ok(head + BigInt(spec.prospective.confirmations) <=
    integer(confirmedHead.rpcHeadBlock, 'RPC_HEAD'), 'PONS_S1_HEAD_NOT_CONFIRMED');
  const prior = previous ?? null;
  if (prior) {
    checkBatch(prior.batch);
    const state = prior.batch;
    assert.equal(prior.seal?.schemaVersion, SEAL_SCHEMA, 'PONS_S1_PREVIOUS_BATCH_UNSEALED');
    assert.equal(prior.seal.batchDigest, state.batchDigest);
    assert.equal(prior.seal.immutable, true);
    assert.equal(prior.seal.externalVerification, 'INDEPENDENT_GITHUB_RELEASE_API');
    assert.equal(state.specSha256, specSha256);
    assert.equal(state.activationDigest, digest(activation));
    assert.equal(from.toString(), state.nextCursor.blockNumber, 'PONS_S1_CURSOR_REWIND_OR_GAP');
    assert.ok(!state.windowClosed && !state.targetCountReached, 'PONS_S1_ALREADY_CLOSED');
  } else {
    assert.equal(from, originNumber, 'PONS_S1_FIRST_SCAN_NOT_ORIGIN');
  }
  assert.ok(Number.isSafeInteger(capturedAtMs) && capturedAtMs >= 0);
  assert.ok(Number.isSafeInteger(confirmedHead.timestampMs));
  const normalized = logs.map(log => normalizeLog(log, activation.factory)).sort(cmp);
  const unique = new Set();
  const blockHashAt = new Map();
  for (const [block, point] of Object.entries(blocks)) {
    assert.equal(String(integer(point.number, 'BLOCK_POINT')), block);
    blockHashAt.set(block, hash(point.hash));
  }
  assert.ok(blockHashAt.has(String(through)), 'PONS_S1_SCAN_END_HASH_MISSING');
  let lastKey = '';
  for (const log of normalized) {
    const bn = BigInt(log.blockNumber);
    assert.ok(bn >= from && bn <= through, 'PONS_S1_OUT_OF_RANGE_LOG');
    assert.equal(blockHashAt.get(log.blockNumber), log.blockHash,
      'PONS_S1_LOG_REORG_OR_UNPROVED_HASH');
    assert.ok(!unique.has(log.eventKey), 'PONS_S1_DUPLICATE_EVENT');
    unique.add(log.eventKey);
    assert.ok(lastKey !== log.eventKey, 'PONS_S1_DUPLICATE_LOG');
    lastKey = log.eventKey;
  }
  const cursor = prior?.batch.nextCursor ?? { blockNumber: String(from), logIndex: -1 };
  assert.equal(cursor.blockNumber, String(from));
  const older = new Set(prior?.batch.enrolledEventKeys ?? []);
  const enrolled = [...(prior?.batch.enrolledEventKeys ?? [])];
  const newEvents = [];
  const limit = Math.min(MAX_NATIVE_PER_BATCH, 96 - enrolled.length);
  let lastProcessed = null, scannedNative = 0, stoppedForWindow = false;
  const windowEnd = origin.block.timestampMs + ONE_DAY_MS;
  for (const log of normalized) {
    if (BigInt(log.blockNumber) === from && log.logIndex <= cursor.logIndex) continue;
    const point = blocks[log.blockNumber];
    assert.ok(point && Number.isSafeInteger(point.timestampMs), 'PONS_S1_MISSING_BLOCK_TIME');
    if (point.timestampMs >= windowEnd) { stoppedForWindow = true; break; }
    if (log.nativePair) {
      assert.ok(!older.has(log.eventKey), 'PONS_S1_PREVIOUS_EVENT_REPLAY');
      if (point.timestampMs + FIVE_MINUTES_MS <= capturedAtMs ||
          point.timestampMs + FIVE_MINUTES_MS <= confirmedHead.timestampMs) {
        throw new Error('PONS_S1_SELECTION_TOO_LATE_FOR_FIVE_MINUTE_OUTCOME');
      }
      newEvents.push({ ...log, launchTimestampMs: point.timestampMs });
      enrolled.push(log.eventKey);
      scannedNative++;
    }
    lastProcessed = log;
    if (newEvents.length >= limit && limit > 0) break;
  }
  const targetCountReached = enrolled.length === 96;
  const endPoint = blocks[String(through)];
  const windowClosed = stoppedForWindow ||
    (endPoint.timestampMs >= windowEnd && !targetCountReached);
  const stoppedMidRange = lastProcessed !== null &&
    newEvents.length === limit && limit > 0 && !targetCountReached;
  const nextCursor = stoppedMidRange ?
    { blockNumber: lastProcessed.blockNumber, logIndex: lastProcessed.logIndex } :
    { blockNumber: String(through + 1n), logIndex: -1 };
  if (prior && lastProcessed === null && !windowClosed &&
      prior.batch.nextCursor.logIndex >= 0) {
    // The caller may be re-fetching the same block. It must advance past
    // the already sealed cursor without losing later log indices.
    assert.equal(from.toString(), prior.batch.nextCursor.blockNumber);
  }
  const payload = {
    schemaVersion: BATCH_SCHEMA,
    phase: 'PENDING_EXTERNAL_IMMUTABLE_SEAL',
    specSha256,
    activationDigest: digest(activation),
    originBlock: String(originNumber),
    batchIndex: prior ? prior.batch.batchIndex + 1 : 0,
    previousBatchDigest: prior ? prior.batch.batchDigest : null,
    scannedFrom: String(from),
    scannedThrough: String(through),
    scannedThroughBlockHash: hash(endPoint.hash),
    confirmedHeadBlock: String(head),
    confirmedHeadHash: hash(confirmedHead.hash),
    capturedAtMs,
    newEvents,
    enrolledEventKeys: enrolled,
    selectionCount: enrolled.length,
    scannedNativeCount: scannedNative,
    nextCursor,
    targetCountReached,
    windowClosed,
    outcomesRead: false,
    scientificStatus: 'EXPLORATORY_SELECTION_ONLY_EDGE_UNPROVEN',
    executionAuthority: false
  };
  return { ...payload, batchDigest: digest(payload) };
}
export function assertExternalSeal(batch, seal) {
  checkBatch(batch);
  assert.equal(seal?.schemaVersion, SEAL_SCHEMA, 'PONS_S1_SELECTION_NOT_EXTERNALLY_SEALED');
  assert.equal(seal.batchDigest, batch.batchDigest, 'PONS_S1_EXTERNAL_SEAL_DIGEST_MISMATCH');
  assert.equal(seal.immutable, true, 'PONS_S1_RELEASE_MUTABLE');
  assert.equal(seal.externalVerification, 'INDEPENDENT_GITHUB_RELEASE_API');
  assert.ok(Number.isSafeInteger(seal.releaseId) && seal.releaseId > 0);
  assert.ok(Number.isSafeInteger(seal.assetId) && seal.assetId > 0);
  assert.match(seal.assetSha256, /^[0-9a-f]{64}$/);
  assert.equal(seal.assetSha256, sha256Bytes(Buffer.from(JSON.stringify(canonical(batch)) + '\n')),
    'PONS_S1_RELEASE_ASSET_HASH_MISMATCH');
  const first = batch.newEvents[0]?.launchTimestampMs;
  if (first !== undefined) {
    assert.ok(Date.parse(seal.publishedAtUtc) < first + FIVE_MINUTES_MS,
      'PONS_S1_RELEASE_PUBLISHED_AFTER_FIRST_OUTCOME');
    assert.ok(batch.capturedAtMs < first + FIVE_MINUTES_MS,
      'PONS_S1_ENROLLED_AFTER_FIRST_OUTCOME');
  }
  // The caller must separately verify these metadata against the real GitHub
  // release API. Self-reported seal JSON alone conveys NO promotion authority.
  return digest(seal);
}
