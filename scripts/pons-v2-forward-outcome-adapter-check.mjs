import assert from 'node:assert/strict';
import {
  decodeFunctionData,
  encodeFunctionResult,
  keccak256
} from 'viem';
import { sha256Hex } from '../dist/evidence/canonical.js';
import {
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  uniswapV4QuoterReadAbi
} from '../dist/adapters/robinhood/ponsV2/contracts.js';
import {
  ROBINHOOD_ETH_USDG_V4_POOL_ID
} from '../dist/adapters/robinhood/ponsV2/v4UsdCalibrationAuthority.js';
import {
  ViemPonsV2ForwardOutcomeAdapter
} from '../dist/adapters/robinhood/ponsV2/viemForwardOutcomeAdapter.js';
import {
  computePonsV2CurveReverse
} from '../dist/adapters/robinhood/ponsV2/viemCurveQuoteAdapter.js';

const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const FACTORY = addr(1);
const CURVE = addr(2);
const TOKEN = addr(3);
const CREATOR = addr(4);
const HOOK = addr(5);
const POOL_MANAGER = addr(6);
const DEPLOYER = addr(7);
const STATE_VIEW = addr(8);
const QUOTER = addr(9);
const USDG = addr(10);
const USDG_IMPL = addr(11);

const codes = {
  factory: '0x60016000',
  hook: '0x60026000',
  deployer: '0x60036000',
  poolManager: '0x60046000',
  stateView: '0x60056000',
  quoter: '0x60066000',
  usdg: '0x60076000',
  usdgImpl: '0x60086000'
};

const ponsAuthority = {
  authorityId: 'TEST_PONS_FACTORY',
  chainId: ROBINHOOD_CHAIN_ID,
  factory: FACTORY,
  fromBlock: 1n,
  factoryRuntimeCodeHash: keccak256(codes.factory)
};

const curveTemplateAuthority = {
  authorityId: 'TEST_CURVE_TEMPLATE',
  factoryAuthorityId: ponsAuthority.authorityId,
  chainId: ROBINHOOD_CHAIN_ID,
  factory: FACTORY,
  launchDeployer: DEPLOYER,
  fromBlock: 1n,
  launchDeployerRuntimeCodeHash: keccak256(codes.deployer)
};

const usdAuthority = {
  authorityId: 'TEST_USD_AUTHORITY',
  chainId: ROBINHOOD_CHAIN_ID,
  fromBlock: 1n,
  poolManager: POOL_MANAGER,
  poolManagerRuntimeCodeHash: keccak256(codes.poolManager),
  stateView: STATE_VIEW,
  stateViewRuntimeCodeHash: keccak256(codes.stateView),
  quoter: QUOTER,
  quoterRuntimeCodeHash: keccak256(codes.quoter),
  usdg: USDG,
  usdgProxyRuntimeCodeHash: keccak256(codes.usdg),
  usdgImplementation: USDG_IMPL,
  usdgImplementationRuntimeCodeHash: keccak256(codes.usdgImpl),
  poolId: ROBINHOOD_ETH_USDG_V4_POOL_ID
};

const outcomeAuthority = {
  authorityId: 'TEST_FORWARD_AUTHORITY',
  chainId: ROBINHOOD_CHAIN_ID,
  fromBlock: 1n,
  memeHook: HOOK,
  memeHookRuntimeCodeHash: keccak256(codes.hook)
};

const marketId = await sha256Hex({
  kind: 'PONS_V2_CURVE_MARKET_V1',
  chainId: ROBINHOOD_CHAIN_ID,
  launchId: 'launch-1',
  curve: CURVE.toLowerCase(),
  pairToken: PONS_V2_NATIVE_PAIR_TOKEN
});

const market = {
  marketId,
  launchId: 'launch-1',
  chainId: ROBINHOOD_CHAIN_ID,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchedToken: TOKEN,
  baseAsset: PONS_V2_NATIVE_PAIR_TOKEN,
  venue: 'PONS_V2_BONDING_CURVE',
  sourceAuthority: {
    schema: 'ROBINHOOD_PONS_V2_MARKET_STATE_R1',
    payload: {
      authorityId: ponsAuthority.authorityId,
      factoryRuntimeCodeHash: ponsAuthority.factoryRuntimeCodeHash,
      launchId: 'launch-1',
      decisionBlock: '10',
      decisionBlockHash: hash(10n),
      factory: FACTORY,
      token: TOKEN,
      curve: CURVE,
      pairToken: PONS_V2_NATIVE_PAIR_TOKEN,
      graduationThreshold: '1000',
      poolFee: 0,
      tickSpacing: 200,
      creatorTaxBps: 100,
      phase: 0,
      state: 'CURVE_ACTIVE',
      sweptQuote: '0',
      sweptTokens: '0',
      sweptAt: '0'
    }
  }
};

