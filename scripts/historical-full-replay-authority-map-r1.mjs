import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { loadFrozenScopeManifest } from './historical-full-replay-scope-fixture.mjs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_FULL_REPLAY_R1.json';
const REVIEWED_FIXTURE_PATH = 'fixtures/historical-compatibility-r1.json';
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'historical-full-replay-authority-map-r1-live.json';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalMapDigest(rows) {
  return sha256(rows.map((row) => [
    row.ordinal,
    row.event,
    row.blockNumber,
    row.blockHash,
    row.transactionHash,
    row.logIndex,
    row.tokenId,
    row.token,
    row.creator,
    row.implementation,
  ].join('|')).join('\n'));
}

const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
invariant(packet.phase === 'HISTORICAL_FULL_REPLAY_R1', 'unexpected phase packet');
invariant(packet.state === 'HISTORICAL_FULL_REPLAY_IMPLEMENTATION_AUTHORIZED', 'Stage A requires implementation-authorized state');
invariant(packet.next_action === 'BUILD_AND_VERIFY_147_LAUNCH_AUTHORITY_MAP', 'Stage A is not current next action');
invariant(packet.authorization?.full_147_replay === true, 'full replay implementation authority missing');
for (const key of ['fast_vet','canary','signing','transaction_construction','transaction_broadcast','live_execution','merge']) {
  invariant(packet.authorization?.[key] === false, `Stage A requires authorization.${key}=false`);
}

const gate = packet.authority_map_gate;
invariant(gate?.status === 'PENDING_VERIFICATION', 'Stage A expects pending authority map gate');
invariant(Array.isArray(gate.expected_cohort_counts) && gate.expected_cohort_counts.length === 9, 'expected nine cohort counts');
invariant(Array.isArray(gate.expected_start_ordinals) && gate.expected_start_ordinals.length === 9, 'expected nine cohort start ordinals');
invariant(Array.isArray(gate.cohorts) && gate.cohorts.length === 9, 'expected nine cohort definitions');

const { index, manifest } = loadFrozenScopeManifest(packet.frozen_scope.manifest_path);
invariant(index.launchIdentitySha256 === packet.frozen_scope.launch_identity_sha256, 'scope digest mismatch');
invariant(manifest.launches.length === 147, 'frozen manifest must contain 147 launches');

const reviewed = JSON.parse(fs.readFileSync(REVIEWED_FIXTURE_PATH, 'utf8'));
invariant(reviewed.schema === 'historical-compatibility-r1-fixtures/v1', 'unexpected reviewed fixture schema');
invariant(Array.isArray(reviewed.representatives) && reviewed.representatives.length === 9, 'reviewed fixture must contain nine representatives');

const computedStartOrdinals = [];
let cursor = 1;
for (const count of gate.expected_cohort_counts) {
  invariant(Number.isInteger(count) && count > 0, `invalid cohort launch count:${count}`);
  computedStartOrdinals.push(cursor);
  cursor += count;
}
invariant(cursor - 1 === 147, `cohort counts must partition 147 launches:actual=${cursor - 1}`);
invariant(JSON.stringify(computedStartOrdinals) === JSON.stringify(gate.expected_start_ordinals), 'cohort start ordinal derivation mismatch');

for (let i = 0; i < gate.cohorts.length; i += 1) {
  const cohort = gate.cohorts[i];
  const reviewedRepresentative = reviewed.representatives[i];
  const startOrdinal = computedStartOrdinals[i];
  const launch = manifest.launches[startOrdinal - 1];

  invariant(cohort.ordinal === i + 1, `cohort ordinal drift:${i + 1}`);
  invariant(cohort.launches === gate.expected_cohort_counts[i], `cohort count drift:${i + 1}`);
  invariant(cohort.implementation === reviewedRepresentative.implementation, `cohort/reviewed implementation mismatch:${i + 1}`);
  invariant(cohort.first_launch_block === reviewedRepresentative.blockNumber, `cohort/reviewed first block mismatch:${i + 1}`);
  invariant(cohort.first_token_id === reviewedRepresentative.tokenId, `cohort/reviewed first token mismatch:${i + 1}`);
  invariant(launch.ordinal === startOrdinal, `frozen manifest ordinal drift:${startOrdinal}`);
  invariant(launch.blockNumber === cohort.first_launch_block, `partition start block mismatch:cohort=${i + 1}:expected=${cohort.first_launch_block}:actual=${launch.blockNumber}`);
  invariant(launch.tokenId === cohort.first_token_id, `partition start token mismatch:cohort=${i + 1}:expected=${cohort.first_token_id}:actual=${launch.tokenId}`);
}

