import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createPublicClient,
  defineChain,
  http
} from 'viem';
import {
  CREATOR_OUTCOME_HORIZON_MS,
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  DEFAULT_ROBINHOOD_RPC_URL,
  FORWARD_OUTCOMES_R1,
  ViemPonsV2CreatorHistoryAdapter,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPortableBaselineBatch,
  buildPortableForwardOutcome,
  buildShadowPolicyComparisonReceipt,
  projectCreatorOutcomeFeatures
} from '../dist/index.js';

const archiveRpcUrl =
  process.env.ROBINHOOD_ARCHIVE_RPC_URL ??
  'https://rpc.nodeflare.app/robinhood/public';
const logRpcUrl =
  process.env.ROBINHOOD_LOG_RPC_URL ??
  DEFAULT_ROBINHOOD_RPC_URL;
const minRpcIntervalMs = Number(
  process.env.PONS_REAL_RPC_MIN_INTERVAL_MS ?? '1500'
);
assert.ok(
  Number.isSafeInteger(minRpcIntervalMs) && minRpcIntervalMs >= 500,
  'PONS_REAL_RPC_MIN_INTERVAL_MS must be an integer >= 500'
);

const priorLaunchBlock = 64_935_682n;
const priorDecisionBlock = 64_935_684n;
const priorCurve =
  '0x918cc3734621d966995d2663dcf587ce0d4768fc';

const handoff = JSON.parse(
  await readFile(
    'evidence/robinhood/pons/m2f-hmn-fast-vet-baseline.json',
    'utf8'
  )
);
assert.equal(handoff.schema, 'SENTRY_PORTABLE_FAST_VET_BASELINE_RECEIPT/1.0');
assert.equal(handoff.chainId, 4663);
assert.equal(handoff.ecosystem, 'ROBINHOOD');
assert.equal(handoff.launchProtocol, 'PONS');

const hmnBaseline = {
  baselineId: handoff.baseline.baselineId,
  authorityDigest: handoff.baseline.authorityDigest,
  launchId: handoff.baseline.launchId,
  policyVersion: handoff.baseline.policyVersion,
  decisionBlock: BigInt(handoff.baseline.decisionBlock),
  decisionBlockHash: handoff.baseline.decisionBlockHash.toLowerCase(),
  status: handoff.baseline.status,
  reverseSemantics: handoff.baseline.reverseSemantics,
  legs: handoff.baseline.legs.map((leg) => ({
    notionalUsdMicros: BigInt(leg.notionalUsdMicros),
    entry: { executable: Boolean(leg.entry.executable) },
    reverse: leg.reverse
      ? { executable: Boolean(leg.reverse.executable) }
      : null,
    independentReverseRecoveryBps:
      leg.independentReverseRecoveryBps === null
        ? null
        : BigInt(leg.independentReverseRecoveryBps)
  }))
};

const hmnTarget = {
  chainId: handoff.chainId,
  ecosystem: handoff.ecosystem,
  launchProtocol: handoff.launchProtocol,
  launchId: handoff.launch.launchId,
  eventId: handoff.launch.eventId,
  factory: CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(),
  txHash: handoff.launch.txHash.toLowerCase(),
  blockNumber: BigInt(handoff.launch.blockNumber),
  blockHash: handoff.launch.blockHash.toLowerCase(),
  logIndex: handoff.launch.logIndex,
  token: handoff.launch.token.toLowerCase(),
  creator: handoff.launch.creator.toLowerCase(),
  name: handoff.launch.name,
  symbol: handoff.launch.symbol,
  sourceEventName: 'TokenLaunched',
  observedAtMs: Date.parse(handoff.source.capturedAt),
  sourceAuthority: {
    schema: 'M2F_IMMUTABLE_FAST_VET_HANDOFF_R1',
    payload: {
      workflow: handoff.source.workflow,
      runId: handoff.source.runId,
      headSha: handoff.source.headSha,
      curve: handoff.launch.curve.toLowerCase(),
      pairToken: handoff.launch.pairToken.toLowerCase()
    }
  }
};

assert.equal(hmnTarget.creator, '0x09ee8fd79fb4a780a01038a88cedbca6d68b3fe4');
assert.equal(hmnBaseline.decisionBlock, 65_808_786n);
assert.equal(hmnBaseline.status, 'COMPLETE');

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [archiveRpcUrl] } }
});