function makeClient({ phase = 0, ready = false } = {}) {
  const record = () => ({
    token: TOKEN,
    curve: CURVE,
    deployer: CREATOR,
    creatorFeeRecipient: CREATOR,
    pairToken: PONS_V2_NATIVE_PAIR_TOKEN,
    graduationThreshold: 1000n,
    poolFee: 0,
    tickSpacing: 200,
    creatorTaxBps: 100,
    buybackEnabled: false,
    phase,
    sweptQuote: phase === 1 ? 5_000n : 0n,
    sweptTokens: phase === 1 ? 10_000n : 0n,
    sweptAt: phase === 1 ? 123n : 0n,
    exists: true
  });

  return {
    async getBlockNumber() { return 100n; },
    async getChainId() { return ROBINHOOD_CHAIN_ID; },
    async getBlock({ blockNumber }) {
      return {
        number: blockNumber,
        hash: hash(blockNumber),
        timestamp: blockNumber
      };
    },
    async getBytecode({ address }) {
      const a = address.toLowerCase();
      if (a === FACTORY.toLowerCase()) return codes.factory;
      if (a === HOOK.toLowerCase()) return codes.hook;
      if (a === DEPLOYER.toLowerCase()) return codes.deployer;
      if (a === POOL_MANAGER.toLowerCase()) return codes.poolManager;
      if (a === STATE_VIEW.toLowerCase()) return codes.stateView;
      if (a === QUOTER.toLowerCase()) return codes.quoter;
      if (a === USDG.toLowerCase()) return codes.usdg;
      if (a === USDG_IMPL.toLowerCase()) return codes.usdgImpl;
      if (a === CURVE.toLowerCase()) return '0x60106000';
      return '0x';
    },
    async getStorageAt() {
      return `0x${USDG_IMPL.slice(2).padStart(64, '0')}`;
    },
    async readContract({ address, functionName, args }) {
      const a = address.toLowerCase();
      if (a === FACTORY.toLowerCase()) {
        if (functionName === 'getLaunchedToken') return record();
        if (functionName === 'memeHook') return HOOK;
        if (functionName === 'poolManager') return POOL_MANAGER;
        if (functionName === 'launchDeployer') return DEPLOYER;
      }
      if (a === CURVE.toLowerCase()) {
        if (functionName === 'graduated') return phase !== 0;
        if (functionName === 'readyToGraduate') return ready;
        if (functionName === 'factory') return FACTORY;
        if (functionName === 'token') return TOKEN;
        if (functionName === 'pairToken') return PONS_V2_NATIVE_PAIR_TOKEN;
        if (functionName === 'getReserves') return [1_000_000n, 2_000_000n];
        if (functionName === 'trackedQuote') return 1_000_000n;
        if (functionName === 'sellableTokens') return 1_000_000n;
        if (functionName === 'feeBps') return 100n;
        if (functionName === 'creatorTaxBps') return 100n;
      }
      if (a === DEPLOYER.toLowerCase() && functionName === 'factory') {
        return FACTORY;
      }
      if (a === HOOK.toLowerCase()) {
        if (functionName === 'factory') return FACTORY;
        if (functionName === 'poolManager') return POOL_MANAGER;
        if (functionName === 'launches') {
          return [
            true,
            false,
            TOKEN,
            PONS_V2_NATIVE_PAIR_TOKEN,
            CREATOR,
            CREATOR,
            CREATOR,
            100,
            3000,
            5000,
            100,
            300,
            false
          ];
        }
      }
      if (a === USDG.toLowerCase()) {
        if (functionName === 'name') return 'Global Dollar';
        if (functionName === 'symbol') return 'USDG';
        if (functionName === 'decimals') return 6;
      }
      if (a === QUOTER.toLowerCase() && functionName === 'poolManager') {
        return POOL_MANAGER;
      }
      if (a === STATE_VIEW.toLowerCase()) {
        const poolId = args?.[0]?.toLowerCase();
        if (functionName === 'getSlot0') {
          return poolId === ROBINHOOD_ETH_USDG_V4_POOL_ID.toLowerCase()
            ? [1n << 96n, 0, 0, 500]
            : [1n << 96n, 0, 0, 0];
        }
        if (functionName === 'getLiquidity') {
          return poolId === ROBINHOOD_ETH_USDG_V4_POOL_ID.toLowerCase()
            ? 5_000_000n
            : 2_000_000n;
        }
      }
      throw new Error(`unexpected readContract ${address} ${functionName}`);
    },
    async call({ data }) {
      const decoded = decodeFunctionData({
        abi: uniswapV4QuoterReadAbi,
        data
      });
      assert.equal(decoded.functionName, 'quoteExactInputSingle');
      const [params] = decoded.args;
      const amountOut = params.zeroForOne ? 1_100_000n : 900_000_000_000_000n;
      return {
        data: encodeFunctionResult({
          abi: uniswapV4QuoterReadAbi,
          functionName: 'quoteExactInputSingle',
          result: [amountOut, 42_000n]
        })
      };
    }
  };
}

