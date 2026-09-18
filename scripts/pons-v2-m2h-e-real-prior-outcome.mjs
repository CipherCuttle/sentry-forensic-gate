import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicClient, defineChain, http } from 'viem';
import {
  CREATOR_OUTCOME_HORIZON_MS,
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildNormalizedProvenanceFact,
  buildPortableBaselineBatch,
  buildPortableForwardOutcome,
  buildShadowPolicyComparisonReceipt,
  projectPortableCreatorOutcomeFeature,
  projectPortableOutcomeReceipt
} from '../dist/index.js';

const rpcUrl = process.env.PONS_M2H_E_RPC_URL;
assert.ok(rpcUrl, 'PONS_M2H_E_RPC_URL is required');
const minIntervalMs = Number(process.env.PONS_M2H_E_RPC_MIN_INTERVAL_MS ?? '1000');
assert.ok(
  Number.isSafeInteger(minIntervalMs) && minIntervalMs >= 500,
  'PONS_M2H_E_RPC_MIN_INTERVAL_MS must be an integer >= 500'
);

const priorLaunchBlock = 64_935_682n;
const expectedPriorCurve =
  '0x918cc3734621d966995d2663dcf587ce0d4768fc';
const targetReceipt = JSON.parse(await readFile(
  new URL('../evidence/robinhood/pons/m2f-hmn-fast-vet-baseline.json', import.meta.url),
  'utf8'
));

assert.equal(targetReceipt.schema, 'SENTRY_PORTABLE_FAST_VET_BASELINE_RECEIPT/1.0');
assert.equal(targetReceipt.chainId, 4663);
assert.equal(targetReceipt.ecosystem, 'ROBINHOOD');
assert.equal(targetReceipt.launchProtocol, 'PONS');
assert.equal(targetReceipt.baseline.status, 'COMPLETE');

const robinhood = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});
const rawClient = createPublicClient({
  chain: robinhood,
  transport: http(rpcUrl, { retryCount: 4, retryDelay: 2000 })
});
const client = pacedClient(rawClient, minIntervalMs);

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
const forwardAdapter = new ViemPonsV2ForwardOutcomeAdapter({
  ponsAuthority: CURRENT_PONS_V2_AUTHORITY,
  curveTemplateAuthority: CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  usdAuthority: CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  outcomeAuthority: CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  client
});

const priorLaunches = await launchAdapter.catchUp(priorLaunchBlock, priorLaunchBlock);
const creator = targetReceipt.launch.creator.toLowerCase();
const matchingPrior = priorLaunches.filter((launch) =>
  launch.creator.toLowerCase() === creator &&
  launchCurve(launch) === expectedPriorCurve
);
assert.equal(
  matchingPrior.length,
  1,
  `PONS_M2H_E_PRIOR_CARDINALITY:${matchingPrior.length}`
);
const priorLaunch = matchingPrior[0];

const priorBaseline = await buildPortableBaselineBatch(
  {
    launch: launchAdapter,
    marketQuotes: quoteAdapter,
    usdCalibration: usdAdapter
  },
  priorLaunch
);

let portableOutcome = null;
let projectedOutcome = null;
if (priorBaseline.status === 'COMPLETE') {
  const headBlock = await forwardAdapter.getHeadBlockNumber();
  const confirmedHead = await forwardAdapter.getBlockPoint(headBlock);
  portableOutcome = await buildPortableForwardOutcome(
    forwardAdapter,
    priorLaunch,
    priorBaseline,
    CREATOR_OUTCOME_HORIZON_MS,
    confirmedHead
  );
  if (portableOutcome) {
    projectedOutcome = await projectPortableOutcomeReceipt(portableOutcome);
  }
}

const targetFact = await buildNormalizedProvenanceFact({
  chainId: targetReceipt.chainId,
  launchId: targetReceipt.launch.launchId,
  creator: targetReceipt.launch.creator,
  blockNumber: BigInt(targetReceipt.launch.blockNumber),
  blockHash: targetReceipt.launch.blockHash,
  logIndex: targetReceipt.launch.logIndex,
  eventId: targetReceipt.launch.eventId
});
const priorFact = await buildNormalizedProvenanceFact(priorLaunch);

