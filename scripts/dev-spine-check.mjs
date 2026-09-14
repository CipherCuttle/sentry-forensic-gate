import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1.json';
const PREDECESSOR_HEAD = '28e598d738c633b0211bae914b8f92450ae61f90';
const BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
const EXPECTED_HORIZONS = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '24h', ms: 86_400_000 },
];
const SENSITIVE_AUTHORIZATION_KEYS = [
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
];
const ALL_FALSE_AUTHORIZATION = Object.fromEntries(SENSITIVE_AUTHORIZATION_KEYS.map((key) => [key, false]));
const STATE_AUTHORIZATION = {
  HISTORICAL_FULL_REPLAY_AUTHORIZATION_DECISION_OPEN: {
    ...ALL_FALSE_AUTHORIZATION,
  },
  HISTORICAL_FULL_REPLAY_AUTHORIZED: {
    ...ALL_FALSE_AUTHORIZATION,
    full_147_replay: true,
  },
  HISTORICAL_FULL_REPLAY_AUTHORIZATION_REJECTED: {
    ...ALL_FALSE_AUTHORIZATION,
  },
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validatePacket(packet) {
  invariant(packet.schema === 'dev-spine-phase/v1', 'unexpected phase packet schema');
  invariant(packet.repo === 'CipherCuttle/sentry-forensic-gate', 'unexpected repository identity');
  invariant(packet.phase === 'HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1', 'unexpected active phase');
  invariant(packet.phase && packet.state && packet.next_action, 'phase, state, and next_action are required');
  invariant(Array.isArray(packet.authority_docs) && packet.authority_docs.length > 0, 'authority_docs must be non-empty');
  invariant(Array.isArray(packet.context_files) && packet.context_files.length > 0, 'context_files must be non-empty');
  for (const path of new Set([...packet.authority_docs, ...packet.context_files])) {
    invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `authority/context file missing: ${path}`);
  }

  const auth = packet.authorization;
  const expectedAuthorization = STATE_AUTHORIZATION[packet.state];
  invariant(expectedAuthorization, `unsupported phase state: ${packet.state}`);
  for (const key of SENSITIVE_AUTHORIZATION_KEYS) {
    invariant(typeof auth?.[key] === 'boolean', `authorization.${key} must be boolean`);
    invariant(auth[key] === expectedAuthorization[key], `state ${packet.state} requires authorization.${key}=${expectedAuthorization[key]}`);
  }

  const authorized = packet.state === 'HISTORICAL_FULL_REPLAY_AUTHORIZED';
  invariant(packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 default invariant must remain explicit');
  invariant(packet.authority?.historical_authorization_granted === authorized, `state ${packet.state} requires authority.historical_authorization_granted=${authorized}`);
  invariant(packet.authority?.historical_baseline_policy_status === 'PASS', 'historical baseline policy status drift');
  invariant(packet.authority?.historical_outcome_policy_status === 'PASS', 'historical outcome policy status drift');
  invariant(packet.authority?.historical_all_horizon_compatibility_status === 'PASS', 'all-horizon compatibility status drift');

  const predecessor = packet.predecessor;
  invariant(predecessor?.phase === 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1', 'unexpected predecessor phase');
  invariant(predecessor?.closure_head === PREDECESSOR_HEAD, 'predecessor closure head drift');
  invariant(predecessor?.verdict === 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS', 'predecessor verdict drift');
  invariant(predecessor?.representatives_attempted === 9, 'predecessor representative count drift');
  invariant(predecessor?.baseline_complete === 9 && predecessor?.baseline_unverified === 0, 'predecessor baseline result must remain 9 COMPLETE / 0 UNVERIFIED');
  invariant(predecessor?.outcomes_attempted === 45 && predecessor?.outcomes_complete === 45 && predecessor?.outcomes_unverified === 0, 'predecessor outcome result must remain 45 COMPLETE / 0 UNVERIFIED');
  for (const [name, expectedId] of Object.entries({
    ci: 34908787242,
    historical_baseline_policy: 34908787280,
    historical_outcome_policy: 34908787225,
    historical_all_horizon_compatibility: 34908787293,
  })) {
    invariant(predecessor?.exact_head_runs?.[name]?.id === expectedId, `predecessor exact-head run id drift: ${name}`);
    invariant(predecessor?.exact_head_runs?.[name]?.status === 'SUCCESS', `predecessor exact-head run status drift: ${name}`);
  }

  const acceptance = packet.acceptance;
  invariant(acceptance?.frozen_historical_launch_count === 147, 'frozen historical launch count must remain 147');
  invariant(acceptance?.launch_producing_implementation_cohorts === 9, 'historical implementation cohort count must remain 9');
  invariant(acceptance?.representative_cohorts_covered === 9, 'representative cohort coverage must remain 9/9');
  invariant(acceptance?.representative_baseline_complete === 9 && acceptance?.representative_baseline_unverified === 0, 'representative baseline prerequisite drift');
  invariant(acceptance?.representative_outcomes_complete === 45 && acceptance?.representative_outcomes_unverified === 0, 'representative outcome prerequisite drift');
  invariant(acceptance?.predecessor_exact_head_verified === true, 'predecessor exact-head verification must remain true');
  invariant(acceptance?.point_in_time_inputs_only === true, 'point-in-time input requirement must remain explicit');
  invariant(acceptance?.research_only === true, 'full replay authorization must remain research-only');
  invariant(acceptance?.provider_or_transport_failure_is_not_market_evidence === true, 'provider failure must not become market evidence');
  invariant(acceptance?.current_r3_must_remain_unchanged === true, 'current R3 must remain unchanged');
  invariant(acceptance?.full_replay_scope_must_equal_frozen_147 === true, 'full replay scope must remain frozen at 147');
  invariant(acceptance?.unverified_must_remain_explicit === true, 'UNVERIFIED results must remain explicit');
  invariant(acceptance?.per_launch_per_horizon_receipts_required === true, 'per-launch/per-horizon receipts must remain required');

  const policy = packet.frozen_policies;
  invariant(policy?.baseline_policy_version === BASELINE_POLICY, 'historical baseline policy version drift');
  invariant(policy?.outcome_policy_version === OUTCOME_POLICY, 'historical outcome policy version drift');
  invariant(JSON.stringify(policy?.horizons) === JSON.stringify(EXPECTED_HORIZONS), 'frozen horizon set drift');
  invariant(policy?.weth_valuation_kind === 'WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1', 'historical WETH valuation kind drift');
  invariant(policy?.freshness_rejection_threshold_seconds === null, 'authorization phase must not fit an age cutoff');

  const historical = packet.known_historical_state;
  invariant(historical?.launch_count === 147, 'historical launch count must remain 147');
  invariant(historical?.launch_producing_implementation_cohorts === 9, 'historical implementation cohort count must remain 9');
  invariant(historical?.representative_fixture_status === 'CAPTURED_FROM_REVIEWED_DISCOVERY_ARTIFACT', 'representative fixture status must remain reviewed');
  invariant(fs.existsSync(historical?.representative_fixture_path), 'representative fixture path must exist');

  if (packet.state === 'HISTORICAL_FULL_REPLAY_AUTHORIZATION_DECISION_OPEN') {
    invariant(packet.next_action === 'DECIDE_FULL_147_REPLAY_AUTHORIZATION', 'open decision next action drift');
    invariant(!packet.decision_result, 'decision result must not be predeclared while decision is open');
  } else if (packet.state === 'HISTORICAL_FULL_REPLAY_AUTHORIZED') {
    invariant(packet.next_action === 'OPEN_HISTORICAL_FULL_REPLAY_R1_IMPLEMENTATION', 'authorized next action drift');
    invariant(packet.decision_result?.status === 'AUTHORIZE', 'authorized state requires AUTHORIZE decision result');
    invariant(packet.decision_result?.basis_predecessor_head === PREDECESSOR_HEAD, 'authorized decision predecessor basis drift');
    invariant(typeof packet.decision_result?.rationale === 'string' && packet.decision_result.rationale.length > 0, 'authorized decision rationale required');
  } else {
    invariant(packet.next_action === 'STOP_FULL_147_REPLAY', 'rejected next action drift');
    invariant(packet.decision_result?.status === 'REJECT', 'rejected state requires REJECT decision result');
    invariant(packet.decision_result?.basis_predecessor_head === PREDECESSOR_HEAD, 'rejected decision predecessor basis drift');
    invariant(typeof packet.decision_result?.rationale === 'string' && packet.decision_result.rationale.length > 0, 'rejected decision rationale required');
  }
}

function main() {
  try {
    const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
    validatePacket(packet);
    console.log(`DEV_SPINE_CHECK=PASS phase=${packet.phase} state=${packet.state}`);
  } catch (error) {
    console.error(`DEV_SPINE_CHECK=FAIL ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
