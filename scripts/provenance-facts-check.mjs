import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MemoryStore,
  PROVENANCE_DERIVATION_VERSION,
  SqliteStore,
  buildProvenanceFact,
  projectProvenanceEdges,
  syncSentryTruth
} from '../dist/index.js';

const creatorA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const creatorB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function launch(launchId, creator, blockNumber, logIndex, suffix) {
  return {
    chainId: 57073,
    blockNumber,
    blockHash: `0x${suffix.padStart(64, '0')}`,
    observedAtMs: Number(blockNumber),
    launchId,
    eventId: `event-${launchId}`,
    factory: '0xdc37e11b68052d1539fa23386ee58ac444bf5be1',
    txHash: `0x${(1000 + logIndex + Number(blockNumber)).toString(16).padStart(64, '0')}`,
    logIndex,
    token: `0x${suffix.padStart(40, '0')}`,
    creator,
    tokenId: BigInt(100 + logIndex),
    name: launchId,
    symbol: launchId.toUpperCase(),
    launchType: 'STANDARD',
    sourceEvent: 'TokenDeployed'
  };
}

const a1 = launch('a1', creatorA, 10n, 1, 'a1');
const b1 = launch('b1', creatorB, 10n, 2, 'b1');
const a2 = launch('a2', creatorA, 10n, 3, 'a2');
const a3 = launch('a3', creatorA, 12n, 0, 'a3');
const launches = [a1, b1, a2, a3];
const facts = await Promise.all(launches.map(buildProvenanceFact));

const checkpointHash = `0x${'12'.padStart(64, '0')}`;
const guardHash = `0x${'10'.padStart(64, '0')}`;
const legacyLaunches = launches.map((item) => ({
  ...item,
  blockHash: item.blockNumber === 12n ? checkpointHash : guardHash
}));

assert.deepEqual(await buildProvenanceFact(a1), facts[0], 'fact construction must be deterministic');
assert.equal(facts[0].evidenceDigest.length, 64);

const edges = await projectProvenanceEdges(facts);
const reversedEdges = await projectProvenanceEdges([...facts].reverse());
assert.deepEqual(reversedEdges, edges, 'projection must not depend on input ordering');
assert.equal(edges.filter((edge) => edge.kind === 'DEPLOYED_BY').length, 4);
const previous = edges.filter((edge) => edge.kind === 'PREVIOUS_LAUNCH');
assert.equal(previous.length, 2);
assert.equal(previous[0].from, 'launch:57073:a2');
assert.equal(previous[0].to, 'launch:57073:a1');
assert.equal(previous[1].from, 'launch:57073:a3');
assert.equal(previous[1].to, 'launch:57073:a2');
assert.ok(previous.every((edge) => edge.evidenceClass === 'DERIVED_JOIN'));
assert.ok(edges.every((edge) => edge.derivationVersion === PROVENANCE_DERIVATION_VERSION));
assert.ok(edges.every((edge) => !Object.hasOwn(edge, 'confidence')));
assert.equal(edges.some((edge) => edge.kind === 'PREVIOUS_LAUNCH' && edge.from === 'launch:57073:a1'), false);

await exerciseStore(new MemoryStore());
await exerciseLegacyBackfill(new MemoryStore());

const dir = mkdtempSync(join(tmpdir(), 'sentry-provenance-'));
const dbPath = join(dir, 'test.sqlite');
const legacyDbPath = join(dir, 'legacy.sqlite');
try {
  const store = new SqliteStore(dbPath, 57073);
  await exerciseStore(store);
  store.close();
  const reopened = new SqliteStore(dbPath, 57073);
  assert.equal((await reopened.listProvenanceFacts()).length, 3, 'rewound SQLite facts must persist');
  reopened.close();

  const legacySeed = new SqliteStore(legacyDbPath, 57073);
  await seedLegacyStore(legacySeed);
  legacySeed.close();
  const legacyReopened = new SqliteStore(legacyDbPath, 57073);
  await assertLegacyBackfill(legacyReopened);
  legacyReopened.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

async function exerciseStore(store) {
  for (const item of launches) await store.putLaunch(item);
  for (const fact of facts) assert.equal(await store.putProvenanceFact(fact), 'INSERTED');
  assert.equal(await store.putProvenanceFact(facts[0]), 'DUPLICATE');
  await assert.rejects(
    store.putProvenanceFact({ ...facts[0], evidenceDigest: 'f'.repeat(64) }),
    /PROVENANCE_FACT_IDENTITY_CONFLICT/
  );

  const storedFacts = await store.listProvenanceFacts();
  assert.deepEqual(storedFacts.map((fact) => fact.launchId), ['a1', 'b1', 'a2', 'a3']);
  await store.replaceProvenanceEdges(await projectProvenanceEdges(storedFacts));
  assert.equal((await store.listProvenanceEdges()).length, 6);

  await store.rewindFromBlock(11n);
  const afterFacts = await store.listProvenanceFacts();
  assert.deepEqual(afterFacts.map((fact) => fact.launchId), ['a1', 'b1', 'a2']);
  await store.replaceProvenanceEdges(await projectProvenanceEdges(afterFacts));
  const afterEdges = await store.listProvenanceEdges();
  assert.equal(afterEdges.some((edge) => edge.from === 'launch:57073:a3'), false);
  assert.equal(afterEdges.filter((edge) => edge.kind === 'PREVIOUS_LAUNCH').length, 1);
}

async function exerciseLegacyBackfill(store) {
  await seedLegacyStore(store);
  await assertLegacyBackfill(store);
}

async function seedLegacyStore(store) {
  for (const item of legacyLaunches) await store.putLaunch(item);
  await store.commitCheckpoint({
    blockNumber: 12n,
    blockHash: checkpointHash,
    guardBlockNumber: 10n,
    guardBlockHash: guardHash
  });
  assert.equal((await store.listProvenanceFacts()).length, 0, 'legacy seed must begin without provenance');
}

async function assertLegacyBackfill(store) {
  const source = {
    getHeadBlockNumber: async () => 14n,
    assertAuthority: async () => {},
    getBlockHash: async (blockNumber) => {
      if (blockNumber === 12n) return checkpointHash;
      if (blockNumber === 10n) return guardHash;
      return `0x${blockNumber.toString(16).padStart(64, '0')}`;
    },
    catchUp: async () => { throw new Error('LEGACY_BACKFILL_MUST_NOT_CATCH_UP'); }
  };
  const report = await syncSentryTruth(source, store, {
    startBlock: 1n,
    confirmations: 2n,
    maxBatchBlocks: 100n,
    reorgLookbackBlocks: 2n,
    pollIntervalMs: 100
  });
  assert.equal(report.startBlock, null, 'current checkpoint should still take the no-new-blocks path');
  assert.equal(report.batches, 0);
  assert.deepEqual((await store.listProvenanceFacts()).map((fact) => fact.launchId), ['a1', 'b1', 'a2', 'a3']);
  const backfilledEdges = await store.listProvenanceEdges();
  assert.equal(backfilledEdges.length, 6);
  assert.ok(backfilledEdges.some((edge) => edge.kind === 'PREVIOUS_LAUNCH' && edge.from === 'launch:57073:a3' && edge.to === 'launch:57073:a2'));
}

console.log('provenance-facts-check: PASS');
