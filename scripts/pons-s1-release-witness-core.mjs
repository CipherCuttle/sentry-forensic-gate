import assert from 'node:assert/strict';
import {
  SEAL_SCHEMA, assertExternalSeal, canonical, checkBatch, sha256Bytes
} from './pons-s1-collector-core.mjs';

export const WITNESS_SCHEMA = 'PONS_S1_GITHUB_IMMUTABLE_RELEASE_WITNESS_V0';
export const WITNESS_REPOSITORY = 'CipherCuttle/sentry-forensic-gate';
const API = 'https://api.github.com/repos/' + WITNESS_REPOSITORY;
const WEB = 'https://github.com/' + WITNESS_REPOSITORY;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;

function exactTime(value, label) {
  assert.match(value, ISO_UTC, label + '_NOT_UTC');
  const ms = Date.parse(value);
  assert.ok(Number.isSafeInteger(ms) && ms > 0, label + '_INVALID');
  return ms;
}
function validId(value, label) {
  assert.ok(Number.isSafeInteger(value) && value > 0, label + '_INVALID');
}
export function canonicalBatchBytes(batch) {
  checkBatch(batch);
  return Buffer.from(JSON.stringify(canonical(batch)) + '\n', 'utf8');
}
export function buildGitHubImmutableWitness(input) {
  const {
    expectedBatchDigest, expectedReleaseId, expectedAssetId,
    expectedActivationCommitSha, release, asset, tagRef, assetBytes
  } = input;
  assert.match(expectedBatchDigest, SHA256, 'PONS_S1_EXPECTED_BATCH_DIGEST_INVALID');
  assert.match(expectedActivationCommitSha, COMMIT_SHA,
    'PONS_S1_ACTIVATION_COMMIT_SHA_INVALID');
  validId(expectedReleaseId, 'PONS_S1_EXPECTED_RELEASE_ID');
  validId(expectedAssetId, 'PONS_S1_EXPECTED_ASSET_ID');
  assert.ok(Buffer.isBuffer(assetBytes), 'PONS_S1_ASSET_BYTES_NOT_BUFFER');
  assert.ok(assetBytes.length > 0 && assetBytes.length < 5_000_000,
    'PONS_S1_ASSET_SIZE_OUT_OF_BOUNDS');

  let batch;
  try {
    batch = JSON.parse(assetBytes.toString('utf8'));
  } catch {
    throw new Error('PONS_S1_ASSET_NOT_VALID_BATCH_JSON');
  }
  const expectedBytes = canonicalBatchBytes(batch);
  assert.ok(assetBytes.equals(expectedBytes), 'PONS_S1_ASSET_NOT_EXACT_CANONICAL_BATCH_BYTES');
  assert.equal(batch.batchDigest, expectedBatchDigest,
    'PONS_S1_BATCH_DIGEST_NOT_OPERATOR_FROZEN');
  assert.match(batch.specSha256, SHA256, 'PONS_S1_BATCH_SPEC_UNBOUND');
  assert.match(batch.activationDigest, SHA256, 'PONS_S1_BATCH_ACTIVATION_UNBOUND');
  assert.ok(Number.isSafeInteger(batch.capturedAtMs), 'PONS_S1_BATCH_CAPTURE_TIME_INVALID');

  const assetSha256 = sha256Bytes(assetBytes);
  const tag = 'pons-s1-batch-' + batch.batchDigest;
  const assetName = tag + '.json';
  assert.equal(release?.id, expectedReleaseId, 'PONS_S1_RELEASE_ID_MISMATCH');
  assert.equal(release?.url, API + '/releases/' + expectedReleaseId,
    'PONS_S1_RELEASE_REPOSITORY_MISMATCH');
  assert.equal(release?.tag_name, tag, 'PONS_S1_RELEASE_TAG_MISMATCH');
  assert.equal(release?.draft, false, 'PONS_S1_RELEASE_NOT_PUBLISHED');
  assert.equal(release?.immutable, true, 'PONS_S1_RELEASE_NOT_IMMUTABLE');
  const publishedMs = exactTime(release.published_at, 'PONS_S1_RELEASE_PUBLISHED_AT');
  assert.ok(publishedMs >= batch.capturedAtMs - 30_000,
    'PONS_S1_RELEASE_PREDATES_CAPTURED_BATCH');
  assert.ok(Array.isArray(release.assets) && release.assets.length === 1,
    'PONS_S1_RELEASE_REQUIRES_EXACT_ONE_ASSET');
  assert.equal(release.assets[0]?.id, expectedAssetId,
    'PONS_S1_RELEASE_ASSET_NOT_ENUMERATED');

  assert.equal(tagRef?.ref, 'refs/tags/' + tag, 'PONS_S1_RELEASE_TAG_REF_MISMATCH');
  assert.equal(tagRef?.object?.type, 'commit',
    'PONS_S1_RELEASE_REQUIRES_LIGHTWEIGHT_CANONICAL_TAG');
  assert.equal(tagRef?.object?.sha, expectedActivationCommitSha,
    'PONS_S1_RELEASE_TAG_WRONG_ACTIVATION_COMMIT');
  assert.equal(tagRef?.url, API + '/git/refs/tags/' + tag,
    'PONS_S1_TAG_REF_REPOSITORY_MISMATCH');

  assert.equal(asset?.id, expectedAssetId, 'PONS_S1_ASSET_ID_MISMATCH');
  assert.equal(asset?.url, API + '/releases/assets/' + expectedAssetId,
    'PONS_S1_ASSET_REPOSITORY_MISMATCH');
  assert.equal(asset?.name, assetName, 'PONS_S1_ASSET_NAME_MISMATCH');
  assert.equal(asset?.browser_download_url,
    WEB + '/releases/download/' + tag + '/' + assetName,
    'PONS_S1_ASSET_DOWNLOAD_LOCATION_MISMATCH');
  assert.equal(asset?.state, 'uploaded', 'PONS_S1_RELEASE_ASSET_NOT_UPLOADED');
  assert.equal(asset?.size, assetBytes.length, 'PONS_S1_RELEASE_ASSET_SIZE_MISMATCH');
  assert.equal(asset?.digest, 'sha256:' + assetSha256,
    'PONS_S1_RELEASE_ASSET_API_DIGEST_MISMATCH');
  const assetCreatedMs = exactTime(asset.created_at, 'PONS_S1_ASSET_CREATED_AT');
  const assetUpdatedMs = exactTime(asset.updated_at, 'PONS_S1_ASSET_UPDATED_AT');
  assert.ok(assetCreatedMs >= batch.capturedAtMs - 30_000,
    'PONS_S1_RELEASE_ASSET_PREDATES_CAPTURED_BATCH');
  assert.ok(assetCreatedMs <= assetUpdatedMs && assetUpdatedMs <= publishedMs,
    'PONS_S1_RELEASE_ASSET_CHANGED_AFTER_PUBLICATION');

  // Verify both independently requested REST objects agree on identity
  // and checksum; local copies cannot substitute for the read-only job.
  for (const key of ['id','name','size','digest','state','created_at','updated_at',
    'url','browser_download_url']) {
    assert.deepEqual(release.assets[0][key], asset[key],
      'PONS_S1_RELEASE_ASSET_TWO_ENDPOINT_DISAGREEMENT:' + key);
  }
  const firstMaturityMs = batch.newEvents.length
    ? Math.min(...batch.newEvents.map(row => row.launchTimestampMs + 300_000))
    : null;
  assert.ok(batch.newEvents.every(row => Number.isSafeInteger(row.launchTimestampMs)
    && row.launchTimestampMs > 0), 'PONS_S1_BAD_SELECTED_LAUNCH_TIME');
  if (firstMaturityMs !== null) {
    assert.ok(batch.capturedAtMs < firstMaturityMs,
      'PONS_S1_BATCH_CAPTURE_AFTER_FIRST_OUTCOME');
    assert.ok(publishedMs < firstMaturityMs,
      'PONS_S1_RELEASE_PUBLISHED_AFTER_FIRST_OUTCOME');
  }
  const seal = {
    schemaVersion: SEAL_SCHEMA,
    batchDigest: batch.batchDigest,
    immutable: true,
    externalVerification: 'INDEPENDENT_GITHUB_RELEASE_API',
    releaseId: release.id,
    assetId: asset.id,
    assetSha256,
    publishedAtUtc: release.published_at,
    tagName: tag,
    activationCommitSha: expectedActivationCommitSha
  };
  assertExternalSeal(batch, seal);
  const witness = {
    schemaVersion: WITNESS_SCHEMA,
    repository: WITNESS_REPOSITORY,
    releaseId: release.id, assetId: asset.id,
    tagName: tag, tagCommitSha: expectedActivationCommitSha,
    batchDigest: batch.batchDigest, specSha256: batch.specSha256,
    activationDigest: batch.activationDigest,
    publishedAtUtc: release.published_at,
    assetCreatedAtUtc: asset.created_at,
    assetSha256, assetBytes: assetBytes.length,
    releaseApiSha256: sha256Bytes(Buffer.from(JSON.stringify(canonical(release)))),
    assetApiSha256: sha256Bytes(Buffer.from(JSON.stringify(canonical(asset)))),
    tagApiSha256: sha256Bytes(Buffer.from(JSON.stringify(canonical(tagRef)))),
    firstPrimaryOutcomeAvailableMs: firstMaturityMs,
    immutableRelease: true,
    limits: 'PROVES_EXACT_BYTES_AND_PRE_OUTCOME_PUBLICATION_NOT_COMPLETE_COHORT_OR_PROFIT',
    moneyAuthority: false, modelPromotionAuthority: false,
    scientificAuthority: 'NONE_UNTIL_CANONICAL_ACTIVATION_AND_INDEPENDENT_COHORT_COMPLETENESS'
  };
  return { batch, seal, witness };
}
