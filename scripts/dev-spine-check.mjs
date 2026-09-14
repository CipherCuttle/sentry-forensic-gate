import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1.json';
const EXPECTED_HORIZONS = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '24h', ms: 86_400_000 },
];
const REDSTONE_ADDRESS = '0xe5867b1d421f0b52697f16e2ac437e87d66d5fbf';
const HISTORICAL_BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const HISTORICAL_OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
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
  HISTORICAL_ALL_HORIZON_COMPATIBILITY_IMPLEMENTATION_AUTHORIZED: {
    ...ALL_FALSE_AUTHORIZATION,
    historical_all_horizon_compatibility_implementation: true,
  },
  HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS: {
    ...ALL_FALSE_AUTHORIZATION,
  },
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validatePacket(packet) {
  invariant(packet.schema === 'dev-spine-phase/v1', 'unexpected phase packet schema');
  invariant(packet.repo === 'CipherCuttle/sentry-forensic-gate', 'unexpected repository identity');
  invariant(packet.phase === 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1', 'unexpected active phase');
  invariant(packet.phase && packet.state && packet.next_action, 'phase, state, and next_action are required');
  invariant(Array.isArray(packet.authority_docs) && packet.authority_docs.length > 0, 'authority_docs must be non-empty');
  invariant(Array.isArray(packet.context_files) && packet.context_files.length > 0, 'context_files must be non-empty');
  for (const path of new Set([...packet.authority_docs, ...packet.context_files])) {
    invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `authority/context file missing: ${path}`);
  }

  const auth = packet.authorization;
  for (const key of SENSITIVE_AUTHORIZATION_KEYS) invariant(typeof auth?.[key] === 'boolean', `authorization.${key} must be boolean`);
  const expectedAuthorization = STATE_AUTHORIZATION[packet.state];
  invariant(expectedAuthorization, `unsupported phase state: ${packet.state}`);
  for (const key of SENSITIVE_AUTHORIZATION_KEYS) {
    invariant(auth[key] === expectedAuthorization[key], `state ${packet.state} requires authorization.${key}=${expectedAuthorization[key]}`);
  }

  invariant(packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 default invariant must remain explicit');
  invariant(packet.authority?.historical_authorization_granted === false, 'historical replay authorization must remain false');
  invariant(packet.authority?.historical_baseline_policy_status === 'PASS', 'historical baseline predecessor must remain PASS');
  invariant(packet.authority?.historical_outcome_policy_status === 'PASS', 'historical outcome predecessor must remain PASS');

  const predecessor = packet.predecessor;
  invariant(predecessor?.phase === 'HISTORICAL_OUTCOME_POLICY_R1', 'unexpected predecessor phase');
  invariant(predecessor?.closure_head === 'cc53013075d9e450fe6c92c07269a577cbfaa7aa', 'predecessor closure head drift');
  invariant(predecessor?.verdict === 'HISTORICAL_OUTCOME_POLICY_PASS', 'predecessor verdict must remain PASS');
  invariant(predecessor?.representative_24h_complete === 9 && predecessor?.representative_24h_unverified === 0, 'predecessor 24h result must remain 9 COMPLETE / 0 UNVERIFIED');
  invariant(predecessor?.hostile_review_closed === true, 'predecessor hostile review must remain closed');
  invariant(predecessor?.targeted_review_closed === true, 'predecessor targeted review must remain closed');

  const acceptance = packet.acceptance;
  invariant(acceptance?.representatives === 9, 'acceptance.representatives must equal 9');
  invariant(JSON.stringify(acceptance?.horizons) === JSON.stringify(EXPECTED_HORIZONS), 'frozen horizon set drift');
  invariant(acceptance?.expected_outcome_cells === 45, 'expected outcome cell count must equal 45');
  invariant(acceptance?.baseline_complete_required === 9, 'historical baseline COMPLETE requirement must remain 9');
  invariant(acceptance?.outcome_complete_required === 45, 'historical outcome COMPLETE requirement must remain 45');
  invariant(acceptance?.outcome_unverified_required === 0, 'historical outcome UNVERIFIED requirement must remain 0');
  invariant(acceptance?.live_archive_rpc_required === true, 'live archive RPC requirement must remain explicit');
  invariant(acceptance?.point_in_time_inputs_only === true, 'point-in-time input requirement must remain explicit');
  invariant(acceptance?.all_representatives_must_be_attempted === true, 'all representatives must remain required');
  invariant(acceptance?.all_horizons_must_be_attempted === true, 'all horizons must remain required');
  invariant(acceptance?.provider_or_transport_failure_is_not_market_evidence === true, 'provider failure must not become market evidence');
  invariant(acceptance?.ordinary_ci_must_be_green === true, 'ordinary CI requirement must remain explicit');
  invariant(acceptance?.research_only_guardrails_must_be_green === true, 'research-only guardrail requirement must remain explicit');
  invariant(acceptance?.observed_blocks_preregistered === false, 'observed horizon blocks must remain live outputs, not preregistered constants');
  invariant(!Object.prototype.hasOwnProperty.call(acceptance, 'observed_blocks'), 'observed_blocks must not be hard-coded in all-horizon preregistration');

  const policy = packet.frozen_policies;
  invariant(policy?.baseline_policy_version === HISTORICAL_BASELINE_POLICY, 'historical baseline policy version drift');
  invariant(policy?.outcome_policy_version === HISTORICAL_OUTCOME_POLICY, 'historical outcome policy version drift');
  invariant(policy?.weth_valuation_kind === 'WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1', 'historical WETH valuation kind drift');
  invariant(String(policy?.redstone_eth_usd_address).toLowerCase() === REDSTONE_ADDRESS, 'RedStone address drift');
  invariant(policy?.required_oracle_decimals === 8, 'RedStone decimals must remain 8');
  invariant(policy?.required_oracle_description === 'RedStone Price Feed for ETH', 'RedStone description drift');
  invariant(policy?.required_oracle_version === 1, 'RedStone version drift');
  invariant(policy?.freshness_rejection_threshold_seconds === null, 'phase must not fit an age cutoff to representative data');
  invariant(policy?.current_r1_default_must_remain_bit_for_bit_identity_compatible === true, 'current outcome R1 identity compatibility must remain explicit');

  const historical = packet.known_historical_state;
  invariant(historical?.launch_count === 147, 'historical launch count must remain 147');
  invariant(historical?.launch_producing_implementation_cohorts === 9, 'historical implementation cohort count must remain 9');
  invariant(historical?.representative_fixture_status === 'CAPTURED_FROM_REVIEWED_DISCOVERY_ARTIFACT', 'representative fixture status must remain reviewed');
  invariant(fs.existsSync(historical?.representative_fixture_path), 'representative fixture path must exist');

  if (packet.state === 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_IMPLEMENTATION_AUTHORIZED') {
    invariant(packet.next_action === 'IMPLEMENT_ALL_HORIZON_HARNESS_AND_RUN_45_CELL_LIVE_GATE', 'implementation next action drift');
    invariant(!packet.implementation_result, 'implementation result must not be predeclared before live gate');
  } else {
    invariant(packet.next_action === 'OPEN_HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1_DECISION', 'closed next action drift');
    const result = packet.implementation_result;
    invariant(result?.status === 'PASS', 'closed all-horizon result must be PASS');
    invariant(result?.representatives_attempted === 9, 'closed representative attempted count must remain 9');
    invariant(result?.baseline_complete === 9 && result?.baseline_unverified === 0, 'closed baseline result must remain 9 COMPLETE / 0 UNVERIFIED');
    invariant(result?.outcomes_attempted === 45, 'closed outcome attempted count must remain 45');
    invariant(result?.outcomes_complete === 45, 'closed outcome COMPLETE count must remain 45');
    invariant(result?.outcomes_unverified === 0, 'closed outcome UNVERIFIED count must remain 0');
    invariant(result?.verdict === 'HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS', 'closed all-horizon verdict drift');
    invariant(auth.full_147_replay === false, 'all-horizon PASS must not self-authorize full replay');
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
