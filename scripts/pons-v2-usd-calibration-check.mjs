import assert from 'node:assert/strict';
import { encodeFunctionResult, keccak256 } from 'viem';
import {
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  uniswapV4QuoterReadAbi
} from '../dist/adapters/robinhood/ponsV2/contracts.js';
import {
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  ROBINHOOD_USDG_EIP1967_IMPLEMENTATION_SLOT,
  ROBINHOOD_ETH_USDG_V4_POOL_ID,
  ROBINHOOD_ETH_USDG_V4_POOL_KEY,
  deriveRobinhoodEthUsdgV4PoolId
} from '../dist/adapters/robinhood/ponsV2/v4UsdCalibrationAuthority.js';
import {
  ViemRobinhoodUsdCalibrationAdapter
} from '../dist/adapters/robinhood/ponsV2/viemUsdCalibrationAdapter.js';

const authority = {
  ...CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  authorityId: 'TEST_ROBINHOOD_USDG_CALIBRATION',
  fromBlock: 100n,
  throughBlock: 500n,
  poolManager: '0x1111111111111111111111111111111111111111',
  stateView: '0x2222222222222222222222222222222222222222',
  quoter: '0x3333333333333333333333333333333333333333',
  usdg: '0x4444444444444444444444444444444444444444',
  usdgImplementation: '0x5555555555555555555555555555555555555555'
};
const codes = {
  poolManager: '0x6001600055',
  stateView: '0x6002600055',
  quoter: '0x6003600055',
  usdg: '0x6004600055',
  implementation: '0x6005600055'
};
authority.poolManagerRuntimeCodeHash = keccak256(codes.poolManager);
authority.stateViewRuntimeCodeHash = keccak256(codes.stateView);
authority.quoterRuntimeCodeHash = keccak256(codes.quoter);
authority.usdgProxyRuntimeCodeHash = keccak256(codes.usdg);
authority.usdgImplementationRuntimeCodeHash = keccak256(codes.implementation);
authority.poolId = ROBINHOOD_ETH_USDG_V4_POOL_ID;

const decisionHash = `0x${'aa'.repeat(32)}`;
const launch = {
  chainId: ROBINHOOD_CHAIN_ID,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchId: 'launch-1',
  eventId: 'event-1',
  factory: '0x6666666666666666666666666666666666666666',
  txHash: `0x${'bb'.repeat(32)}`,
  blockNumber: 110n,
  blockHash: `0x${'cc'.repeat(32)}`,
  logIndex: 1,
  token: '0x7777777777777777777777777777777777777777',
  creator: '0x8888888888888888888888888888888888888888',
  name: 'Calibration',
  symbol: 'CAL',
  sourceEventName: 'TokenLaunched',
  observedAtMs: 1,
  sourceAuthority: { schema: 'TEST', payload: {} }
};
const market = {
  marketId: 'market-1',
  launchId: launch.launchId,
  chainId: ROBINHOOD_CHAIN_ID,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchedToken: launch.token,
  baseAsset: PONS_V2_NATIVE_PAIR_TOKEN,
  venue: 'PONS_V2_BONDING_CURVE',
  sourceAuthority: { schema: 'TEST', payload: {} }
};

function paddedAddress(address) {
  return `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`;
}

function makeClient({
  amountIn = 400_000_000_000_000n,
  gasEstimate = 75_000n,
  decimals = 6,
  name = 'Global Dollar',
  symbol = 'USDG',
  implementation = authority.usdgImplementation,
  lpFee = 500,
  sqrtPriceX96 = 123n,
  liquidity = 456n,
  quoterPoolManager = authority.poolManager,
  codeOverride = {},
  blockHashSequence
} = {}) {
  let hashRead = 0;
  return {
    async getChainId() { return ROBINHOOD_CHAIN_ID; },
    async getBlock({ blockNumber }) {
      const hash = blockHashSequence
        ? blockHashSequence[Math.min(hashRead++, blockHashSequence.length - 1)]
        : decisionHash;
      return { number: blockNumber, hash };
    },
    async getBytecode({ address }) {
      const a = address.toLowerCase();
      if (a === authority.poolManager.toLowerCase()) return codeOverride.poolManager ?? codes.poolManager;
      if (a === authority.stateView.toLowerCase()) return codeOverride.stateView ?? codes.stateView;
      if (a === authority.quoter.toLowerCase()) return codeOverride.quoter ?? codes.quoter;
      if (a === authority.usdg.toLowerCase()) return codeOverride.usdg ?? codes.usdg;
      if (a === authority.usdgImplementation.toLowerCase()) return codeOverride.implementation ?? codes.implementation;
      return undefined;
    },
    async getStorageAt({ address, slot }) {
      assert.equal(address.toLowerCase(), authority.usdg.toLowerCase());
      assert.equal(slot.toLowerCase(), ROBINHOOD_USDG_EIP1967_IMPLEMENTATION_SLOT.toLowerCase());
      return paddedAddress(implementation);
    },
    async readContract({ address, functionName }) {
      const a = address.toLowerCase();
      if (a === authority.usdg.toLowerCase()) {
        if (functionName === 'name') return name;
        if (functionName === 'symbol') return symbol;
        if (functionName === 'decimals') return decimals;
      }
      if (a === authority.quoter.toLowerCase() && functionName === 'poolManager') {
        return quoterPoolManager;
      }
      if (a === authority.stateView.toLowerCase()) {
        if (functionName === 'getSlot0') return [sqrtPriceX96, -100, 0, lpFee];
        if (functionName === 'getLiquidity') return liquidity;
      }
      throw new Error(`UNEXPECTED_READ:${address}:${functionName}`);
    },
    async call() {
      return {
        data: encodeFunctionResult({
          abi: uniswapV4QuoterReadAbi,
          functionName: 'quoteExactOutputSingle',
          result: [amountIn, gasEstimate]
        })
      };
    }
  };
}

