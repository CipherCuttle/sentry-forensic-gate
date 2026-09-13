import assert from 'node:assert/strict';
import {
  DEFAULT_SENTRY_LAUNCH_FACTORY,
  deriveLaunchId,
  MemoryStore,
  SqliteStore,
  syncSentryTruth
} from '../dist/index.js';

const launchIdA = await deriveLaunchId({
  chainId: 57073,
  factory: DEFAULT_SENTRY_LAUNCH_FACTORY,
  txHash: '0xAA',
  token: '0xBB'
});
const launchIdB = await deriveLaunchId({
  chainId: 57073,
  factory: DEFAULT_SENTRY_LAUNCH_FACTORY.toLowerCase(),
  txHash: '0xaa',
  token: '0xbb'
});
assert.equal(launchIdA, launchIdB, 'identity must be case-normalized');

function launch(blockNumber, id, blockHash = `0x${blockNumber.toString(16)}`) {
  return {
    chainId: 57073,
    blockNumber,
    blockHash,
    observedAtMs: Number(blockNumber),
    launchId: id,
    eventId: `event-${id}`,
    factory: DEFAULT_SENTRY_LAUNCH_FACTORY,
    txHash: `0x${id}`,
    logIndex: 0,
    token: `0x${id}01`,
    creator: `0x${id}02`,
    tokenId: blockNumber,
    name: id,
    symbol: id.toUpperCase(),
    launchType: 'STANDARD',
    sourceEvent: 'TokenDeployed'
  };
}

class FakeSource {
  head = 12n;
  hashes = new Map();
  launches = [launch(6n, 'a'), launch(9n, 'b')];
  constructor() {
    for (let i = 0n; i <= 30n; i++) this.hashes.set(i, `0x${i.toString(16)}`);
  }
  async getHeadBlockNumber() { return this.head; }
  async getBlockHash(block) { return this.hashes.get(block); }
  async catchUp(from, to) { return this.launches.filter((v) => v.blockNumber >= from && v.blockNumber <= to); }
}

const options = {
  startBlock: 5n,
  confirmations: 2n,
  maxBatchBlocks: 3n,
  reorgLookbackBlocks: 3n,
  pollIntervalMs: 100
};
const source = new FakeSource();
const store = new MemoryStore();

const first = await syncSentryTruth(source, store, options);
assert.equal(first.inserted, 2);
assert.equal(first.batches, 2);
assert.equal((await store.getCheckpoint()).blockNumber, 10n);
assert.equal(store.launchCount, 2);

const restart = await syncSentryTruth(source, store, options);
assert.equal(restart.batches, 0, 'restart at same head must not rescan committed blocks');
assert.equal(store.launchCount, 2);

source.head = 14n;
source.launches.push(launch(11n, 'c'));
const advanced = await syncSentryTruth(source, store, options);
assert.equal(advanced.inserted, 1);
assert.equal((await store.getCheckpoint()).blockNumber, 12n);
assert.equal(store.launchCount, 3);

// Reorg the persisted checkpoint. The runtime must rewind, remove launches in the
// lookback window, and replay replacement canonical data.
source.hashes.set(12n, '0x12b');
source.hashes.set(11n, '0x11b');
source.launches = source.launches.filter((v) => v.blockNumber !== 11n);
source.launches.push(launch(11n, 'd', '0x11b'));
const reorg = await syncSentryTruth(source, store, options);
assert.equal(reorg.reorgRewindFrom, 10n);
assert.equal(await store.getLaunch('c'), null, 'orphaned launch must be removed');
assert.notEqual(await store.getLaunch('d'), null, 'replacement canonical launch must be inserted');


// A canonical duplicate may be observed at a different wall-clock time, but
// contradictory chain-authority fields must fail closed instead of hiding under dedupe.
const conflictStore = new MemoryStore();
const originalConflict = launch(15n, 'conflict');
assert.equal(await conflictStore.putLaunch(originalConflict), 'INSERTED');
assert.equal(
  await conflictStore.putLaunch({ ...originalConflict, observedAtMs: originalConflict.observedAtMs + 999 }),
  'DUPLICATE'
);
await assert.rejects(
  conflictStore.putLaunch({ ...originalConflict, creator: '0xdead' }),
  /LAUNCH_IDENTITY_CONFLICT/
);

// Detect a reorg in the narrow window after batch writes and before checkpoint.
// The uncommitted batch must be removed before the error escapes.
class CommitRaceSource extends FakeSource {
  boundaryReads = 0;
  launches = [launch(6n, 'race')];
  head = 9n; // target 7 with 2 confirmations; one 5..7 batch
  async getBlockHash(block) {
    if (block === 7n) {
      this.boundaryReads += 1;
      if (this.boundaryReads >= 3) return '0x7b';
    }
    return super.getBlockHash(block);
  }
}
const raceSource = new CommitRaceSource();
const raceStore = new MemoryStore();
await assert.rejects(syncSentryTruth(raceSource, raceStore, options), /REORG_DURING_COMMIT/);
assert.equal(raceStore.launchCount, 0, 'uncommitted old-fork batch must be removed');
assert.equal(await raceStore.getCheckpoint(), null, 'checkpoint must not advance across commit-window reorg');

// SQLite exactly-once and rewind smoke test.
const sqlite = new SqliteStore(':memory:', 57073);
const sqlLaunch = launch(20n, 'sql');
assert.equal(await sqlite.putLaunch(sqlLaunch), 'INSERTED');
assert.equal(await sqlite.putLaunch({ ...sqlLaunch, observedAtMs: sqlLaunch.observedAtMs + 500 }), 'DUPLICATE');
await assert.rejects(
  sqlite.putLaunch({ ...sqlLaunch, blockHash: '0xbad' }),
  /LAUNCH_IDENTITY_CONFLICT/
);
await sqlite.commitCheckpoint({ blockNumber: 20n, blockHash: sqlLaunch.blockHash });
assert.equal((await sqlite.getCheckpoint()).blockNumber, 20n);
await sqlite.rewindFromBlock(20n);
assert.equal(await sqlite.getLaunch(sqlLaunch.launchId), null);
assert.equal(await sqlite.getCheckpoint(), null);
sqlite.close();

console.log('sentry-truth-check: PASS');
