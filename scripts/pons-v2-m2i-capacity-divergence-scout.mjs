import assert from 'node:assert/strict';
import { createPublicClient, defineChain, http } from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPortableBaselineBatch,
  buildShadowPolicyComparisonReceipt,
  ponsV2TokenLaunchedEvent,
  sha256Hex
} from '../dist/index.js';

const rpcUrl = process.env.PONS_M2I_RPC_URL ??
  'https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public';
const scanBackBlocks = BigInt(process.env.PONS_M2I_SCAN_BACK_BLOCKS ?? '30000');
const maxCandidates = Number(process.env.PONS_M2I_MAX_CANDIDATES ?? '12');
const minRpcIntervalMs = Number(process.env.PONS_M2I_RPC_MIN_INTERVAL_MS ?? '750');

assert.ok(scanBackBlocks > 0n, 'PONS_M2I_SCAN_BACK_BLOCKS must be positive');
assert.ok(Number.isSafeInteger(maxCandidates) && maxCandidates >= 1 && maxCandidates <= 50);
assert.ok(Number.isSafeInteger(minRpcIntervalMs) && minRpcIntervalMs >= 100);

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});
const rawClient = createPublicClient({
  chain: robinhood,
  transport: http(rpcUrl, { retryCount: 2, retryDelay: 1500 })
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

const headBlock = await client.getBlockNumber();
const head = await client.getBlock({ blockNumber: headBlock });
assert.ok(head.hash, 'M2I_HEAD_HASH_MISSING');
const fromBlock = headBlock > scanBackBlocks
  ? headBlock - scanBackBlocks
  : CURRENT_PONS_V2_AUTHORITY.fromBlock;
const boundedFromBlock = fromBlock < CURRENT_PONS_V2_AUTHORITY.fromBlock
  ? CURRENT_PONS_V2_AUTHORITY.fromBlock
  : fromBlock;

await launchAdapter.assertAuthority(boundedFromBlock);
await launchAdapter.assertAuthority(headBlock);

const logChunkBlocks = 5_000n;
const logs = [];
for (
  let chunkFrom = boundedFromBlock;
  chunkFrom <= headBlock;
  chunkFrom += logChunkBlocks
) {
  const candidateTo = chunkFrom + logChunkBlocks - 1n;
  const chunkTo = candidateTo < headBlock ? candidateTo : headBlock;
  const chunk = await client.getLogs({
    address: CURRENT_PONS_V2_AUTHORITY.factory,
    event: ponsV2TokenLaunchedEvent,
    fromBlock: chunkFrom,
    toBlock: chunkTo,
    strict: true
  });
  logs.push(...chunk);
}

const orderedLogs = [...logs]
  .filter((log) =>
    log.blockNumber !== null &&
    log.logIndex !== null &&
    log.args?.token &&
    log.args?.pairToken?.toLowerCase() === PONS_V2_NATIVE_PAIR_TOKEN.toLowerCase()
  )
  .sort((a, b) => {
    if (a.blockNumber < b.blockNumber) return -1;
    if (a.blockNumber > b.blockNumber) return 1;
    return a.logIndex - b.logIndex;
  });

const selectionRule = {
  version: 'ROBINHOOD_PONS_M2I_CAPACITY_DIVERGENCE_SCOUT/1.0',
  scanBackBlocks: scanBackBlocks.toString(),
  maxCandidates,
  order: 'OLDEST_FIRST',
  requireNativePair: true,
  requireOutcomeUnmaturedAtSelection: true,
  requireR0PrimaryFailure: true,
  requireR1Trade: true,
  requireControlTrade: true,
  creatorEvidenceAtSelection: 'INTENTIONALLY_NULL_TO_ISOLATE_CAPACITY_DIVERGENCE',
  mode: 'SHADOW_ONLY',
  liveMoneyAuthority: false
};
const selectionRuleDigest = await sha256Hex(selectionRule);

const checks = [];
let selected = null;

for (const log of orderedLogs) {
  if (checks.length >= maxCandidates || selected) break;
  assert.ok(log.blockNumber !== null && log.logIndex !== null, 'M2I_FILTERED_LOG_INCOMPLETE');
  const launchBlock = log.blockNumber;
  const decisionBlock = launchBlock + 2n;
  if (decisionBlock > headBlock) continue;

  const launchBlockPoint = await client.getBlock({ blockNumber: launchBlock });
  const targetTimestampSec = launchBlockPoint.timestamp + 86_400n;
  if (targetTimestampSec <= head.timestamp) {
    continue;
  }

  const launchesAtBlock = await launchAdapter.catchUp(launchBlock, launchBlock);
  const expectedToken = String(log.args.token).toLowerCase();
  const launch = launchesAtBlock.find((item) =>
    item.token.toLowerCase() === expectedToken &&
    item.logIndex === log.logIndex
  );
  assert.ok(
    launch,
    `M2I_DISCOVERY_MATERIALIZATION_MISMATCH:block=${launchBlock}:log=${log.logIndex}`
  );

  const baseline = await buildPortableBaselineBatch(
    {
      launch: launchAdapter,
      marketQuotes: quoteAdapter,
      usdCalibration: usdAdapter
    },
    launch
  );

  const comparison = await buildShadowPolicyComparisonReceipt({
    launchId: launch.launchId,
    baseline,
    creatorFeature: null
  });

  const r0 = comparison.receipts.r0;
  const r1 = comparison.receipts.r1;
  const control = comparison.receipts.buyEveryExecutableControl;
  const primaryFailure =
    r0.reasons.includes('PRIMARY_ENTRY_NOT_EXECUTABLE') ||
    r0.reasons.includes('PRIMARY_REVERSE_NOT_EXECUTABLE');
  const match =
    baseline.status === 'COMPLETE' &&
    r0.hypotheticalAction === 'WOULD_SKIP' &&
    primaryFailure &&
    r1.hypotheticalAction === 'WOULD_TRADE' &&
    control.hypotheticalAction === 'WOULD_TRADE' &&
    r1.capacityUsdMicros !== null &&
    BigInt(r1.capacityUsdMicros) < 1_000_000n;

  checks.push({
    launchId: launch.launchId,
    blockNumber: launch.blockNumber,
    token: launch.token,
    creator: launch.creator,
    baselineId: baseline.baselineId,
    baselineStatus: baseline.status,
    targetTimestampMs: Number(targetTimestampSec * 1000n),
    r0Decision: r0.decision,
    r0Action: r0.hypotheticalAction,
    r0Reasons: r0.reasons,
    r1Decision: r1.decision,
    r1Action: r1.hypotheticalAction,
    r1CapacityUsdMicros: r1.capacityUsdMicros,
    r1Uncertainties: r1.uncertainties,
    controlAction: control.hypotheticalAction,
    match
  });

  if (match) {
    selected = {
      launch,
      baseline,
      policyComparison: comparison,
      launchTimestampMs: Number(launchBlockPoint.timestamp * 1000n),
      targetTimestampMs: Number(targetTimestampSec * 1000n)
    };
  }
}

const receipt = {
  schema: 'ROBINHOOD_PONS_M2I_CAPACITY_DIVERGENCE_SELECTION/1.0',
  verdict: selected
    ? 'CAPACITY_DIVERGENCE_CANDIDATE_FROZEN'
    : 'NO_CAPACITY_DIVERGENCE_IN_BOUNDED_WINDOW',
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  selection: {
    rule: selectionRule,
    ruleDigest: selectionRuleDigest,
    headBlock,
    headBlockHash: head.hash,
    headTimestampMs: Number(head.timestamp * 1000n),
    fromBlock: boundedFromBlock,
    throughBlock: headBlock,
    discoveredNativeLaunchCount: orderedLogs.length,
    evaluatedCandidateCount: checks.length,
    logChunkBlocks: logChunkBlocks.toString()
  },
  candidateChecks: checks,
  frozenCandidate: selected,
  boundaries: {
    wallet: false,
    signer: false,
    approvals: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoney: false,
    robinhoodLiveAuthority: false,
    arcLiveAuthority: false,
    outcomeObservedDuringSelection: false
  }
};

console.log(JSON.stringify(jsonSafe(receipt), null, 2));

function pacedClient(raw, intervalMs) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;

  const paced = (operation) => {
    const run = tail.then(async () => {
      const waitMs = Math.max(0, lastStartedAt + intervalMs - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      lastStartedAt = Date.now();
      return operation();
    });
    tail = run.catch(() => undefined);
    return run;
  };

  return new Proxy(raw, {
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
