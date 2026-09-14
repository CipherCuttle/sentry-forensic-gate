import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_BASELINE_POLICY_R1.json', 'utf8'));
validatePacket(packet);

for (const key of [
  'historical_compatibility_implementation',
  'historical_baseline_policy_discovery',
  'historical_baseline_policy_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'merge',
]) {
  const mutated = structuredClone(packet);
  mutated.authorization[key] = !mutated.authorization[key];
  assert.throws(() => validatePacket(mutated), new RegExp(`requires authorization\\.${key}=`));
}

const changedNotionals = structuredClone(packet);
changedNotionals.acceptance.notionals_usd_micros = [100000, 250000, 500000, 1000000, 2000000];
assert.throws(() => validatePacket(changedNotionals), /frozen R1 notionals must remain exactly/);

const fittedFreshness = structuredClone(packet);
fittedFreshness.historical_policy.freshness_rejection_threshold_seconds = 18056;
assert.throws(() => validatePacket(fittedFreshness), /must not fit an age cutoff/);

const changedOracle = structuredClone(packet);
changedOracle.historical_policy.redstone_eth_usd_address = '0x0000000000000000000000000000000000000001';
assert.throws(() => validatePacket(changedOracle), /historical RedStone address drift/);

const changedPolicy = structuredClone(packet);
changedPolicy.historical_policy.policy_version = 'EXECUTABLE_BASELINE_R1';
assert.throws(() => validatePacket(changedPolicy), /historical policy version drift/);

const replayAuthorized = structuredClone(packet);
replayAuthorized.authorization.full_147_replay = true;
assert.throws(() => validatePacket(replayAuthorized), /requires authorization\.full_147_replay=false/);

const weakenedR3 = structuredClone(packet);
weakenedR3.authority.current_r3_behavior_must_remain_unchanged = false;
assert.throws(() => validatePacket(weakenedR3), /current R3 default invariant/);

console.log('DEV_SPINE_CHECK_TEST=PASS');
