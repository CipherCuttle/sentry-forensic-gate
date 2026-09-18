import { createPublicClient, defineChain, http } from 'viem';
import assert from 'node:assert/strict';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPortableBaselineBatch,
  evaluatePortableFastVet
} from '../dist/index.js';

const launchBlock = BigInt(process.env.PONS_SMOKE_BLOCK ?? '65808784');
const expectedToken =
  (process.env.PONS_SMOKE_TOKEN ?? '0x633d3b4CCe2E3cD2e6D7588186cEEd26a634147D').toLowerCase();
const archiveRpcUrl = process.env.ROBINHOOD_ARCHIVE_RPC_URL;
assert.ok(
  archiveRpcUrl,
  'ROBINHOOD_ARCHIVE_RPC_URL is required; the public Robinhood RPC is pruned and cannot prove the frozen decision block'
);
const minRpcIntervalMs = Number(process.env.PONS_SMOKE_RPC_MIN_INTERVAL_MS ?? '750');
assert.ok(
  Number.isSafeInteger(minRpcIntervalMs) && minRpcIntervalMs >= 100,
  'PONS_SMOKE_RPC_MIN_INTERVAL_MS must be an integer >= 100'
);

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [archiveRpcUrl] } }
});
const rawClient = createPublicClient({
  chain: robinhood,
  transport: http(archiveRpcUrl, { retryCount: 2, retryDelay: 1500 })
});
const client = pacedClient(rawClient, minRpcIntervalMs);

const launchAdapter = new ViemPonsV2LaunchAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  client
});
const quoteAdapter = new ViemPonsV2CurveQuoteAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  templateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  client
});
const usdAdapter = new ViemRobinhoodUsdCalibrationAdapter({
  authority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  client
});

const launches = await launchAdapter.catchUp(launchBlock, launchBlock);
const launch = launches.find((item) => item.token.toLowerCase() === expectedToken);
assert.ok(launch, `PONS_LIVE_SMOKE_TOKEN_NOT_FOUND:${expectedToken}:block=${launchBlock}`);

const launchAuthority = launch.sourceAuthority?.payload;
assert.ok(launchAuthority && typeof launchAuthority === 'object' && !Array.isArray(launchAuthority));
assert.equal(
  String(launchAuthority.pairToken).toLowerCase(),
  PONS_V2_NATIVE_PAIR_TOKEN.toLowerCase(),
  'live smoke candidate must use the reviewed native-ETH pair path'
);

const baseline = await buildPortableBaselineBatch(
  {
    launch: launchAdapter,
    marketQuotes: quoteAdapter,
    usdCalibration: usdAdapter
  },
  launch
);

const vet = evaluatePortableFastVet({
  baseline,
  creatorFeature: null
});

assert.equal(
  vet.decision,
  'UNKNOWN',
  'missing real creator-history evidence must not produce PASS/REJECT by invention'
);
assert.ok(
  vet.reasons.includes('CREATOR_FEATURE_MISSING') || vet.reasons.includes('BASELINE_UNVERIFIED'),
  `unexpected FAST_VET reason set: ${vet.reasons.join(',')}`
);

const receipt = {
  verdict: baseline.status === 'COMPLETE'
    ? 'PONS_V2_LIVE_SHADOW_BASELINE_COMPLETE'
    : 'PONS_V2_LIVE_SHADOW_BASELINE_UNVERIFIED',
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  launch: {
    launchId: launch.launchId,
    eventId: launch.eventId,
    token: launch.token,
    creator: launch.creator,
    name: launch.name,
    symbol: launch.symbol,
    blockNumber: launch.blockNumber,
    blockHash: launch.blockHash,
    txHash: launch.txHash,
    pairToken: launchAuthority.pairToken,
    curve: launchAuthority.curve
  },
  baseline: {
    baselineId: baseline.baselineId,
    authorityDigest: baseline.authorityDigest,
    policyVersion: baseline.policyVersion,
    decisionBlock: baseline.decisionBlock,
    decisionBlockHash: baseline.decisionBlockHash,
    status: baseline.status,
    reason: baseline.reason ?? null,
    reverseSemantics: baseline.reverseSemantics,
    market: baseline.market
      ? {
          marketId: baseline.market.marketId,
          venue: baseline.market.venue,
          baseAsset: baseline.market.baseAsset
        }
      : null,
    legs: baseline.legs.map((leg) => ({
      notionalUsdMicros: leg.notionalUsdMicros,
      nativeEthCalibrationWei: leg.calibration.baseAmount,
      entry: {
        executable: leg.entry.executable,
        amountInWei: leg.entry.amountIn,
        tokenAmountOut: leg.entry.amountOut,
        failureReason: leg.entry.failureReason ?? null
      },
      reverse: leg.reverse
        ? {
            executable: leg.reverse.executable,
            tokenAmountIn: leg.reverse.amountIn,
            nativeEthAmountOutWei: leg.reverse.amountOut,
            failureReason: leg.reverse.failureReason ?? null
          }
        : null,
      independentReverseRecoveryBps: leg.independentReverseRecoveryBps
    }))
  },
  fastVet: vet,
  transport: {
    archiveRequired: true,
    endpointClass: 'PUBLIC_ARCHIVE_SMOKE',
    minRpcIntervalMs
  },
  boundaries: {
    wallet: false,
    signer: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoney: false,
    creatorHistoryInvented: false
  }
};

console.log(JSON.stringify(jsonSafe(receipt), null, 2));

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}


function pacedClient(rawClient, minIntervalMs) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;

  const paced = (operation) => {
    const run = tail.then(async () => {
      const waitMs = Math.max(0, lastStartedAt + minIntervalMs - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      lastStartedAt = Date.now();
      return operation();
    });
    tail = run.catch(() => undefined);
    return run;
  };

  return new Proxy(rawClient, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof value !== 'function' ||
        ![
          'getChainId',
          'getBlockNumber',
          'getBlock',
          'getBytecode',
          'getLogs',
          'getStorageAt',
          'readContract',
          'call'
        ].includes(String(property))
      ) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (...args) => paced(() => value.apply(target, args));
    }
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
