import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import { ROBINHOOD_CHAIN_ID, PONS_V2_NATIVE_PAIR_TOKEN } from '../dist/adapters/robinhood/ponsV2/contracts.js';
import {
  PONS_V2_SHADOW_QUOTE_RECIPIENT,
  ViemPonsV2CurveQuoteAdapter
} from '../dist/adapters/robinhood/ponsV2/viemCurveQuoteAdapter.js';

const factory = '0x1111111111111111111111111111111111111111';
const launchDeployer = '0x1212121212121212121212121212121212121212';
const token = '0x2222222222222222222222222222222222222222';
const curve = '0x3333333333333333333333333333333333333333';
const creator = '0x4444444444444444444444444444444444444444';
const factoryCode = '0x6001600055';
const launchDeployerCode = '0x6002600055';
const curveCode = '0x6003600055';
const factoryRuntimeCodeHash = keccak256(factoryCode);
const launchDeployerRuntimeCodeHash = keccak256(launchDeployerCode);
const decisionHash = `0x${'aa'.repeat(32)}`;

const authority = {
  authorityId: 'TEST_FACTORY_AUTHORITY',
  chainId: ROBINHOOD_CHAIN_ID,
  factory,
  fromBlock: 100n,
  throughBlock: 500n,
  factoryRuntimeCodeHash
};
const templateAuthority = {
  authorityId: 'TEST_CURVE_TEMPLATE',
  factoryAuthorityId: authority.authorityId,
  chainId: ROBINHOOD_CHAIN_ID,
  factory,
  launchDeployer,
  fromBlock: 100n,
  throughBlock: 500n,
  launchDeployerRuntimeCodeHash
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
  creator,
  name: 'Quote Test',
  symbol: 'QTE',
  sourceEventName: 'TokenLaunched',
  observedAtMs: 1,
  sourceAuthority: {
    schema: 'ROBINHOOD_PONS_V2_TOKEN_LAUNCHED_V1',
    payload: {
      authorityId: authority.authorityId,
      factoryRuntimeCodeHash,
      launchId: 'launch-1',
      eventId: 'event-1',
      factory,
      token,
      deployer: creator,
      curve,
      pairToken: PONS_V2_NATIVE_PAIR_TOKEN,
      graduationThreshold: '500'
    }
  }
};

const baseRecord = {
  token,
  curve,
  deployer: creator,
  creatorFeeRecipient: creator,
  pairToken: PONS_V2_NATIVE_PAIR_TOKEN,
  graduationThreshold: 500n,
  poolFee: 0,
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
  quoteReserve = 1000n,
  tokenReserve = 10000n,
  trackedQuote = 500n,
  sellableTokens = 8000n,
  feeBps = 100n,
  creatorTaxBps = 200n,
  snipeTaxBps = 400n,
  snipeTaxExempt = false,
  configuredLaunchDeployer = launchDeployer,
  deployerCode = launchDeployerCode,
  deployerFactory = factory,
  pairToken = PONS_V2_NATIVE_PAIR_TOKEN,
  graduated = false,
  readyToGraduate = false,
  blockHashSequence
} = {}) {
  let hashRead = 0;
  return {
    async getChainId() { return ROBINHOOD_CHAIN_ID; },
    async getBlockNumber() { return 200n; },
    async getBlock({ blockNumber }) {
      const hash = blockHashSequence
        ? blockHashSequence[Math.min(hashRead++, blockHashSequence.length - 1)]
        : decisionHash;
      return { number: blockNumber, hash, timestamp: 1_789_700_000n };
    },
    async getBytecode({ address }) {
      const a = address.toLowerCase();
      if (a === factory.toLowerCase()) return factoryCode;
      if (a === launchDeployer.toLowerCase()) return deployerCode;
      if (a === curve.toLowerCase()) return curveCode;
      if (a === PONS_V2_SHADOW_QUOTE_RECIPIENT.toLowerCase()) return undefined;
      return undefined;
    },
    async readContract({ address, functionName }) {
      const a = address.toLowerCase();
      if (a === factory.toLowerCase()) {
        if (functionName === 'launchDeployer') return configuredLaunchDeployer;
        if (functionName === 'getLaunchedToken') return { ...baseRecord, pairToken, creatorTaxBps: Number(creatorTaxBps) };
      }
      if (a === launchDeployer.toLowerCase() && functionName === 'factory') return deployerFactory;
      if (a === token.toLowerCase()) {
        if (functionName === 'name') return 'Quote Test';
        if (functionName === 'symbol') return 'QTE';
      }
      if (a === curve.toLowerCase()) {
        if (functionName === 'factory') return factory;
        if (functionName === 'token') return token;
        if (functionName === 'pairToken') return pairToken;
        if (functionName === 'graduated') return graduated;
        if (functionName === 'readyToGraduate') return readyToGraduate;
        if (functionName === 'getReserves') return [quoteReserve, tokenReserve];
        if (functionName === 'trackedQuote') return trackedQuote;
        if (functionName === 'sellableTokens') return sellableTokens;
        if (functionName === 'feeBps') return feeBps;
        if (functionName === 'creatorTaxBps') return creatorTaxBps;
        if (functionName === 'snipeTaxExempt') return snipeTaxExempt;
        if (functionName === 'currentSnipeTaxBps') return snipeTaxBps;
      }
      throw new Error(`UNEXPECTED_READ:${address}:${functionName}`);
    }
  };
}

