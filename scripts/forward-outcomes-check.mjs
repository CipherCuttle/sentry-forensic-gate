import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXECUTABLE_BASELINE_R1,
  FORWARD_OUTCOMES_R1,
  MemoryStore,
  SqliteStore,
  classifyExecutableOutcome,
  syncForwardOutcomes
} from '../dist/index.js';

const ONE_MINUTE = 60_000;
const FIVE_MINUTES = 300_000;
const creator = '0xcccccccccccccccccccccccccccccccccccccccc';
const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const base = '0x0200c29006150606b650577bbe7b6248f58470c1';
const pool = '0x1111111111111111111111111111111111111111';

assert.equal(classifyExecutableOutcome(2_000n), 'CATASTROPHIC_LOSS');
assert.equal(classifyExecutableOutcome(2_001n), 'NORMAL_LOSS');
assert.equal(classifyExecutableOutcome(9_999n), 'NORMAL_LOSS');
assert.equal(classifyExecutableOutcome(10_000n), 'NORMAL_WIN');

function hash(block) {
  return `0x${block.toString(16).padStart(64, '0')}`;
}

function makeLaunch(id = 'launch-a') {
  return {
    chainId: 57073,
    blockNumber: 10n,
    blockHash: hash(10n),
    observedAtMs: 1,
    launchId: id,
    eventId: `event-${id}`,
    factory: '0xdc37e11b68052d1539fa23386ee58ac444bf5be1',
    txHash: `0x${id.padEnd(64, '0').slice(0, 64)}`,
    logIndex: 1,
    token,
    creator,
    tokenId: 7n,
    name: 'A',
    symbol: 'A',
    launchType: 'STANDARD',
    sourceEvent: 'TokenDeployed'
  };
}

function makeBatch(launchId = 'launch-a') {
  const entry = {
    quoteId: `entry-${launchId}`,
    launchId,
    blockNumber: 12n,
    blockHash: hash(12n),
    observedAtMs: 2,
    kind: 'ENTRY',
    mode: 'EXACT_INPUT',
    notionalUsdMicros: 1_000_000n,
    pool,
    tokenIn: base,
    tokenOut: token,
    fee: 10_000,
    amountIn: 1_000_000n,
    amountOut: 2_000_000n,
    executable: true
  };
  return {
    baselineId: `baseline-${launchId}`,
    authorityDigest: `authority-${launchId}`,
    launchId,
    policyVersion: EXECUTABLE_BASELINE_R1,
    decisionBlock: 12n,
    decisionBlockHash: hash(12n),
    observedAtMs: 2,
    status: 'COMPLETE',
    market: {
      launchId,
      launchedToken: token,
      baseToken: base,
      token0: token,
      token1: base,
      fee: 10_000,
      pool,
      positionLiquidity: 100n,
      activeLiquidity: 90n,
      sqrtPriceX96Before: 123n
    },
    legs: [{
      notionalUsdMicros: 1_000_000n,
      calibration: {
        kind: 'USDT0_NOMINAL_PEG_V0',
        notionalUsdMicros: 1_000_000n,
        baseToken: base,
        baseAmount: 1_000_000n,
        baseDecimals: 6
      },
      entry,
      reverse: null,
      independentReverseRecoveryBps: null
    }],
    reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL'
  };
}

function legacyOutcome(launchId, outcomeId = `legacy-${launchId}`) {
  return {
    outcomeId,
    launchId,
    horizonMs: ONE_MINUTE,
    observedBlock: 16n,
    executableValueUsdMicros: 900_000n,
    sellable: true,
    classification: 'NORMAL_LOSS'
  };
}

class FakeOutcomeSource {
  head = 20n;
  activeLiquidity = 100n;
  exitExecutable = true;
  baseAmountOut = 150_000n;
  usdValue = 150_000n;
  valuationError = null;
  quoteCalls = 0;
  authorityBlocks = [];
  hashReads = new Map();
  mutateBlock = null;
  predecessorTurnsEligible = false;

