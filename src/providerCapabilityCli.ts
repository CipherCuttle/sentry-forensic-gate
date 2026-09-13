import { createPublicClient, defineChain, http, type Address } from 'viem';
import { CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH } from './authority/executableInfraAuthority.js';
import { CURRENT_SENTRY_AUTHORITY_EPOCH } from './authority/sentryAuthority.js';
import { DEFAULT_INK_RPC_URL, DEFAULT_SENTRY_LAUNCH_FACTORY, INK_CHAIN_ID } from './sentry/contracts.js';
import { ViemSentryLaunchSource } from './sentry/viemSource.js';
import { ViemExecutableBaselineSource } from './tsunami/viemBaselineSource.js';
import {
  positionManagerReadAbi,
  sentryBaselineReadAbi,
  TSUNAMI_POSITION_MANAGER,
  TSUNAMI_QUOTER_V2,
  TSUNAMI_V3_FACTORY,
  tsunamiQuoterV2Abi,
  WETH9
} from './tsunami/contracts.js';

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_INK_RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } }
});

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const probeBlock = process.env.PROVIDER_PROBE_BLOCK
  ? BigInt(process.env.PROVIDER_PROBE_BLOCK)
  : CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock;

if (probeBlock < CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock) {
  throw new Error(
    `PROVIDER_PROBE_BLOCK_UNAUTHORIZED:block=${probeBlock}:earliestAuthorized=${CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock}`
  );
}

const truth = new ViemSentryLaunchSource({ rpcUrl });
const baseline = new ViemExecutableBaselineSource({ rpcUrl });
const client = createPublicClient({ chain: ink, transport: http(rpcUrl) });
const head = await truth.getHeadBlockNumber();
if (head < probeBlock) throw new Error(`PROVIDER_PROBE_BLOCK_AHEAD_OF_HEAD:block=${probeBlock}:head=${head}`);

const confirmedBlock = head > 2n ? head - 2n : head;

await truth.assertAuthority(probeBlock);
const historicalInfrastructure = await readInfrastructure(probeBlock);
const historicalBlockHash = await truth.getBlockHash(probeBlock);
const historicalLaunches = await truth.catchUp(probeBlock, probeBlock);
const historicalBaselineAuthority = await classifyBaselineAuthority(probeBlock);

await truth.assertAuthority(confirmedBlock);
const confirmedInfrastructure = await readInfrastructure(confirmedBlock);
const confirmedBlockHash = await truth.getBlockHash(confirmedBlock);
const confirmedBaselineAuthority = await classifyBaselineAuthority(confirmedBlock);

const baselineAuthorityStatus =
  historicalBaselineAuthority.status === 'PASS' && confirmedBaselineAuthority.status === 'PASS'
    ? 'PASS'
    : 'BLOCKED';

console.log(JSON.stringify({
  receiptVersion: 'PROVIDER_CAPABILITY_R1',
  chainId: INK_CHAIN_ID,
  factory: DEFAULT_SENTRY_LAUNCH_FACTORY,
  providerOrigin: providerOrigin(rpcUrl),
  authority: {
    version: CURRENT_SENTRY_AUTHORITY_EPOCH.version,
    implementation: CURRENT_SENTRY_AUTHORITY_EPOCH.implementation,
    epochStartBlock: CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock.toString(),
    upgradeTx: CURRENT_SENTRY_AUTHORITY_EPOCH.upgradeTx
  },
  executableInfraAuthority: {
    version: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.version,
    epochStartBlock: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock.toString(),
    activationBlock: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.activationBlock.toString(),
    activationTx: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.activationTx,
    npm: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.npm,
    factory: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.factory,
    quoterV2: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.quoterV2,
    weth: CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.weth
  },
  head: head.toString(),
  historicalProbe: {
    blockNumber: probeBlock.toString(),
    blockHash: historicalBlockHash,
    launchEventsObserved: historicalLaunches.length,
    infrastructure: historicalInfrastructure,
    baselineAuthority: historicalBaselineAuthority,
    capabilities: {
      blockHeader: 'PASS',
      implementationStorage: 'PASS',
      proxyAndImplementationBytecode: 'PASS',
      sentryNpmRead: 'PASS',
      supportedBaseTokensRead: 'PASS',
      npmFactoryAndWethReads: 'PASS',
      quoterFactoryAndWethReads: 'PASS',
      historicalContractCode: 'PASS',
      sentryLogs: 'PASS'
    }
  },
  confirmedProbe: {
    blockNumber: confirmedBlock.toString(),
    blockHash: confirmedBlockHash,
    infrastructure: confirmedInfrastructure,
    baselineAuthority: confirmedBaselineAuthority,
    authorityReads: 'PASS'
  },
  providerStatus: 'PASS',
  baselineAuthorityStatus,
  deploymentGate: baselineAuthorityStatus === 'PASS' ? 'ELIGIBLE_FOR_CANARY' : 'BLOCKED_BY_BASELINE_AUTHORITY',
  executableQuoteProbe: 'DEFERRED_TO_CANARY_LAUNCH'
}));

