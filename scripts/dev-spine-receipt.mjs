import fs from 'node:fs';

const PACKET_PATH='docs/agent-packets/FAST_VET_R0_AUTHORIZATION_R1.json';
const OUTPUT_PATH='.dev-spine/receipt.json';
function fail(m){console.error(`DEV_SPINE_RECEIPT=FAIL ${m}`);process.exit(1)}
const packet=JSON.parse(fs.readFileSync(PACKET_PATH,'utf8'));
const testedSha=process.env.DEV_SPINE_TESTED_SHA;
const sourceHeadSha=process.env.DEV_SPINE_SOURCE_SHA??testedSha;
const dirtyRaw=process.env.DEV_SPINE_DIRTY;
if(!testedSha||!sourceHeadSha)fail('tested/source SHA must be supplied by the Spine adapter');
if(dirtyRaw!=='true'&&dirtyRaw!=='false')fail('dirty state must be explicitly supplied by the Spine adapter');
const dirty=dirtyRaw==='true';
const ciStatus=String(process.env.DEV_SPINE_CI_STATUS??'unknown').toLowerCase();
const repositoryVerification=ciStatus==='success'?'PASS':ciStatus==='failure'||ciStatus==='cancelled'?'FAIL':'UNKNOWN';
const receipt={
  schema:'dev-spine-receipt/v1',repo:packet.repo,phase:packet.phase,tested_sha:testedSha,source_head_sha:sourceHeadSha,
  source_matches_tested_sha:sourceHeadSha===testedSha,dirty_worktree_observed:dirty,
  repository_verification:{ci_status:ciStatus,verdict:repositoryVerification},
  phase_evidence:{
    predecessor_phase:packet.predecessor.phase,
    predecessor_closure_head:packet.predecessor.closure_head,
    predecessor_verdict:packet.predecessor.verdict,
    predecessor_replay_artifact_id:packet.predecessor.full_replay.artifact_id,
    predecessor_replay_receipt_sha256:packet.predecessor.full_replay.receipt_sha256,
    frozen_smoke_source_pr:packet.frozen_smoke_rule.source_pr,
    frozen_smoke_source_head:packet.frozen_smoke_rule.source_head,
    frozen_smoke_fixture_git_blob_sha1:packet.frozen_smoke_rule.fixture_git_blob_sha1,
    review_status:packet.review_gate.status,
    repair_head:packet.review_gate.repair_head,
    targeted_clean_comment_id:packet.review_gate.targeted_clean_comment_id,
    smoke_authorized:packet.authorization.fast_vet_smoke,
    smoke_executed:false
  },
  review_gate:packet.review_gate,authorization:packet.authorization,phase_state:packet.state,next_action:packet.next_action,
  verdict:repositoryVerification==='PASS'&&!dirty?'REPO_VERIFICATION_PASS_FAST_VET_R0_SMOKE_AUTHORIZED':repositoryVerification==='FAIL'?'REPO_VERIFICATION_FAIL_FAST_VET_R0_SMOKE_AUTHORIZED':'REPO_VERIFICATION_UNKNOWN_FAST_VET_R0_SMOKE_AUTHORIZED'
};
fs.mkdirSync('.dev-spine',{recursive:true});
fs.writeFileSync(OUTPUT_PATH,`${JSON.stringify(receipt,null,2)}\n`,'utf8');
console.log(`DEV_SPINE_RECEIPT=${OUTPUT_PATH}`);
console.log(`TESTED_SHA=${testedSha}`);
console.log(`SOURCE_HEAD_SHA=${sourceHeadSha}`);
console.log(`DIRTY_WORKTREE_OBSERVED=${dirty}`);
console.log(`VERDICT=${receipt.verdict}`);
