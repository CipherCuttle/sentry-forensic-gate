import assert from 'node:assert/strict';
import {
  FAST_VET_PRIMARY_NOTIONAL_USD_MICROS,
  FAST_VET_R0_CONFIGURATION,
  evaluateFastVet
} from '../dist/evaluation/fastVet.js';
import {
  MULTICHAIN_SHADOW_RESEARCH_AUTHORITY
} from '../dist/multichain/domain.js';
import { evaluatePortableFastVet } from '../dist/multichain/fastVetBridge.js';
import { normalizeInkSentryLaunch } from '../dist/multichain/inkSentryProjection.js';
import { assertAdapterIdentity } from '../dist/multichain/ports.js';
import { DEFAULT_BASELINE_NOTIONALS_USD_MICROS } from '../dist/shadow/baselineTypes.js';

const launch = {
  chainId: 57073,
  blockNumber: 100n,
  blockHash: '0xAABB',
  observedAtMs: 1_789_700_000_000,
  launchId: 'launch-1',
  eventId: 'event-1',
  factory: '0xFACADE',
  txHash: '0xABCDEF',
  logIndex: 7,
  token: '0xBEEF',
  creator: '0xCAFE',
  tokenId: 42n,
  name: 'Portable Test',
  symbol: 'PORT',
  launchType: 'STANDARD',
  sourceEvent: 'TokenDeployed'
};

const normalized = normalizeInkSentryLaunch(launch);
assert.equal(normalized.chainId, 57073);
assert.equal(normalized.ecosystem, 'INK');
assert.equal(normalized.launchProtocol, 'SENTRY');
assert.equal(normalized.sourceEventName, launch.sourceEvent);
assert.equal(normalized.blockHash, launch.blockHash.toLowerCase());
assert.equal(normalized.factory, launch.factory.toLowerCase());
assert.equal(normalized.txHash, launch.txHash.toLowerCase());
assert.equal(normalized.token, launch.token.toLowerCase());
assert.equal(normalized.creator, launch.creator.toLowerCase());
assert.equal(normalized.observedAtMs, launch.observedAtMs);
assert.deepEqual(normalized.sourceAuthority, {
  schema: 'INK_SENTRY_LAUNCH_OBSERVED_V1',
  payload: {
    launchId: launch.launchId,
    eventId: launch.eventId,
    chainId: launch.chainId,
    blockNumber: launch.blockNumber.toString(),
    blockHash: launch.blockHash.toLowerCase(),
    factory: launch.factory.toLowerCase(),
    txHash: launch.txHash.toLowerCase(),
    logIndex: launch.logIndex,
    token: launch.token.toLowerCase(),
    creator: launch.creator.toLowerCase(),
    tokenId: launch.tokenId.toString(),
    name: launch.name,
    symbol: launch.symbol,
    launchType: launch.launchType,
    sourceEvent: launch.sourceEvent
  }
});
assert.equal(Object.hasOwn(normalized.sourceAuthority.payload, 'observedAtMs'), false);
assert.throws(
  () => normalizeInkSentryLaunch({ ...launch, chainId: 1 }),
  /INK_SENTRY_CHAIN_MISMATCH:1/
);

assert.deepEqual(
  [...DEFAULT_BASELINE_NOTIONALS_USD_MICROS],
  [250_000n, 500_000n, 1_000_000n, 2_000_000n, 5_000_000n]
);
assert.equal(FAST_VET_PRIMARY_NOTIONAL_USD_MICROS, 1_000_000n);
assert.equal(FAST_VET_R0_CONFIGURATION.authority, 'SHADOW_RESEARCH_ONLY_EDGE_UNPROVEN');
assert.equal(FAST_VET_R0_CONFIGURATION.requireCompleteBaseline, true);
assert.equal(FAST_VET_R0_CONFIGURATION.requireExecutablePrimaryEntry, true);
assert.equal(FAST_VET_R0_CONFIGURATION.requireExecutablePrimaryReverse, true);

const portableBaseline = {
  baselineId: 'baseline-1',
  authorityDigest: 'baseline-authority-digest',
  launchId: launch.launchId,
  policyVersion: 'EXECUTABLE_BASELINE_R1',
  decisionBlock: 102n,
  decisionBlockHash: '0x1234',
  status: 'COMPLETE',
  legs: DEFAULT_BASELINE_NOTIONALS_USD_MICROS.map((notionalUsdMicros) => ({
    notionalUsdMicros,
    entry: { executable: true },
    reverse: { executable: true },
    independentReverseRecoveryBps: 9_900n
  })),
  reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL'
};

