import assert from 'node:assert/strict';
import { MemoryStore } from '../dist/db/memoryStore.js';
import { buildBaselineBatch, syncExecutableBaseline } from '../dist/runtime/executableBaseline.js';
import { classifyLaunchMarket } from '../dist/tsunami/market.js';
import { scaleUsdMicrosToTokenUnits } from '../dist/shadow/baselineTypes.js';

const LAUNCH_BLOCK = 52_269_353n;
const DECISION_BLOCK = LAUNCH_BLOCK + 2n;
const MATURE_HEAD = LAUNCH_BLOCK + 4n;

const launch = {
  chainId: 57073,
  blockNumber: LAUNCH_BLOCK,
  blockHash: `0x${LAUNCH_BLOCK}`,
  observedAtMs: 1,
  launchId: 'launch-a',
  eventId: 'event-a',
  factory: '0xfac',
  txHash: '0xtx',
  logIndex: 1,
  token: '0xaaa',
  creator: '0xccc',
  tokenId: 7n,
  name: 'A',
  symbol: 'A',
  launchType: 'AGENT',
  sourceEvent: 'TokenDeployed'
};

assert.equal(scaleUsdMicrosToTokenUnits(250_000n, 6), 250_000n);
assert.equal(scaleUsdMicrosToTokenUnits(1_000_000n, 6), 1_000_000n);
assert.throws(() => scaleUsdMicrosToTokenUnits(1n, 0), /ROUNDS_TO_ZERO/);

const market = classifyLaunchMarket({
  launch,
  position: { token0: '0xaaa', token1: '0xbbb', fee: 10000, liquidity: 55n },
  supportedBaseTokens: ['0xbbb'],
  pool: '0xpool',
  poolToken0: '0xaaa',
  poolToken1: '0xbbb',
  poolFee: 10000,
  activeLiquidity: 44n,
  sqrtPriceX96Before: 123n
});
assert.equal(market.baseToken, '0xbbb', 'base must come from LP position, not launch type');
assert.throws(() => classifyLaunchMarket({
  launch,
  position: { token0: '0x111', token1: '0x222', fee: 10000, liquidity: 55n },
  supportedBaseTokens: ['0x222'], pool: '0xpool', poolToken0: '0x111', poolToken1: '0x222', poolFee: 10000,
  activeLiquidity: 1n, sqrtPriceX96Before: 1n
}), /MARKET_TOKEN_POSITION_MISMATCH/);

class FakeSource {
  head = MATURE_HEAD;
  hashes = new Map([[DECISION_BLOCK, `0x${DECISION_BLOCK}`]]);
  authorityBlocks = [];
  reverseInputs = [];
  entryExecutable = true;
  failMarket = false;
  failProvider = false;
  async getHeadBlockNumber() { return this.head; }
  async getBlockHash(block) { return this.hashes.get(block) ?? `0x${block}`; }
  async assertAuthority(block) { this.authorityBlocks.push(block); }
  async resolveMarket(_launch, decisionBlock) {
    assert.equal(decisionBlock, DECISION_BLOCK, 'market reads must pin launch+delay, not latest');
    if (this.failProvider) throw new Error('RPC_TIMEOUT');
    if (this.failMarket) throw new Error('UNSUPPORTED_SENTRY_BASE:0xbad');
    return market;
  }
  async calibrateUsd({ notionalUsdMicros, decisionBlock }) {
    assert.equal(decisionBlock, DECISION_BLOCK);
    return { kind: 'USDT0_NOMINAL_PEG_V0', notionalUsdMicros, baseToken: market.baseToken, baseAmount: notionalUsdMicros, baseDecimals: 6 };
  }
  async quoteEntry({ launch, decisionBlockHash, decisionBlock, notionalUsdMicros, amountIn }) {
    return { quoteId:`e-${notionalUsdMicros}`,launchId:launch.launchId,blockNumber:decisionBlock,blockHash:decisionBlockHash,observedAtMs:2,kind:'ENTRY',mode:'EXACT_INPUT',notionalUsdMicros,pool:market.pool,tokenIn:market.baseToken,tokenOut:market.launchedToken,fee:market.fee,amountIn,amountOut:this.entryExecutable ? amountIn*3n : 0n,executable:this.entryExecutable,...(!this.entryExecutable?{failureReason:'EVM_REVERT'}:{}) };
  }
  async quoteIndependentReverse({ launch, decisionBlockHash, decisionBlock, notionalUsdMicros, amountIn }) {
    this.reverseInputs.push(amountIn);
    return { quoteId:`r-${notionalUsdMicros}`,launchId:launch.launchId,blockNumber:decisionBlock,blockHash:decisionBlockHash,observedAtMs:3,kind:'INDEPENDENT_REVERSE_EXIT',mode:'EXACT_INPUT',notionalUsdMicros,pool:market.pool,tokenIn:market.launchedToken,tokenOut:market.baseToken,fee:market.fee,amountIn,amountOut:amountIn/4n,executable:true };
  }
}

const options = { decisionDelayBlocks: 2n, confirmations: 2n, maxLaunchesPerSync: 10, notionalsUsdMicros: [1_000_000n] };

