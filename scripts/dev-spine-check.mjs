import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_OUTCOME_POLICY_R1.json';
const EXACT_OBSERVED_BLOCKS = [40029876, 40118660, 42146879, 44224383, 45720972, 45900260, 46697772, 46723560, 46753934];
const REDSTONE_ADDRESS = '0xe5867b1d421f0b52697f16e2ac437e87d66d5fbf';
const SENSITIVE_AUTHORIZATION_KEYS = [
  'historical_compatibility_implementation',
  'historical_baseline_policy_discovery',
  'historical_baseline_policy_implementation',
  'historical_outcome_policy_discovery',
  'historical_outcome_policy_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'merge',
];
const STATE_AUTHORIZATION = {
  HISTORICAL_OUTCOME_POLICY_DISCOVERY_AUTHORIZED: {
    historical_compatibility_implementation: false,
    historical_baseline_policy_discovery: false,
    historical_baseline_policy_implementation: false,
    historical_outcome_policy_discovery: true,
    historical_outcome_policy_implementation: false,
    full_147_replay: false,
    fast_vet: false,
    canary: false,
    merge: false,
  },
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function validatePacket(packet) {
  invariant(packet.schema === 'dev-spine-phase/v1', 'unexpected phase packet schema');
  invariant(packet.repo === 'CipherCuttle/sentry-forensic-gate', 'unexpected repository identity');
  invariant(packet.phase === 'HISTORICAL_OUTCOME_POLICY_R1', 'unexpected active phase');
  invariant(packet.phase && packet.state && packet.next_action, 'phase, state, and next_action are required');
  invariant(Array.isArray(packet.authority_docs) && packet.authority_docs.length > 0, 'authority_docs must be non-empty');
  invariant(Array.isArray(packet.context_files) && packet.context_files.length > 0, 'context_files must be non-empty');

  for (const path of new Set([...packet.authority_docs, ...packet.context_files])) {
    invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `authority/context file missing: ${path}`);
  }

  const auth = packet.authorization;
  for (const key of SENSITIVE_AUTHORIZATION_KEYS) {
    invariant(typeof auth?.[key] === 'boolean', `authorization.${key} must be boolean`);
  }
  const expectedAuthorization = STATE_AUTHORIZATION[packet.state];
  invariant(expectedAuthorization, `unsupported phase state: ${packet.state}`);
  for (const key of SENSITIVE_AUTHORIZATION_KEYS) {
    invariant(auth[key] === expectedAuthorization[key], `state ${packet.state} requires authorization.${key}=${expectedAuthorization[key]}`);
  }

  invariant(packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 default invariant must remain explicit');
  invariant(packet.authority?.historical_authorization_granted === false, 'historical replay authorization must remain false');
  invariant(packet.authority?.historical_baseline_policy_status === 'PASS', 'historical baseline predecessor must remain PASS');
  invariant(packet.authority?.historical_outcome_policy_status === 'DISCOVERY_NOT_RUN', 'outcome policy status must remain discovery-not-run before evidence');

  const acceptance = packet.acceptance;
  invariant(acceptance?.representatives === 9, 'acceptance.representatives must equal 9');
  invariant(acceptance?.outcome_horizon_ms === 86400000, 'outcome horizon must remain exact 24h');
  invariant(JSON.stringify(acceptance?.observed_blocks) === JSON.stringify(EXACT_OBSERVED_BLOCKS), 'exact 24h observed block set drift');
  invariant(acceptance?.live_archive_rpc_required === true, 'live archive RPC requirement must remain explicit');
  invariant(acceptance?.point_in_time_inputs_only === true, 'point-in-time input requirement must remain explicit');
  invariant(acceptance?.all_representatives_must_be_attempted === true, 'all representatives must remain required');
  invariant(acceptance?.provider_or_transport_failure_is_not_market_evidence === true, 'provider failure must not become market evidence');

  const predecessor = packet.predecessor_result;
  invariant(predecessor?.historical_baseline_attempted === 9, 'predecessor baseline attempted must remain 9');
  invariant(predecessor?.historical_baseline_complete === 9, 'predecessor baseline COMPLETE must remain 9');
  invariant(predecessor?.historical_baseline_unverified === 0, 'predecessor baseline UNVERIFIED must remain 0');
  invariant(predecessor?.historical_baseline_verdict === 'PASS', 'predecessor baseline verdict must remain PASS');
  invariant(predecessor?.outcomes_24h_attempted === 9, 'predecessor outcomes attempted must remain 9');
  invariant(predecessor?.outcomes_24h_complete === 7, 'predecessor outcomes COMPLETE must remain 7');
  invariant(predecessor?.outcomes_24h_unverified === 2, 'predecessor outcomes UNVERIFIED must remain 2');

  const oracle = packet.candidate_oracle;
  invariant(oracle?.id === 'REDSTONE_ETH_USD', 'candidate oracle identity drift');
  invariant(String(oracle?.address).toLowerCase() === REDSTONE_ADDRESS, 'candidate RedStone address drift');
  invariant(oracle?.required_decimals === 8, 'RedStone decimals must remain 8');
  invariant(oracle?.required_description === 'RedStone Price Feed for ETH', 'RedStone description drift');
  invariant(oracle?.required_version === 1, 'RedStone version drift');
  invariant(oracle?.freshness_rejection_threshold_seconds === null, 'discovery must not fit an age cutoff to representative data');

  const historical = packet.known_historical_state;
  invariant(historical?.launch_count === 147, 'historical launch count must remain 147');
  invariant(historical?.launch_producing_implementation_cohorts === 9, 'historical implementation cohort count must remain 9');
  invariant(historical?.representative_fixture_status === 'CAPTURED_FROM_REVIEWED_DISCOVERY_ARTIFACT', 'representative fixture status must remain reviewed');
  invariant(fs.existsSync(historical?.representative_fixture_path), 'representative fixture path must exist');

  invariant(packet.next_action === 'RUN_POINT_IN_TIME_REDSTONE_AT_EXACT_24H_BLOCKS', 'unexpected successor next action');
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
