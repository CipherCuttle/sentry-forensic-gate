import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1.json', 'utf8'));
validatePacket(packet);
assert.equal(packet.state, 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_IMPLEMENTATION_AUTHORIZED');
assert.equal(packet.authorization.historical_all_horizon_compatibility_implementation, true);
assert.equal(packet.authorization.full_147_replay, false);

for (const key of [
  'historical_compatibility_implementation',
  'historical_baseline_policy_discovery',
  'historical_baseline_policy_implementation',
  'historical_outcome_policy_discovery',
  'historical_outcome_policy_implementation',
  'historical_all_horizon_compatibility_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'merge',
]) {
  const mutated = structuredClone(packet);
  mutated.authorization[key] = !mutated.authorization[key];
  assert.throws(() => validatePacket(mutated), new RegExp(`requires authorization\\.${key}=`));
}

const changedHorizon = structuredClone(packet);
changedHorizon.acceptance.horizons[0].ms += 1;
assert.throws(() => validatePacket(changedHorizon), /frozen horizon set drift/);

const changedCells = structuredClone(packet);
changedCells.acceptance.expected_outcome_cells = 44;
assert.throws(() => validatePacket(changedCells), /expected outcome cell count must equal 45/);

const hardCodedBlocks = structuredClone(packet);
hardCodedBlocks.acceptance.observed_blocks = [40029876];
assert.throws(() => validatePacket(hardCodedBlocks), /must not be hard-coded/);

const fittedFreshness = structuredClone(packet);
fittedFreshness.frozen_policies.freshness_rejection_threshold_seconds = 21600;
assert.throws(() => validatePacket(fittedFreshness), /must not fit an age cutoff/);

const changedOracle = structuredClone(packet);
changedOracle.frozen_policies.redstone_eth_usd_address = '0x0000000000000000000000000000000000000001';
assert.throws(() => validatePacket(changedOracle), /RedStone address drift/);

const changedOutcomePolicy = structuredClone(packet);
changedOutcomePolicy.frozen_policies.outcome_policy_version = 'FORWARD_OUTCOMES_R1';
assert.throws(() => validatePacket(changedOutcomePolicy), /historical outcome policy version drift/);

const weakenedPredecessor = structuredClone(packet);
weakenedPredecessor.predecessor.representative_24h_complete = 8;
weakenedPredecessor.predecessor.representative_24h_unverified = 1;
assert.throws(() => validatePacket(weakenedPredecessor), /predecessor 24h result must remain 9 COMPLETE/);

const replayAuthorized = structuredClone(packet);
replayAuthorized.authorization.full_147_replay = true;
assert.throws(() => validatePacket(replayAuthorized), /requires authorization\.full_147_replay=false/);

const fakePass = structuredClone(packet);
fakePass.state = 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS';
fakePass.authorization.historical_all_horizon_compatibility_implementation = false;
fakePass.next_action = 'OPEN_HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1_DECISION';
assert.throws(() => validatePacket(fakePass), /closed all-horizon result must be PASS/);

const replayNext = structuredClone(packet);
replayNext.next_action = 'RUN_FULL_147_REPLAY';
assert.throws(() => validatePacket(replayNext), /implementation next action drift/);

console.log('DEV_SPINE_CHECK_TEST=PASS');
