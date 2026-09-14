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
fittedFreshness.candidate_oracle.freshness_rejection_threshold_seconds = 21600;
assert.throws(() => validatePacket(fittedFreshness), /must not fit an age cutoff/);

const changedOracle = structuredClone(packet);
changedOracle.candidate_oracle.address = '0x0000000000000000000000000000000000000001';
assert.throws(() => validatePacket(changedOracle), /candidate RedStone address drift/);

const falseBaselinePass = structuredClone(packet);
falseBaselinePass.predecessor_result.historical_baseline_complete = 8;
assert.throws(() => validatePacket(falseBaselinePass), /predecessor baseline COMPLETE must remain 9/);

const hiddenOutcomeImplementation = structuredClone(packet);
hiddenOutcomeImplementation.authorization.historical_outcome_policy_implementation = true;
assert.throws(() => validatePacket(hiddenOutcomeImplementation), /requires authorization\.historical_outcome_policy_implementation=false/);

const replayAuthorized = structuredClone(packet);
replayAuthorized.authorization.full_147_replay = true;
assert.throws(() => validatePacket(replayAuthorized), /requires authorization\.full_147_replay=false/);

const weakenedR3 = structuredClone(packet);
weakenedR3.authority.current_r3_behavior_must_remain_unchanged = false;
assert.throws(() => validatePacket(weakenedR3), /current R3 default invariant/);

console.log('DEV_SPINE_CHECK_TEST=PASS');