const rawStateClient = createPublicClient({
  chain: robinhood,
  transport: http(archiveRpcUrl, {
    retryCount: 4,
    retryDelay: 3000,
    fetchOptions: {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; SentryForensicGate/0.7; +https://github.com/CipherCuttle/sentry-forensic-gate)',
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    }
  })
});
const stateClient = pacedClient(rawStateClient, minRpcIntervalMs);

const rawLogsClient = createPublicClient({
  chain: robinhood,
  transport: http(logRpcUrl, {
    retryCount: 4,
    retryDelay: 2500
  })
});
const logsClient = pacedClient(rawLogsClient, minRpcIntervalMs);

const launchAdapter = new ViemPonsV2LaunchAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  client: stateClient
});
const quoteAdapter = new ViemPonsV2CurveQuoteAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  templateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  client: stateClient
});
const usdAdapter = new ViemRobinhoodUsdCalibrationAdapter({
  authority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  client: stateClient
});
const forwardAdapter = new ViemPonsV2ForwardOutcomeAdapter({
  ponsAuthority: CURRENT_PONS_V2_AUTHORITY,
  curveTemplateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  usdAuthority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  outcomeAuthority: CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  client: stateClient
});

const priorLaunches = await launchAdapter.catchUp(
  priorLaunchBlock,
  priorLaunchBlock
);
const priorMatches = priorLaunches.filter((launch) => {
  const payload = launch.sourceAuthority?.payload;
  const curve =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? String(payload.curve ?? '').toLowerCase()
      : '';
  return (
    launch.creator.toLowerCase() === hmnTarget.creator &&
    curve === priorCurve
  );
});
assert.equal(
  priorMatches.length,
  1,
  `M2H_E_PRIOR_LAUNCH_CARDINALITY:${priorMatches.length}`
);
const priorLaunch = priorMatches[0];

const priorBaseline = await buildPortableBaselineBatch(
  {
    launch: launchAdapter,
    marketQuotes: quoteAdapter,
    usdCalibration: usdAdapter
  },
  priorLaunch
);
assert.equal(priorBaseline.decisionBlock, priorDecisionBlock);
assert.equal(
  priorBaseline.status,
  'COMPLETE',
  `M2H_E_PRIOR_BASELINE_NOT_COMPLETE:${priorBaseline.reason ?? 'unknown'}`
);

const hmnDecisionPoint = await forwardAdapter.getBlockPoint(
  hmnBaseline.decisionBlock
);
assert.equal(
  hmnDecisionPoint.blockHash.toLowerCase(),
  hmnBaseline.decisionBlockHash
);

const priorOutcome = await buildPortableForwardOutcome(
  forwardAdapter,
  priorLaunch,
  priorBaseline,
  CREATOR_OUTCOME_HORIZON_MS,
  hmnDecisionPoint
);
assert.ok(priorOutcome, 'M2H_E_PRIOR_24H_OUTCOME_NOT_MATURE_BY_HMN_DECISION');
assert.ok(
  priorOutcome.observedBlock <= hmnBaseline.decisionBlock,
  'M2H_E_FUTURE_INFORMATION_BREACH'
);

const priorOutcomeReceipt = {
  outcomeId: priorOutcome.outcomeId,
  launchId: priorOutcome.launchId,
  horizonMs: priorOutcome.horizonMs,
  observedBlock: priorOutcome.observedBlock,
  ...(priorOutcome.executableValueUsdMicros !== undefined
    ? { executableValueUsdMicros: priorOutcome.executableValueUsdMicros }
    : {}),
  sellable: priorOutcome.exitExecutable,
  ...(priorOutcome.classification !== undefined
    ? { classification: priorOutcome.classification }
    : {}),
  policyVersion: FORWARD_OUTCOMES_R1,
  status: priorOutcome.status,
  ...(priorOutcome.reason ? { reason: priorOutcome.reason } : {}),
  observedBlockHash: priorOutcome.observedBlockHash,
  targetTimestampMs: priorOutcome.targetTimestampMs,
  observedTimestampMs: priorOutcome.observedTimestampMs,
  baselineId: priorOutcome.baselineId,
  entryNotionalUsdMicros: priorOutcome.entryNotionalUsdMicros,
  baseToken: priorOutcome.baseAsset,
  baseAmountOut: priorOutcome.baseAmountOut,
  ...(priorOutcome.executableReturnBps !== undefined
    ? { executableReturnBps: priorOutcome.executableReturnBps }
    : {}),
  evidenceDigest: priorOutcome.authorityDigest
};

