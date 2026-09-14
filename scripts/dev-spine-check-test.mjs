import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_OUTCOME_POLICY_R1.json', 'utf8'));
validatePacket(packet);

for (const key of [
  'historical_compatibility_implementation',
  'historical_baseline_policy_discovery',
  'historical_baseline_policy_implementation',
  'historical_outcome_policy_discovery',
  'historical_outcome_policy_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'merge',
]) {
  const mutated = structuredClone(packet);
  mutated.authorization[key] = !mutated.authorization[key];
  assert.throws(() => validatePacket(mutated), new RegExp(`requires authorization\\.${key}=`));
}

const changedBlocks = structuredClone(packet);
changedBlocks.acceptance.observed_blocks = [...changedBlocks.acceptance.observed_blocks];
changedBlocks.acceptance.observed_blocks[0] += 1;
assert.throws(() => validatePacket(changedBlocks), /exact 24h observed block set drift/);

const fittedFreshness = structuredClone(packet);
fittedFreshness.historical_policy.freshness_rejection_threshold_seconds = 21600;
assert.throws(() => validatePacket(fittedFreshness), /must not fit an age cutoff/);

const changedOracle = structuredClone(packet);
changedOracle.historical_policy.redstone_eth_usd_address = '0x0000000000000000000000000000000000000001';
assert.throws(() => validatePacket(changedOracle), /RedStone address drift/);

const falseDiscovery = structuredClone(packet);
falseDiscovery.oracle_discovery_result.structurally_point_in_time_usable = 8;
assert.throws(() => validatePacket(falseDiscovery), /oracle discovery usability must remain 9\/9/);

const changedPolicy = structuredClone(packet);
changedPolicy.historical_policy.policy_version = 'FORWARD_OUTCOMES_R1';
assert.throws(() => validatePacket(changedPolicy), /historical outcome policy version drift/);

const replayAuthorized = structuredClone(packet);
replayAuthorized.authorization.full_147_replay = true;
assert.throws(() => validatePacket(replayAuthorized), /requires authorization\.full_147_replay=false/);

const weakenedR3 = structuredClone(packet);
weakenedR3.authority.current_r3_behavior_must_remain_unchanged = false;
assert.throws(() => validatePacket(weakenedR3), /current R3 default invariant/);

console.log('DEV_SPINE_CHECK_TEST=PASS');
