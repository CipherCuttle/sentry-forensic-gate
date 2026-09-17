import assert from 'node:assert/strict';
import fs from 'node:fs';

const path = process.env.OUTPUT_PATH ?? 'historical-baseline-policy-r1-live-receipt.json';
const receipt = JSON.parse(fs.readFileSync(path, 'utf8'));

assert.equal(receipt.schema, 'historical-baseline-policy-r1-live-receipt/v1');
assert.equal(receipt.phase, 'HISTORICAL_BASELINE_POLICY_R1');
assert.equal(receipt.stage, 'STAGE_C_REPRESENTATIVE_GATE');
assert.equal(receipt.policyVersion, 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1');
assert.equal(receipt.representativesAttempted, 9);
assert.deepEqual(receipt.notionalsUsdMicros, ['250000', '500000', '1000000', '2000000', '5000000']);
assert.equal(receipt.baselineAttempted, 9);
assert.equal(receipt.baselineComplete, 9);
assert.equal(receipt.baselineUnverified, 0);
assert.equal(receipt.baselineVerdict, 'PASS');

assert.equal(receipt.outcomes24hAttempted, 9);
assert.equal(receipt.outcomes24hComplete, 7);
assert.equal(receipt.outcomes24hUnverified, 2);
assert.equal(receipt.outcomes24hNotAttempted, 0);
assert.equal(receipt.outcomeProbeVerdict, 'BLOCKED');
assert.equal(receipt.verdict, 'BASELINE_POLICY_PASS_OUTCOME_PROBE_BLOCKED');

const blocked = receipt.rows.filter((row) => row.outcome24hStatus === 'UNVERIFIED');
assert.equal(blocked.length, 2);
assert.deepEqual(blocked.map((row) => row.tokenId), ['1', '5']);
for (const row of blocked) {
  assert.match(row.outcome24hReason ?? '', /^OUTCOME_USD_VALUATION_UNAVAILABLE:/);
}

console.log('historical baseline policy live receipt check: PASS baseline=9/9 outcome=7/9 blocker=OUTCOME_USD_VALUATION_UNAVAILABLE');