function adapterFor(options = {}) {
  return new ViemPonsV2ForwardOutcomeAdapter({
    ponsAuthority,
    curveTemplateAuthority,
    usdAuthority,
    outcomeAuthority,
    client: makeClient(options)
  });
}

const pureReverse = computePonsV2CurveReverse(10_000n, {
  curve: CURVE,
  quoteReserve: 1_000_000n,
  tokenReserve: 2_000_000n,
  trackedQuote: 1_000_000n,
  sellableTokens: 1_000_000n,
  feeBps: 100n,
  creatorTaxBps: 100n,
  snipeTaxBps: 0n
});
assert.equal(pureReverse.executable, true);
assert.ok(pureReverse.quoteOut > 0n);

const curveAdapter = adapterFor({ phase: 0 });
const point = await curveAdapter.getBlockPoint(20n);
assert.equal(point.blockHash, hash(20n));
const curveLiquidity = await curveAdapter.readLiquidity(market, 20n);
assert.equal(curveLiquidity.state, 'SURVIVED');
const curveExit = await curveAdapter.quoteExit({
  market,
  tokenAmount: 10_000n,
  blockNumber: 20n
});
assert.equal(curveExit.executable, true);
assert.ok(curveExit.amountOut > 0n);

const readyAdapter = adapterFor({ phase: 0, ready: true });
assert.equal((await readyAdapter.readLiquidity(market, 20n)).state, 'UNKNOWN');
const readyExit = await readyAdapter.quoteExit({
  market,
  tokenAmount: 10_000n,
  blockNumber: 20n
});
assert.equal(readyExit.executable, false);
assert.equal(
  readyExit.failureReason,
  'PONS_V2_FORWARD_VENUE_TRANSITION_UNAVAILABLE'
);

const sweptAdapter = adapterFor({ phase: 1 });
assert.equal((await sweptAdapter.readLiquidity(market, 20n)).state, 'UNKNOWN');

const v4Adapter = adapterFor({ phase: 2 });
const v4Liquidity = await v4Adapter.readLiquidity(market, 20n);
assert.equal(v4Liquidity.state, 'SURVIVED');
const v4Exit = await v4Adapter.quoteExit({
  market,
  tokenAmount: 10_000n,
  blockNumber: 20n
});
assert.equal(v4Exit.executable, true);
assert.equal(v4Exit.amountOut, 900_000_000_000_000n);
const usdValue = await v4Adapter.valueBaseAmountUsdMicros({
  market,
  baseAmount: v4Exit.amountOut,
  blockNumber: 20n
});
assert.equal(usdValue.usdMicros, 1_100_000n);

const rescuedAdapter = adapterFor({ phase: 3 });
assert.equal((await rescuedAdapter.readLiquidity(market, 20n)).state, 'COLLAPSED');
const rescuedExit = await rescuedAdapter.quoteExit({
  market,
  tokenAmount: 10_000n,
  blockNumber: 20n
});
assert.equal(rescuedExit.executable, false);
assert.equal(rescuedExit.failureReason, 'PONS_V2_FORWARD_RESCUED_TERMINAL');

await assert.rejects(
  () => curveAdapter.readLiquidity({ ...market, marketId: 'alias' }, 20n),
  /PONS_V2_FORWARD_MARKET_ID_MISMATCH/
);

const badHookAdapter = new ViemPonsV2ForwardOutcomeAdapter({
  ponsAuthority,
  curveTemplateAuthority,
  usdAuthority,
  outcomeAuthority: {
    ...outcomeAuthority,
    memeHookRuntimeCodeHash: hash(999n)
  },
  client: makeClient({ phase: 0 })
});
await assert.rejects(
  () => badHookAdapter.readLiquidity(market, 20n),
  /PONS_V2_FORWARD_MEME_HOOK_CODE_HASH_DRIFT/
);

console.log(JSON.stringify({
  verdict: 'PONS_V2_FORWARD_OUTCOME_ADAPTER_PASS',
  phases: {
    curveActive: curveLiquidity.state,
    curveHaltedReady: 'UNKNOWN',
    sweptPendingV4: 'UNKNOWN',
    v4PoolActive: v4Liquidity.state,
    rescuedTerminal: 'COLLAPSED'
  },
  v4ExactInputExit: v4Exit.executable,
  observedEthUsdgMicros: usdValue.usdMicros.toString(),
  marketAliasFailsClosed: true,
  hookRuntimePinned: true,
  liveMoneyAuthority: false,
  edge: 'UNPROVEN'
}, null, 2));
