import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  http
} from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ponsV2TokenLaunchedEvent,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPortableBaselineBatch,
  buildPortableForwardOutcome,
  buildShadowPolicyComparisonReceipt
} from '../dist/index.js';

const launchBlock = BigInt(process.env.PONS_X17Z_LAUNCH_BLOCK ?? '64935682');
const expectedCurve = norm(
  process.env.PONS_X17Z_CURVE ??
    '0x918cc3734621d966995d2663dcf587ce0d4768fc'
);
const expectedCreator = norm(
  process.env.PONS_X17Z_CREATOR ??
    '0x09ee8fd79fb4a780a01038a88cedbca6d68b3fe4'
);
const horizonMs = Number(process.env.PONS_X17Z_HORIZON_MS ?? '86400000');
const rpcUrl = process.env.ROBINHOOD_ARCHIVE_RPC_URL;
const indexedLogPath =
  process.env.PONS_X17Z_INDEXED_LOG ??
  'artifacts/m2i-x17z/launch-log.json';
const minRpcIntervalMs = Number(process.env.PONS_RPC_MIN_INTERVAL_MS ?? '2200');

assert.ok(rpcUrl, 'ROBINHOOD_ARCHIVE_RPC_URL is required');
assert.ok(Number.isSafeInteger(horizonMs) && horizonMs > 0, 'invalid horizon');
assert.ok(
  Number.isSafeInteger(minRpcIntervalMs) && minRpcIntervalMs >= 500,
  'PONS_RPC_MIN_INTERVAL_MS must be >= 500'
);

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});
const rawClient = createPublicClient({
  chain: robinhood,
  transport: http(rpcUrl, {
    retryCount: 5,
    retryDelay: 3000,
    fetchOptions: {
      headers: {
        'user-agent':
          'Mozilla/5.0 (compatible; SentryForensicGate/0.7; +https://github.com/CipherCuttle/sentry-forensic-gate)',
        accept: 'application/json',
        referer: 'https://rpc.nodeflare.app/'
      }
    }
  })
});
const chainClient = pacedClient(rawClient, minRpcIntervalMs);

const indexed = JSON.parse(await readFile(indexedLogPath, 'utf8'));
assert.ok(indexed && typeof indexed === 'object', 'indexed log envelope missing');
assert.equal(String(indexed.status), '1', `Blockscout status=${indexed.status}`);
assert.ok(Array.isArray(indexed.result), 'Blockscout result must be an array');
assert.ok(indexed.result.length > 0, 'PONS_X17Z_INDEXED_EVENT_MISSING');

const decodedCandidates = [];
for (const raw of indexed.result) {
  if (!raw || typeof raw !== 'object') continue;
  if (!Array.isArray(raw.topics) || typeof raw.data !== 'string') continue;
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: [ponsV2TokenLaunchedEvent],
      data: raw.data,
      topics: raw.topics,
      strict: true
    });
  } catch {
    continue;
  }
  const args = decoded.args;
  if (
    norm(String(args.curve)) === expectedCurve &&
    norm(String(args.deployer)) === expectedCreator &&
    BigInt(raw.blockNumber) === launchBlock
  ) {
    decodedCandidates.push({ raw, args });
  }
}
assert.equal(
  decodedCandidates.length,
  1,
  `PONS_X17Z_EVENT_CARDINALITY:${decodedCandidates.length}`
);

const selected = decodedCandidates[0];
const launchPoint = await chainClient.getBlock({ blockNumber: launchBlock });
assert.ok(launchPoint.hash, 'PONS_X17Z_LAUNCH_BLOCK_HASH_MISSING');
const frozenLog = {
  address: CURRENT_PONS_V2_AUTHORITY.factory,
  blockNumber: launchBlock,
  blockHash: launchPoint.hash,
  transactionHash: selected.raw.transactionHash,
  logIndex: Number(BigInt(selected.raw.logIndex)),
  args: selected.args
};
assert.match(frozenLog.transactionHash, /^0x[0-9a-fA-F]{64}$/);
assert.ok(Number.isSafeInteger(frozenLog.logIndex) && frozenLog.logIndex >= 0);

const launchClient = clientWithFrozenLaunchLog(
  chainClient,
  launchBlock,
  frozenLog
);
const launchAdapter = new ViemPonsV2LaunchAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  client: launchClient
});
const quoteAdapter = new ViemPonsV2CurveQuoteAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  templateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  client: chainClient
});
const usdAdapter = new ViemRobinhoodUsdCalibrationAdapter({
  authority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  client: chainClient
});
const forwardAdapter = new ViemPonsV2ForwardOutcomeAdapter({
  ponsAuthority: CURRENT_PONS_V2_AUTHORITY,
  curveTemplateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  usdAuthority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  outcomeAuthority: CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  client: chainClient
});

const launches = await launchAdapter.catchUp(launchBlock, launchBlock);
assert.equal(launches.length, 1, `PONS_X17Z_LAUNCH_CARDINALITY:${launches.length}`);
const launch = launches[0];
assert.equal(norm(launch.creator), expectedCreator);
const launchAuthority = launch.sourceAuthority?.payload;
assert.ok(
  launchAuthority &&
    typeof launchAuthority === 'object' &&
    !Array.isArray(launchAuthority),
  'PONS_X17Z_LAUNCH_AUTHORITY_MALFORMED'
);
assert.equal(norm(String(launchAuthority.curve)), expectedCurve);
assert.equal(
  norm(String(launchAuthority.pairToken)),
  norm(PONS_V2_NATIVE_PAIR_TOKEN),
  'PONS_X17Z_NON_NATIVE_PAIR'
);