  async getHeadBlockNumber() { return this.head; }
  async getBlockPoint(blockNumber) {
    const reads = (this.hashReads.get(blockNumber) ?? 0) + 1;
    this.hashReads.set(blockNumber, reads);
    const mutated = this.mutateBlock === blockNumber && reads >= 2;
    let timestampMs = 900_000 + Number(blockNumber) * 10_000;
    if (this.predecessorTurnsEligible && blockNumber === 15n && reads >= 2) timestampMs = 1_060_000;
    return {
      blockNumber,
      blockHash: mutated ? `${hash(blockNumber)}ff` : hash(blockNumber),
      timestampMs
    };
  }
  async assertMarketAuthority(_market, blockNumber) { this.authorityBlocks.push(blockNumber); }
  async readMarketState() { return { activeLiquidity: this.activeLiquidity }; }
  async quoteTokenToBase() {
    this.quoteCalls += 1;
    return this.exitExecutable
      ? { executable: true, amountOut: this.baseAmountOut }
      : { executable: false, amountOut: 0n, failureReason: 'EVM_REVERT' };
  }
  async valueBaseAmountUsdMicros() {
    if (this.valuationError) throw new Error(this.valuationError);
    return this.usdValue;
  }
}

const options = {
  confirmations: 2n,
  maxOutcomesPerSync: 10,
  horizons: [{ label: '1m', ms: ONE_MINUTE }, { label: '5m', ms: FIVE_MINUTES }]
};

// Canonical horizon selection: launch block timestamp is 1,000,000 ms, so 1m lands on block 16.
const store = new MemoryStore();
await store.putLaunch(makeLaunch());
await store.putBaselineBatch(makeBatch());
const source = new FakeOutcomeSource();
const report = await syncForwardOutcomes(source, store, options);
assert.equal(report.processed, 1);
assert.equal(report.complete, 1);
assert.equal(report.pendingMaturity, 1, '5m horizon should remain pending');
const [receipt] = await store.listOutcomes();
assert.equal(receipt.policyVersion, FORWARD_OUTCOMES_R1);
assert.equal(receipt.observedBlock, 16n, 'must use first confirmed block at/after launch+horizon');
assert.equal(receipt.targetTimestampMs, 1_060_000);
assert.equal(receipt.observedTimestampMs, 1_060_000);
assert.equal(receipt.classification, 'CATASTROPHIC_LOSS');
assert.equal(receipt.executableReturnBps, 1_500n);
assert.equal(receipt.sellable, true);
assert.equal(receipt.baseAmountOut, 150_000n);
assert.ok(receipt.evidenceDigest?.length === 64);
assert.ok(source.authorityBlocks.every((block) => block === 16n));

const restart = await syncForwardOutcomes(source, store, options);
assert.equal(restart.processed, 0, 'persisted R1 horizon must be restart-idempotent');

// Rewind by the outcome's own observation block must delete the receipt while preserving launch/baseline.
await store.rewindFromBlock(16n);
assert.equal((await store.listOutcomes()).length, 0);
assert.equal(store.launchCount, 1);
assert.equal(store.baselineCount, 1);

// Zero active liquidity is diagnostic, not sufficient by itself to claim collapse: V3 can cross empty ranges.
const zeroLiquidityStore = new MemoryStore();
await zeroLiquidityStore.putLaunch(makeLaunch('launch-zero-liq'));
await zeroLiquidityStore.putBaselineBatch(makeBatch('launch-zero-liq'));
const zeroLiquiditySource = new FakeOutcomeSource();
zeroLiquiditySource.activeLiquidity = 0n;
await syncForwardOutcomes(zeroLiquiditySource, zeroLiquidityStore, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] });
const [zeroLiquidityReceipt] = await zeroLiquidityStore.listOutcomes();
assert.equal(zeroLiquidityReceipt.classification, 'CATASTROPHIC_LOSS');
assert.equal(zeroLiquidityReceipt.sellable, true);
assert.equal(zeroLiquiditySource.quoteCalls, 1, 'zero active liquidity must still ask the executable quoter');

// Quote failure plus zero active liquidity is deterministic liquidity-collapse evidence.
const liquidityStore = new MemoryStore();
await liquidityStore.putLaunch(makeLaunch('launch-liq'));
await liquidityStore.putBaselineBatch(makeBatch('launch-liq'));
const liquiditySource = new FakeOutcomeSource();
liquiditySource.activeLiquidity = 0n;
liquiditySource.exitExecutable = false;
await syncForwardOutcomes(liquiditySource, liquidityStore, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] });
const [liquidityReceipt] = await liquidityStore.listOutcomes();
assert.equal(liquidityReceipt.classification, 'LIQUIDITY_COLLAPSE');
assert.equal(liquidityReceipt.sellable, false);
assert.equal(liquiditySource.quoteCalls, 1);

// A quote revert with active liquidity is an exit failure, not a provider failure.
const exitStore = new MemoryStore();
await exitStore.putLaunch(makeLaunch('launch-exit'));
await exitStore.putBaselineBatch(makeBatch('launch-exit'));
const exitSource = new FakeOutcomeSource();
exitSource.exitExecutable = false;
await syncForwardOutcomes(exitSource, exitStore, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] });
const [exitReceipt] = await exitStore.listOutcomes();
assert.equal(exitReceipt.classification, 'EXIT_FAILURE');
assert.equal(exitReceipt.status, 'COMPLETE');
assert.equal(exitReceipt.executableValueUsdMicros, 0n);

