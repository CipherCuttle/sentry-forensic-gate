#!/usr/bin/env node
// Read-only S0 coverage audit for S1 design. Never derives a new target or a strategy score.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 'PONS_S1_MEASUREMENT_AUDIT_V1';
const evidenceArg = process.argv.indexOf('--evidence');
if (evidenceArg === -1 || !process.argv[evidenceArg + 1] || process.argv.length !== 4) {
  console.error('usage: node scripts/pons-s1-measurement-audit.mjs --evidence <frozen-cohort-dir>');
  process.exit(2);
}
const evidence = process.argv[evidenceArg + 1];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const parseJsonl = (bytes, label) => bytes.toString('utf8').trimEnd().split('
').filter(Boolean).map((line, index) => {
  try { return JSON.parse(line); }
  catch { throw new Error(`${label}: malformed JSON at line ${index + 1}`); }
});
const tally = (list, getKey) => Object.fromEntries(
  [...list.reduce((counts, value) => {
    const key = String(getKey(value));
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map())].sort(([a], [b]) => a.localeCompare(b))
);
const requireString = (value, name) => assert.ok(typeof value === 'string' && value.length > 0, name);

try {
  const files = ['features.jsonl', 'outcomes.jsonl', 'manifest.json', 'origin-receipt.json', 'summary.json'];
  const fileBytes = Object.fromEntries(await Promise.all(files.map(async name => [name, await readFile(join(evidence, name))])));
  const sums = await readFile(join(evidence, 'SHA256SUMS'), 'utf8');
  const expected = new Map(sums.trim().split('
').map(line => {
    const match = /^([a-f0-9]{64})\s+cohort\/(.+)$/.exec(line.trim());
    assert.ok(match, 'malformed SHA256SUMS line');
    return [match[2], match[1]];
  }));
  assert.equal(expected.size, files.length, 'SHA256SUMS cardinality mismatch');
  for (const name of files) assert.equal(sha256(fileBytes[name]), expected.get(name), `${name}: SHA256 mismatch`);

  const origin = JSON.parse(fileBytes['origin-receipt.json']);
  const manifest = JSON.parse(fileBytes['manifest.json']);
  const summary = JSON.parse(fileBytes['summary.json']);
  const features = parseJsonl(fileBytes['features.jsonl'], 'features');
  const outcomes = parseJsonl(fileBytes['outcomes.jsonl'], 'outcomes');
  assert.equal(origin.source.repositoryCommit, '493c85b8d84565cedf6e936063549edfa02edf3a');
  assert.equal(origin.evidenceDigest, '31dd06dca9555954c2ca4546c8e75a9f3a2e9db33062c56076928b16919761ce', 'unexpected frozen origin');
  assert.equal(origin.materialization.launchIndexSha256, '00af1e630831ccdd3658559627964ca4d1c5b64b488f1aca5a429b28323eb5eb', 'unexpected launch index');
  assert.equal(origin.frozenAuthority.selectedLaunchCount, 96);
  assert.equal(origin.frozenAuthority.targetPerformanceInspectedForSelection, false);
  assert.equal(origin.boundaries.edge, 'UNPROVEN');
  assert.equal(origin.boundaries.liveMoneyAuthority, false);
  assert.equal(origin.artifacts.featureStreamSha256, expected.get('features.jsonl'));
  assert.equal(origin.artifacts.outcomeStreamSha256, expected.get('outcomes.jsonl'));
  assert.equal(origin.artifacts.manifestFileSha256, expected.get('manifest.json'));
  assert.equal(manifest.featureStreamSha256, expected.get('features.jsonl'));
  assert.equal(manifest.outcomeStreamSha256, expected.get('outcomes.jsonl'));
  assert.equal(manifest.featurePacketCount, features.length);
  assert.equal(manifest.outcomePacketCount, outcomes.length);
  assert.equal(summary.featurePacketCount, features.length);
  assert.equal(summary.outcomePacketCount, outcomes.length);
  assert.equal(summary.originEvidenceDigest, origin.evidenceDigest);

  const featuresByKey = new Map();
  for (const f of features) {
    assert.equal(f.schemaVersion, 'PONS_S0_FEATURE_PACKET_V1');
    const key = `${f.launch.launchId}:${f.baseline.baselineId}`;
    assert.ok(!featuresByKey.has(key), `duplicate feature ${key}`);
    featuresByKey.set(key, f);
  }
  const outcomesByKey = new Map();
  for (const o of outcomes) {
    assert.equal(o.schemaVersion, 'PONS_S0_OUTCOME_PACKET_V1');
    const key = `${o.launchId}:${o.baselineId}`;
    assert.ok(featuresByKey.has(key), `unbound outcome ${key}`);
    assert.ok(!outcomesByKey.has(key), `duplicate outcome ${key}`);
    assert.equal(o.horizonMs, 86400000);
    assert.equal(o.status, 'COMPLETE', `incomplete exported outcome ${key}`);
    assert.equal(featuresByKey.get(key).baseline.status, 'COMPLETE', `outcome bound to incomplete baseline ${key}`);
    outcomesByKey.set(key, o);
  }

  const complete = features.filter(f => f.baseline.status === 'COMPLETE');
  const incomplete = features.filter(f => f.baseline.status === 'UNVERIFIED');
  assert.equal(complete.length + incomplete.length, features.length, 'unexpected baseline status');
  for (const f of complete) assert.ok(outcomesByKey.has(`${f.launch.launchId}:${f.baseline.baselineId}`), 'missing 24h outcome for COMPLETE baseline');
  for (const f of incomplete) assert.ok(!outcomesByKey.has(`${f.launch.launchId}:${f.baseline.baselineId}`), 'UNVERIFIED baseline has an outcome');

  const unsupported = incomplete.filter(f => f.baseline.reason?.startsWith('ROBINHOOD_USD_CALIBRATION_UNSUPPORTED_BASE:'));
  const otherIncomplete = incomplete.filter(f => !unsupported.includes(f));
  const unsupportedAssets = tally(unsupported, f => f.baseline.reason.split(':')[1]);
  for (const o of outcomes) {
    requireString(o.outcomeAuthorityDigest, 'missing outcome authority digest');
    requireString(o.sourceAuthorityDigest, 'missing source authority digest');
    assert.equal(o.costProjection.status, 'UNVERIFIED_EXECUTION_COST', 'unexpected net-cost state requires separate audit');
    assert.equal(o.costProjection.netExecutableValueUsdMicros, null, 'net value without verified costs');
  }

  const report = {
    schemaVersion: SCHEMA,
    source: {
      originEvidenceDigest: origin.evidenceDigest,
      manifestId: origin.artifacts.manifestId,
      frozenSourceCommit: origin.source.repositoryCommit,
      launchIndexSha256: origin.materialization.launchIndexSha256,
      frozenAsOfBlock: origin.frozenAuthority.asOfBlock,
      selectedLaunchCount: features.length,
      population: 'SYSTEMATIC_SAMPLE_MATURE_PONS_V2_ALL_PAIR_ASSETS'
    },
    baseline: {
      statusCounts: tally(features, f => f.baseline.status),
      unverifiedReasonFamilies: tally(incomplete, f => f.baseline.reason?.split(':')[0] ?? 'MISSING_REASON'),
      unsupportedBaseCount: unsupported.length,
      unsupportedDistinctBaseAssets: Object.keys(unsupportedAssets).length,
      unsupportedBaseAssetCounts: unsupportedAssets,
      otherUnverifiedCount: otherIncomplete.length,
      supportedBaselineVenues: tally(complete, f => f.baseline.venue ?? 'NOT_EXPORTED')
    },
    outcome24h: {
      resolvedCount: outcomes.length,
      unobservedBecauseBaselineUnverified: incomplete.length,
      classificationCounts: tally(outcomes, o => o.classification ?? 'UNCLASSIFIED'),
      exitExecutableCounts: tally(outcomes, o => o.exitExecutable),
      liquidityStateCounts: tally(outcomes, o => o.liquidityState),
      exitFailureReasons: tally(outcomes.filter(o => !o.exitExecutable), o => o.reason ?? 'MISSING_REASON'),
      costProjectionStatusCounts: tally(outcomes, o => o.costProjection.status),
      verifiedNetPnlCount: outcomes.filter(o => o.costProjection.status === 'COMPLETE').length,
      exitRouteObservedCount: 0,
      exitRouteLimitation: 'EXPORT_HAS_ONLY_OUTCOME_AUTHORITY_DIGESTS; NO PER_OUTCOME_CURVE_VS_V4_PHASE_OR_ROUTE',
      sequentialCapacityLimitation: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL'
    },
    creatorPriorOutcomeCoverage: tally(features, f => f.creatorHistory?.coverage ?? 'NOT_EXPORTED'),
    decisions: {
      baselineUnverifiedMustRemainUnlabeled: true,
      noRematerializationOfFrozenS0: true,
      successorVenueCoverageRequired: true,
      verifiedFullCostEvidenceRequired: true,
      shadowLiveExecutionPersonaParityRequired: true,
      scientificEdge: 'UNPROVEN',
      liveMoneyAuthority: false,
      modelPromotionAuthority: false,
      verdict: 'MEASUREMENT_GAPS_IDENTIFIED_NO_STRATEGY_PROMOTION'
    }
  };
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`PONS_S1_MEASUREMENT_AUDIT_FAILED_CLOSED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
