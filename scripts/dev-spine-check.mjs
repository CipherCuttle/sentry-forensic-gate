import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/FAST_VET_R0_AUTHORIZATION_R1.json';
const RULE_PATH = 'fixtures/fast-vet-r0-authorization-r1.json';
const RULE_GIT_BLOB_SHA1 = 'a3266ab0bc2e1e1aaec26fafda64ae6be164c494';
const REPLAY_HEAD = '75588056de53b94f92b5cf3b40e89e2b5521031a';
const REPAIR_HEAD = 'c54c58b75e34ff390e0bf7f541b155d93de1a93d';
const SMOKE_HEAD = '22fcce4c301e791a59c68b19b198bd1bea104138';
const REPLAY_ARTIFACT_SHA = 'ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a';
const REPLAY_RECEIPT_SHA = '916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825';
const AUTH_KEYS = ['historical_full_replay','fast_vet','fast_vet_smoke','fast_vet_osint','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge'];
function invariant(c,m){if(!c)throw new Error(m)}
function exactKeys(v,e,l){invariant(JSON.stringify(Object.keys(v??{}).sort())===JSON.stringify([...e].sort()),`${l} keyset drift`)}
function gitBlobSha1(bytes){const h=Buffer.from(`blob ${bytes.length}\0`);return createHash('sha1').update(h).update(bytes).digest('hex')}