// Deterministic USD-calibration gaps are durable UNVERIFIED evidence, not fabricated losses.
const valuationStore = new MemoryStore();
await valuationStore.putLaunch(makeLaunch('launch-value'));
await valuationStore.putBaselineBatch(makeBatch('launch-value'));
const valuationSource = new FakeOutcomeSource();
valuationSource.valuationError = 'OUTCOME_USD_VALUATION_UNAVAILABLE:no-route';
await syncForwardOutcomes(valuationSource, valuationStore, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] });
const [valuationReceipt] = await valuationStore.listOutcomes();
assert.equal(valuationReceipt.status, 'UNVERIFIED');
assert.equal(valuationReceipt.sellable, true);
assert.equal(valuationReceipt.classification, undefined);
assert.equal(valuationReceipt.executableValueUsdMicros, undefined);

// Provider failures must escape and leave the R1 horizon pending for retry.
const providerStore = new MemoryStore();
await providerStore.putLaunch(makeLaunch('launch-provider'));
await providerStore.putBaselineBatch(makeBatch('launch-provider'));
const providerSource = new FakeOutcomeSource();
providerSource.valuationError = 'RPC_TIMEOUT';
await assert.rejects(
  syncForwardOutcomes(providerSource, providerStore, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] }),
  /RPC_TIMEOUT/
);
assert.equal((await providerStore.listOutcomes()).length, 0);
assert.equal((await providerStore.listBaselineBatchesPendingOutcome(ONE_MINUTE, 10)).length, 1);

// A moving selected horizon block invalidates the read before persistence.
const reorgStore = new MemoryStore();
await reorgStore.putLaunch(makeLaunch('launch-reorg'));
await reorgStore.putBaselineBatch(makeBatch('launch-reorg'));
const reorgSource = new FakeOutcomeSource();
reorgSource.mutateBlock = 16n;
await assert.rejects(
  syncForwardOutcomes(reorgSource, reorgStore, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] }),
  /OUTCOME_REORG_DURING_READ/
);
assert.equal((await reorgStore.listOutcomes()).length, 0);

// Mixed-fork binary search: predecessor changes from below-target to target-eligible after it was skipped.
const boundaryStore = new MemoryStore();
await boundaryStore.putLaunch(makeLaunch('launch-boundary'));
await boundaryStore.putBaselineBatch(makeBatch('launch-boundary'));
const boundarySource = new FakeOutcomeSource();
boundarySource.predecessorTurnsEligible = true;
await assert.rejects(
  syncForwardOutcomes(boundarySource, boundaryStore, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] }),
  /OUTCOME_HORIZON_NONMINIMAL/
);
assert.equal((await boundaryStore.listOutcomes()).length, 0, 'mixed-fork boundary must never persist');

// Legacy receipts are preserved but must not satisfy the R1 collection slot.
const legacyStore = new MemoryStore();
await legacyStore.putLaunch(makeLaunch('launch-legacy'));
await legacyStore.putBaselineBatch(makeBatch('launch-legacy'));
await legacyStore.putOutcome(legacyOutcome('launch-legacy'));
assert.equal((await legacyStore.listBaselineBatchesPendingOutcome(ONE_MINUTE, 10)).length, 1);
await syncForwardOutcomes(new FakeOutcomeSource(), legacyStore, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] });
const legacyAndR1 = await legacyStore.listOutcomes();
assert.equal(legacyAndR1.length, 2);
assert.equal(legacyAndR1.filter((item) => item.policyVersion === FORWARD_OUTCOMES_R1).length, 1);
assert.equal(legacyAndR1.filter((item) => item.policyVersion === undefined).length, 1);

