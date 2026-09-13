import { createPublicClient, defineChain, http, type Address, type Hash } from 'viem';
import { CURRENT_SENTRY_AUTHORITY_EPOCH } from './authority/sentryAuthority.js';
import {
  DEFAULT_INK_RPC_URL,
  DEFAULT_SENTRY_LAUNCH_FACTORY,
  INK_CHAIN_ID
} from './sentry/contracts.js';
import {
  positionManagerReadAbi,
  sentryBaselineReadAbi,
  tsunamiQuoterV2Abi,
  WETH9
} from './tsunami/contracts.js';

const CURRENT_UNISWAP_V3_NPM: Address = '0xC0836E5B058BBE22ae2266e1AC488A1A0fD8DCE8';
const CURRENT_UNISWAP_V3_FACTORY: Address = '0x640887A9ba3A9C53Ed27D0F7e8246A4F933f3424';
const CURRENT_UNISWAP_V3_QUOTER_V2: Address = '0x96b572D2d880cf2Fa2563651BD23ADE6f5516652';

const sentryInfrastructureAbi = [
  ...sentryBaselineReadAbi,
  { type: 'function', name: 'GEN1_NPM', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'MIGRATION_NPM', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }
] as const;

const npmUpdatedEvent = {
  type: 'event',
  name: 'NPMUpdated',
  anonymous: false,
  inputs: [
    { indexed: false, name: 'oldNPM', type: 'address' },
    { indexed: false, name: 'newNPM', type: 'address' }
  ]
} as const;

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_INK_RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } }
});

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const maxBatchBlocks = envBigInt('INFRA_DISCOVERY_MAX_BATCH_BLOCKS', 100_000n);
if (maxBatchBlocks < 1n) throw new Error('INFRA_DISCOVERY_MAX_BATCH_BLOCKS must be >= 1');

const client = createPublicClient({ chain: ink, transport: http(rpcUrl) });
const head = await client.getBlockNumber();
const confirmedBlock = head > 2n ? head - 2n : head;
const startBlock = CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock;
if (confirmedBlock < startBlock) {
  throw new Error(`INFRA_DISCOVERY_HEAD_BEFORE_AUTHORITY:start=${startBlock}:confirmed=${confirmedBlock}`);
}

const [startNpm, currentNpm, gen1Npm, migrationNpm, supportedBaseTokens] = await Promise.all([
  readSentryAddress('npm', startBlock),
  readSentryAddress('npm', confirmedBlock),
  readSentryAddress('GEN1_NPM', confirmedBlock),
  readSentryAddress('MIGRATION_NPM', confirmedBlock),
  client.readContract({
    address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
    abi: sentryInfrastructureAbi,
    functionName: 'getSupportedBaseTokens',
    blockNumber: confirmedBlock
  }) as Promise<readonly Address[]>
]);

const updates: Array<{
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
  oldNpm: Address;
  newNpm: Address;
}> = [];

for (let fromBlock = startBlock; fromBlock <= confirmedBlock; fromBlock += maxBatchBlocks) {
  const toBlock = minBigInt(confirmedBlock, fromBlock + maxBatchBlocks - 1n);
  const logs = await client.getLogs({
    address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
    event: npmUpdatedEvent,
    fromBlock,
    toBlock,
    strict: true
  });

  for (const log of logs) {
    if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null || log.logIndex === null) {
      throw new Error('INFRA_DISCOVERY_INCOMPLETE_NPM_UPDATED_LOG');
    }
    const args = log.args as Partial<{ oldNPM: Address; newNPM: Address }>;
    if (typeof args.oldNPM !== 'string' || typeof args.newNPM !== 'string') {
      throw new Error(`INFRA_DISCOVERY_MALFORMED_NPM_UPDATED:block=${log.blockNumber}`);
    }
    updates.push({
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: log.logIndex,
      oldNpm: args.oldNPM,
      newNpm: args.newNPM
    });
  }
}

updates.sort((a, b) => {
  if (a.blockNumber < b.blockNumber) return -1;
  if (a.blockNumber > b.blockNumber) return 1;
  return a.logIndex - b.logIndex;
});

let currentNpmActivationBlock: bigint | null = sameAddress(startNpm, currentNpm) ? startBlock : null;
for (const update of updates) {
  if (sameAddress(update.newNpm, currentNpm)) currentNpmActivationBlock = update.blockNumber;
}
if (currentNpmActivationBlock === null) {
  throw new Error(`INFRA_DISCOVERY_CURRENT_NPM_ACTIVATION_NOT_FOUND:npm=${currentNpm}`);
}

