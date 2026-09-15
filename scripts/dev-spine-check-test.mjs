import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_FULL_REPLAY_R1.json', 'utf8'));
validatePacket(packet);

assert.equal(packet.state, 'HISTORICAL_FULL_REPLAY_IMPLEMENTATION_AUTHORIZED');
assert.equal(packet.authorization.full_147_replay, true);
assert.equal(packet.next_action, 'BUILD_AND_VERIFY_147_LAUNCH_AUTHORITY_MAP');
assert.equal(packet.authority_map_gate.status, 'PENDING_VERIFICATION');
assert.equal(packet.authority_map_gate.authority_map_sha256, null);
assert.equal(packet.replay_contract.expected_launch_receipts, 147);
assert.equal(packet.replay_contract.expected_horizon_cells, 735);
assert.equal(packet.replay_contract.economic_complete_required_for_phase_pass, false);

const extraAuth = structuredClone(packet);
extraAuth.authorization.live_execution_bypass = true;
assert.throws(() => validatePacket(extraAuth), /authorization keyset drift/);

const replayOff = structuredClone(packet);
replayOff.authorization.full_147_replay = false;
assert.throws(() => validatePacket(replayOff), /authorization\.full_147_replay=true/);

const liveOn = structuredClone(packet);
liveOn.authorization.live_execution = true;
assert.throws(() => validatePacket(liveOn), /authorization\.live_execution=false/);

const changedHead = structuredClone(packet);
changedHead.predecessor.closure_head = '0'.repeat(40);
assert.throws(() => validatePacket(changedHead), /authorization predecessor closure head drift/);

const changedScope = structuredClone(packet);
changedScope.frozen_scope.launch_identity_sha256 = 'a'.repeat(64);
assert.throws(() => validatePacket(changedScope), /frozen scope identity digest drift/);

const changedHorizon = structuredClone(packet);
changedHorizon.frozen_policies.horizons[0].ms += 1;
assert.throws(() => validatePacket(changedHorizon), /frozen horizon set drift/);

const changedCount = structuredClone(packet);
changedCount.authority_map_gate.expected_cohort_counts[0] = 1;
assert.throws(() => validatePacket(changedCount), /historical cohort count vector drift/);

const changedStart = structuredClone(packet);
changedStart.authority_map_gate.expected_start_ordinals[1] = 4;
assert.throws(() => validatePacket(changedStart), /historical cohort start ordinals drift/);

const changedRep = structuredClone(packet);
changedRep.authority_map_gate.cohorts[4].first_token_id = '999';
assert.throws(() => validatePacket(changedRep), /cohort first token id drift/);

const jumpReplay = structuredClone(packet);
jumpReplay.next_action = 'EXECUTE_FULL_147_X_5_REPLAY';
assert.throws(() => validatePacket(jumpReplay), /Stage A authority map must be next/);

const fakeMap = structuredClone(packet);
fakeMap.authority_map_gate.authority_map_sha256 = 'f'.repeat(64);
assert.throws(() => validatePacket(fakeMap), /pending authority map must not predeclare digest/);

console.log('DEV_SPINE_CHECK_TEST=PASS');
