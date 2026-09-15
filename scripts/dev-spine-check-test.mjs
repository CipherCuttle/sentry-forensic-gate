import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePacket } from './dev-spine-check.mjs';

const packet = JSON.parse(fs.readFileSync('docs/agent-packets/HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1.json','utf8'));
validatePacket(packet);
assert.equal(packet.state,'HISTORICAL_FULL_REPLAY_AUTHORIZATION_DECISION_OPEN');
assert.equal(packet.authorization.full_147_replay,false);
assert.equal(packet.authority.historical_authorization_granted,false);
assert.equal(packet.next_action,'TARGETED_REREVIEW_CRITICAL_HIGH_FIXES');
assert.equal(packet.acceptance.full_replay_scope_manifest.status,'FROZEN_VERIFIED');
assert.equal(packet.review_gate.status,'REPAIRED_PENDING_TARGETED_REREVIEW');
for (const key of ['historical_compatibility_implementation','historical_baseline_policy_discovery','historical_baseline_policy_implementation','historical_outcome_policy_discovery','historical_outcome_policy_implementation','historical_all_horizon_compatibility_implementation','full_147_replay','fast_vet','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge']) {
  const mutated=structuredClone(packet); mutated.authorization[key]=!mutated.authorization[key]; assert.throws(()=>validatePacket(mutated),new RegExp(`requires authorization\\.${key}=`));
}
const extraAuth=structuredClone(packet); extraAuth.authorization.signing_bypass=true; assert.throws(()=>validatePacket(extraAuth),/authorization keyset drift/);
const changedHead=structuredClone(packet); changedHead.predecessor.closure_head='0'.repeat(40); assert.throws(()=>validatePacket(changedHead),/predecessor identity\/verdict drift/);
const weakened=structuredClone(packet); weakened.predecessor.outcomes_complete=44; weakened.predecessor.outcomes_unverified=1; assert.throws(()=>validatePacket(weakened),/45 COMPLETE \/ 0 UNVERIFIED/);
const changedScope=structuredClone(packet); changedScope.acceptance.full_replay_scope_manifest.launch_identity_sha256='a'.repeat(64); assert.throws(()=>validatePacket(changedScope),/identity digest drift/);
const changedHorizon=structuredClone(packet); changedHorizon.frozen_policies.horizons[0].ms+=1; assert.throws(()=>validatePacket(changedHorizon),/frozen horizon set drift/);
const fakeAuthorized=structuredClone(packet); fakeAuthorized.state='HISTORICAL_FULL_REPLAY_AUTHORIZED'; fakeAuthorized.authorization.full_147_replay=true; fakeAuthorized.authority.historical_authorization_granted=true; fakeAuthorized.next_action='OPEN_HISTORICAL_FULL_REPLAY_R1_IMPLEMENTATION'; fakeAuthorized.decision_result={status:'AUTHORIZE',basis_predecessor_head:'28e598d738c633b0211bae914b8f92450ae61f90',scope_identity_sha256:'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211',hostile_review_id:999,reviewed_authorization_head:'f'.repeat(40),rationale:'attempt'}; assert.throws(()=>validatePacket(fakeAuthorized),/requires hostile review gate CLOSED_PASS/);
const closedReview=structuredClone(packet); closedReview.review_gate.status='CLOSED_PASS'; closedReview.review_gate.targeted_review_id=999; closedReview.review_gate.targeted_reviewed_head='f'.repeat(40); closedReview.review_gate.unresolved_critical_high=0; closedReview.review_gate.critical_high_findings.forEach((f)=>{f.repair_status='CLOSED';}); closedReview.next_action='DECIDE_FULL_147_REPLAY_AUTHORIZATION'; validatePacket(closedReview);
const validAuthorized=structuredClone(closedReview); validAuthorized.state='HISTORICAL_FULL_REPLAY_AUTHORIZED'; validAuthorized.authorization.full_147_replay=true; validAuthorized.authority.historical_authorization_granted=true; validAuthorized.next_action='OPEN_HISTORICAL_FULL_REPLAY_R1_IMPLEMENTATION'; validAuthorized.decision_result={status:'AUTHORIZE',basis_predecessor_head:'28e598d738c633b0211bae914b8f92450ae61f90',scope_identity_sha256:'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211',hostile_review_id:999,reviewed_authorization_head:'f'.repeat(40),rationale:'Frozen scope and hostile review gate closed; open only the separate research replay implementation.'}; validatePacket(validAuthorized);
const validRejected=structuredClone(packet); validRejected.state='HISTORICAL_FULL_REPLAY_AUTHORIZATION_REJECTED'; validRejected.next_action='STOP_FULL_147_REPLAY'; validRejected.decision_result={status:'REJECT',basis_predecessor_head:'28e598d738c633b0211bae914b8f92450ae61f90',rationale:'A frozen prerequisite failed.'}; validatePacket(validRejected);
const runWhileOpen=structuredClone(packet); runWhileOpen.next_action='RUN_FULL_147_REPLAY'; assert.throws(()=>validatePacket(runWhileOpen),/open decision next action drift/);
console.log('DEV_SPINE_CHECK_TEST=PASS');
