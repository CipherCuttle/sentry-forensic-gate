import fs from 'node:fs';
import { loadFrozenScopeManifest } from './historical-full-replay-scope-fixture.mjs';
import { authorityMapDigest, loadFrozenAuthorityMap } from './historical-full-replay-authority-map-fixture.mjs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_FULL_REPLAY_R1.json';
const REVIEWED_FIXTURE_PATH = 'fixtures/historical-compatibility-r1.json';
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'historical-full-replay-authority-map-r1-live.json';

function invariant(condition, message) { if (!condition) throw new Error(message); }
const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
invariant(packet.phase === 'HISTORICAL_FULL_REPLAY_R1', 'unexpected phase packet');
const pending = packet.state === 'HISTORICAL_FULL_REPLAY_IMPLEMENTATION_AUTHORIZED';
const frozen = packet.state === 'HISTORICAL_FULL_REPLAY_AUTHORITY_MAP_FROZEN';
invariant(pending || frozen, `unsupported Stage A state:${packet.state}`);
invariant((pending && packet.next_action === 'BUILD_AND_VERIFY_147_LAUNCH_AUTHORITY_MAP') ||
  (frozen && packet.next_action === 'EXECUTE_FULL_147_X_5_REPLAY'), 'Stage A state/next action mismatch');
invariant(packet.authorization?.full_147_replay === true, 'full replay implementation authority missing');
for (const key of ['fast_vet','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge']) {
  invariant(packet.authorization?.[key] === false, `Stage A requires authorization.${key}=false`);
}

const gate = packet.authority_map_gate;
invariant((pending && gate?.status === 'PENDING_VERIFICATION') || (frozen && gate?.status === 'FROZEN_VERIFIED'), 'Stage A state/gate status mismatch');
const { index, manifest } = loadFrozenScopeManifest(packet.frozen_scope.manifest_path);
invariant(index.launchIdentitySha256 === packet.frozen_scope.launch_identity_sha256, 'scope digest mismatch');
invariant(manifest.launches.length === 147, 'frozen manifest must contain 147 launches');
const reviewed = JSON.parse(fs.readFileSync(REVIEWED_FIXTURE_PATH, 'utf8'));
invariant(reviewed.schema === 'historical-compatibility-r1-fixtures/v1' && reviewed.representatives?.length === 9, 'reviewed representative fixture drift');

const starts = [];
let cursor = 1;
for (const count of gate.expected_cohort_counts) { starts.push(cursor); cursor += count; }
invariant(cursor - 1 === 147, `cohort counts must partition 147 launches:actual=${cursor - 1}`);
invariant(JSON.stringify(starts) === JSON.stringify(gate.expected_start_ordinals), 'cohort start ordinal derivation mismatch');

for (let i = 0; i < gate.cohorts.length; i += 1) {
  const cohort = gate.cohorts[i];
  const representative = reviewed.representatives[i];
  const launch = manifest.launches[starts[i] - 1];
  invariant(cohort.implementation === representative.implementation, `cohort/reviewed implementation mismatch:${i + 1}`);
  invariant(cohort.first_launch_block === representative.blockNumber && cohort.first_token_id === representative.tokenId, `cohort/reviewed boundary mismatch:${i + 1}`);
  invariant(launch.blockNumber === cohort.first_launch_block && launch.tokenId === cohort.first_token_id, `partition boundary mismatch:${i + 1}`);
}

const rows = [];
for (let i = 0; i < gate.cohorts.length; i += 1) {
  const cohort = gate.cohorts[i];
  const launches = manifest.launches.slice(starts[i] - 1, starts[i] - 1 + cohort.launches);
  invariant(launches.length === cohort.launches, `cohort slice length mismatch:${i + 1}`);
  for (const launch of launches) rows.push({
    ordinal: launch.ordinal, event: launch.event, blockNumber: launch.blockNumber, blockHash: launch.blockHash,
    transactionHash: launch.transactionHash, logIndex: launch.logIndex, tokenId: launch.tokenId, token: launch.token,
    creator: launch.creator, implementation: cohort.implementation,
  });
}
invariant(rows.length === 147 && rows.every((row,index) => row.ordinal === index + 1), 'authority map row/ordinal drift');
const digest = authorityMapDigest(rows);
let fixturePresent = false;
let fixtureMatch = null;
if (frozen) {
  const committed = loadFrozenAuthorityMap(gate.output_path);
  fixturePresent = true;
  invariant(committed.index.authorityMapSha256 === digest, 'committed authority map digest mismatch');
  invariant(JSON.stringify(committed.manifest.rows) === JSON.stringify(rows), 'committed authority map rows do not match deterministic regeneration');
  fixtureMatch = true;
  invariant(gate.authority_map_sha256 === digest, 'frozen packet authority map digest mismatch');
} else {
  invariant(!fs.existsSync(gate.output_path), 'pending Stage A must not already have committed authority map index');
}

const implementationCounts = Object.fromEntries(gate.cohorts.map((cohort) => [cohort.implementation, 0]));
for (const row of rows) implementationCounts[row.implementation] += 1;
const receipt = {
  schema:'historical-full-replay-authority-map-r1/v1', phase:'HISTORICAL_FULL_REPLAY_R1', stage:'STAGE_A_AUTHORITY_MAP',
  status:'AUTHORITY_MAP_DISCOVERY_COMPLETE_NO_ECONOMIC_REPLAY', mappingRule:gate.mapping_rule,
  sourceScopeIdentitySha256:packet.frozen_scope.launch_identity_sha256, launchCount:147, cohortCount:9,
  cohortCounts:gate.expected_cohort_counts, cohortStartOrdinals:starts, implementationCounts,
  authorityMapSha256:digest, fixturePresent, fixtureMatch, rows,
};
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({status:receipt.status,launchCount:147,cohortCount:9,authorityMapSha256:digest,fixtureMatch}, null, 2));
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
