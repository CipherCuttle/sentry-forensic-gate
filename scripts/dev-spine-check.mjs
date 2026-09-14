import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_COMPATIBILITY_R1.json';
const SENSITIVE_AUTHORIZATION_KEYS = [
  'historical_compatibility_implementation',
  'full_147_replay',
  'fast_vet',
  'canary',
  'merge',
];
const STATE_AUTHORIZATION = {
  NEXT_AWAITING_IMPLEMENTATION_PROMPT: {
    historical_compatibility_implementation: false,
    full_147_replay: false,
    fast_vet: false,
    canary: false,
    merge: false,
  },
  HISTORICAL_COMPATIBILITY_IMPLEMENTATION_AUTHORIZED: {
    historical_compatibility_implementation: true,
    full_147_replay: false,
    fast_vet: false,
    canary: false,
    merge: false,
  },
  HISTORICAL_COMPATIBILITY_BLOCKED_FROZEN_BASELINE_SEMANTICS: {
    historical_compatibility_implementation: false,
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

  const acceptance = packet.acceptance;
  for (const key of ['representatives', 'decision_delay_blocks', 'outcome_horizon_ms']) {
    invariant(Number.isInteger(acceptance?.[key]) && acceptance[key] > 0, `acceptance.${key} must be a positive integer`);
  }
  invariant(acceptance?.live_archive_rpc_required === true, 'live archive RPC requirement must remain explicit');
  invariant(acceptance?.real_existing_pipeline_required === true, 'real existing pipeline requirement must remain explicit');

  const cohort = packet.known_historical_state;
  invariant(Array.isArray(cohort?.implementation_cohorts) && cohort.implementation_cohorts.length > 0, 'implementation cohorts must be non-empty');
  const cohortLaunches = cohort.implementation_cohorts.reduce((sum, item) => sum + Number(item.launches ?? 0), 0);
  invariant(cohortLaunches === cohort.launch_count, 'historical cohort accounting does not close');
  invariant(
    cohort.implementation_cohorts.length === cohort.launch_producing_implementation_cohorts,
    'historical implementation cohort count does not close',
  );

  if (packet.state === 'HISTORICAL_COMPATIBILITY_BLOCKED_FROZEN_BASELINE_SEMANTICS') {
    invariant(packet.authority?.historical_compatibility_status === 'FAIL_FROZEN_BASELINE_SEMANTIC_INCOMPATIBILITY', 'blocked compatibility state requires explicit failure status');
    invariant(packet.compatibility_result?.verdict === 'FAIL', 'blocked compatibility state requires FAIL live verdict');
    invariant(packet.compatibility_result?.baseline_attempted === acceptance.representatives, 'blocked compatibility state requires all baseline representatives attempted');
    invariant(packet.compatibility_result?.baseline_complete < acceptance.baseline_complete_required, 'blocked compatibility state must not claim baseline acceptance');
    invariant(packet.next_action === 'STOP_DO_NOT_BROADEN_BASELINE_SEMANTICS_AWAIT_SUCCESSOR_DECISION', 'blocked compatibility state must STOP and await successor decision');
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
