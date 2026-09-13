import { CURRENT_SENTRY_AUTHORITY_EPOCH } from './authority/sentryAuthority.js';
import { DEFAULT_INK_RPC_URL, DEFAULT_SENTRY_LAUNCH_FACTORY, INK_CHAIN_ID } from './sentry/contracts.js';
import { ViemSentryLaunchSource } from './sentry/viemSource.js';
import { ViemExecutableBaselineSource } from './tsunami/viemBaselineSource.js';

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const probeBlock = process.env.PROVIDER_PROBE_BLOCK
  ? BigInt(process.env.PROVIDER_PROBE_BLOCK)
  : CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock;

if (probeBlock < CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock) {
  throw new Error(
    `PROVIDER_PROBE_BLOCK_UNAUTHORIZED:block=${probeBlock}:earliestAuthorized=${CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock}`
  );
}

const truth = new ViemSentryLaunchSource({ rpcUrl });
const baseline = new ViemExecutableBaselineSource({ rpcUrl });
const head = await truth.getHeadBlockNumber();
if (head < probeBlock) throw new Error(`PROVIDER_PROBE_BLOCK_AHEAD_OF_HEAD:block=${probeBlock}:head=${head}`);

const confirmedBlock = head > 2n ? head - 2n : head;

// These calls intentionally exercise the exact reviewed adapters used by the runtime:
// historical block/hash access, ERC-1967 storage, proxy/implementation bytecode,
// Sentry/Tsunami authority reads, and historical Sentry log retrieval.
await truth.assertAuthority(probeBlock);
await baseline.assertAuthority(probeBlock);
const historicalBlockHash = await truth.getBlockHash(probeBlock);
const historicalLaunches = await truth.catchUp(probeBlock, probeBlock);

await truth.assertAuthority(confirmedBlock);
await baseline.assertAuthority(confirmedBlock);
const confirmedBlockHash = await truth.getBlockHash(confirmedBlock);

console.log(JSON.stringify({
  receiptVersion: 'PROVIDER_CAPABILITY_R1',
  chainId: INK_CHAIN_ID,
  factory: DEFAULT_SENTRY_LAUNCH_FACTORY,
  rpcUrl,
  authority: {
    version: CURRENT_SENTRY_AUTHORITY_EPOCH.version,
    implementation: CURRENT_SENTRY_AUTHORITY_EPOCH.implementation,
    epochStartBlock: CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock.toString(),
    upgradeTx: CURRENT_SENTRY_AUTHORITY_EPOCH.upgradeTx
  },
  head: head.toString(),
  historicalProbe: {
    blockNumber: probeBlock.toString(),
    blockHash: historicalBlockHash,
    launchEventsObserved: historicalLaunches.length,
    capabilities: {
      blockHeader: 'PASS',
      implementationStorage: 'PASS',
      proxyAndImplementationBytecode: 'PASS',
      sentryAndTsunamiAuthorityReads: 'PASS',
      sentryLogs: 'PASS'
    }
  },
  confirmedProbe: {
    blockNumber: confirmedBlock.toString(),
    blockHash: confirmedBlockHash,
    authorityReads: 'PASS'
  },
  executableQuoteProbe: 'DEFERRED_TO_CANARY_LAUNCH',
  status: 'PASS'
}));