const baseline = await buildPortableBaselineBatch(
  {
    launch: launchAdapter,
    marketQuotes: quoteAdapter,
    usdCalibration: usdAdapter
  },
  launch
);
assert.equal(
  baseline.status,
  'COMPLETE',
  `PONS_X17Z_BASELINE_NOT_COMPLETE:${baseline.reason ?? 'UNKNOWN'}`
);

// Freeze all policy decisions before any forward-outcome read.
const policyComparison = await buildShadowPolicyComparisonReceipt({
  launchId: launch.launchId,
  baseline,
  creatorFeature: null
});
assert.equal(policyComparison.receipts.r0.hypotheticalAction, 'WOULD_SKIP');
assert.equal(policyComparison.receipts.r1.hypotheticalAction, 'WOULD_TRADE');
assert.equal(
  policyComparison.receipts.buyEveryExecutableControl.hypotheticalAction,
  'WOULD_TRADE'
);

const head = await forwardAdapter.getHeadBlockNumber();
const confirmationLag = 1000n;
const confirmedBlock = head > confirmationLag ? head - confirmationLag : head;
const confirmedHeadPoint = await forwardAdapter.getBlockPoint(confirmedBlock);
const outcome = await buildPortableForwardOutcome(
  forwardAdapter,
  launch,
  baseline,
  horizonMs,
  confirmedHeadPoint
);
assert.ok(outcome, 'PONS_X17Z_24H_NOT_MATURED');

const grossUsdDeltaMicros =
  outcome.executableValueUsdMicros === undefined
    ? null
    : outcome.executableValueUsdMicros - outcome.entryNotionalUsdMicros;

const receipt = {
  schema: 'SENTRY_PONS_X17Z_REAL_POLICY_OUTCOME/1.0',
  verdict:
    outcome.status === 'COMPLETE'
      ? 'REAL_POLICY_OUTCOME_COMPLETE'
      : 'REAL_POLICY_OUTCOME_UNVERIFIED',
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  launch: {
    launchId: launch.launchId,
    eventId: launch.eventId,
    name: launch.name,
    symbol: launch.symbol,
    token: launch.token,
    creator: launch.creator,
    curve: launchAuthority.curve,
    blockNumber: launch.blockNumber,
    blockHash: launch.blockHash,
    txHash: launch.txHash,
    logIndex: launch.logIndex
  },
  baseline: {
    baselineId: baseline.baselineId,
    authorityDigest: baseline.authorityDigest,
    decisionBlock: baseline.decisionBlock,
    decisionBlockHash: baseline.decisionBlockHash,
    status: baseline.status,
    capacityEvidence: baseline.legs.map((leg) => ({
      notionalUsdMicros: leg.notionalUsdMicros,
      entryExecutable: leg.entry.executable,
      reverseExecutable: Boolean(leg.reverse?.executable),
      independentReverseRecoveryBps: leg.independentReverseRecoveryBps
    }))
  },
  policyComparison,
  outcome: {
    outcomeId: outcome.outcomeId,
    authorityDigest: outcome.authorityDigest,
    horizonMs: outcome.horizonMs,
    status: outcome.status,
    reason: outcome.reason ?? null,
    observedBlock: outcome.observedBlock,
    observedBlockHash: outcome.observedBlockHash,
    targetTimestampMs: outcome.targetTimestampMs,
    observedTimestampMs: outcome.observedTimestampMs,
    entryNotionalUsdMicros: outcome.entryNotionalUsdMicros,
    exitExecutable: outcome.exitExecutable,
    baseAmountOut: outcome.baseAmountOut,
    executableValueUsdMicros: outcome.executableValueUsdMicros ?? null,
    executableReturnBps: outcome.executableReturnBps ?? null,
    grossUsdDeltaMicros,
    classification: outcome.classification ?? null,
    liquidity: outcome.liquidity,
    accountingNote: 'EXECUTABLE_VALUE_BEFORE_GAS;NOT_REALIZED_PNL'
  },
  transport: {
    archiveProviderClass: 'NODEFLARE_PUBLIC_KEYLESS',
    indexedLaunchSource: 'ROBINHOOD_BLOCKSCOUT_EXACT_FACTORY_EVENT',
    minRpcIntervalMs,
    confirmationLagBlocks: confirmationLag
  },
  boundaries: {
    wallet: false,
    signer: false,
    approvals: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoney: false,
    policyTuningAfterOutcome: false
  }
};

console.log(JSON.stringify(jsonSafe(receipt), null, 2));

function clientWithFrozenLaunchLog(client, expectedBlock, log) {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'getLogs') {
        return async ({ fromBlock, toBlock, address }) => {
          assert.equal(fromBlock, expectedBlock, 'FROZEN_LOG_FROM_BLOCK_MISMATCH');
          assert.equal(toBlock, expectedBlock, 'FROZEN_LOG_TO_BLOCK_MISMATCH');
          assert.equal(
            norm(String(address)),
            norm(CURRENT_PONS_V2_AUTHORITY.factory)
          );
          return [log];
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
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

function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)])
    );
  }
  return value;
}

function norm(value) {
  return String(value).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