async function prepare(options = {}) {
  const adapter = new ViemPonsV2CurveQuoteAdapter({
    authority,
    templateAuthority,
    client: makeClient(options),
    now: () => 1234
  });
  const market = await adapter.resolveMarket(launch, 120n);
  return { adapter, market };
}

assert.notEqual(PONS_V2_SHADOW_QUOTE_RECIPIENT, PONS_V2_NATIVE_PAIR_TOKEN);

{
  const { adapter, market } = await prepare();
  const entry = await adapter.quoteEntry({
    launch,
    market,
    decisionBlock: 120n,
    decisionBlockHash: decisionHash,
    notionalUsdMicros: 1_000_000n,
    amountIn: 100n
  });
  assert.equal(entry.executable, true);
  assert.equal(entry.amountIn, 100n);
  assert.equal(entry.amountOut, 850n);
  assert.equal(entry.tokenIn, PONS_V2_NATIVE_PAIR_TOKEN);
  assert.equal(entry.tokenOut, token);
  assert.equal(entry.sourceAuthority.payload.snipeTaxAmount, '4');

  const reverse = await adapter.quoteIndependentReverse({
    launch,
    market,
    decisionBlock: 120n,
    decisionBlockHash: decisionHash,
    notionalUsdMicros: 1_000_000n,
    amountIn: entry.amountOut
  });
  assert.equal(reverse.executable, true);
  assert.equal(reverse.amountIn, 850n);
  assert.equal(reverse.amountOut, 77n);
}

{
  const { adapter, market } = await prepare({ sellableTokens: 100n });
  const entry = await adapter.quoteEntry({
    launch,
    market,
    decisionBlock: 120n,
    decisionBlockHash: decisionHash,
    notionalUsdMicros: 1_000_000n,
    amountIn: 100n
  });
  assert.equal(entry.executable, true);
  assert.equal(entry.amountOut, 100n);
  assert.equal(entry.amountIn, 12n, 'partial fill must record actual spent input after refund');
  assert.equal(entry.sourceAuthority.payload.partialFill, true);
  assert.equal(entry.sourceAuthority.payload.amountInRequested, '100');
}

{
  const { adapter, market } = await prepare({ snipeTaxBps: 9900n });
  const entry = await adapter.quoteEntry({
    launch,
    market,
    decisionBlock: 120n,
    decisionBlockHash: decisionHash,
    notionalUsdMicros: 1_000_000n,
    amountIn: 100n
  });
  assert.equal(entry.executable, true);
  assert.equal(entry.sourceAuthority.payload.snipeTaxAmount, '96', 'snipe tax must clamp to leave 1% net headroom');
}

{
  const { adapter, market } = await prepare({ trackedQuote: 1n });
  const reverse = await adapter.quoteIndependentReverse({
    launch,
    market,
    decisionBlock: 120n,
    decisionBlockHash: decisionHash,
    notionalUsdMicros: 1_000_000n,
    amountIn: 850n
  });
  assert.equal(reverse.executable, false);
  assert.equal(reverse.amountOut, 0n);
  assert.equal(reverse.failureReason, 'PONS_V2_CURVE_INSUFFICIENT_REAL_QUOTE');
}

await assert.rejects(
  async () => {
    const { adapter, market } = await prepare({ snipeTaxExempt: true });
    return adapter.quoteEntry({
      launch, market, decisionBlock: 120n, decisionBlockHash: decisionHash,
      notionalUsdMicros: 1_000_000n, amountIn: 100n
    });
  },
  /PONS_V2_QUOTE_SHADOW_RECIPIENT_EXEMPT/
);

await assert.rejects(
  () => prepare({ configuredLaunchDeployer: '0x9999999999999999999999999999999999999999' }),
  /PONS_V2_QUOTE_FACTORY_LAUNCH_DEPLOYER_MISMATCH/
);

await assert.rejects(
  () => prepare({ deployerCode: '0x6004600055' }),
  /PONS_V2_CURVE_TEMPLATE_CODE_HASH_DRIFT/
);

await assert.rejects(
  () => prepare({ pairToken: '0x5555555555555555555555555555555555555555' }),
  /PONS_V2_MARKET_LAUNCH_RECORD_MISMATCH:PAIR_TOKEN/
);

{
  const stable = await prepare();
  const reorgClient = makeClient({ blockHashSequence: [decisionHash, decisionHash, decisionHash, `0x${'dd'.repeat(32)}`] });
  const adapter = new ViemPonsV2CurveQuoteAdapter({ authority, templateAuthority, client: reorgClient });
  await assert.rejects(
    () => adapter.quoteEntry({
      launch,
      market: stable.market,
      decisionBlock: 120n,
      decisionBlockHash: decisionHash,
      notionalUsdMicros: 1_000_000n,
      amountIn: 100n
    }),
    /PONS_V2_QUOTE_REORG_DURING_READ|PONS_V2_QUOTE_DECISION_HASH_MISMATCH/
  );
}

console.log(JSON.stringify({
  verdict: 'PONS_V2_CURVE_QUOTE_AUTHORITY_PASS',
  mode: 'SHADOW_ONLY',
  nativePairOnly: true,
  templateAuthorityPinned: true,
  syntheticNonExemptRecipient: true,
  partialFillSpentInputPreserved: true,
  independentReverseSameState: true,
  liveMoneyAuthority: false
}, null, 2));
