import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1.json', 'utf8'));
validatePacket(packet);
assert.equal(packet.state, 'HISTORICAL_FULL_REPLAY_AUTHORIZATION_DECISION_OPEN');
assert.equal(packet.authorization.full_147_replay, false);
assert.equal(packet.authority.historical_authorization_granted, false);
assert.equal(packet.next_action, 'DECIDE_FULL_147_REPLAY_AUTHORIZATION');

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

const changedHead = structuredClone(packet);
changedHead.predecessor.closure_head = '0000000000000000000000000000000000000000';
assert.throws(() => validatePacket(changedHead), /predecessor closure head drift/);

const weakenedEvidence = structuredClone(packet);
weakenedEvidence.predecessor.outcomes_complete = 44;
weakenedEvidence.predecessor.outcomes_unverified = 1;
assert.throws(() => validatePacket(weakenedEvidence), /45 COMPLETE \/ 0 UNVERIFIED/);

const changedScope = structuredClone(packet);
changedScope.acceptance.frozen_historical_launch_count = 146;
assert.throws(() => validatePacket(changedScope), /must remain 147/);

const changedHorizon = structuredClone(packet);
changedHorizon.frozen_policies.horizons[0].ms += 1;
assert.throws(() => validatePacket(changedHorizon), /frozen horizon set drift/);

const fittedFreshness = structuredClone(packet);
fittedFreshness.frozen_policies.freshness_rejection_threshold_seconds = 21600;
assert.throws(() => validatePacket(fittedFreshness), /must not fit an age cutoff/);

const fakeAuthorized = structuredClone(packet);
fakeAuthorized.state = 'HISTORICAL_FULL_REPLAY_AUTHORIZED';
fakeAuthorized.authorization.full_147_replay = true;
fakeAuthorized.authority.historical_authorization_granted = true;
fakeAuthorized.next_action = 'OPEN_HISTORICAL_FULL_REPLAY_R1_IMPLEMENTATION';
assert.throws(() => validatePacket(fakeAuthorized), /AUTHORIZE decision result/);

const validAuthorized = structuredClone(fakeAuthorized);
validAuthorized.decision_result = {
  status: 'AUTHORIZE',
  basis_predecessor_head: '28e598d738c633b0211bae914b8f92450ae61f90',
  rationale: 'Frozen predecessor evidence satisfies the preregistered authorization criteria.',
};
validatePacket(validAuthorized);

const widenedAuthority = structuredClone(validAuthorized);
widenedAuthority.authorization.canary = true;
assert.throws(() => validatePacket(widenedAuthority), /requires authorization\.canary=false/);

const validRejected = structuredClone(packet);
validRejected.state = 'HISTORICAL_FULL_REPLAY_AUTHORIZATION_REJECTED';
validRejected.next_action = 'STOP_FULL_147_REPLAY';
validRejected.decision_result = {
  status: 'REJECT',
  basis_predecessor_head: '28e598d738c633b0211bae914b8f92450ae61f90',
  rationale: 'A frozen prerequisite failed.',
};
validatePacket(validRejected);

const runWhileOpen = structuredClone(packet);
runWhileOpen.next_action = 'RUN_FULL_147_REPLAY';
assert.throws(() => validatePacket(runWhileOpen), /open decision next action drift/);

console.log('DEV_SPINE_CHECK_TEST=PASS');
