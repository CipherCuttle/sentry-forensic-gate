import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/FAST_VET_R0_HISTORICAL_SMOKE_R1.json';
const PREDECESSOR_HEAD = 'eedd320c7745c855d5830133d4686f65b47e57a2';
const REPLAY_HEAD = '75588056de53b94f92b5cf3b40e89e2b5521031a';
const RULE_HEAD = '22fcce4c301e791a59c68b19b198bd1bea104138';
const REPLAY_ARTIFACT_SHA = 'ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a';
const REPLAY_RECEIPT_SHA = '916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825';
const BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
const AUTH_KEYS = ['historical_full_replay','fast_vet','fast_vet_smoke','fast_vet_osint','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge'];
const FROZEN_BLOBS = {
  'docs/FAST_VET_R0.md':'1ea7ac524803e621947d076e120860bade3df780',
  'src/evaluation/fastVet.ts':'0ca384e142a8f1c898f7041fff87811e2f136225',
  'src/evaluation/fastVetShadow.ts':'de2a993b93b9b60669acd09a60e1589cdc96e572',
  'scripts/fast-vet-check.mjs':'2417b03a449bf305a89d0a7196b5db89ef4216bc',
  'src/forensic/creatorOutcome.ts':'2d9b15481df64e69016c236a6374c96657d31cc0',
  'src/outcome/forwardTypes.ts':'8c9682b671a7c185dbca416594c8eacd4b0c282e'
};

function invariant(condition, message) { if (!condition) throw new Error(message); }
function exactKeys(value, expected, label) {
  invariant(JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...expected].sort()), `${label} keyset drift`);
}
function gitBlobSha1(bytes) {
  return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}