// SQLite revival must preserve all bigint evidence and pending-slot semantics.
const dir = mkdtempSync(join(tmpdir(), 'sentry-forward-outcome-'));
const dbPath = join(dir, 'test.sqlite');
try {
  const sqlite = new SqliteStore(dbPath, 57073);
  await sqlite.putLaunch(makeLaunch('launch-sqlite'));
  await sqlite.putBaselineBatch(makeBatch('launch-sqlite'));
  const sqliteSource = new FakeOutcomeSource();
  sqliteSource.usdValue = 1_250_000n;
  await syncForwardOutcomes(sqliteSource, sqlite, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] });
  sqlite.close();

  const reopened = new SqliteStore(dbPath, 57073);
  const [sqliteReceipt] = await reopened.listOutcomes();
  assert.equal(sqliteReceipt.entryTokenAmount, 2_000_000n);
  assert.equal(sqliteReceipt.baseAmountOut, 150_000n);
  assert.equal(sqliteReceipt.executableValueUsdMicros, 1_250_000n);
  assert.equal(sqliteReceipt.executableReturnBps, 12_500n);
  assert.equal(sqliteReceipt.poolActiveLiquidity, 100n);
  assert.equal(sqliteReceipt.classification, 'NORMAL_WIN');
  assert.equal((await reopened.listBaselineBatchesPendingOutcome(ONE_MINUTE, 10)).length, 0);
  await reopened.rewindFromBlock(16n);
  assert.equal((await reopened.listOutcomes()).length, 0);
  assert.equal((await reopened.listBaselineBatchesPendingOutcome(ONE_MINUTE, 10)).length, 1);
  reopened.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Upgrade a real v0.5-style SQLite outcomes table without deleting legacy evidence.
const migrationDir = mkdtempSync(join(tmpdir(), 'sentry-forward-outcome-migration-'));
const migrationPath = join(migrationDir, 'legacy.sqlite');
try {
  const legacyDb = new Database(migrationPath);
  legacyDb.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE launches (
      launch_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      block_number TEXT NOT NULL,
      block_hash TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      factory TEXT NOT NULL,
      token TEXT NOT NULL,
      creator TEXT NOT NULL,
      token_id TEXT NOT NULL,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      launch_type TEXT NOT NULL,
      source_event TEXT NOT NULL,
      observed_at_ms INTEGER NOT NULL,
      UNIQUE(chain_id, tx_hash, token)
    );
    CREATE TABLE outcomes (
      outcome_id TEXT PRIMARY KEY,
      launch_id TEXT NOT NULL REFERENCES launches(launch_id) ON DELETE CASCADE,
      horizon_ms INTEGER NOT NULL,
      observed_block TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(launch_id, horizon_ms)
    );
  `);
  const migrationLaunch = makeLaunch('launch-migrate');
  legacyDb.prepare(`
    INSERT INTO launches (
      launch_id, event_id, chain_id, block_number, block_hash, tx_hash, log_index,
      factory, token, creator, token_id, name, symbol, launch_type, source_event, observed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    migrationLaunch.launchId, migrationLaunch.eventId, migrationLaunch.chainId,
    migrationLaunch.blockNumber.toString(), migrationLaunch.blockHash, migrationLaunch.txHash,
    migrationLaunch.logIndex, migrationLaunch.factory, migrationLaunch.token, migrationLaunch.creator,
    migrationLaunch.tokenId.toString(), migrationLaunch.name, migrationLaunch.symbol,
    migrationLaunch.launchType, migrationLaunch.sourceEvent, migrationLaunch.observedAtMs
  );
  const old = legacyOutcome('launch-migrate', 'legacy-migration');
  const oldPayload = JSON.stringify({ ...old, observedBlock: old.observedBlock.toString(), executableValueUsdMicros: old.executableValueUsdMicros.toString() });
  legacyDb.prepare('INSERT INTO outcomes (outcome_id, launch_id, horizon_ms, observed_block, payload_json) VALUES (?, ?, ?, ?, ?)')
    .run(old.outcomeId, old.launchId, old.horizonMs, old.observedBlock.toString(), oldPayload);
  legacyDb.close();

  const migrated = new SqliteStore(migrationPath, 57073);
  const [preserved] = await migrated.listOutcomes();
  assert.equal(preserved.outcomeId, 'legacy-migration');
  assert.equal(preserved.policyVersion, undefined);
  await migrated.putBaselineBatch(makeBatch('launch-migrate'));
  assert.equal((await migrated.listBaselineBatchesPendingOutcome(ONE_MINUTE, 10)).length, 1, 'legacy row must not satisfy R1 slot');
  await syncForwardOutcomes(new FakeOutcomeSource(), migrated, { ...options, horizons: [{ label: '1m', ms: ONE_MINUTE }] });
  const migratedOutcomes = await migrated.listOutcomes();
  assert.equal(migratedOutcomes.length, 2, 'migration must preserve legacy evidence and admit R1 beside it');
  assert.equal(migratedOutcomes.filter((item) => item.policyVersion === FORWARD_OUTCOMES_R1).length, 1);
  migrated.close();
} finally {
  rmSync(migrationDir, { recursive: true, force: true });
}

console.log('forward-outcomes-check: PASS');
