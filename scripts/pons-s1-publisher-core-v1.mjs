// Inert S1 paired-protocol publication transport. NO collector, wallet or outcome API.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const BATCH_SCHEMA = 'PONS_S1_PAIRED_PREOUTCOME_DECISION_BATCH_V1';
export const AUTHORITY_SCHEMA = 'PONS_S1_PUBLISH_AUTHORITY_V1';
export const INCLUSION_RULE = 'OBSERVED_C0_COMPLETION_HEAD_PLUS_TWO_CANONICAL_BLOCKS_V1';
export const REPO = 'CipherCuttle/sentry-forensic-gate';
export const API = 'https://api.github.com/repos/' + REPO;
export const MIN_PUBLICATION_BUDGET_MS = 90_000;
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const BLOCK_HASH = /^0x[a-f0-9]{64}$/;
const ADDRESS = /^0x[a-f0-9]{40}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
const exact = (object, keys, label) => {
  assert.ok(object && typeof object === 'object' && !Array.isArray(object), label + '_OBJECT_REQUIRED');
  assert.deepEqual(Object.keys(object).sort(), [...keys].sort(), label + '_EXACT_FIELDS_REQUIRED');
};
const pos = (n, label) => assert.ok(Number.isSafeInteger(n) && n > 0, label);
const nonneg = (n, label) => assert.ok(Number.isSafeInteger(n) && n >= 0, label);
const block = (s, label) => {
  assert.match(s, /^(0|[1-9]\d*)$/, label);
  return BigInt(s);
};
const utc = (s, label) => {
  assert.match(s, ISO, label + '_UTC_REQUIRED');
  const n = Date.parse(s);
  assert.ok(Number.isSafeInteger(n) && n > 0, label + '_INVALID');
  return n;
};
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(
    Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = object => sha256(Buffer.from(JSON.stringify(canonical(object))));
export function canonicalBatchBytes(batch) {
  const data = Buffer.from(JSON.stringify(canonical(batch)) + '\n');
  assert.ok(data.length > 0 && data.length < 5_000_000, 'BATCH_ASSET_BOUNDS');
  return data;
}
const fixedFields = ['schemaVersion','phase','protocolDigest','activationCommitSha',
  'activationDigest','batchIndex','previous','scanned','census',
  'selectedEventKeys','cumulativeEligibleDecisions','capturedAtMs',
  'outcomesRead','batchDigest'];
const scanFields = ['originBlockNumber','originBlockHash','scanFromCursor',
  'scannedThrough','scannedThroughHash','nextCursor','confirmedHeadBlock',
  'factoryEventsDigest','officialEventsDigest','archiveEventsDigest'];
const cursorFields = ['blockNumber','logIndex'];
const rowFields = ['eventKey','blockNumber','blockHash','transactionHash',
  'logIndex','token','nativePair','launchTimestampMs','c0','inclusion'];
const c0Fields = ['action','decisionBlock','decisionHash','decidedAtMs',
  'evidence','evidenceSha256'];
const priorFields = ['batchDigest','assetSha256','releaseId','assetId',
  'cumulativeEligibleDecisions','nextCursor'];
function checkCursor(cursor, label) {
  exact(cursor, cursorFields, label);
  block(cursor.blockNumber, label + '_BLOCK');
  nonneg(cursor.logIndex, label + '_LOG');
}
export function checkAuthority(protocol, authority, activationSha) {
  assert.equal(protocol.schemaVersion, 'PONS_S1_SINGLE_PROTOCOL_DECISION_V1');
  assert.equal(protocol.status, 'CANONICAL_FROZEN_ACTIVE',
    'DRAFT_PROTOCOL_CANNOT_PUBLISH');
  assert.equal(protocol.population.chainId, 4663);
  assert.equal(protocol.population.maxConsecutiveEligibleDecisions, 200);
  assert.equal(protocol.population.maxWindowSeconds, 604800);
  assert.equal(protocol.population.preOutcomeC0EligibilityMustBeSealed, true);
  assert.equal(protocol.evidence.preOutcomeC0DecisionReceiptsInImmutableBatchRequired, true);
  assert.equal(protocol.timing.minimumFinalityConfirmations, 12);
  assert.equal(protocol.timing.syntheticInclusionRule,INCLUSION_RULE,
    'UNREVIEWED_OR_CAUSALLY_INVALID_SYNTHETIC_INCLUSION_RULE');
  assert.equal(protocol.timing.targetAnchor,
    'ACTUAL_TIMESTAMP_OF_PREDETERMINED_SYNTHETIC_INCLUSION_BLOCK');
  assert.deepEqual(protocol.arms.map(a => a.fixedHorizonMs), [300000, 86400000]);
  exact(authority, ['schemaVersion','status','protocolDigest','reviewedMergeSha',
    'reviewedMergePr','originBlockNumber','originBlockHash','activationDigest',
    'publicationAuthorized','collectionAuthorized','liveMoneyAuthorized',
    'signingAuthorized','broadcastAuthorized','modelPromotionAuthorized',
    'unattendedAuthorized'], 'AUTHORITY');
  assert.equal(authority.schemaVersion, AUTHORITY_SCHEMA);
  assert.equal(authority.status, 'CANONICAL_SEPARATELY_APPROVED');
  assert.equal(authority.protocolDigest, digest(protocol), 'PROTOCOL_DIGEST_MISMATCH');
  assert.match(authority.reviewedMergeSha, HEX40);
  pos(authority.reviewedMergePr, 'REVIEWED_MERGE_PR');
  block(authority.originBlockNumber, 'ORIGIN_BLOCK');
  assert.match(authority.originBlockHash, BLOCK_HASH);
  assert.match(authority.activationDigest, HEX64);
  assert.match(activationSha, HEX40, 'ACTIVATION_SHA_REQUIRED');
  assert.notEqual(activationSha, authority.reviewedMergeSha,
    'ACTIVATION_MUST_BE_SEPARATE_POST_MERGE_COMMIT');
  assert.equal(authority.publicationAuthorized, true, 'PUBLICATION_NOT_AUTHORIZED');
  assert.equal(authority.collectionAuthorized, true, 'COLLECTION_NOT_AUTHORIZED');
  for (const key of ['liveMoneyAuthorized','signingAuthorized','broadcastAuthorized',
    'modelPromotionAuthorized','unattendedAuthorized']) {
    assert.equal(authority[key], false, 'FORBIDDEN_AUTHORITY_' + key);
  }
  return authority.protocolDigest;
}
export function validateBatch(batch, protocol, authority, activationSha,
    prior = null, nowMs = Date.now()) {
  checkAuthority(protocol, authority, activationSha);
  exact(batch, fixedFields, 'BATCH');
  assert.equal(batch.schemaVersion, BATCH_SCHEMA, 'LEGACY_BATCH_FORBIDDEN');
  assert.equal(batch.phase, 'FROZEN_PREOUTCOME_NO_RESULTS');
  assert.equal(batch.outcomesRead, false, 'OUTCOME_PEEK_FORBIDDEN');
  assert.equal(batch.protocolDigest, authority.protocolDigest);
  assert.equal(batch.activationCommitSha, activationSha);
  assert.equal(batch.activationDigest, authority.activationDigest);
  nonneg(batch.batchIndex, 'BATCH_INDEX');
  nonneg(batch.cumulativeEligibleDecisions, 'CUMULATIVE_ELIGIBLE_INVALID');
  assert.ok(batch.cumulativeEligibleDecisions <= 200);
  pos(batch.capturedAtMs, 'CAPTURED_TIME_INVALID');
  assert.ok(batch.capturedAtMs <= nowMs, 'FUTURE_CAPTURE_UNTRUSTWORTHY');
  exact(batch.scanned, scanFields, 'SCAN');
  assert.equal(batch.scanned.originBlockNumber, authority.originBlockNumber);
  assert.equal(batch.scanned.originBlockHash, authority.originBlockHash);
  checkCursor(batch.scanned.scanFromCursor, 'SCAN_FROM');
  checkCursor(batch.scanned.nextCursor, 'NEXT_CURSOR');
  const from = block(batch.scanned.scanFromCursor.blockNumber, 'SCAN_FROM_BLOCK');
  const through = block(batch.scanned.scannedThrough, 'SCANNED_THROUGH');
  const next = block(batch.scanned.nextCursor.blockNumber, 'NEXT_BLOCK');
  assert.ok(through >= from && through - from < 16n, 'SCAN_RANGE_TOO_LARGE');
  assert.ok(next >= from && next <= through + 1n, 'NEXT_CURSOR_OUT_OF_RANGE');
  assert.match(batch.scanned.scannedThroughHash, BLOCK_HASH);
  const confirmed = block(batch.scanned.confirmedHeadBlock, 'CONFIRMED_HEAD');
  assert.ok(confirmed >= through + 12n, 'TWELVE_CONFIRMATIONS_MISSING');
  if (batch.batchIndex === 0) {
    assert.equal(batch.previous, null, 'GENESIS_MUST_NOT_INVENT_PRIOR');
    assert.equal(prior, null, 'UNEXPECTED_PREVIOUS_PROOF');
    assert.equal(from, block(authority.originBlockNumber, 'ORIGIN'));
    assert.equal(batch.scanned.scanFromCursor.logIndex, 0);
  } else {
    exact(batch.previous, priorFields, 'PRIOR_POINTER');
    assert.ok(prior && prior.independentLiveGitHubCheck === true,
      'PREVIOUS_IMMUTABLE_RELEASE_PROOF_REQUIRED');
    assert.equal(batch.previous.batchDigest, prior.batch.batchDigest);
    assert.equal(batch.previous.assetSha256, prior.assetSha256);
    assert.ok(Number.isSafeInteger(prior.publishedAtMs) &&
      prior.publishedAtMs <= batch.capturedAtMs,
      'PREVIOUS_SEAL_AFTER_CURRENT_CAPTURE');
    assert.equal(batch.previous.releaseId, prior.releaseId);
    assert.equal(batch.previous.assetId, prior.assetId);
    assert.equal(batch.previous.cumulativeEligibleDecisions,
      prior.batch.cumulativeEligibleDecisions);
    assert.deepEqual(batch.previous.nextCursor, prior.batch.scanned.nextCursor);
    assert.equal(batch.batchIndex, prior.batch.batchIndex + 1);
    assert.deepEqual(batch.scanned.scanFromCursor, prior.batch.scanned.nextCursor,
      'CURSOR_LINEAGE_BROKEN');
    assert.equal(prior.batch.activationCommitSha, activationSha);
    assert.equal(prior.batch.protocolDigest, batch.protocolDigest);
  }
  assert.ok(Array.isArray(batch.census) && batch.census.length <= 4096);
  assert.ok(Array.isArray(batch.selectedEventKeys));
  let lastBlock = -1n, lastLog = -1, eligible = [], deadlines = [];
  const identities = [];
  const seenTokens = new Set(), seenEvents = new Set();
  for (const row of batch.census) {
    exact(row, rowFields, 'CENSUS_ROW');
    const n = block(row.blockNumber, 'EVENT_BLOCK');
    assert.ok(n >= from && n <= through, 'EVENT_OUTSIDE_SCAN');
    assert.match(row.blockHash, BLOCK_HASH);
    assert.match(row.transactionHash, BLOCK_HASH);
    assert.match(row.token, ADDRESS);
    nonneg(row.logIndex, 'EVENT_LOG_INDEX');
    assert.equal(row.eventKey,
      row.blockNumber + ':' + row.transactionHash + ':' + row.logIndex);
    assert.ok(n > lastBlock || n === lastBlock && row.logIndex > lastLog,
      'CENSUS_NOT_STRICT_CHAIN_ORDER');
    if (n === from) {
      assert.ok(row.logIndex >= batch.scanned.scanFromCursor.logIndex,
        'CURSOR_REPLAY');
    }
    assert.ok(!seenEvents.has(row.eventKey), 'DUPLICATE_EVENT');
    seenEvents.add(row.eventKey);
    assert.ok(!seenTokens.has(row.token), 'DUPLICATE_TOKEN_IN_BATCH');
    seenTokens.add(row.token);
    if (n === through) assert.equal(row.blockHash,
      batch.scanned.scannedThroughHash, 'SCANNED_THROUGH_EVENT_HASH_MISMATCH');
    lastBlock = n; lastLog = row.logIndex;
    assert.equal(typeof row.nativePair, 'boolean');
    pos(row.launchTimestampMs, 'LAUNCH_TIMESTAMP');
    identities.push({eventKey:row.eventKey,blockHash:row.blockHash,
      token:row.token,nativePair:row.nativePair});
    if (!row.nativePair) {
      assert.equal(row.c0, null, 'NONNATIVE_MUST_NOT_BE_ENROLLED');
      assert.equal(row.inclusion, null, 'NONNATIVE_INCLUSION_FORBIDDEN');
      continue;
    }
    deadlines.push(row.launchTimestampMs + 300_000);
    exact(row.c0, c0Fields, 'C0');
    assert.ok(['WOULD_TRADE','REJECT','UNKNOWN_PREOUTCOME_C0'].includes(row.c0.action));
    assert.equal(block(row.c0.decisionBlock, 'C0_BLOCK'), n + 2n);
    assert.match(row.c0.decisionHash, BLOCK_HASH);
    pos(row.c0.decidedAtMs, 'C0_DECISION_TIME');
    assert.ok(row.c0.decidedAtMs <= batch.capturedAtMs,
      'POST_CAPTURE_DECISION_FORBIDDEN');
    assert.ok(confirmed >= n + 14n, 'C0_NOT_TWELVE_CONFIRMED');
    assert.ok(row.c0.evidence && typeof row.c0.evidence === 'object' &&
      !Array.isArray(row.c0.evidence), 'C0_POINT_IN_TIME_EVIDENCE_REQUIRED');
    assert.equal(row.c0.evidenceSha256, digest(row.c0.evidence),
      'C0_EVIDENCE_DIGEST_MISMATCH');
    assert.equal(row.c0.evidence.syntheticInclusionRule,INCLUSION_RULE,
      'C0_UNREVIEWED_INCLUSION_RULE');
    assert.equal(row.c0.evidence.observedC0CompletionAtMs,row.c0.decidedAtMs,
      'C0_OBSERVATION_TIME_NOT_BOUND');
    const observedHead=block(row.c0.evidence.observedHeadBlock,
      'C0_OBSERVED_HEAD_BLOCK');
    assert.ok(observedHead>=n+4n,
      'C0_OBSERVED_BEFORE_TWO_DECISION_CONFIRMATIONS');
    assert.match(row.c0.evidence.observedHeadHash,BLOCK_HASH,
      'C0_OBSERVED_HEAD_HASH_REQUIRED');
    // Opaque source evidence still requires independent collector qualification.
    assert.ok(!Object.hasOwn(row.c0.evidence, 'futureOutcome'),
      'POST_OUTCOME_EVIDENCE_FORBIDDEN');
    if (row.c0.action === 'UNKNOWN_PREOUTCOME_C0') {
      assert.equal(row.inclusion, null, 'UNKNOWN_C0_CANNOT_INFER_ENTRY');
      assert.match(row.c0.evidence.reason ?? '', /^.{1,160}$/);
    } else if (row.c0.action === 'REJECT') {
      assert.equal(row.inclusion, null, 'REJECT_CANNOT_INFER_ENTRY');
    } else {
      exact(row.inclusion, ['blockNumber','blockHash','timestampMs'],
        'INCLUSION');
      assert.equal(block(row.inclusion.blockNumber, 'INCLUSION_BLOCK'),
        observedHead+2n,'CAUSALLY_INVALID_INCLUSION_ANCHOR');
      assert.match(row.inclusion.blockHash, BLOCK_HASH);
      pos(row.inclusion.timestampMs, 'INCLUSION_TIMESTAMP');
      assert.ok(row.inclusion.timestampMs >= row.c0.decidedAtMs,
        'INCLUSION_TIMESTAMP_PRECEDES_C0_COMPLETION');
      assert.ok(row.inclusion.timestampMs <= batch.capturedAtMs,
        'FUTURE_INCLUSION_LOOKAHEAD_FORBIDDEN');
      assert.ok(confirmed >= block(row.inclusion.blockNumber,'INCLUSION_BLOCK')+12n,
        'INCLUSION_NOT_TWELVE_CONFIRMED');
      deadlines.push(row.inclusion.timestampMs + 300_000);
      eligible.push(row.eventKey);
    }
  }
  assert.deepEqual(batch.selectedEventKeys, eligible,
    'SELECTED_MUST_MATCH_ALL_CONSECUTIVE_C0_DECISIONS');
  assert.ok(eligible.length <= 4, 'MICROBATCH_TOO_LARGE');
  // Empty scans are still evidence: they bind the consecutive zero-event
  // denominator and cursor. They receive an operational expiry, never an
  // invented market outcome deadline.
  assert.equal(batch.scanned.factoryEventsDigest, digest(identities),
    'FACTORY_CENSUS_DIGEST_MISMATCH');
  assert.equal(batch.scanned.officialEventsDigest, batch.scanned.factoryEventsDigest,
    'OFFICIAL_SOURCE_DIGEST_MISMATCH');
  assert.equal(batch.scanned.archiveEventsDigest, batch.scanned.factoryEventsDigest,
    'ARCHIVE_SOURCE_DIGEST_MISMATCH');
  assert.equal(batch.cumulativeEligibleDecisions,
    (prior ? prior.batch.cumulativeEligibleDecisions : 0) + eligible.length,
    'HIDDEN_ELIGIBLE_DECISION');
  const nextCursor = batch.scanned.nextCursor;
  assert.ok(next === through || next === through+1n,
    'CURSOR_CANNOT_SKIP_OR_RESCAN_PARTIAL_RANGE');
  if (next === through + 1n) assert.equal(nextCursor.logIndex, 0);
  if (next === through) {
    assert.equal(lastBlock, through,'SAME_BLOCK_RESUME_WITHOUT_FINAL_EVENT');
    assert.ok(nextCursor.logIndex > lastLog,'NEXT_CURSOR_REPEATS_LAST_EVENT');
  }
  const {batchDigest, ...payload} = batch;
  assert.equal(batchDigest, digest(payload), 'BATCH_DIGEST_MISMATCH');
  assert.match(batchDigest, HEX64);
  const deadline = deadlines.length ? Math.min(...deadlines) :
    batch.capturedAtMs + 600_000;
  assert.ok(Number.isSafeInteger(deadline), 'BAD_DEADLINE');
  assert.ok(batch.capturedAtMs < deadline, 'CAPTURED_AFTER_FIRST_OUTCOME');
  assert.ok(Number.isSafeInteger(nowMs) &&
    nowMs + MIN_PUBLICATION_BUDGET_MS < deadline,
    'INSUFFICIENT_PREOUTCOME_PUBLICATION_BUDGET');
  return {batchDigest, deadline, earliestOutcomeMs:deadline,
    assetSha256:sha256(canonicalBatchBytes(batch)), selectedCount:eligible.length,
    totalFactoryCount:batch.census.length, deadlineKind: deadlines.length ?
      'EARLIEST_NATIVE_PREOUTCOME' : 'EMPTY_OR_NONNATIVE_OPERATIONAL_EXPIRY'};
}
export function planPublication(bytes, protocol, authority, activationSha, prior, nowMs) {
  assert.ok(Buffer.isBuffer(bytes), 'EXACT_BYTES_REQUIRED');
  let batch;
  try { batch = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('INVALID_BATCH_JSON'); }
  assert.ok(bytes.equals(canonicalBatchBytes(batch)),
    'BATCH_BYTES_NOT_CANONICAL_EXACT');
  const checked = validateBatch(batch, protocol, authority, activationSha, prior, nowMs);
  const tag = 'pons-s1-paired-v1-batch-' + checked.batchDigest;
  return {schemaVersion:'PONS_S1_PUBLISH_PLAN_V1',
    tag, assetName:tag+'.json', batchDigest:checked.batchDigest,
    assetSha256:checked.assetSha256, assetSize:bytes.length,
    activationCommitSha:activationSha, deadlineMs:checked.deadline,
    deadlineKind:checked.deadlineKind,
    source:'FROZEN_BATCH_BYTES_UNMODIFIED', published:false,
    independentWitnessRequired:true, liveMoneyAuthorized:false};
}
// Publisher read-back is a consistency check, never the independent witness.
export function verifyReadBack(plan, bytes, release, asset, tagRef) {
  assert.equal(sha256(bytes), plan.assetSha256, 'ASSET_CHANGED_AFTER_FREEZE');
  pos(release?.id, 'RELEASE_ID');
  pos(asset?.id, 'ASSET_ID');
  assert.equal(release?.url, API+'/releases/'+release.id);
  assert.equal(release?.tag_name, plan.tag);
  assert.equal(release?.immutable, true, 'RELEASE_NOT_IMMUTABLE');
  assert.equal(release?.draft, false, 'RELEASE_STILL_DRAFT');
  assert.ok(Array.isArray(release.assets) && release.assets.length === 1,
    'SINGLETON_ASSET_REQUIRED');
  assert.equal(release.assets[0]?.id, asset.id);
  assert.equal(asset?.url, API+'/releases/assets/'+asset.id);
  assert.equal(asset?.browser_download_url,
    'https://github.com/'+REPO+'/releases/download/'+plan.tag+'/'+plan.assetName);
  assert.equal(asset?.name, plan.assetName);
  assert.equal(asset?.size, bytes.length);
  assert.equal(asset?.state, 'uploaded');
  assert.equal(asset?.digest, 'sha256:'+plan.assetSha256,
    'GITHUB_ASSET_DIGEST_MISMATCH');
  for (const k of ['id','name','size','state','digest','url','created_at',
    'updated_at','browser_download_url']) assert.deepEqual(release.assets[0][k],
    asset[k], 'TWO_ENDPOINTS_DISAGREE_'+k);
  assert.equal(tagRef?.ref, 'refs/tags/'+plan.tag);
  assert.equal(tagRef?.url, API+'/git/refs/tags/'+plan.tag);
  assert.equal(tagRef?.object?.type, 'commit');
  assert.equal(tagRef?.object?.sha, plan.activationCommitSha);
  const published = utc(release.published_at, 'PUBLISHED');
  const created = utc(asset.created_at, 'ASSET_CREATED');
  const updated = utc(asset.updated_at, 'ASSET_UPDATED');
  assert.ok(created <= updated && updated <= published,
    'ASSET_MUTATED_AFTER_PUBLICATION');
  // GitHub REST timestamps can be whole seconds: use upper bound, not the
  // optimistic start of the published second.
  const resolutionMs = /\.\d+Z$/.test(release.published_at) ? 1 : 1000;
  assert.ok(published + resolutionMs < plan.deadlineMs,
    'RELEASE_PUBLISHED_TOO_LATE');
  return {schemaVersion:'PONS_S1_PUBLISHER_SELF_READBACK_V1',
    releaseId:release.id,assetId:asset.id,tag:plan.tag,
    activationCommitSha:plan.activationCommitSha,batchDigest:plan.batchDigest,
    assetSha256:plan.assetSha256,publishedAtUtc:release.published_at,
    immutable:true,exactBytes:true,independentWitness:false,
    prospectiveEvidenceAdmissible:false,liveMoneyAuthorized:false};
}