export function validateHistoricalSmoke(packet, { verifyFiles = true } = {}) {
  invariant(packet.schema === 'dev-spine-phase/v1' && packet.repo === 'CipherCuttle/sentry-forensic-gate', 'unexpected packet identity');
  invariant(packet.phase === 'FAST_VET_R0_HISTORICAL_SMOKE_R1', 'unexpected phase');
  invariant(packet.state === 'FAST_VET_R0_HISTORICAL_SMOKE_EXECUTION_AUTHORIZED', 'unexpected phase state');
  invariant(packet.next_action === 'RUN_FAST_VET_R0_HISTORICAL_SMOKE_R1_ON_PINNED_ARTIFACT', 'unexpected next action');

  invariant(packet.predecessor?.phase === 'FAST_VET_R0_AUTHORIZATION_R1' && packet.predecessor?.pr === 24, 'predecessor phase drift');
  invariant(packet.predecessor?.closure_head === PREDECESSOR_HEAD && packet.predecessor?.verdict === 'CLOSED_AUTHORIZE_SMOKE', 'predecessor closure drift');

  const replay = packet.replay_source;
  invariant(replay?.phase === 'HISTORICAL_FULL_REPLAY_R1' && replay?.pr === 23 && replay?.closure_head === REPLAY_HEAD, 'replay source identity drift');
  invariant(replay?.run_id === 35001582697 && replay?.artifact_id === 10410898359, 'replay run/artifact drift');
  invariant(replay?.artifact_sha256 === REPLAY_ARTIFACT_SHA && replay?.receipt_sha256 === REPLAY_RECEIPT_SHA, 'replay digest drift');
  invariant(replay?.launches_accounted === 147 && replay?.baseline_complete === 147 && replay?.baseline_unverified === 0, 'replay baseline accounting drift');
  invariant(replay?.horizon_cells_accounted === 735 && replay?.outcomes_complete === 735 && replay?.outcomes_unverified === 0, 'replay outcome accounting drift');
  invariant(replay?.baseline_policy === BASELINE_POLICY && replay?.outcome_policy === OUTCOME_POLICY, 'replay policy drift');

  const rule = packet.frozen_smoke_rule;
  invariant(rule?.source_pr === 13 && rule?.source_head === RULE_HEAD && rule?.source_ci_run === 34772418456 && rule?.source_ci_status === 'SUCCESS', 'frozen rule source drift');
  invariant(rule?.decision_policy_version === 'FAST_VET_R0' && rule?.shadow_receipt_version === 'FAST_VET_SHADOW_R0', 'frozen rule identity drift');
  invariant(rule?.materialization === 'DEDICATED_WORKFLOW_FETCH_EXACT_SOURCE_HEAD_NOT_COMMITTED', 'frozen rule materialization drift');
  invariant(rule?.status === 'SMOKE_ONLY' && rule?.strategy_label === 'EDGE_UNPROVEN', 'frozen scientific status drift');
  invariant(rule?.primary_notional_usd_micros === 1_000_000 && rule?.target_horizon_ms === 86_400_000 && rule?.unknown_action === 'SKIP' && rule?.control_cohort === 'COMPLETE_BASELINE_ONLY', 'frozen rule semantics drift');
  invariant(JSON.stringify(rule?.source_blobs) === JSON.stringify(FROZEN_BLOBS), 'frozen source blob manifest drift');

  const adapter = packet.adapter_contract;
  invariant(adapter?.source === 'PINNED_REPAIRED_HISTORICAL_REPLAY_AGGREGATE_ONLY', 'adapter source drift');
  for (const key of ['shape_adaptation_only','no_chain_refetch','no_sqlite_runner','preserve_source_policy_identity','preserve_classification_and_executable_value','creator_history_point_in_time_only']) {
    invariant(adapter?.[key] === true, `adapter_contract.${key} must remain true`);
  }
  invariant(adapter?.creator_history_order === 'FROZEN_CANONICAL_REPLAY_ORDINAL', 'creator history order drift');
  invariant(adapter?.creator_outcome_available_rule === '24H_COMPLETE_AND_OBSERVED_BLOCK_LTE_TARGET_DECISION_BLOCK', 'creator outcome availability drift');
  invariant(adapter?.shadow_target_projection === 'HISTORICAL_OUTCOME_TO_FROZEN_FORWARD_OUTCOMES_R1_ANALYZER_SHAPE_ONLY', 'shadow projection drift');
  invariant(adapter?.shadow_projection_is_evidence_authority === false, 'shadow projection must not become evidence authority');

  exactKeys(packet.authorization, AUTH_KEYS, 'authorization');
  for (const key of AUTH_KEYS) invariant(packet.authorization[key] === (key === 'fast_vet_smoke'), `implementation requires authorization.${key}=${key === 'fast_vet_smoke'}`);

  invariant(packet.review_gate?.required === true && packet.review_gate?.status === 'PENDING_IMPLEMENTATION_HOSTILE_REVIEW' && packet.review_gate?.review_loop_limit === 1, 'implementation review gate drift');
  invariant(packet.review_gate?.unresolved_critical_high === null, 'implementation review must not fabricate closure');

  const acceptance = packet.acceptance;
  for (const key of ['predecessor_authorization_exact_head_required','source_replay_receipt_sha256_required','source_rule_exact_blobs_required','launches_must_equal_147','horizon_cells_must_equal_735','baseline_complete_must_equal_147','outcomes_complete_must_equal_735','unknown_must_map_to_skip','primary_notional_must_remain_one_usd','target_horizon_must_remain_24h','control_denominator_must_be_complete_baselines_only','no_post_hoc_threshold_or_rule_tuning','no_new_network_or_osint_collectors','current_r3_must_remain_unchanged','no_live_authority']) {
    invariant(acceptance?.[key] === true, `acceptance.${key} must remain true`);
  }

  invariant(Array.isArray(packet.authority_docs) && packet.authority_docs.length > 0 && Array.isArray(packet.context_files) && packet.context_files.length > 0, 'authority/context files required');
  if (verifyFiles) {
    for (const path of new Set([...packet.authority_docs, ...packet.context_files])) invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `authority/context file missing: ${path}`);
    for (const [path, expected] of Object.entries(FROZEN_BLOBS)) {
      if (!fs.existsSync(path)) {
        invariant(['docs/FAST_VET_R0.md','src/evaluation/fastVet.ts','src/evaluation/fastVetShadow.ts','scripts/fast-vet-check.mjs'].includes(path), `frozen transitive source file missing: ${path}`);
        continue;
      }
      const actual = gitBlobSha1(fs.readFileSync(path));
      invariant(actual === expected, `frozen source blob drift: ${path}:actual=${actual}:expected=${expected}`);
    }
  }
}

function main() {
  try {
    const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
    validateHistoricalSmoke(packet);
    console.log(`DEV_SPINE_CHECK=PASS phase=${packet.phase} state=${packet.state}`);
  } catch (error) {
    console.error(`DEV_SPINE_CHECK=FAIL ${error.message}`);
    process.exit(1);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