const targetBaseline = {
  baselineId: targetReceipt.baseline.baselineId,
  authorityDigest: targetReceipt.baseline.authorityDigest,
  launchId: targetReceipt.baseline.launchId,
  policyVersion: targetReceipt.baseline.policyVersion,
  decisionBlock: BigInt(targetReceipt.baseline.decisionBlock),
  decisionBlockHash: targetReceipt.baseline.decisionBlockHash,
  observedAtMs: Date.parse(targetReceipt.source.capturedAt),
  status: targetReceipt.baseline.status,
  market: null,
  legs: targetReceipt.baseline.legs.map((leg) => ({
    notionalUsdMicros: BigInt(leg.notionalUsdMicros),
    entry: { executable: Boolean(leg.entry.executable) },
    reverse: leg.reverse
      ? { executable: Boolean(leg.reverse.executable) }
      : null,
    independentReverseRecoveryBps:
      leg.independentReverseRecoveryBps === null
        ? null
        : BigInt(leg.independentReverseRecoveryBps)
  })),
  reverseSemantics: targetReceipt.baseline.reverseSemantics,
  chainId: targetReceipt.chainId,
  ecosystem: targetReceipt.ecosystem,
  launchProtocol: targetReceipt.launchProtocol,
  sourceAuthority: {
    schema: 'IMMUTABLE_M2F_FAST_VET_RECEIPT_R1',
    payload: {
      sourceWorkflow: targetReceipt.source.workflow,
      sourceRunId: targetReceipt.source.runId,
      sourceHeadSha: targetReceipt.source.headSha,
      baselineId: targetReceipt.baseline.baselineId,
      authorityDigest: targetReceipt.baseline.authorityDigest
    }
  }
};

assert.ok(
  priorFact.observedBlock < targetFact.observedBlock,
  'frozen creator prior must precede HMN target'
);
if (projectedOutcome) {
  assert.ok(
    projectedOutcome.observedBlock <= targetBaseline.decisionBlock,
    '24h creator outcome must exist by the HMN decision block'
  );
}

const creatorFeature = await projectPortableCreatorOutcomeFeature(
  targetBaseline,
  targetFact,
  [priorFact],
  projectedOutcome ? [projectedOutcome] : []
);
const comparison = await buildShadowPolicyComparisonReceipt({
  launchId: targetReceipt.launch.launchId,
  baseline: targetBaseline,
  creatorFeature
});

const receipt = {
  schema: 'ROBINHOOD_PONS_M2H_E_REAL_CREATOR_OUTCOME/1.0',
  verdict: portableOutcome?.status === 'COMPLETE' && portableOutcome.classification
    ? 'REAL_PRIOR_24H_OUTCOME_CLASSIFIED'
    : 'REAL_PRIOR_24H_OUTCOME_UNVERIFIED',
  mode: 'SHADOW_ONLY',
  edge: 'UNPROVEN',
  transport: {
    providerClass: 'NODEFLARE_PUBLIC_ARCHIVE',
    credentialRequired: false,
    minRpcIntervalMs
  },
  target: {
    launchId: targetReceipt.launch.launchId,
    token: targetReceipt.launch.token,
    creator: targetReceipt.launch.creator,
    decisionBlock: targetBaseline.decisionBlock,
    baselineId: targetBaseline.baselineId
  },
  prior: {
    launchId: priorLaunch.launchId,
    eventId: priorLaunch.eventId,
    token: priorLaunch.token,
    creator: priorLaunch.creator,
    blockNumber: priorLaunch.blockNumber,
    blockHash: priorLaunch.blockHash,
    curve: launchCurve(priorLaunch),
    baseline: {
      baselineId: priorBaseline.baselineId,
      authorityDigest: priorBaseline.authorityDigest,
      decisionBlock: priorBaseline.decisionBlock,
      decisionBlockHash: priorBaseline.decisionBlockHash,
      status: priorBaseline.status,
      reason: priorBaseline.reason ?? null,
      legs: priorBaseline.legs.map((leg) => ({
        notionalUsdMicros: leg.notionalUsdMicros,
        entryExecutable: leg.entry.executable,
        reverseExecutable: leg.reverse?.executable ?? false,
        independentReverseRecoveryBps: leg.independentReverseRecoveryBps
      }))
    }
  },
  outcome: portableOutcome,
  projectedOutcome,
  creatorFeature,
  policyComparison: comparison,
  boundaries: {
    wallet: false,
    signer: false,
    approvals: false,
    transactionConstruction: false,
    broadcast: false,
    liveMoney: false,
    robinhoodLiveAuthority: false,
    arcLiveAuthority: false
  }
};

console.log(JSON.stringify(jsonSafe(receipt), null, 2));

function launchCurve(launch) {
  const payload = launch.sourceAuthority?.payload;
  assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload));
  const curve = String(payload.curve ?? '').toLowerCase();
  assert.match(curve, /^0x[0-9a-f]{40}$/);
  return curve;
}

function pacedClient(rawClient, intervalMs) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;
  const paced = (operation) => {
    const run = tail.then(async () => {
      const waitMs = Math.max(0, lastStartedAt + intervalMs - Date.now());
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
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
