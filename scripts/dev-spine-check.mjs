import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/FAST_VET_R0_AUTHORIZATION_R1.json';
const RULE_PATH = 'fixtures/fast-vet-r0-authorization-r1.json';
const RULE_GIT_BLOB_SHA1 = 'a3266ab0bc2e1e1aaec26fafda64ae6be164c494';
const REPLAY_HEAD = '75588056de53b94f92b5cf3b40e89e2b5521031a';
const SMOKE_HEAD = '22fcce4c301e791a59c68b19b198bd1bea104138';
const REPLAY_ARTIFACT_SHA = 'ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a';
const REPLAY_RECEIPT_SHA = '916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825';
const AUTH_KEYS = ['historical_full_replay','fast_vet','fast_vet_smoke','fast_vet_osint','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge'];

function invariant(condition, message) { if (!condition) throw new Error(message); }
function gitBlobSha1(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`);
  return createHash('sha1').update(header).update(bytes).digest('hex');
}
function exactKeys(value, expected, label) {
  invariant(JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...expected].sort()), `${label} keyset drift`);
}

export function validateFastVetAuthorization(packet, ruleRaw = fs.readFileSync(RULE_PATH)) {
  invariant(packet.schema === 'dev-spine-phase/v1' && packet.repo === 'CipherCuttle/sentry-forensic-gate' && packet.phase === 'FAST_VET_R0_AUTHORIZATION_R1', 'unexpected packet identity');
  invariant(packet.state === 'FAST_VET_R0_AUTHORIZATION_PENDING_REVIEW', 'unexpected phase state');
  invariant(packet.next_action === 'RUN_ONE_INDEPENDENT_HOSTILE_REVIEW', 'hostile review must be next');

  exactKeys(packet.authorization, AUTH_KEYS, 'authorization');
  for (const key of AUTH_KEYS) invariant(packet.authorization[key] === false, `pending authorization requires authorization.${key}=false`);
  invariant(packet.authority?.current_default === 'R3' && packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 authority drift');
  invariant(packet.authority?.historical_full_replay_status === 'PASS' && packet.authority?.research_only === true, 'predecessor/research authority drift');
  invariant(packet.authority?.fast_vet_authorization_status === 'PENDING_REVIEW', 'FAST_VET authorization must remain pending');

  const predecessor = packet.predecessor;
  invariant(predecessor?.phase === 'HISTORICAL_FULL_REPLAY_R1' && predecessor?.pr === 23, 'predecessor identity drift');
  invariant(predecessor?.closure_head === REPLAY_HEAD && predecessor?.verdict === 'CLOSED_PASS', 'predecessor closure drift');
  invariant(predecessor?.closure_comment_id === 5688792266, 'predecessor closure comment drift');
  invariant(predecessor?.full_replay?.run_id === 35001582697 && predecessor?.full_replay?.artifact_id === 10410898359, 'predecessor replay identity drift');
  invariant(predecessor?.full_replay?.artifact_sha256 === REPLAY_ARTIFACT_SHA && predecessor?.full_replay?.receipt_sha256 === REPLAY_RECEIPT_SHA, 'predecessor replay digest drift');
  invariant(predecessor?.full_replay?.launches_accounted === 147 && predecessor?.full_replay?.baseline_complete === 147 && predecessor?.full_replay?.baseline_unverified === 0, 'predecessor baseline accounting drift');
  invariant(predecessor?.full_replay?.horizon_cells_accounted === 735 && predecessor?.full_replay?.outcomes_complete === 735 && predecessor?.full_replay?.outcomes_unverified === 0, 'predecessor outcome accounting drift');
  invariant(predecessor?.review_closure?.repair_head === REPLAY_HEAD && predecessor?.review_closure?.targeted_reviewed_head === REPLAY_HEAD, 'predecessor review head drift');
  invariant(predecessor?.review_closure?.targeted_clean_comment_id === 5688765850 && predecessor?.review_closure?.unresolved_critical_high === 0, 'predecessor review closure drift');

  const frozen = packet.frozen_smoke_rule;
  invariant(frozen?.source_pr === 13 && frozen?.source_head === SMOKE_HEAD, 'frozen smoke source drift');
  invariant(frozen?.source_ci_run === 34772418456 && frozen?.source_ci_status === 'SUCCESS', 'frozen smoke source CI drift');
  invariant(frozen?.fixture_path === RULE_PATH && frozen?.fixture_git_blob_sha1 === RULE_GIT_BLOB_SHA1, 'frozen smoke fixture identity drift');
  invariant(gitBlobSha1(ruleRaw) === RULE_GIT_BLOB_SHA1, 'frozen rule fixture Git blob drift');
  invariant(frozen?.decision_policy_version === 'FAST_VET_R0' && frozen?.shadow_receipt_version === 'FAST_VET_SHADOW_R0', 'frozen smoke versions drift');
  invariant(frozen?.status === 'SMOKE_ONLY' && frozen?.strategy_label === 'EDGE_UNPROVEN', 'smoke status/strategy drift');
  invariant(frozen?.primary_notional_usd_micros === 1_000_000 && frozen?.target_horizon_ms === 86_400_000, 'smoke notional/horizon drift');
  invariant(frozen?.unknown_action === 'SKIP' && frozen?.control_cohort === 'COMPLETE_BASELINE_ONLY', 'smoke action/cohort drift');

  const rule = JSON.parse(ruleRaw.toString('utf8'));
  invariant(rule.schema === 'fast-vet-r0-frozen-rule/v1' && rule.source?.pr === 13 && rule.source?.head === SMOKE_HEAD, 'frozen rule source identity drift');
  const blobs = rule.source?.blobs ?? {};
  const expectedBlobs = {
    'docs/FAST_VET_R0.md': '1ea7ac524803e621947d076e120860bade3df780',
    'src/evaluation/fastVet.ts': '0ca384e142a8f1c898f7041fff87811e2f136225',
    'src/evaluation/fastVetShadow.ts': 'de2a993b93b9b60669acd09a60e1589cdc96e572',
    'scripts/fast-vet-check.mjs': '2417b03a449bf305a89d0a7196b5db89ef4216bc',
    'src/forensic/creatorOutcome.ts': '2d9b15481df64e69016c236a6374c96657d31cc0',
    'src/outcome/forwardTypes.ts': '8c9682b671a7c185dbca416594c8eacd4b0c282e'
  };
  invariant(JSON.stringify(blobs) === JSON.stringify(expectedBlobs), 'frozen source blob set drift');

  const decision = rule.decision_semantics;
  invariant(decision?.policy_version === 'FAST_VET_R0' && decision?.primary_notional_usd_micros === 1_000_000, 'rule decision identity drift');
  invariant(JSON.stringify(decision?.decisions) === JSON.stringify(['PASS','REJECT','UNKNOWN']), 'rule decisions drift');
  invariant(decision?.pass_action === 'BUY_ELIGIBLE' && decision?.reject_action === 'SKIP' && decision?.unknown_action === 'SKIP', 'rule action semantics drift');
  invariant(JSON.stringify(decision?.reject_reasons) === JSON.stringify(['PRIMARY_ENTRY_NOT_EXECUTABLE','PRIMARY_REVERSE_NOT_EXECUTABLE','KNOWN_PRIOR_ADVERSE_CREATOR']), 'reject reason normalization drift');
  invariant(JSON.stringify(decision?.unknown_reasons) === JSON.stringify(['BASELINE_MISSING','BASELINE_UNVERIFIED','PRIMARY_LEG_MISSING','CREATOR_FEATURE_MISSING','CREATOR_HISTORY_INCOMPLETE']), 'unknown reason normalization drift');
  invariant(JSON.stringify(decision?.pass_creator_coverage) === JSON.stringify(['NO_HISTORY','COMPLETE']), 'pass creator coverage drift');
  invariant(decision?.independent_reverse_semantics === 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL' && decision?.recovery_bps_threshold === null, 'independent reverse semantics drift');

  const shadow = rule.shadow_semantics;
  invariant(shadow?.receipt_version === 'FAST_VET_SHADOW_R0' && shadow?.status === 'SMOKE_ONLY' && shadow?.strategy_label === 'EDGE_UNPROVEN', 'shadow identity drift');
  invariant(shadow?.target_horizon_ms === 86_400_000 && shadow?.source_outcome_policy === 'FORWARD_OUTCOMES_R1' && shadow?.primary_outcome_notional_usd_micros === 1_000_000, 'shadow source binding drift');
  invariant(shadow?.control_cohort === 'COMPLETE_BASELINE_ONLY' && shadow?.candidate_exposure === 'PASS_ONLY', 'shadow cohort semantics drift');
  invariant(shadow?.no_sample_adequacy_claim === true && shadow?.no_probability_or_p_value === true && shadow?.no_threshold_tuning === true, 'shadow non-promotion invariants drift');

  const adapter = packet.adapter_contract;
  invariant(adapter?.source === 'HISTORICAL_FULL_REPLAY_R1_REPAIRED_AGGREGATE_ONLY', 'adapter source drift');
  invariant(adapter?.source_artifact_id === 10410898359 && adapter?.source_artifact_sha256 === REPLAY_ARTIFACT_SHA && adapter?.source_receipt_sha256 === REPLAY_RECEIPT_SHA, 'adapter predecessor binding drift');
  invariant(adapter?.baseline_policy === 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1' && adapter?.outcome_policy === 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1', 'adapter policy drift');
  invariant(adapter?.target_horizon_ms === 86_400_000 && adapter?.shape_adaptation_only === true && adapter?.preserve_source_policy_identity === true && adapter?.preserve_classification_and_executable_value === true && adapter?.creator_history_point_in_time_only === true, 'adapter semantic boundary drift');
  invariant(adapter?.old_sqlite_runner_authorized === false, 'old SQLite runner must remain unauthorized');

  const review = packet.review_gate;
  invariant(review?.required === true && review?.status === 'PENDING' && review?.review_loop_limit === 1, 'review gate drift');
  invariant(review?.initial_review_id === null && review?.initial_reviewed_head === null && review?.unresolved_critical_high === null, 'review evidence cannot be pre-filled');
  invariant(packet.acceptance?.predecessor_github_provenance_must_be_runtime_verified === true, 'runtime predecessor provenance verification required');
  invariant(packet.acceptance?.normalized_rule_must_match_fetched_source_semantics === true, 'source semantic parity verification required');
  invariant(packet.decision_result?.status === 'PENDING_REVIEW' && packet.decision_result?.authorized_bit_if_closed === 'fast_vet_smoke', 'decision result drift');

  invariant(Array.isArray(packet.authority_docs) && packet.authority_docs.length > 0 && Array.isArray(packet.context_files) && packet.context_files.length > 0, 'authority/context files required');
  for (const path of new Set([...packet.authority_docs, ...packet.context_files])) invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `authority/context file missing: ${path}`);
}

function main() {
  try {
    const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
    validateFastVetAuthorization(packet);
    console.log(`DEV_SPINE_CHECK=PASS phase=${packet.phase} state=${packet.state}`);
  } catch (error) {
    console.error(`DEV_SPINE_CHECK=FAIL ${error.message}`);
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