async function readInfrastructure(blockNumber: bigint) {
  const [sentryNpm, supportedBaseTokens] = await Promise.all([
    client.readContract({
      address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
      abi: sentryBaselineReadAbi,
      functionName: 'npm',
      blockNumber
    }) as Promise<Address>,
    client.readContract({
      address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
      abi: sentryBaselineReadAbi,
      functionName: 'getSupportedBaseTokens',
      blockNumber
    }) as Promise<readonly Address[]>
  ]);
  if (!Array.isArray(supportedBaseTokens)) throw new Error('PROVIDER_SUPPORTED_BASE_TOKENS_MALFORMED');

  const [npmCode, npmFactory, npmWeth, pinnedFactoryCode, quoterCode, quoterFactory, quoterWeth] = await Promise.all([
    client.getBytecode({ address: sentryNpm, blockNumber }),
    client.readContract({ address: sentryNpm, abi: positionManagerReadAbi, functionName: 'factory', blockNumber }) as Promise<Address>,
    client.readContract({ address: sentryNpm, abi: positionManagerReadAbi, functionName: 'WETH9', blockNumber }) as Promise<Address>,
    client.getBytecode({ address: TSUNAMI_V3_FACTORY as Address, blockNumber }),
    client.getBytecode({ address: TSUNAMI_QUOTER_V2 as Address, blockNumber }),
    client.readContract({ address: TSUNAMI_QUOTER_V2 as Address, abi: tsunamiQuoterV2Abi, functionName: 'factory', blockNumber }) as Promise<Address>,
    client.readContract({ address: TSUNAMI_QUOTER_V2 as Address, abi: tsunamiQuoterV2Abi, functionName: 'WETH9', blockNumber }) as Promise<Address>
  ]);
  const npmFactoryCode = await client.getBytecode({ address: npmFactory, blockNumber });

  if (!npmCode || npmCode === '0x') throw new Error(`PROVIDER_NPM_CODE_MISSING:block=${blockNumber}`);
  if (!npmFactoryCode || npmFactoryCode === '0x') throw new Error(`PROVIDER_NPM_FACTORY_CODE_MISSING:block=${blockNumber}`);
  if (!pinnedFactoryCode || pinnedFactoryCode === '0x') throw new Error(`PROVIDER_PINNED_FACTORY_CODE_MISSING:block=${blockNumber}`);
  if (!quoterCode || quoterCode === '0x') throw new Error(`PROVIDER_QUOTER_CODE_MISSING:block=${blockNumber}`);

  return {
    sentryNpm,
    expectedNpm: TSUNAMI_POSITION_MANAGER,
    npmMatchesFrozenAuthority: sameAddress(sentryNpm, TSUNAMI_POSITION_MANAGER),
    npmFactory,
    expectedFactory: TSUNAMI_V3_FACTORY,
    npmFactoryMatchesFrozenAuthority: sameAddress(npmFactory, TSUNAMI_V3_FACTORY),
    npmWeth,
    expectedWeth: WETH9,
    npmWethMatchesFrozenAuthority: sameAddress(npmWeth, WETH9),
    quoter: TSUNAMI_QUOTER_V2,
    quoterFactory,
    quoterFactoryMatchesFrozenAuthority: sameAddress(quoterFactory, TSUNAMI_V3_FACTORY),
    quoterWeth,
    quoterWethMatchesFrozenAuthority: sameAddress(quoterWeth, WETH9),
    supportedBaseTokenCount: supportedBaseTokens.length,
    supportedBaseTokens: [...supportedBaseTokens]
  };
}

async function classifyBaselineAuthority(blockNumber: bigint): Promise<{ status: 'PASS' | 'DRIFT' | 'ERROR'; error?: string }> {
  try {
    await baseline.assertAuthority(blockNumber);
    return { status: 'PASS' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: message.includes('_DRIFT:') ? 'DRIFT' : 'ERROR', error: message };
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function providerOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}