const rows = [];
for (let i = 0; i < gate.cohorts.length; i += 1) {
  const cohort = gate.cohorts[i];
  const start = computedStartOrdinals[i] - 1;
  const end = start + cohort.launches;
  const launches = manifest.launches.slice(start, end);
  invariant(launches.length === cohort.launches, `cohort slice length mismatch:${i + 1}`);
  for (const launch of launches) {
    rows.push({
      ordinal: launch.ordinal,
      event: launch.event,
      blockNumber: launch.blockNumber,
      blockHash: launch.blockHash,
      transactionHash: launch.transactionHash,
      logIndex: launch.logIndex,
      tokenId: launch.tokenId,
      token: launch.token,
      creator: launch.creator,
      implementation: cohort.implementation,
    });
  }
}

invariant(rows.length === 147, `authority map row count mismatch:${rows.length}`);
invariant(rows.every((row, index) => row.ordinal === index + 1), 'authority map ordinal sequence drift');
invariant(new Set(rows.map((row) => [
  row.blockNumber, row.blockHash, row.transactionHash, row.logIndex, row.tokenId, row.token, row.creator,
].join('|'))).size === 147, 'authority map contains duplicate frozen launch identities');

const implementationCounts = Object.fromEntries(gate.cohorts.map((cohort) => [cohort.implementation, 0]));
for (const row of rows) {
  invariant(Object.hasOwn(implementationCounts, row.implementation), `unexpected implementation:${row.implementation}`);
  implementationCounts[row.implementation] += 1;
}
gate.cohorts.forEach((cohort) => invariant(
  implementationCounts[cohort.implementation] === cohort.launches,
  `authority map implementation count mismatch:${cohort.implementation}`
));

const authorityMapSha256 = canonicalMapDigest(rows);

let fixturePresent = false;
let fixtureMatch = null;
if (fs.existsSync(gate.output_path)) {
  fixturePresent = true;
  const committed = JSON.parse(fs.readFileSync(gate.output_path, 'utf8'));
  invariant(committed.schema === 'historical-full-replay-authority-map-r1/v1', 'unexpected committed authority map schema');
  invariant(committed.sourceScopeIdentitySha256 === packet.frozen_scope.launch_identity_sha256, 'committed authority map source scope drift');
  invariant(committed.launchCount === 147 && Array.isArray(committed.rows) && committed.rows.length === 147, 'committed authority map row count drift');
  invariant(committed.authorityMapSha256 === authorityMapSha256, 'committed authority map digest mismatch');
  invariant(JSON.stringify(committed.rows) === JSON.stringify(rows), 'committed authority map rows do not match deterministic regeneration');
  fixtureMatch = true;
}

const receipt = {
  schema: 'historical-full-replay-authority-map-r1/v1',
  phase: 'HISTORICAL_FULL_REPLAY_R1',
  stage: 'STAGE_A_AUTHORITY_MAP',
  status: 'AUTHORITY_MAP_DISCOVERY_COMPLETE_NO_ECONOMIC_REPLAY',
  mappingRule: gate.mapping_rule,
  sourceScopeIdentitySha256: packet.frozen_scope.launch_identity_sha256,
  launchCount: rows.length,
  cohortCount: gate.cohorts.length,
  cohortCounts: gate.expected_cohort_counts,
  cohortStartOrdinals: computedStartOrdinals,
  implementationCounts,
  authorityMapSha256,
  fixturePresent,
  fixtureMatch,
  rows,
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  status: receipt.status,
  launchCount: receipt.launchCount,
  cohortCount: receipt.cohortCount,
  authorityMapSha256: receipt.authorityMapSha256,
}, null, 2));
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
