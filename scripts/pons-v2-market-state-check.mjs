import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { ROBINHOOD_CHAIN_ID } from '../dist/adapters/robinhood/ponsV2/contracts.js';
import { ViemPonsV2MarketStateResolver } from '../dist/adapters/robinhood/ponsV2/viemMarketStateResolver.js';

const factory = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const curve = '0x3333333333333333333333333333333333333333';
const deployer = '0x4444444444444444444444444444444444444444';
const pairToken = '0x0000000000000000000000000000000000000000';
const factoryCode = '0x6001600055';
const factoryRuntimeCodeHash = keccak256(factoryCode);
const decisionHash = `0x${'aa'.repeat(32)}`;

const authority = {
  authorityId: 'TEST_PONS_V2_MARKET_EPOCH',
  chainId: ROBINHOOD_CHAIN_ID,
  factory,
  fromBlock: 100n,
  throughBlock: 500n,
  factoryRuntimeCodeHash
};

const launch = {
  chainId: ROBINHOOD_CHAIN_ID,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchId: 'launch-1',
  eventId: 'event-1',
  factory,
  txHash: `0x${'bb'.repeat(32)}`,
  blockNumber: 110n,
  blockHash: `0x${'cc'.repeat(32)}`,
  logIndex: 7,
  token,
  creator: deployer,
  name: 'Market Test',
  symbol: 'MKT',
  sourceEventName: 'TokenLaunched',
  observedAtMs: 1_789_700_000_000,
  sourceAuthority: {
    schema: 'ROBINHOOD_PONS_V2_TOKEN_LAUNCHED_V1',
    payload: {
      curve,
      pairToken,
      graduationThreshold: '50000000000000000000'
    }
  }
};

const baseRecord = {
  token,
  curve,
  deployer,
  creatorFeeRecipient: deployer,
  pairToken,
  graduationThreshold: 50_000_000_000_000_000_000n,
  poolFee: 3000,
  tickSpacing: 60,
  creatorTaxBps: 200,
  buybackEnabled: false,
  phase: 0,
  sweptQuote: 0n,
  sweptTokens: 0n,
  sweptAt: 0n,
  exists: true
};

function makeClient({
  phase = 0,
  readyToGraduate = false,
  graduated = false,
  record = baseRecord,
  blockHashSequence,
  curveCode = '0x6002'
} = {}) {
  let blockRead = 0;
  return {
    async getChainId() { return ROBINHOOD_CHAIN_ID; },
    async getBlockNumber() { return 200n; },
    async getBlock({ blockNumber }) {
      const hash = blockHashSequence
        ? blockHashSequence[Math.min(blockRead++, blockHashSequence.length - 1)]
        : decisionHash;
      return { number: blockNumber, hash, timestamp: 1_789_700_000n };
    },
    async getBytecode({ address }) {
      if (address.toLowerCase() === factory.toLowerCase()) return factoryCode;
      if (address.toLowerCase() === curve.toLowerCase()) return curveCode;
      return undefined;
    },
    async readContract({ address, functionName }) {
      if (address.toLowerCase() === factory.toLowerCase() && functionName === 'getLaunchedToken') {
        return { ...record, phase };
      }
      if (address.toLowerCase() === curve.toLowerCase() && functionName === 'graduated') {
        return graduated;
      }
      if (address.toLowerCase() === curve.toLowerCase() && functionName === 'readyToGraduate') {
        return readyToGraduate;
      }
      throw new Error(`UNEXPECTED_READ:${address}:${functionName}`);
    }
  };
}

async function resolve(options = {}) {
  return new ViemPonsV2MarketStateResolver({
    authority,
    client: makeClient(options)
  }).resolve(launch, 120n);
}

const active = await resolve();
assert.equal(active.state, 'CURVE_ACTIVE');
assert.equal(active.decisionBlock, 120n);
assert.equal(active.decisionBlockHash, decisionHash);
assert.ok(active.market);
assert.equal(active.market.venue, 'PONS_V2_BONDING_CURVE');
assert.equal(active.market.baseAsset, pairToken);
assert.equal(active.market.launchId, launch.launchId);
assert.equal(active.market.sourceAuthority.schema, 'ROBINHOOD_PONS_V2_MARKET_STATE_R1');

const ready = await resolve({ readyToGraduate: true });
assert.equal(ready.state, 'CURVE_HALTED_READY');
assert.equal(ready.market, null);

const swept = await resolve({ phase: 1 });
assert.equal(swept.state, 'SWEPT_PENDING_V4');
assert.equal(swept.market, null);

const pool = await resolve({ phase: 2 });
assert.equal(pool.state, 'V4_POOL_PENDING_ADAPTER');
assert.equal(pool.market, null);

const rescued = await resolve({ phase: 3 });
assert.equal(rescued.state, 'RESCUED_TERMINAL');
assert.equal(rescued.market, null);

await assert.rejects(
  () => resolve({ phase: 4 }),
  /PONS_V2_MARKET_UNKNOWN_GRADUATION_PHASE:4/
);

await assert.rejects(
  () => new ViemPonsV2MarketStateResolver({ authority, client: makeClient() }).resolve(launch, 109n),
  /PONS_V2_MARKET_DECISION_BEFORE_LAUNCH/
);

await assert.rejects(
  () => resolve({ graduated: true }),
  /PONS_V2_MARKET_PHASE_CONTRADICTION/
);

await assert.rejects(
  () => resolve({ curveCode: '0x' }),
  /PONS_V2_MARKET_CURVE_CODE_MISSING/
);

await assert.rejects(
  () => resolve({ record: { ...baseRecord, pairToken: '0x5555555555555555555555555555555555555555' } }),
  /PONS_V2_MARKET_LAUNCH_RECORD_MISMATCH:PAIR_TOKEN/
);

const reorg = new ViemPonsV2MarketStateResolver({
  authority,
  client: makeClient({
    blockHashSequence: [decisionHash, `0x${'dd'.repeat(32)}`]
  })
});
await assert.rejects(
  () => reorg.resolve(launch, 120n),
  /PONS_V2_MARKET_REORG_DURING_READ/
);

const wrongFactoryLaunch = { ...launch, factory: '0x6666666666666666666666666666666666666666' };
await assert.rejects(
  () => new ViemPonsV2MarketStateResolver({ authority, client: makeClient() }).resolve(wrongFactoryLaunch, 120n),
  /PONS_V2_MARKET_FACTORY_MISMATCH/
);

console.log(JSON.stringify({
  verdict: 'PONS_V2_MARKET_STATE_RESOLVER_PASS',
  mode: 'SHADOW_ONLY',
  liveMoneyAuthority: false,
  activeCurveProducesMarket: true,
  readyCurveFailsClosed: true,
  sweptFailsClosed: true,
  v4RequiresSeparateAdapter: true,
  rescuedTerminal: true,
  decisionBlockReorgGuard: true
}, null, 2));