export function validateFastVetAuthorization(packet, ruleRaw=fs.readFileSync(RULE_PATH)){
  invariant(packet.schema==='dev-spine-phase/v1'&&packet.repo==='CipherCuttle/sentry-forensic-gate'&&packet.phase==='FAST_VET_R0_AUTHORIZATION_R1','unexpected packet identity');
  invariant(packet.state==='FAST_VET_R0_SMOKE_AUTHORIZED','unexpected phase state');
  invariant(packet.next_action==='OPEN_FAST_VET_R0_HISTORICAL_SMOKE_R1_IMPLEMENTATION','unexpected next action');
  exactKeys(packet.authorization,AUTH_KEYS,'authorization');
  for(const key of AUTH_KEYS) invariant(packet.authorization[key]===(key==='fast_vet_smoke'),`closed authorization requires authorization.${key}=${key==='fast_vet_smoke'}`);
  invariant(packet.authority?.current_default==='R3'&&packet.authority?.current_r3_behavior_must_remain_unchanged===true,'current R3 authority drift');
  invariant(packet.authority?.historical_full_replay_status==='PASS'&&packet.authority?.research_only===true&&packet.authority?.fast_vet_authorization_status==='CLOSED_PASS','closed authority drift');

  const p=packet.predecessor;
  invariant(p?.phase==='HISTORICAL_FULL_REPLAY_R1'&&p?.pr===23&&p?.closure_head===REPLAY_HEAD&&p?.verdict==='CLOSED_PASS','predecessor closure drift');
  invariant(p?.closure_comment_id===5688792266,'predecessor closure comment drift');
  invariant(p?.full_replay?.run_id===35001582697&&p?.full_replay?.artifact_id===10410898359,'predecessor replay identity drift');
  invariant(p?.full_replay?.artifact_sha256===REPLAY_ARTIFACT_SHA&&p?.full_replay?.receipt_sha256===REPLAY_RECEIPT_SHA,'predecessor replay digest drift');
  invariant(p?.full_replay?.launches_accounted===147&&p?.full_replay?.baseline_complete===147&&p?.full_replay?.baseline_unverified===0,'predecessor baseline accounting drift');
  invariant(p?.full_replay?.horizon_cells_accounted===735&&p?.full_replay?.outcomes_complete===735&&p?.full_replay?.outcomes_unverified===0,'predecessor outcome accounting drift');

  const f=packet.frozen_smoke_rule;
  invariant(f?.source_pr===13&&f?.source_head===SMOKE_HEAD&&f?.source_ci_run===34772418456&&f?.source_ci_status==='SUCCESS','frozen smoke source drift');
  invariant(f?.fixture_path===RULE_PATH&&f?.fixture_git_blob_sha1===RULE_GIT_BLOB_SHA1&&gitBlobSha1(ruleRaw)===RULE_GIT_BLOB_SHA1,'frozen smoke fixture drift');
  invariant(f?.decision_policy_version==='FAST_VET_R0'&&f?.shadow_receipt_version==='FAST_VET_SHADOW_R0'&&f?.status==='SMOKE_ONLY'&&f?.strategy_label==='EDGE_UNPROVEN','frozen smoke identity drift');
  invariant(f?.primary_notional_usd_micros===1_000_000&&f?.target_horizon_ms===86_400_000&&f?.unknown_action==='SKIP'&&f?.control_cohort==='COMPLETE_BASELINE_ONLY','frozen smoke semantics drift');

  const rule=JSON.parse(ruleRaw.toString('utf8'));
  invariant(rule.schema==='fast-vet-r0-frozen-rule/v1'&&rule.source?.head===SMOKE_HEAD,'frozen rule source identity drift');
  const d=rule.decision_semantics,s=rule.shadow_semantics;
  invariant(d?.policy_version==='FAST_VET_R0'&&d?.primary_notional_usd_micros===1_000_000&&d?.unknown_action==='SKIP'&&d?.recovery_bps_threshold===null,'rule decision drift');
  invariant(JSON.stringify(d?.decisions)===JSON.stringify(['PASS','REJECT','UNKNOWN']),'rule decisions drift');
  invariant(JSON.stringify(d?.reject_reasons)===JSON.stringify(['PRIMARY_ENTRY_NOT_EXECUTABLE','PRIMARY_REVERSE_NOT_EXECUTABLE','KNOWN_PRIOR_ADVERSE_CREATOR']),'rule reject reasons drift');
  invariant(JSON.stringify(d?.pass_creator_coverage)===JSON.stringify(['NO_HISTORY','COMPLETE']),'rule creator coverage drift');
  invariant(s?.receipt_version==='FAST_VET_SHADOW_R0'&&s?.status==='SMOKE_ONLY'&&s?.strategy_label==='EDGE_UNPROVEN','shadow identity drift');
  invariant(s?.target_horizon_ms===86_400_000&&s?.source_outcome_policy==='FORWARD_OUTCOMES_R1'&&s?.primary_outcome_notional_usd_micros===1_000_000,'shadow source binding drift');
  invariant(s?.control_cohort==='COMPLETE_BASELINE_ONLY'&&s?.candidate_exposure==='PASS_ONLY'&&s?.no_threshold_tuning===true,'shadow cohort/tuning drift');

  const a=packet.adapter_contract;
  invariant(a?.source==='HISTORICAL_FULL_REPLAY_R1_REPAIRED_AGGREGATE_ONLY'&&a?.source_artifact_id===10410898359&&a?.source_artifact_sha256===REPLAY_ARTIFACT_SHA&&a?.source_receipt_sha256===REPLAY_RECEIPT_SHA,'adapter predecessor binding drift');
  invariant(a?.baseline_policy==='HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1'&&a?.outcome_policy==='HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1'&&a?.target_horizon_ms===86_400_000,'adapter policy drift');
  for(const key of ['shape_adaptation_only','preserve_source_policy_identity','preserve_classification_and_executable_value','creator_history_point_in_time_only']) invariant(a?.[key]===true,`adapter_contract.${key} must remain true`);
  invariant(a?.old_sqlite_runner_authorized===false,'old SQLite runner must remain unauthorized');

  const r=packet.review_gate;
  invariant(r?.required===true&&r?.status==='CLOSED_PASS'&&r?.review_loop_limit===1,'review closure drift');
  invariant(r?.initial_review_id===5216435120&&r?.initial_reviewed_head==='b2d21a3e45db0b344f5c5ffcfe8caf4c0f6319d7'&&r?.initial_critical_high_count===2,'initial review evidence drift');
  invariant(Array.isArray(r?.critical_high_findings)&&r.critical_high_findings.length===2&&r.critical_high_findings.every(x=>x.severity==='P1'&&x.repair_status==='CLOSED'),'P1 closure drift');
  invariant(r?.repair_head===REPAIR_HEAD&&r?.repair_exact_head_runs?.ci?.id===35041509635&&r?.repair_exact_head_runs?.ci?.status==='SUCCESS','repair CI evidence drift');
  invariant(r?.repair_exact_head_runs?.fast_vet_authorization?.id===35041509630&&r?.repair_exact_head_runs?.fast_vet_authorization?.status==='SUCCESS','repair authorization evidence drift');
  invariant(r?.targeted_rereview_required===true&&r?.targeted_review_request_comment_id===5690352056&&r?.targeted_clean_comment_id===5690369864&&r?.targeted_reviewed_head===REPAIR_HEAD,'targeted review evidence drift');
  invariant(r?.unresolved_critical_high===0&&r?.further_review_forbidden_by_bounded_policy===true,'review loop closure drift');

  invariant(packet.acceptance?.hostile_review_gate_closed===true&&packet.acceptance?.predecessor_github_provenance_must_be_runtime_verified===true&&packet.acceptance?.normalized_rule_must_match_fetched_source_semantics===true,'acceptance closure drift');
  invariant(packet.decision_result?.status==='AUTHORIZE_SMOKE'&&packet.decision_result?.authorized_bit==='fast_vet_smoke'&&packet.decision_result?.basis_repair_head===REPAIR_HEAD&&packet.decision_result?.targeted_clean_comment_id===5690369864,'decision result drift');
  invariant(Array.isArray(packet.authority_docs)&&packet.authority_docs.length>0&&Array.isArray(packet.context_files)&&packet.context_files.length>0,'authority/context files required');
  for(const path of new Set([...packet.authority_docs,...packet.context_files])) invariant(fs.existsSync(path)&&fs.statSync(path).isFile(),`authority/context file missing: ${path}`);
}
function main(){try{const p=JSON.parse(fs.readFileSync(PACKET_PATH,'utf8'));validateFastVetAuthorization(p);console.log(`DEV_SPINE_CHECK=PASS phase=${p.phase} state=${p.state}`)}catch(e){console.error(`DEV_SPINE_CHECK=FAIL ${e.message}`);process.exit(1)}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main();