const cleanCreator = {
  launchId: launch.launchId,
  baselineId: portableBaseline.baselineId,
  coverage: 'NO_HISTORY',
  priorLaunchCount: 0,
  catastrophicLossCount: 0,
  exitFailureCount: 0,
  liquidityCollapseCount: 0
};

function assertFrozenParity(baseline, creatorFeature) {
  const portable = evaluatePortableFastVet({ baseline, creatorFeature });
  const frozenDirect = evaluateFastVet({ baseline, creatorFeature });
  assert.deepEqual(portable, frozenDirect);
  return portable;
}

const pass = assertFrozenParity(portableBaseline, cleanCreator);
assert.equal(pass.decision, 'PASS');
assert.equal(pass.action, 'BUY_ELIGIBLE');
assert.deepEqual(pass.reasons, []);

const adverse = assertFrozenParity(
  portableBaseline,
  { ...cleanCreator, coverage: 'COMPLETE', priorLaunchCount: 1, catastrophicLossCount: 1 }
);
assert.equal(adverse.decision, 'REJECT');
assert.deepEqual(adverse.reasons, ['KNOWN_PRIOR_ADVERSE_CREATOR']);

const incomplete = assertFrozenParity(
  portableBaseline,
  { ...cleanCreator, coverage: 'PARTIAL', priorLaunchCount: 1 }
);
assert.equal(incomplete.decision, 'UNKNOWN');
assert.deepEqual(incomplete.reasons, ['CREATOR_HISTORY_INCOMPLETE']);

assert.throws(
  () => evaluatePortableFastVet({
    baseline: { ...portableBaseline, policyVersion: 'UNREVIEWED_POLICY' },
    creatorFeature: cleanCreator
  }),
  /MULTICHAIN_FAST_VET_POLICY_UNAUTHORIZED:UNREVIEWED_POLICY/
);
assert.throws(
  () => evaluatePortableFastVet({
    baseline: { ...portableBaseline, reverseSemantics: 'SEQUENTIAL_PNL' },
    creatorFeature: cleanCreator
  }),
  /MULTICHAIN_FAST_VET_REVERSE_SEMANTICS_MISMATCH:SEQUENTIAL_PNL/
);
assert.throws(
  () => evaluatePortableFastVet({
    baseline: { ...portableBaseline, authorityDigest: '' },
    creatorFeature: cleanCreator
  }),
  /MULTICHAIN_FAST_VET_AUTHORITY_DIGEST_MISSING/
);
assert.throws(
  () => evaluatePortableFastVet({
    baseline: {
      ...portableBaseline,
      legs: [portableBaseline.legs[2]]
    },
    creatorFeature: cleanCreator
  }),
  /MULTICHAIN_FAST_VET_COMPLETE_LADDER_MISMATCH/
);

const identity = {
  chainId: 57073,
  ecosystem: 'INK',
  launchProtocol: 'SENTRY',
  mode: 'SHADOW_ONLY'
};
const adapter = {
  authority: MULTICHAIN_SHADOW_RESEARCH_AUTHORITY,
  launch: { ...identity },
  marketQuotes: { ...identity },
  usdCalibration: { ...identity },
  forwardOutcomes: { ...identity }
};
assert.doesNotThrow(() => assertAdapterIdentity(adapter));
assert.throws(
  () => assertAdapterIdentity({ ...adapter, forwardOutcomes: { ...identity, ecosystem: 'ARC', launchProtocol: 'PAR' } }),
  /MULTICHAIN_ADAPTER_IDENTITY_MISMATCH/
);
assert.throws(
  () => assertAdapterIdentity({ ...adapter, marketQuotes: { ...identity, mode: 'LIVE' } }),
  /MULTICHAIN_ADAPTER_NON_SHADOW_MODE/
);

console.log(JSON.stringify({
  verdict: 'MULTICHAIN_M1_PORTABLE_DOMAIN_PASS',
  strategyAuthority: FAST_VET_R0_CONFIGURATION.authority,
  adapterAuthority: MULTICHAIN_SHADOW_RESEARCH_AUTHORITY,
  notionalsUsdMicros: DEFAULT_BASELINE_NOTIONALS_USD_MICROS.map(String),
  inkProjectionPreservesSourceAuthority: true,
  adapterIdentityFailsClosed: true,
  frozenFastVetParity: true,
  frozenFastVetSourceUntouched: true
}, null, 2));
