import fs from 'node:fs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_COMPATIBILITY_R1.json';

function fail(message) {
  console.error(`DEV_SPINE_CHECK=FAIL ${message}`);
  process.exit(1);
}

let packet;
try {
  packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
} catch (error) {
  fail(`cannot parse ${PACKET_PATH}: ${error.message}`);
}

if (packet.schema !== 'dev-spine-phase/v1') fail('unexpected phase packet schema');
if (packet.repo !== 'CipherCuttle/sentry-forensic-gate') fail('unexpected repository identity');
if (!packet.phase || !packet.state || !packet.next_action) fail('phase, state, and next_action are required');
if (!Array.isArray(packet.authority_docs) || packet.authority_docs.length === 0) fail('authority_docs must be non-empty');
if (!Array.isArray(packet.context_files) || packet.context_files.length === 0) fail('context_files must be non-empty');

for (const path of new Set([...packet.authority_docs, ...packet.context_files])) {
  if (!fs.existsSync(path) || !fs.statSync(path).isFile()) fail(`authority/context file missing: ${path}`);
}

const auth = packet.authorization;
for (const key of ['historical_compatibility_implementation', 'full_147_replay', 'fast_vet', 'canary', 'merge']) {
  if (typeof auth?.[key] !== 'boolean') fail(`authorization.${key} must be boolean`);
}

if (packet.state === 'NEXT_AWAITING_IMPLEMENTATION_PROMPT' && auth.historical_compatibility_implementation !== false) {
  fail('awaiting implementation prompt cannot authorize implementation');
}
if (auth.full_147_replay && packet.authority?.historical_authorization_granted !== true) {
  fail('full historical replay cannot be authorized before historical authority is granted');
}
if (packet.authority?.current_r3_behavior_must_remain_unchanged !== true) {
  fail('current R3 default invariant must remain explicit');
}

const acceptance = packet.acceptance;
for (const key of ['representatives', 'decision_delay_blocks', 'outcome_horizon_ms']) {
  if (!Number.isInteger(acceptance?.[key]) || acceptance[key] <= 0) fail(`acceptance.${key} must be a positive integer`);
}
if (acceptance?.live_archive_rpc_required !== true) fail('live archive RPC requirement must remain explicit');
if (acceptance?.real_existing_pipeline_required !== true) fail('real existing pipeline requirement must remain explicit');

const cohort = packet.known_historical_state;
if (!Array.isArray(cohort?.implementation_cohorts) || cohort.implementation_cohorts.length === 0) {
  fail('implementation cohorts must be non-empty');
}
const cohortLaunches = cohort.implementation_cohorts.reduce((sum, item) => sum + Number(item.launches ?? 0), 0);
if (cohortLaunches !== cohort.launch_count) fail('historical cohort accounting does not close');
if (cohort.implementation_cohorts.length !== cohort.launch_producing_implementation_cohorts) {
  fail('historical implementation cohort count does not close');
}

console.log(`DEV_SPINE_CHECK=PASS phase=${packet.phase} state=${packet.state}`);
