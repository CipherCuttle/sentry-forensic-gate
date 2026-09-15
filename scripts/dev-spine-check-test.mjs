import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1.json','utf8'));
validatePacket(packet);
assert.equal(packet.state,'HISTORICAL_FULL_REPLAY_AUTHORIZED');
assert.equal(packet.authorization.full_147_replay,true);
assert.equal(packet.authority.historical_authorization_granted,true);
assert.equal(packet.next_action,'OPEN_HISTORICAL_FULL_REPLAY_R1_IMPLEMENTATION');
assert.equal(packet.review_gate.status,'CLOSED_PASS');
assert.equal(packet.review_gate.targeted_review_id,5204380099);
assert.equal(packet.review_gate.targeted_reviewed_head,'e527255949ffd72409284a379cf4428c48aa855f');
for (const key of ['fast_vet','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge']) assert.equal(packet.authorization[key],false);

for (const key of ['historical_compatibility_implementation','historical_baseline_policy_discovery','historical_baseline_policy_implementation','historical_outcome_policy_discovery','historical_outcome_policy_implementation','historical_all_horizon_compatibility_implementation','full_147_replay','fast_vet','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge']) {
  const mutated=structuredClone(packet); mutated.authorization[key]=!mutated.authorization[key]; assert.throws(()=>validatePacket(mutated),new RegExp(`requires authorization\\.${key}=`));
}
const extraAuth=structuredClone(packet); extraAuth.authorization.signing_bypass=true; assert.throws(()=>validatePacket(extraAuth),/authorization keyset drift/);
const wrongReviewId=structuredClone(packet); wrongReviewId.review_gate.targeted_review_id=1; assert.throws(()=>validatePacket(wrongReviewId),/targeted review id drift/);
const wrongReviewedHead=structuredClone(packet); wrongReviewedHead.review_gate.targeted_reviewed_head='0'.repeat(40); assert.throws(()=>validatePacket(wrongReviewedHead),/targeted reviewed head drift/);
const wrongTargetedFinding=structuredClone(packet); wrongTargetedFinding.review_gate.targeted_review_finding.comment_id=1; assert.throws(()=>validatePacket(wrongTargetedFinding),/targeted re-review finding id drift/);
const unresolved=structuredClone(packet); unresolved.review_gate.unresolved_critical_high=1; assert.throws(()=>validatePacket(unresolved),/zero unresolved Critical\/High/);
const changedScope=structuredClone(packet); changedScope.acceptance.full_replay_scope_manifest.launch_identity_sha256='a'.repeat(64); assert.throws(()=>validatePacket(changedScope),/identity digest drift/);
const changedHorizon=structuredClone(packet); changedHorizon.frozen_policies.horizons[0].ms+=1; assert.throws(()=>validatePacket(changedHorizon),/frozen horizon set drift/);
const wrongDecisionReview=structuredClone(packet); wrongDecisionReview.decision_result.hostile_review_id=1; assert.throws(()=>validatePacket(wrongDecisionReview),/authorized decision hostile review id drift/);
const wrongDecisionHead=structuredClone(packet); wrongDecisionHead.decision_result.reviewed_authorization_head='0'.repeat(40); assert.throws(()=>validatePacket(wrongDecisionHead),/authorized decision reviewed head drift/);

const validOpen=structuredClone(packet);
validOpen.state='HISTORICAL_FULL_REPLAY_AUTHORIZATION_DECISION_OPEN';
validOpen.authorization.full_147_replay=false;
validOpen.authority.historical_authorization_granted=false;
validOpen.next_action='DECIDE_FULL_147_REPLAY_AUTHORIZATION';
delete validOpen.decision_result;
validatePacket(validOpen);

const validRejected=structuredClone(validOpen);
validRejected.state='HISTORICAL_FULL_REPLAY_AUTHORIZATION_REJECTED';
validRejected.next_action='STOP_FULL_147_REPLAY';
validRejected.decision_result={status:'REJECT',basis_predecessor_head:'28e598d738c633b0211bae914b8f92450ae61f90',rationale:'A frozen prerequisite failed.'};
validatePacket(validRejected);

console.log('DEV_SPINE_CHECK_TEST=PASS');
