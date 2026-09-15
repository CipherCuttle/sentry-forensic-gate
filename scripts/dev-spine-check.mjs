import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/FAST_VET_R0_AUTHORIZATION_R1.json';
const RULE_PATH = 'fixtures/fast-vet-r0-authorization-r1.json';
const RULE_SHA = '48704fd4692016a7fae73bcd63841686788f837d3001d43c9cf5cb3841172665';
const REPLAY_HEAD = '75588056de53b94f92b5cf3b40e89e2b5521031a';
const SMOKE_HEAD = '22fcce4c301e791a59c68b19b198bd1bea104138';
const REPLAY_ARTIFACT_SHA = 'ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a';
const REPLAY_RECEIPT_SHA = '916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825';
const AUTH_KEYS = [
  'historical_full_replay','fast_vet','fast_vet_smoke','fast_vet_osint','canary',
  'signing','transaction_construction','transaction_broadcast','live_execution','merge'
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function exactKeys(value, expected, label) {
  invariant(JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...expected].sort()), `${label} keyset drift`);
}

export function validateFastVetAuthorization(packet, ruleRaw = fs.readFileSync(RULE_PATH)) {
  invariant(packet.schema === 'dev-spine-phase/v1', 'unexpected packet schema');
  invariant(packet.repo === 'CipherCuttle/sentry-forensic-gate', 'unexpected repo');
  invariant(packet.phase === 'FAST_VET_R0_AUTHORIZATION_R1', 'unexpected phase');
  invariant(packet.state === 'FAST_VET_R0_AUTHORIZATION_PENDING_REVIEW', 'unexpected phase state');
  invariant(packet.next_action === 'RUN_ONE_INDEPENDENT_HOSTILE_REVIEW', 'hostile review must be next');

  exactKeys(packet.authorization, AUTH_KEYS, 'authorization');
  for (const key of AUTH_KEYS) invariant(packet.authorization[key] === false, `pending authorization requires authorization.${key}=false`);

  invariant(packet.authority?.current_default === 'R3', 'current default authority drift');
  invariant(packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 behavior must remain unchanged');
  invariant(packet.authority?.historical_full_replay_status === 'PASS', 'historical replay predecessor must be PASS');
  invariant(packet.authority?.research_only === true, 'authorization must remain research-only');
  invariant(packet.authority?.fast_vet_authorization_status === 'PENDING_REVIEW', 'FAST_VET authorization must remain pending');

  const predecessor = packet.predecessor;
  invariant(predecessor?.phase === 'HISTORICAL_FULL_REPLAY_R1' && predecessor?.pr === 23, 'predecessor identity drift');
  invariant(predecessor?.closure_head === REPLAY_HEAD && predecessor?.verdict === 'CLOSED_PASS', 'predecessor closure drift');
  invariant(predecessor?.closure_comment_id === 5688792266, 'predecessor closure comment drift');
  invariant(predecessor?.full_replay?.run_id === 35001582697, 'full replay run drift');
  invariant(predecessor?.full_replay?.artifact_id === 10410898359, 'full replay artifact id drift');
  invariant(predecessor?.full_replay?.artifact_sha256 === REPLAY_ARTIFACT_SHA, 'full replay artifact digest drift');
  invariant(predecessor?.full_replay?.receipt_sha256 === REPLAY_RECEIPT_SHA, 'full replay receipt digest drift');
  invariant(predecessor?.full_replay?.launches_accounted === 147, 'full replay launch count drift');
  invariant(predecessor?.full_replay?.baseline_complete === 147 && predecessor?.full_replay?.baseline_unverified === 0, 'full replay baseline accounting drift');
  invariant(predecessor?.full_replay?.horizon_cells_accounted === 735, 'full replay horizon accounting drift');
  invariant(predecessor?.full_replay?.outcomes_complete === 735 && predecessor?.full_replay?.outcomes_unverified === 0, 'full replay outcome accounting drift');
  invariant(predecessor?.review_closure?.repair_head === REPLAY_HEAD, 'predecessor review repair head drift');
  invariant(predecessor?.review_closure?.targeted_reviewed_head === REPLAY_HEAD, 'predecessor targeted review head drift');
  invariant(predecessor?.review_closure?.targeted_clean_comment_id === 5688765850, 'predecessor clean targeted review evidence drift');
  invariant(predecessor?.review_closure?.unresolved_critical_high === 0, 'predecessor unresolved Critical/High');

  const frozen = packet.frozen_smoke_rule;
  invariant(frozen?.source_pr === 13 && frozen?.source_head === SMOKE_HEAD, 'frozen smoke source drift');
  invariant(frozen?.source_ci_run === 34772418456 && frozen?.source_ci_status === 'SUCCESS', 'frozen smoke source CI drift');
  invariant(frozen?.fixture_path === RULE_PATH && frozen?.fixture_sha256 === RULE_SHA, 'frozen smoke fixture identity drift');
  invariant(frozen?.decision_policy_version === 'FAST_VET_R0', 'decision policy drift');
  invariant(frozen?.shadow_receipt_version === 'FAST_VET_SHADOW_R0', 'shadow receipt version drift');
  invariant(frozen?.status === 'SMOKE_ONLY' && frozen?.strategy_label === 'EDGE_UNPROVEN', 'smoke status/strategy drift');
  invariant(frozen?.primary_notional_usd_micros === 1_000_000, 'primary notional drift');
  invariant(frozen?.target_horizon_ms === 86_400_000, 'target horizon drift');
  invariant(frozen?.unknown_action === 'SKIP', 'UNKNOWN must remain SKIP');
  invariant(frozen?.control_cohort === 'COMPLETE_BASELINE_ONLY', 'control cohort drift');

  invariant(sha256(ruleRaw) === RULE_SHA, 'frozen rule fixture sha drift');
  const rule = JSON.parse(ruleRaw.toString('utf8'));
  invariant(rule.schema === 'fast-vet-r0-frozen-rule/v1', 'frozen rule schema drift');
  invariant(rule.source?.pr === 13 && rule.source?.head === SMOKE_HEAD, 'frozen rule source identity drift');
  invariant(rule.source?.ci_run === 34772418456 && rule.source?.ci_status === 'SUCCESS', 'frozen rule source CI drift');
  const blobs = rule.source?.blobs ?? {};
  invariant(blobs['docs/FAST_VET_R0.md'] === '1ea7ac524803e621947d076e120860bade3df780', 'FAST_VET doc blob drift');
  invariant(blobs['src/evaluation/fastVet.ts'] === '0ca384e142a8f1c898f7041fff87811e2f136225', 'FAST_VET decision blob drift');
  invariant(blobs['src/evaluation/fastVetShadow.ts'] === 'de2a993b93b9b60669acd09a60e1589cdc96e572', 'FAST_VET shadow blob drift');
  invariant(blobs['scripts/fast-vet-check.mjs'] === '2417b03a449bf305a89d0a7196b5db89ef4216bc', 'FAST_VET test blob drift');

  const decision = rule.decision_semantics;
  invariant(decision?.policy_version === 'FAST_VET_R0', 'rule decision version drift');
  invariant(decision?.primary_notional_usd_micros === 1_000_000, 'rule $1 notional drift');
  invariant(JSON.stringify(decision?.decisions) === JSON.stringify(['PASS','REJECT','UNKNOWN']), 'rule decisions drift');
  invariant(decision?.pass_action === 'BUY_ELIGIBLE' && decision?.reject_action === 'SKIP' && decision?.unknown_action === 'SKIP', 'rule action semantics drift');
  invariant(decision?.independent_reverse_semantics === 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL', 'independent reverse semantics drift');
  invariant(decision?.recovery_bps_threshold === null, 'recovery threshold tuning is forbidden');

  const shadow = rule.shadow_semantics;
  invariant(shadow?.receipt_version === 'FAST_VET_SHADOW_R0', 'shadow rule version drift');
  invariant(shadow?.status === 'SMOKE_ONLY' && shadow?.strategy_label === 'EDGE_UNPROVEN', 'shadow authority drift');
  invariant(shadow?.target_horizon_ms === 86_400_000, 'shadow horizon drift');
  invariant(shadow?.control_cohort === 'COMPLETE_BASELINE_ONLY' && shadow?.candidate_exposure === 'PASS_ONLY', 'shadow cohort semantics drift');
  invariant(shadow?.no_sample_adequacy_claim === true && shadow?.no_probability_or_p_value === true && shadow?.no_threshold_tuning === true, 'shadow non-promotion invariants drift');

  const adapter = packet.adapter_contract;
  invariant(adapter?.source === 'HISTORICAL_FULL_REPLAY_R1_REPAIRED_AGGREGATE_ONLY', 'adapter source drift');
  invariant(adapter?.source_artifact_id === 10410898359 && adapter?.source_artifact_sha256 === REPLAY_ARTIFACT_SHA, 'adapter artifact drift');
  invariant(adapter?.source_receipt_sha256 === REPLAY_RECEIPT_SHA, 'adapter receipt drift');
  invariant(adapter?.baseline_policy === 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1', 'adapter baseline policy drift');
  invariant(adapter?.outcome_policy === 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1', 'adapter outcome policy drift');
  invariant(adapter?.target_horizon_ms === 86_400_000, 'adapter horizon drift');
  for (const key of ['shape_adaptation_only','preserve_source_policy_identity','preserve_classification_and_executable_value','creator_history_point_in_time_only']) {
    invariant(adapter?.[key] === true, `adapter_contract.${key} must remain true`);
  }
  invariant(adapter?.old_sqlite_runner_authorized === false, 'old SQLite runner must remain unauthorized');

  const review = packet.review_gate;
  invariant(review?.required === true && review?.status === 'PENDING', 'review gate must remain pending');
  invariant(review?.review_loop_limit === 1, 'review loop limit drift');
  invariant(review?.initial_review_id === null && review?.initial_reviewed_head === null, 'review evidence cannot be pre-filled');
  invariant(review?.unresolved_critical_high === null, 'unresolved finding count must remain unknown before review');

  invariant(packet.decision_result?.status === 'PENDING_REVIEW', 'decision result must remain pending');
  invariant(packet.decision_result?.authorized_bit_if_closed === 'fast_vet_smoke', 'only fast_vet_smoke may be authorized by this phase');

  invariant(Array.isArray(packet.authority_docs) && packet.authority_docs.length > 0, 'authority_docs required');
  invariant(Array.isArray(packet.context_files) && packet.context_files.length > 0, 'context_files required');
  for (const path of new Set([...packet.authority_docs, ...packet.context_files])) {
    invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `authority/context file missing: ${path}`);
  }
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