function adapter(options = {}) {
  return new ViemRobinhoodUsdCalibrationAdapter({
    authority,
    client: makeClient(options)
  });
}

assert.equal(ROBINHOOD_ETH_USDG_V4_POOL_KEY.currency0, PONS_V2_NATIVE_PAIR_TOKEN);
assert.equal(ROBINHOOD_ETH_USDG_V4_POOL_KEY.fee, 500);
assert.equal(ROBINHOOD_ETH_USDG_V4_POOL_KEY.tickSpacing, 10);
assert.equal(
  ROBINHOOD_ETH_USDG_V4_POOL_ID,
  '0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982'
);
assert.equal(deriveRobinhoodEthUsdgV4PoolId(), ROBINHOOD_ETH_USDG_V4_POOL_ID);

const oneDollar = await adapter().calibrateUsd({
  launch,
  market,
  decisionBlock: 120n,
  decisionBlockHash: decisionHash,
  notionalUsdMicros: 1_000_000n
});
assert.equal(oneDollar.baseAsset, PONS_V2_NATIVE_PAIR_TOKEN);
assert.equal(oneDollar.baseDecimals, 18);
assert.equal(oneDollar.baseAmount, 400_000_000_000_000n);
assert.equal(oneDollar.sourceAuthority.payload.targetUsdg, '1000000');
assert.equal(oneDollar.sourceAuthority.payload.usdgDecimals, 6);
assert.equal(oneDollar.sourceAuthority.payload.quoteMode, 'EXACT_OUTPUT');

const quarterDollar = await adapter({ amountIn: 100_000_000_000_000n }).calibrateUsd({
  launch,
  market,
  decisionBlock: 120n,
  decisionBlockHash: decisionHash,
  notionalUsdMicros: 250_000n
});
assert.equal(quarterDollar.sourceAuthority.payload.targetUsdg, '250000');
assert.equal(quarterDollar.baseAmount, 100_000_000_000_000n);

await assert.rejects(
  () => adapter({ implementation: '0x9999999999999999999999999999999999999999' }).calibrateUsd({
    launch, market, decisionBlock: 120n, decisionBlockHash: decisionHash, notionalUsdMicros: 1_000_000n
  }),
  /USDG_IMPLEMENTATION_DRIFT/
);

await assert.rejects(
  () => adapter({ decimals: 18 }).calibrateUsd({
    launch, market, decisionBlock: 120n, decisionBlockHash: decisionHash, notionalUsdMicros: 1_000_000n
  }),
  /USDG_IDENTITY_DRIFT/
);

await assert.rejects(
  () => adapter({ codeOverride: { quoter: '0x6009600055' } }).calibrateUsd({
    launch, market, decisionBlock: 120n, decisionBlockHash: decisionHash, notionalUsdMicros: 1_000_000n
  }),
  /QUOTER_CODE_HASH_DRIFT/
);

await assert.rejects(
  () => adapter({ quoterPoolManager: '0x9999999999999999999999999999999999999999' }).calibrateUsd({
    launch, market, decisionBlock: 120n, decisionBlockHash: decisionHash, notionalUsdMicros: 1_000_000n
  }),
  /QUOTER_POOL_MANAGER_DRIFT/
);

await assert.rejects(
  () => adapter({ liquidity: 0n }).calibrateUsd({
    launch, market, decisionBlock: 120n, decisionBlockHash: decisionHash, notionalUsdMicros: 1_000_000n
  }),
  /POOL_UNAVAILABLE/
);

await assert.rejects(
  () => adapter({ lpFee: 3000 }).calibrateUsd({
    launch, market, decisionBlock: 120n, decisionBlockHash: decisionHash, notionalUsdMicros: 1_000_000n
  }),
  /POOL_FEE_DRIFT/
);

await assert.rejects(
  () => adapter({
    blockHashSequence: [decisionHash, `0x${'dd'.repeat(32)}`]
  }).calibrateUsd({
    launch, market, decisionBlock: 120n, decisionBlockHash: decisionHash, notionalUsdMicros: 1_000_000n
  }),
  /REORG_DURING_READ/
);

const wrongBaseMarket = {
  ...market,
  baseAsset: '0x9999999999999999999999999999999999999999'
};
await assert.rejects(
  () => adapter().calibrateUsd({
    launch, market: wrongBaseMarket, decisionBlock: 120n,
    decisionBlockHash: decisionHash, notionalUsdMicros: 1_000_000n
  }),
  /UNSUPPORTED_BASE/
);

console.log(JSON.stringify({
  verdict: 'ROBINHOOD_USDG_CALIBRATION_PASS',
  mode: 'SHADOW_ONLY',
  usdConvention: 'USDG_NOMINAL_USD_PEG_V0',
  quoteMode: 'EXACT_OUTPUT',
  nativeEthBase: true,
  poolAuthorityPinned: true,
  usdgImplementationPinned: true,
  decisionBlockReorgGuard: true,
  liveMoneyAuthority: false
}, null, 2));
