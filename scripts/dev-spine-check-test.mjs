import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_OUTCOME_ALL_HORIZONS_R1.json', 'utf8'));
validatePacket(packet);
assert.equal(packet.state, 'HISTORICAL_OUTCOME_ALL_HORIZONS_R1_AUTHORIZED');
assert.equal(packet.authorization.historical_outcome_all_horizons_gate, true);
assert.equal(packet.authorization.full_147_replay, false);

for (const key of [
  'historical_compatibility_implementation',
  'historical_baseline_policy_discovery',
  'historical_baseline_policy_implementation',
  'historical_outcome_policy_discovery',
  'historical_outcome_policy_implementation',
  'historical_outcome_all_horizons_gate',
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
changedHorizon.acceptance.horizons[0].ms = 60001;
assert.throws(() => validatePacket(changedHorizon), /frozen five-horizon contract drift/);

const changedShape = structuredClone(packet);
changedShape.acceptance.expected_outcomes = 44;
assert.throws(() => validatePacket(changedShape), /expected outcome matrix must equal 45/);

const guessedBlocks = structuredClone(packet);
guessedBlocks.acceptance.derive_observed_blocks_from_existing_horizon_algorithm = false;
assert.throws(() => validatePacket(guessedBlocks), /observed blocks must be derived/);

const providerAsMarket = structuredClone(packet);
providerAsMarket.acceptance.provider_or_transport_failure_is_not_market_evidence = false;
assert.throws(() => validatePacket(providerAsMarket), /provider failure must not become market evidence/);

const weakenedR3 = structuredClone(packet);
weakenedR3.authority.current_r3_behavior_must_remain_unchanged = false;
assert.throws(() => validatePacket(weakenedR3), /current R3 default invariant/);

const degradedPredecessor = structuredClone(packet);
degradedPredecessor.predecessor_result.outcomes_24h_complete = 8;
assert.throws(() => validatePacket(degradedPredecessor), /predecessor 24h COMPLETE must remain 9/);

const replayAuthorized = structuredClone(packet);
replayAuthorized.authorization.full_147_replay = true;
assert.throws(() => validatePacket(replayAuthorized), /requires authorization\.full_147_replay=false/);

const closed = structuredClone(packet);
closed.state = 'HISTORICAL_OUTCOME_ALL_HORIZONS_R1_PASS';
closed.authorization.historical_outcome_all_horizons_gate = false;
closed.next_action = 'STOP_AT_EVIDENCE_AWAIT_REPLAY_AUTHORITY';
closed.implementation_result = {
  status: 'PASS',
  representatives_attempted: 9,
  baseline_attempted: 9,
  baseline_complete: 9,
  baseline_unverified: 0,
  outcomes_attempted: 45,
  outcomes_complete: 45,
  outcomes_unverified: 0,
  verdict: 'HISTORICAL_OUTCOME_ALL_HORIZONS_R1_PASS',
};
validatePacket(closed);

const fakeClosedPass = structuredClone(closed);
fakeClosedPass.implementation_result.outcomes_complete = 44;
fakeClosedPass.implementation_result.outcomes_unverified = 1;
assert.throws(() => validatePacket(fakeClosedPass), /closed outcome COMPLETE count must remain 45/);

const replayNext = structuredClone(closed);
replayNext.next_action = 'RUN_FULL_147_REPLAY';
assert.throws(() => validatePacket(replayNext), /closed next action drift/);

console.log('DEV_SPINE_CHECK_TEST=PASS');
