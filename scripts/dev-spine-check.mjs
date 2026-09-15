import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadFrozenScopeManifest } from './historical-full-replay-scope-fixture.mjs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1.json';
const PREDECESSOR_HEAD = '28e598d738c633b0211bae914b8f92450ae61f90';
const SCOPE_DIGEST = 'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211';
const SCOPE_PAYLOAD_SHA = 'c8188726b28e72a72ffc5c8233a416c2fb531d2e6e3229f8906969d9dc1609a0';
const SCOPE_COMPRESSED_SHA = '72a2b881c88ed1219b35406b129e5ea58968b0466cafcbe10a4a42468cd85813';
const BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
const EXPECTED_HORIZONS = [{label:'1m',ms:60000},{label:'5m',ms:300000},{label:'30m',ms:1800000},{label:'2h',ms:7200000},{label:'24h',ms:86400000}];
const SENSITIVE_AUTHORIZATION_KEYS = ['historical_compatibility_implementation','historical_baseline_policy_discovery','historical_baseline_policy_implementation','historical_outcome_policy_discovery','historical_outcome_policy_implementation','historical_all_horizon_compatibility_implementation','full_147_replay','fast_vet','canary','merge'];
const ALL_FALSE_AUTHORIZATION = Object.fromEntries(SENSITIVE_AUTHORIZATION_KEYS.map((key) => [key, false]));
const STATE_AUTHORIZATION = {
  HISTORICAL_FULL_REPLAY_AUTHORIZATION_DECISION_OPEN: { ...ALL_FALSE_AUTHORIZATION },
  HISTORICAL_FULL_REPLAY_AUTHORIZED: { ...ALL_FALSE_AUTHORIZATION, full_147_replay: true },
  HISTORICAL_FULL_REPLAY_AUTHORIZATION_REJECTED: { ...ALL_FALSE_AUTHORIZATION },
};
function invariant(condition, message) { if (!condition) throw new Error(message); }
function validateScope(packet, authorized) {
  const scope = packet.acceptance?.full_replay_scope_manifest;
  invariant(scope?.required === true, 'full replay scope manifest must be required');
  invariant(scope?.path === 'fixtures/historical-full-replay-scope-r1.json', 'full replay scope manifest path drift');
  invariant(scope?.expected_launches === 147 && scope?.first_launch_block === 39943476 && scope?.final_launch_block === 49271598, 'scope manifest range/count drift');
  invariant(['DISCOVERY_PENDING','FROZEN_PENDING_LIVE_VERIFY','FROZEN_VERIFIED'].includes(scope?.status), 'unsupported scope manifest status');
  if (scope.status === 'DISCOVERY_PENDING') {
    invariant(!authorized, 'authorized replay requires FROZEN_VERIFIED scope manifest');
    invariant(scope.launch_identity_sha256 === null, 'pending scope must not predeclare identity digest');
    return;
  }
  invariant(scope.launch_identity_sha256 === SCOPE_DIGEST, 'frozen scope identity digest drift');
  invariant(scope.payload_sha256 === SCOPE_PAYLOAD_SHA, 'frozen scope payload digest drift');
  invariant(scope.compressed_payload_sha256 === SCOPE_COMPRESSED_SHA, 'frozen scope compressed payload digest drift');
  invariant(scope.discovery_run === 34910384086, 'frozen scope discovery run drift');
  invariant(scope.discovery_artifact_id === 10374237897, 'frozen scope discovery artifact drift');
  invariant(scope.discovery_artifact_sha256 === 'd63713918a90f018badf2e583a2b8230355a9dc21b0fc94499d675cf9919e296', 'frozen scope discovery artifact digest drift');
  const frozen = loadFrozenScopeManifest(scope.path);
  invariant(frozen.index.launchIdentitySha256 === scope.launch_identity_sha256, 'packet scope digest must match committed scope index');
  invariant(frozen.index.payloadSha256 === scope.payload_sha256, 'packet payload digest must match committed scope index');
  if (scope.status === 'FROZEN_VERIFIED') {
    invariant(Number.isInteger(scope.live_verification_run) && scope.live_verification_run > 0, 'frozen verified scope requires live verification run');
    invariant(Number.isInteger(scope.live_verification_artifact_id) && scope.live_verification_artifact_id > 0, 'frozen verified scope requires live verification artifact');
    invariant(/^[0-9a-f]{64}$/.test(scope.live_verification_artifact_sha256 ?? ''), 'frozen verified scope requires live verification artifact digest');
  } else {
    invariant(scope.live_verification_run === null && scope.live_verification_artifact_id === null && scope.live_verification_artifact_sha256 === null, 'pending live verification must not predeclare verification provenance');
  }
  if (authorized) invariant(scope.status === 'FROZEN_VERIFIED', 'authorized replay requires FROZEN_VERIFIED scope manifest');
}