// Launches before the executable epoch must fail closed even if their later decision block would be authorized.
const updateBlockLaunch = { ...launch, blockNumber: 52_269_352n, launchId:'launch-update-block', eventId:'event-update-block', txHash:'0xupdate', token:'0xafe' };
await assert.rejects(
  buildBaselineBatch(new FakeSource(), updateBlockLaunch, 2n, [1_000_000n]),
  /EXECUTABLE_INFRA_EPOCH_UNAUTHORIZED:block=52269352:earliestAuthorized=52269353/
);

const store = new MemoryStore();
await store.putLaunch(launch);
const source = new FakeSource();
const immatureSource = new FakeSource();
immatureSource.head = MATURE_HEAD - 1n;
const immatureStore = new MemoryStore();
await immatureStore.putLaunch({ ...launch, launchId:'launch-immature', eventId:'event-immature', txHash:'0ximmature', token:'0xaaf' });
assert.equal((await syncExecutableBaseline(immatureSource, immatureStore, options)).processed, 0, 'decision block must mature before persistence');
const report = await syncExecutableBaseline(source, store, options);
assert.equal(report.complete, 1);
assert.equal(store.baselineCount, 1);
assert.deepEqual(source.reverseInputs, [3_000_000n], 'reverse must spend entry token output, never base input');
assert.ok(source.authorityBlocks.every((b) => b === DECISION_BLOCK), 'authority reads must pin decision block');
const restart = await syncExecutableBaseline(source, store, options);
assert.equal(restart.processed, 0, 'completed baseline must be restart-idempotent');

// Reorg at decision block: launch survives, quote evidence at decision block must not.
await store.rewindFromBlock(DECISION_BLOCK);
assert.equal(store.launchCount, 1);
assert.equal(store.baselineCount, 0, 'decision-block evidence must be invalidated even when launch survives');
const replay = await syncExecutableBaseline(source, store, options);
assert.equal(replay.complete, 1);

// EVM non-executability is economic evidence, not a provider error: persist COMPLETE and do not reverse.
const noEntryStore = new MemoryStore();
await noEntryStore.putLaunch({ ...launch, launchId:'launch-no-entry', eventId:'event-no-entry', txHash:'0xnoentry', token:'0xaab' });
const noEntrySource = new FakeSource();
noEntrySource.entryExecutable = false;
await syncExecutableBaseline(noEntrySource, noEntryStore, options);
assert.equal(noEntryStore.baselineCount, 1);
assert.deepEqual(noEntrySource.reverseInputs, []);

// Structural missing evidence is terminal UNVERIFIED at the frozen decision point.
const unverifiedStore = new MemoryStore();
await unverifiedStore.putLaunch({ ...launch, launchId:'launch-u', eventId:'event-u', txHash:'0xu', token:'0xaac' });
const unverifiedSource = new FakeSource();
unverifiedSource.failMarket = true;
const uv = await syncExecutableBaseline(unverifiedSource, unverifiedStore, options);
assert.equal(uv.unverified, 1);
assert.equal((await unverifiedStore.listLaunchesPendingBaseline(LAUNCH_BLOCK, 10)).length, 0);

// Provider/transport failures are not market evidence: halt and leave the launch pending for retry.
const providerStore = new MemoryStore();
await providerStore.putLaunch({ ...launch, launchId:'launch-p', eventId:'event-p', txHash:'0xp', token:'0xab0' });
const providerSource = new FakeSource();
providerSource.failProvider = true;
await assert.rejects(syncExecutableBaseline(providerSource, providerStore, options), /RPC_TIMEOUT/);
assert.equal(providerStore.baselineCount, 0);
assert.equal((await providerStore.listLaunchesPendingBaseline(LAUNCH_BLOCK, 10)).length, 1);

// Authority drift is global: halt and do not convert it into a per-launch UNVERIFIED record.
const driftStore = new MemoryStore();
await driftStore.putLaunch({ ...launch, launchId:'launch-d', eventId:'event-d', txHash:'0xd', token:'0xaad' });
class DriftSource extends FakeSource { async assertAuthority() { throw new Error('QUOTER_FACTORY_DRIFT'); } }
await assert.rejects(syncExecutableBaseline(new DriftSource(), driftStore, options), /DRIFT/);
assert.equal(driftStore.baselineCount, 0);

// Block moves during the read: fail closed and leave launch pending for canonical replay.
const raceStore = new MemoryStore();
await raceStore.putLaunch({ ...launch, launchId:'launch-r', eventId:'event-r', txHash:'0xr', token:'0xaae' });
class RaceSource extends FakeSource {
  reads = 0;
  async getBlockHash(block) { this.reads += 1; return this.reads === 1 ? `0x${DECISION_BLOCK}` : `0x${DECISION_BLOCK}b`; }
}
await assert.rejects(syncExecutableBaseline(new RaceSource(), raceStore, options), /BASELINE_REORG_DURING_READ/);
assert.equal(raceStore.baselineCount, 0);
assert.equal((await raceStore.listLaunchesPendingBaseline(LAUNCH_BLOCK, 10)).length, 1);

console.log('executable-baseline-check: PASS');
