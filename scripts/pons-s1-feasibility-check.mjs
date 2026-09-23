import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const evidence = new URL('docs/evidence/pons-s0-real-cohort-v1/', root);
const spec = JSON.parse(await readFile(new URL('docs/experiments/pons-s1-five-minute-feasibility-v0.json', root), 'utf8'));
const summary = JSON.parse(await readFile(new URL('summary.json', evidence), 'utf8'));
const origin = JSON.parse(await readFile(new URL('origin-receipt.json', evidence), 'utf8'));
const featuresRaw = await readFile(new URL('features.jsonl', evidence));
const outcomesRaw = await readFile(new URL('outcomes.jsonl', evidence));
const manifestRaw = await readFile(new URL('manifest.json', evidence));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const parseJsonl = (bytes) => bytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
const countBy = (rows, getKey) => rows.reduce((counts, row) => {
  const value = getKey(row);
  const key = value == null ? 'NONE' : String(value);
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {});
const sorted = (value) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
function assertHistoricalFingerprint(actual, expected) {
  for (const key of Object.keys(expected)) {
    if (typeof expected[key] === 'object' && expected[key] !== null) {
      assert.deepStrictEqual(sorted(actual[key]), sorted(expected[key]), 'S0 historical fingerprint drift: ' + key);
    } else {
      assert.equal(actual[key], expected[key], 'S0 historical fingerprint drift: ' + key);
    }
  }
}

// Entirely read-only. Refuse any plan claiming collection or economic authority.
assert.equal(spec.schemaVersion, 'PONS_S1_FIVE_MINUTE_FEASIBILITY_PREREG_V0');
assert.equal(spec.state, 'DRAFT_REVIEW_ONLY_NOT_ACTIVE');
assert.equal(spec.hypothesisOrigin, 'REGISTERED_AFTER_INSPECTION_OF_FAILED_S0_24H_OUTCOMES');
assert.equal(spec.prospective.forbiddenHistoricalReuse, true);
assert.equal(spec.prospective.primaryExit.horizonMs, 300000);
assert.equal(spec.prospective.entryNotionalUsdMicros, 1000000);
assert.equal(spec.prospective.maxUniqueNativePairLaunches, 96);
assert.equal(spec.prospective.learningOrModelFitting, false);
assert.equal(spec.prospective.independentSameStateReverseIsNotSequentialPnL, true);
assert.equal(spec.prospective.diagnosticsNotEligibleForPrimaryReranking, true);
assert.equal(spec.prospective.pilotSampleIsNotConfirmatory, true);
assert.ok(Object.values(spec.authority).every((value) => value === false), 'Unexpected permission in draft experiment');

assert.equal(sha256(featuresRaw), origin.artifacts.featureStreamSha256, 'Feature stream hash mismatch');
assert.equal(sha256(outcomesRaw), origin.artifacts.outcomeStreamSha256, 'Outcome stream hash mismatch');
assert.equal(sha256(manifestRaw), origin.artifacts.manifestFileSha256, 'Manifest file hash mismatch');
assert.equal(origin.evidenceDigest, spec.source.s0OriginEvidenceDigest, 'Unexpected S0 origin');
assert.equal(origin.source.repositoryCommit, spec.source.reviewedExportSourceCommit);
assert.equal(summary.originEvidenceDigest, origin.evidenceDigest);
assert.equal(summary.manifestId, origin.artifacts.manifestId);

const features = parseJsonl(featuresRaw);
const outcomes = parseJsonl(outcomesRaw);
assert.equal(features.length, summary.featurePacketCount, 'Feature count mismatch');
assert.equal(outcomes.length, summary.outcomePacketCount, 'Outcome count mismatch');
assert.equal(features.length, summary.selectedLaunchCount, 'Raw denominator mismatch');
assert.equal(outcomes.length, origin.artifacts.outcomePacketCount, 'Origin outcome count mismatch');
assert.deepStrictEqual(sorted(summary.baselineStatusCounts), sorted({ COMPLETE: 57, UNVERIFIED: 39 }));
assert.equal(features.filter(row => row.baseline?.status === 'UNVERIFIED').length, 39, 'Missing-baseline count mismatch');
assert.ok(outcomes.every(row => row.status === 'COMPLETE'), 'Unexpected unresolved outcome');
assert.ok(outcomes.every(row => row.horizonMs === 86400000), 'Unexpected historical exit horizon');
assert.ok(outcomes.every(row => row.costProjection?.status === 'UNVERIFIED_EXECUTION_COST'), 'Misrepresented verified cost coverage');
assert.equal(new Set(outcomes.map(row => row.launchId)).size, outcomes.length, 'Duplicate outcome launch');

const outcomeClassCounts = countBy(outcomes, row => row.classification);
outcomeClassCounts.NORMAL_WIN ??= 0; // A zero-count registered class is absent from raw rows, not unknown.
const actual = {
  selectedLaunches: summary.selectedLaunchCount,
  featurePackets: features.length,
  complete24hOutcomes: outcomes.length,
  unverifiedBaselines: features.filter(row => row.baseline?.status === 'UNVERIFIED').length,
  outcomeClassCounts,
  outcomeReasonCounts: countBy(outcomes, row => row.reason),
  executableExitCount: outcomes.filter(row => row.exitExecutable === true).length,
  nonExecutableExitCount: outcomes.filter(row => row.exitExecutable === false).length,
  verifiedFullCostCount: outcomes.filter(row => row.costProjection?.status === 'COMPLETE').length,
  allOutcomesHorizonMs: 86400000
};
assertHistoricalFingerprint(actual, spec.historicalS0);
// Negative test: in-memory tampering must be rejected. No evidence file changes.
assert.throws(
  () => assertHistoricalFingerprint({ ...actual, unverifiedBaselines: actual.unverifiedBaselines - 1 }, spec.historicalS0),
  /historical fingerprint drift/
);
console.log(JSON.stringify({
  verdict: 'PONS_S1_PREREG_SOURCE_AUDIT_PASS_NO_ACTIVATION',
  status: spec.state,
  immutableEvidenceCommit: spec.source.immutableS0EvidenceCommit,
  featureStreamSha256: sha256(featuresRaw),
  outcomeStreamSha256: sha256(outcomesRaw),
  observed: actual,
  edge: 'UNPROVEN',
  collectorAuthorized: false,
  liveMoneyAuthorized: false,
  promotionAuthorized: false
}, null, 2));
