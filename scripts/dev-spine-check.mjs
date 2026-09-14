import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_BASELINE_POLICY_R1.json';
const FROZEN_R1_NOTIONALS = [250000, 500000, 1000000, 2000000, 5000000];
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
  HISTORICAL_BASELINE_POLICY_DISCOVERY_AUTHORIZED: {
    historical_compatibility_implementation: false,
    historical_baseline_policy_discovery: true,
    historical_baseline_policy_implementation: false,
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

  if (auth.full_147_replay) {
    invariant(packet.authority?.historical_authorization_granted === true, 'full historical replay cannot be authorized before historical authority is granted');
  }
  invariant(packet.authority?.current_r3_behavior_must_remain_unchanged === true, 'current R3 default invariant must remain explicit');
  invariant(packet.authority?.historical_authorization_granted === false, 'historical authorization must remain false during policy discovery');

  const acceptance = packet.acceptance;
  invariant(Number.isInteger(acceptance?.representatives) && acceptance.representatives === 9, 'acceptance.representatives must equal 9');
  invariant(Number.isInteger(acceptance?.decision_delay_blocks) && acceptance.decision_delay_blocks === 2, 'acceptance.decision_delay_blocks must equal 2');
  invariant(Array.isArray(acceptance?.notionals_usd_micros), 'acceptance.notionals_usd_micros must be an array');
  invariant(
    JSON.stringify(acceptance.notionals_usd_micros) === JSON.stringify(FROZEN_R1_NOTIONALS),
    'frozen R1 notionals must remain exactly 250000,500000,1000000,2000000,5000000',
  );
  invariant(acceptance.live_archive_rpc_required === true, 'live archive RPC requirement must remain explicit');
  invariant(acceptance.point_in_time_inputs_only === true, 'point-in-time input requirement must remain explicit');
  invariant(acceptance.existing_historical_tuple_only === true, 'historical tuple requirement must remain explicit');

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