const [npmCode, currentFactory, currentWeth, quoterCode, quoterFactory, quoterWeth] = await Promise.all([
  client.getBytecode({ address: currentNpm, blockNumber: confirmedBlock }),
  client.readContract({ address: currentNpm, abi: positionManagerReadAbi, functionName: 'factory', blockNumber: confirmedBlock }) as Promise<Address>,
  client.readContract({ address: currentNpm, abi: positionManagerReadAbi, functionName: 'WETH9', blockNumber: confirmedBlock }) as Promise<Address>,
  client.getBytecode({ address: CURRENT_UNISWAP_V3_QUOTER_V2, blockNumber: confirmedBlock }),
  client.readContract({ address: CURRENT_UNISWAP_V3_QUOTER_V2, abi: tsunamiQuoterV2Abi, functionName: 'factory', blockNumber: confirmedBlock }) as Promise<Address>,
  client.readContract({ address: CURRENT_UNISWAP_V3_QUOTER_V2, abi: tsunamiQuoterV2Abi, functionName: 'WETH9', blockNumber: confirmedBlock }) as Promise<Address>
]);
const factoryCode = await client.getBytecode({ address: currentFactory, blockNumber: confirmedBlock });

requireAddress('CURRENT_NPM', currentNpm, CURRENT_UNISWAP_V3_NPM);
requireAddress('CURRENT_FACTORY', currentFactory, CURRENT_UNISWAP_V3_FACTORY);
requireAddress('CURRENT_NPM_WETH', currentWeth, WETH9 as Address);
requireAddress('CURRENT_QUOTER_FACTORY', quoterFactory, CURRENT_UNISWAP_V3_FACTORY);
requireAddress('CURRENT_QUOTER_WETH', quoterWeth, WETH9 as Address);
if (!npmCode || npmCode === '0x') throw new Error(`CURRENT_NPM_CODE_MISSING:${currentNpm}`);
if (!factoryCode || factoryCode === '0x') throw new Error(`CURRENT_FACTORY_CODE_MISSING:${currentFactory}`);
if (!quoterCode || quoterCode === '0x') throw new Error(`CURRENT_QUOTER_CODE_MISSING:${CURRENT_UNISWAP_V3_QUOTER_V2}`);

// Conservative by construction: an NPMUpdated log can share a block with launches.
// Starting one block later avoids transaction-order ambiguity without inventing a same-block rule.
const candidateExecutableStartBlock = currentNpmActivationBlock + 1n;

console.log(JSON.stringify(jsonSafe({
  receiptVersion: 'EXECUTABLE_INFRA_DISCOVERY_R2',
  providerOrigin: providerOrigin(rpcUrl),
  chainId: INK_CHAIN_ID,
  sentryFactory: DEFAULT_SENTRY_LAUNCH_FACTORY,
  sentryAuthority: {
    version: CURRENT_SENTRY_AUTHORITY_EPOCH.version,
    implementation: CURRENT_SENTRY_AUTHORITY_EPOCH.implementation,
    fromBlock: CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock
  },
  head,
  confirmedBlock,
  sentryInfrastructure: {
    npmAtAuthorityStart: startNpm,
    currentNpm,
    gen1Npm,
    migrationNpm,
    supportedBaseTokens
  },
  npmUpdates: updates,
  currentExecutableTuple: {
    npm: currentNpm,
    factory: currentFactory,
    quoterV2: CURRENT_UNISWAP_V3_QUOTER_V2,
    weth: currentWeth
  },
  currentNpmActivationBlock,
  candidateExecutableStartBlock,
  sameBlockPolicy: 'EXCLUDE_NPM_UPDATE_BLOCK',
  status: 'PASS'
})));

async function readSentryAddress(
  functionName: 'npm' | 'GEN1_NPM' | 'MIGRATION_NPM',
  blockNumber: bigint
): Promise<Address> {
  return client.readContract({
    address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
    abi: sentryInfrastructureAbi,
    functionName,
    blockNumber
  }) as Promise<Address>;
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  return raw ? BigInt(raw) : fallback;
}

function requireAddress(label: string, actual: Address, expected: Address): void {
  if (!sameAddress(actual, expected)) throw new Error(`${label}_DRIFT:expected=${expected}:actual=${actual}`);
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function providerOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