export function validatePacket(packet) {
  invariant(packet.schema === 'dev-spine-phase/v1' && packet.repo === 'CipherCuttle/sentry-forensic-gate' && packet.phase === 'HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1', 'unexpected phase packet identity');
  invariant(packet.state && packet.next_action, 'phase state and next action required');
  invariant(Array.isArray(packet.authority_docs) && packet.authority_docs.length > 0, 'authority_docs must be non-empty');
  invariant(Array.isArray(packet.context_files) && packet.context_files.length > 0, 'context_files must be non-empty');
  for (const path of new Set([...packet.authority_docs, ...packet.context_files])) invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `authority/context file missing: ${path}`);
  const auth = packet.authorization;
  const expected = STATE_AUTHORIZATION[packet.state];
  invariant(expected, `unsupported phase state: ${packet.state}`);
  for (const key of SENSITIVE_AUTHORIZATION_KEYS) {
    invariant(typeof auth?.[key] === 'boolean', `authorization.${key} must be boolean`);
    invariant(auth[key] === expected[key], `state ${packet.state} requires authorization.${key}=${expected[key]}`);
  }
  const authorized = packet.state === 'HISTORICAL_FULL_REPLAY_AUTHORIZED';
  invariant(packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 invariant drift');
  invariant(packet.authority?.historical_authorization_granted === authorized, `state ${packet.state} requires authority.historical_authorization_granted=${authorized}`);
  invariant(packet.authority?.historical_baseline_policy_status === 'PASS' && packet.authority?.historical_outcome_policy_status === 'PASS' && packet.authority?.historical_all_horizon_compatibility_status === 'PASS', 'historical predecessor policy status drift');
  const p = packet.predecessor;
  invariant(p?.phase === 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1' && p?.closure_head === PREDECESSOR_HEAD && p?.verdict === 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS', 'predecessor identity/verdict drift');
  invariant(p?.representatives_attempted === 9 && p?.baseline_complete === 9 && p?.baseline_unverified === 0, 'predecessor baseline result drift');
  invariant(p?.outcomes_attempted === 45 && p?.outcomes_complete === 45 && p?.outcomes_unverified === 0, 'predecessor outcome result must remain 45 COMPLETE / 0 UNVERIFIED');
  for (const [name,id] of Object.entries({ci:34908787242,historical_baseline_policy:34908787280,historical_outcome_policy:34908787225,historical_all_horizon_compatibility:34908787293})) {
    invariant(p?.exact_head_runs?.[name]?.id === id && p?.exact_head_runs?.[name]?.status === 'SUCCESS', `predecessor exact-head run drift: ${name}`);
  }
  const a = packet.acceptance;
  invariant(a?.frozen_historical_launch_count === 147 && a?.launch_producing_implementation_cohorts === 9 && a?.representative_cohorts_covered === 9, 'historical population/cohort prerequisite drift');
  invariant(a?.representative_baseline_complete === 9 && a?.representative_baseline_unverified === 0, 'representative baseline prerequisite drift');
  invariant(a?.representative_outcomes_complete === 45 && a?.representative_outcomes_unverified === 0, 'representative outcome prerequisite drift');
  for (const key of ['predecessor_exact_head_verified','point_in_time_inputs_only','research_only','provider_or_transport_failure_is_not_market_evidence','current_r3_must_remain_unchanged','full_replay_scope_must_equal_frozen_147','unverified_must_remain_explicit','per_launch_per_horizon_receipts_required']) invariant(a?.[key] === true, `acceptance.${key} must remain true`);
  validateScope(packet, authorized);
  const policy = packet.frozen_policies;
  invariant(policy?.baseline_policy_version === BASELINE_POLICY && policy?.outcome_policy_version === OUTCOME_POLICY, 'historical policy version drift');
  invariant(JSON.stringify(policy?.horizons) === JSON.stringify(EXPECTED_HORIZONS), 'frozen horizon set drift');
  invariant(policy?.weth_valuation_kind === 'WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1' && policy?.freshness_rejection_threshold_seconds === null, 'historical valuation/freshness policy drift');
  const h = packet.known_historical_state;
  invariant(h?.launch_count === 147 && h?.first_launch_block === 39943476 && h?.final_launch_block === 49271598 && h?.launch_producing_implementation_cohorts === 9, 'known historical state drift');
  invariant(h?.representative_fixture_status === 'CAPTURED_FROM_REVIEWED_DISCOVERY_ARTIFACT' && fs.existsSync(h?.representative_fixture_path), 'representative fixture prerequisite drift');
  if (packet.state === 'HISTORICAL_FULL_REPLAY_AUTHORIZATION_DECISION_OPEN') {
    invariant(['FREEZE_FULL_147_REPLAY_SCOPE_THEN_DECIDE','DECIDE_FULL_147_REPLAY_AUTHORIZATION'].includes(packet.next_action), 'open decision next action drift');
    invariant(!packet.decision_result, 'decision result must not be predeclared while open');
  } else if (authorized) {
    invariant(packet.next_action === 'OPEN_HISTORICAL_FULL_REPLAY_R1_IMPLEMENTATION', 'authorized next action drift');
    invariant(packet.decision_result?.status === 'AUTHORIZE' && packet.decision_result?.basis_predecessor_head === PREDECESSOR_HEAD, 'authorized decision basis drift');
    invariant(packet.decision_result?.scope_identity_sha256 === packet.acceptance.full_replay_scope_manifest.launch_identity_sha256, 'authorized decision scope digest drift');
    invariant(typeof packet.decision_result?.rationale === 'string' && packet.decision_result.rationale.length > 0, 'authorized decision rationale required');
  } else {
    invariant(packet.next_action === 'STOP_FULL_147_REPLAY' && packet.decision_result?.status === 'REJECT' && packet.decision_result?.basis_predecessor_head === PREDECESSOR_HEAD, 'rejected decision basis/next action drift');
    invariant(typeof packet.decision_result?.rationale === 'string' && packet.decision_result.rationale.length > 0, 'rejected decision rationale required');
  }
}
function main() { try { const packet=JSON.parse(fs.readFileSync(PACKET_PATH,'utf8')); validatePacket(packet); console.log(`DEV_SPINE_CHECK=PASS phase=${packet.phase} state=${packet.state}`); } catch (error) { console.error(`DEV_SPINE_CHECK=FAIL ${error.message}`); process.exit(1); } }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
