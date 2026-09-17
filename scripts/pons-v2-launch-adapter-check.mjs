import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { ROBINHOOD_CHAIN_ID, PONS_V2_NATIVE_PAIR_TOKEN } from '../dist/adapters/robinhood/ponsV2/contracts.js';
import { ViemPonsV2LaunchAdapter } from '../dist/adapters/robinhood/ponsV2/viemLaunchAdapter.js';

const factory = '0x1111111111111111111111111111111111111111';
const token = '0x2222222222222222222222222222222222222222';
const curve = '0x3333333333333333333333333333333333333333';
const deployer = '0x4444444444444444444444444444444444444444';
const factoryCode = '0x60016000556002600055';
const factoryRuntimeCodeHash = keccak256(factoryCode);
const blockHash = `0x${'aa'.repeat(32)}`;
const txHash = `0x${'bb'.repeat(32)}`;

const authority = {
  authorityId: 'TEST_ONLY_PONS_V2_EPOCH',
  chainId: ROBINHOOD_CHAIN_ID,
  factory,
  fromBlock: 100n,
  throughBlock: 200n,
  factoryRuntimeCodeHash
};

const baseRecord = {
  token,
  curve,
  deployer,
  creatorFeeRecipient: deployer,
  pairToken: PONS_V2_NATIVE_PAIR_TOKEN,
  graduationThreshold: 50_000_000_000_000_000_000n,
  poolFee: 0,
  tickSpacing: 60,
  creatorTaxBps: 0,
  buybackEnabled: false,
  phase: 0,
  sweptQuote: 0n,
  sweptTokens: 0n,
  sweptAt: 0n,
  exists: true
};

function makeClient({
  chainId = ROBINHOOD_CHAIN_ID,
  factoryBytecode = factoryCode,
  record = baseRecord,
  canonicalBlockHash = blockHash
} = {}) {
  return {
    async getBlockNumber() { return 150n; },
    async getChainId() { return chainId; },
    async getBlock({ blockNumber }) {
      return { number: blockNumber, hash: canonicalBlockHash, timestamp: 1_789_700_000n };
    },
    async getBytecode({ address }) {
      if (address.toLowerCase() === factory.toLowerCase()) return factoryBytecode;
      if (address.toLowerCase() === token.toLowerCase()) return '0x6003';
      if (address.toLowerCase() === curve.toLowerCase()) return '0x6004';
      return undefined;
    },
    async getLogs() {
      return [{
        blockNumber: 110n,
        blockHash,
        transactionHash: txHash,
        logIndex: 7,
        args: {
          token,
          curve,
          deployer,
          pairToken: PONS_V2_NATIVE_PAIR_TOKEN,
          launchConfigId: 3n,
          graduationThreshold: baseRecord.graduationThreshold
        }
      }];
    },
    async readContract({ functionName }) {
      if (functionName === 'getLaunchedToken') return record;
      if (functionName === 'name') return 'Portable Pons';
      if (functionName === 'symbol') return 'PONSX';
      throw new Error(`UNEXPECTED_READ:${functionName}`);
    }
  };
}

const adapter = new ViemPonsV2LaunchAdapter({
  authority,
  client: makeClient(),
  now: () => 1_789_700_123_456
});

assert.equal(adapter.chainId, ROBINHOOD_CHAIN_ID);
assert.equal(adapter.ecosystem, 'ROBINHOOD');
assert.equal(adapter.launchProtocol, 'PONS');
assert.equal(adapter.mode, 'SHADOW_ONLY');
assert.equal(await adapter.getHeadBlockNumber(), 150n);
await assert.doesNotReject(() => adapter.assertAuthority(110n));

const launches = await adapter.catchUp(100n, 120n);
assert.equal(launches.length, 1);
const launch = launches[0];
assert.equal(launch.chainId, ROBINHOOD_CHAIN_ID);
assert.equal(launch.ecosystem, 'ROBINHOOD');
assert.equal(launch.launchProtocol, 'PONS');
assert.equal(launch.factory, factory);
assert.equal(launch.token, token);
assert.equal(launch.creator, deployer);
assert.equal(launch.name, 'Portable Pons');
assert.equal(launch.symbol, 'PONSX');
assert.equal(launch.sourceEventName, 'TokenLaunched');
assert.equal(launch.sourceAuthority.schema, 'ROBINHOOD_PONS_V2_TOKEN_LAUNCHED_V1');
assert.deepEqual(
  {
    curve: launch.sourceAuthority.payload.curve,
    pairToken: launch.sourceAuthority.payload.pairToken,
    launchConfigId: launch.sourceAuthority.payload.launchConfigId,
    graduationThreshold: launch.sourceAuthority.payload.graduationThreshold,
    authorityId: launch.sourceAuthority.payload.authorityId
  },
  {
    curve,
    pairToken: PONS_V2_NATIVE_PAIR_TOKEN,
    launchConfigId: '3',
    graduationThreshold: baseRecord.graduationThreshold.toString(),
    authorityId: authority.authorityId
  }
);

await assert.rejects(
  () => adapter.assertAuthority(99n),
  /PONS_V2_AUTHORITY_BLOCK_BEFORE_EPOCH/
);
await assert.rejects(
  () => adapter.assertAuthority(201n),
  /PONS_V2_AUTHORITY_BLOCK_AFTER_EPOCH/
);

const wrongChain = new ViemPonsV2LaunchAdapter({
  authority,
  client: makeClient({ chainId: 1 })
});
await assert.rejects(
  () => wrongChain.assertAuthority(110n),
  /PONS_V2_CHAIN_ID_DRIFT/
);

const codeDrift = new ViemPonsV2LaunchAdapter({
  authority,
  client: makeClient({ factoryBytecode: '0x6005' })
});
await assert.rejects(
  () => codeDrift.assertAuthority(110n),
  /PONS_V2_FACTORY_CODE_HASH_DRIFT/
);

const recordMismatch = new ViemPonsV2LaunchAdapter({
  authority,
  client: makeClient({
    record: { ...baseRecord, curve: '0x5555555555555555555555555555555555555555' }
  })
});
await assert.rejects(
  () => recordMismatch.catchUp(100n, 120n),
  /PONS_V2_LAUNCH_RECORD_MISMATCH:CURVE/
);

const reorg = new ViemPonsV2LaunchAdapter({
  authority,
  client: makeClient({ canonicalBlockHash: `0x${'cc'.repeat(32)}` })
});
await assert.rejects(
  () => reorg.catchUp(100n, 120n),
  /PONS_V2_REORG_DURING_READ/
);

assert.throws(
  () => new ViemPonsV2LaunchAdapter({
    authority: { ...authority, factoryRuntimeCodeHash: `0x${'00'.repeat(32)}` },
    client: makeClient()
  }),
  /PONS_V2_AUTHORITY_CODE_HASH_INVALID/
);

console.log(JSON.stringify({
  verdict: 'PONS_V2_LAUNCH_ADAPTER_PASS',
  mode: 'SHADOW_ONLY',
  liveMoneyAuthority: false,
  defaultFactoryAuthority: false,
  chainId: ROBINHOOD_CHAIN_ID,
  factoryEpochRequired: true,
  runtimeCodeHashRequired: true,
  sourceRecordCrossCheck: true,
  blockHashReorgGuard: true
}, null, 2));