const historyAdapter = new ViemPonsV2CreatorHistoryAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  client: stateClient,
  logsClient
});
const creatorHistory = await historyAdapter.scan({
  target: hmnTarget,
  decisionBlock: hmnBaseline.decisionBlock,
  decisionBlockHash: hmnBaseline.decisionBlockHash
});

assert.ok(
  creatorHistory.priorFacts.some(
    (fact) => fact.launchId === priorLaunch.launchId
  ),
  'M2H_E_PRIOR_FACT_NOT_IN_HMN_CREATOR_HISTORY'
);

const creatorReceipts = await projectCreatorOutcomeFeatures(
  [{
    baselineId: hmnBaseline.baselineId,
    authorityDigest: hmnBaseline.authorityDigest,
    launchId: hmnBaseline.launchId,
    decisionBlock: hmnBaseline.decisionBlock,
    decisionBlockHash: hmnBaseline.decisionBlockHash,
    status: hmnBaseline.status
  }],
  [creatorHistory.targetFact, ...creatorHistory.priorFacts],
  [priorOutcomeReceipt]
);
assert.equal(creatorReceipts.length, 1);
const creatorFeature = creatorReceipts[0];

const comparison = await buildShadowPolicyComparisonReceipt({
  launchId: hmnBaseline.launchId,
  baseline: hmnBaseline,
  creatorFeature
});

const result = {
  verdict: 'M2H_E_REAL_PONS_24H_POLICY_COMPARISON',
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  transport: {
    archive: 'NODEFLARE_PUBLIC_M2H_D_CAPABILITY_PASS',
    archiveCapabilityRunId: 35387747266,
    logTransport: 'ROBINHOOD_PUBLIC_READ_ONLY',
    minRpcIntervalMs
  },
  prior: {
    launch: {
      launchId: priorLaunch.launchId,
      eventId: priorLaunch.eventId,
      token: priorLaunch.token,
      creator: priorLaunch.creator,
      blockNumber: priorLaunch.blockNumber,
      blockHash: priorLaunch.blockHash,
      decisionBlock: priorBaseline.decisionBlock,
      decisionBlockHash: priorBaseline.decisionBlockHash
    },
    baseline: {
      baselineId: priorBaseline.baselineId,
      authorityDigest: priorBaseline.authorityDigest,
      status: priorBaseline.status
    },
    outcome24h: priorOutcome
  },
  hmn: {
    launchId: hmnTarget.launchId,
    token: hmnTarget.token,
    creator: hmnTarget.creator,
    decisionBlock: hmnBaseline.decisionBlock,
    decisionBlockHash: hmnBaseline.decisionBlockHash,
    creatorHistory: {
      coverage: creatorFeature.coverage,
      priorLaunchCount: creatorFeature.priorLaunchCount,
      outcomeReceiptCount: creatorFeature.outcomeReceiptCount,
      classifiedOutcomeCount: creatorFeature.classifiedOutcomeCount,
      unresolvedOutcomeCount: creatorFeature.unresolvedOutcomeCount,
      catastrophicLossCount: creatorFeature.catastrophicLossCount,
      exitFailureCount: creatorFeature.exitFailureCount,
      liquidityCollapseCount: creatorFeature.liquidityCollapseCount,
      normalLossCount: creatorFeature.normalLossCount,
      normalWinCount: creatorFeature.normalWinCount,
      sourceOutcomeIds: creatorFeature.sourceOutcomeIds
    },
    comparison
  },
  boundaries: {
    wallet: false,
    signer: false,
    approvals: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoney: false,
    futureInformation: false
  }
};

console.log(JSON.stringify(jsonSafe(result), null, 2));

function pacedClient(rawClient, minIntervalMs) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;
  const pacedMethods = new Set([
    'getChainId',
    'getBlockNumber',
    'getBlock',
    'getBytecode',
    'getLogs',
    'readContract',
    'getStorageAt',
    'call'
  ]);

  const paced = (operation) => {
    const run = tail.then(async () => {
      const waitMs = Math.max(
        0,
        lastStartedAt + minIntervalMs - Date.now()
      );
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
        typeof property !== 'string' ||
        !pacedMethods.has(property)
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
