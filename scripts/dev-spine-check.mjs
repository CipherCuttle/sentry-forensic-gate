import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_BASELINE_POLICY_R1.json';
const FROZEN_R1_NOTIONALS = [250000, 500000, 1000000, 2000000, 5000000];
const HISTORICAL_POLICY_VERSION = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const REDSTONE_ADDRESS = '0xe5867b1d421f0b52697f16e2ac437e87d66d5fbf';
const SENSITIVE_AUTHORIZATION_KEYS = [
  'historical_compatibility_implementation',
  'historical_baseline_policy_discovery',
  'historical_baseline_policy_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'merge',
];
const STATE_AUTHORIZATION = {
  HISTORICAL_BASELINE_POLICY_IMPLEMENTATION_AUTHORIZED: {
    historical_compatibility_implementation: false,
    historical_baseline_policy_discovery: true,
    historical_baseline_policy_implementation: true,
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
  invariant(packet.phase === 'HISTORICAL_BASELINE_POLICY_R1', 'unexpected active phase');
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
    invariant(
      auth[key] === expectedAuthorization[key],
      `state ${packet.state} requires authorization.${key}=${expectedAuthorization[key]}`,
    );
  }

  invariant(packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 default invariant must remain explicit');
  invariant(packet.authority?.historical_authorization_granted === false, 'historical authorization must remain false before replay authority');

  const acceptance = packet.acceptance;
  invariant(acceptance?.representatives === 9, 'acceptance.representatives must equal 9');
  invariant(acceptance?.decision_delay_blocks === 2, 'acceptance.decision_delay_blocks must equal 2');
  invariant(
    JSON.stringify(acceptance?.notionals_usd_micros) === JSON.stringify(FROZEN_R1_NOTIONALS),
    'frozen R1 notionals must remain exactly 250000,500000,1000000,2000000,5000000',
  );
  invariant(acceptance?.baseline_complete_required === 9, 'baseline COMPLETE requirement must remain 9');
  invariant(acceptance?.baseline_unverified_required === 0, 'baseline UNVERIFIED requirement must remain 0');
  invariant(acceptance?.live_archive_rpc_required === true, 'live archive RPC requirement must remain explicit');
  invariant(acceptance?.point_in_time_inputs_only === true, 'point-in-time input requirement must remain explicit');

  const stageA = packet.calibration_surface_result;
  invariant(stageA?.status === 'DISCOVERY_COMPLETE', 'Stage A must remain complete');
  invariant(stageA?.representatives_with_full_frozen_r1_calibration === 1, 'Stage A full-calibration count must remain 1');

  const stageB = packet.oracle_discovery_result;
  invariant(stageB?.status === 'DISCOVERY_COMPLETE', 'Stage B must remain complete');
  invariant(stageB?.eoracle?.structurally_point_in_time_usable === 0, 'eOracle historical usability must remain 0/9');
  invariant(stageB?.redstone?.structurally_point_in_time_usable === 9, 'RedStone historical usability must remain 9/9');
  invariant(String(stageB?.redstone?.address).toLowerCase() === REDSTONE_ADDRESS, 'RedStone discovery address drift');

  const policy = packet.historical_policy;
  invariant(policy?.policy_version === HISTORICAL_POLICY_VERSION, 'historical policy version drift');
  invariant(policy?.weth_calibration_kind === 'WETH_REDSTONE_ETH_USD_ASOF_V1', 'historical calibration kind drift');
  invariant(String(policy?.redstone_eth_usd_address).toLowerCase() === REDSTONE_ADDRESS, 'historical RedStone address drift');
  invariant(policy?.required_oracle_decimals === 8, 'historical RedStone decimals must remain 8');
  invariant(policy?.required_oracle_description === 'RedStone Price Feed for ETH', 'historical RedStone description drift');
  invariant(policy?.required_oracle_version === 1, 'historical RedStone version drift');
  invariant(policy?.freshness_rejection_threshold_seconds === null, 'historical policy must not fit an age cutoff to representative data');
  invariant(policy?.oracle_age_must_be_recorded_in_calibration_evidence === true, 'oracle age evidence must remain required');
  invariant(policy?.baseline_ids_must_be_policy_separated === true, 'baseline IDs must remain policy-separated');
  invariant(policy?.quote_ids_must_be_policy_separated === true, 'quote IDs must remain policy-separated');
  invariant(policy?.current_r1_default_must_remain_bit_for_bit_identity_compatible === true, 'current R1 identity compatibility must remain explicit');

  const historical = packet.known_historical_state;
  invariant(historical?.launch_count === 147, 'historical launch count must remain 147');
  invariant(historical?.launch_producing_implementation_cohorts === 9, 'historical implementation cohort count must remain 9');
  invariant(historical?.representative_fixture_status === 'CAPTURED_FROM_REVIEWED_DISCOVERY_ARTIFACT', 'representative fixture status must remain reviewed');
  invariant(fs.existsSync(historical?.representative_fixture_path), 'representative fixture path must exist');
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
