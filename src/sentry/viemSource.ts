import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Hash,
  type PublicClient
} from 'viem';
import type { Hex, LaunchEventName, LaunchObserved, LaunchType } from '../domain.js';
import { deriveEventId, deriveLaunchId } from './identity.js';
import {
  DEFAULT_INK_RPC_URL,
  DEFAULT_SENTRY_LAUNCH_FACTORY,
  EIP1967_IMPLEMENTATION_SLOT,
  EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION,
  goPumpMeTokenDeployedEvent,
  INK_CHAIN_ID,
  krakenVerifiedTokenDeployedEvent,
  sentryLaunchFactoryReadAbi,
  tokenDeployedEvent
} from './contracts.js';

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_INK_RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } }
});

type RawDeployment = {
  sourceEvent: LaunchEventName;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  logIndex: number;
  token: Address;
  creator: Address;
  tokenId: bigint;
  name: string;
  symbol: string;
};

export interface ViemSentryLaunchSourceOptions {
  rpcUrl?: string;
  factory?: Hex;
  client?: PublicClient;
  now?: () => number;
  allowUnavailableGenericLaunchTypeFlags?: boolean;
}

export class ViemSentryLaunchSource {
  readonly factory: Hex;
  private readonly client: PublicClient;
  private readonly now: () => number;
  private readonly allowUnavailableGenericLaunchTypeFlags: boolean;

  constructor(options: ViemSentryLaunchSourceOptions = {}) {
    this.factory = options.factory ?? DEFAULT_SENTRY_LAUNCH_FACTORY;
    this.client = options.client ?? createPublicClient({
      chain: ink,
      transport: http(options.rpcUrl ?? DEFAULT_INK_RPC_URL)
    });
    this.now = options.now ?? Date.now;
    this.allowUnavailableGenericLaunchTypeFlags = options.allowUnavailableGenericLaunchTypeFlags ?? false;
  }

  async getHeadBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getBlockHash(blockNumber: bigint): Promise<Hex> {
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`Missing block hash for ${blockNumber}`);
    return block.hash;
  }

  async assertAuthority(blockNumber: bigint): Promise<void> {
    const chainId = await this.client.getChainId();
    if (chainId !== INK_CHAIN_ID) {
      throw new Error(`INK_CHAIN_ID_DRIFT:expected=${INK_CHAIN_ID}:actual=${chainId}`);
    }
    if (this.factory.toLowerCase() !== DEFAULT_SENTRY_LAUNCH_FACTORY.toLowerCase()) {
      throw new Error(
        `SENTRY_FACTORY_ADDRESS_DRIFT:expected=${DEFAULT_SENTRY_LAUNCH_FACTORY}:actual=${this.factory}`
      );
    }

    const storage = await this.client.getStorageAt({
      address: this.factory,
      slot: EIP1967_IMPLEMENTATION_SLOT,
      blockNumber
    });
    if (!storage || storage === '0x' || /^0x0+$/.test(storage)) {
      throw new Error(`SENTRY_PROXY_IMPLEMENTATION_MISSING:block=${blockNumber}`);
    }
    const implementation = `0x${storage.slice(-40)}` as Hex;
    if (implementation.toLowerCase() !== EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION.toLowerCase()) {
      throw new Error(
        `SENTRY_PROXY_IMPLEMENTATION_DRIFT:expected=${EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION}:actual=${implementation}:block=${blockNumber}`
      );
    }

    const [proxyCode, implementationCode] = await Promise.all([
      this.client.getBytecode({ address: this.factory, blockNumber }),
      this.client.getBytecode({ address: implementation, blockNumber })
    ]);
    if (!proxyCode || proxyCode === '0x') {
      throw new Error(`SENTRY_PROXY_CODE_MISSING:block=${blockNumber}`);
    }
    if (!implementationCode || implementationCode === '0x') {
      throw new Error(`SENTRY_IMPLEMENTATION_CODE_MISSING:block=${blockNumber}`);
    }
  }

  async catchUp(fromBlock: bigint, toBlock: bigint): Promise<LaunchObserved[]> {
    if (toBlock < fromBlock) return [];

    const [generic, kraken, goPumpMe] = await Promise.all([
      this.readEvent(tokenDeployedEvent, 'TokenDeployed', fromBlock, toBlock),
      this.readEvent(krakenVerifiedTokenDeployedEvent, 'KrakenVerifiedTokenDeployed', fromBlock, toBlock),
      this.readEvent(goPumpMeTokenDeployedEvent, 'GoPumpMeTokenDeployed', fromBlock, toBlock)
    ]);

    const grouped = new Map<string, RawDeployment[]>();
    for (const event of [...generic, ...kraken, ...goPumpMe]) {
      const key = `${event.transactionHash.toLowerCase()}:${event.token.toLowerCase()}`;
      const existing = grouped.get(key);
      if (existing) existing.push(event);
      else grouped.set(key, [event]);
    }

    const launches: LaunchObserved[] = [];
    for (const events of grouped.values()) launches.push(await this.collapseDeploymentEvents(events));
    launches.sort(compareLaunches);
    return launches;
  }

  private async readEvent(
    event: typeof tokenDeployedEvent | typeof krakenVerifiedTokenDeployedEvent | typeof goPumpMeTokenDeployedEvent,
    sourceEvent: LaunchEventName,
    fromBlock: bigint,
    toBlock: bigint
  ): Promise<RawDeployment[]> {
    const logs = await this.client.getLogs({
      address: this.factory,
      event,
      fromBlock,
      toBlock,
      strict: true
    });

    return logs.map((log: (typeof logs)[number]) => {
      if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null || log.logIndex === null) {
        throw new Error(`Incomplete ${sourceEvent} log in confirmed range`);
      }
      const args = log.args as Partial<{
        token: Address;
        creator: Address;
        tokenId: bigint;
        name: string;
        symbol: string;
      }>;
      if (
        typeof args.token !== 'string' ||
        typeof args.creator !== 'string' ||
        typeof args.tokenId !== 'bigint' ||
        typeof args.name !== 'string' ||
        typeof args.symbol !== 'string'
      ) {
        throw new Error(`Malformed ${sourceEvent} log in confirmed range`);
      }
      return {
        sourceEvent,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        token: args.token,
        creator: args.creator,
        tokenId: args.tokenId,
        name: args.name,
        symbol: args.symbol
      };
    });
  }

  private async collapseDeploymentEvents(events: RawDeployment[]): Promise<LaunchObserved> {
    if (events.length === 0) throw new Error('Cannot collapse empty deployment event set');
    events.sort((a, b) => a.logIndex - b.logIndex);
    const first = events[0]!;

    for (const event of events.slice(1)) {
      if (
        event.blockNumber !== first.blockNumber ||
        event.blockHash.toLowerCase() !== first.blockHash.toLowerCase() ||
        event.transactionHash.toLowerCase() !== first.transactionHash.toLowerCase() ||
        event.token.toLowerCase() !== first.token.toLowerCase() ||
        event.creator.toLowerCase() !== first.creator.toLowerCase() ||
        event.tokenId !== first.tokenId ||
        event.name !== first.name ||
        event.symbol !== first.symbol
      ) {
        throw new Error(`Contradictory Sentry deployment events in tx ${first.transactionHash}`);
      }
    }

    const explicitTypes = new Set(events.map((event) => event.sourceEvent));
    if (explicitTypes.has('GoPumpMeTokenDeployed') && explicitTypes.has('KrakenVerifiedTokenDeployed')) {
      throw new Error(`Contradictory specialized launch events in tx ${first.transactionHash}`);
    }

    let launchType: LaunchType;
    let sourceEvent: LaunchEventName;

    if (explicitTypes.has('GoPumpMeTokenDeployed')) {
      launchType = 'GO_PUMP_ME';
      sourceEvent = 'GoPumpMeTokenDeployed';
    } else if (explicitTypes.has('KrakenVerifiedTokenDeployed')) {
      launchType = 'KRAKEN_VERIFIED';
      sourceEvent = 'KrakenVerifiedTokenDeployed';
    } else {
      sourceEvent = 'TokenDeployed';
      launchType = await this.classifyGenericLaunch(first.tokenId, first.blockNumber);
    }
    const source = events.find((event) => event.sourceEvent === sourceEvent) ?? first;

    const [launchId, eventId] = await Promise.all([
      deriveLaunchId({
        chainId: INK_CHAIN_ID,
        factory: this.factory,
        txHash: first.transactionHash,
        token: first.token
      }),
      deriveEventId({
        chainId: INK_CHAIN_ID,
        factory: this.factory,
        txHash: first.transactionHash,
        logIndex: source.logIndex
      })
    ]);

    return {
      chainId: INK_CHAIN_ID,
      blockNumber: first.blockNumber,
      blockHash: first.blockHash,
      observedAtMs: this.now(),
      launchId,
      eventId,
      factory: this.factory,
      txHash: first.transactionHash,
      logIndex: source.logIndex,
      token: first.token,
      creator: first.creator,
      tokenId: first.tokenId,
      name: first.name,
      symbol: first.symbol,
      launchType,
      sourceEvent
    };
  }

  private async classifyGenericLaunch(tokenId: bigint, blockNumber: bigint): Promise<LaunchType> {
    const [isAgent, isKraken, isGoPumpMe] = await Promise.all([
      this.readLaunchTypeFlag('isAgentPosition', tokenId, blockNumber),
      this.readLaunchTypeFlag('isKrakenVerifiedPosition', tokenId, blockNumber),
      this.readLaunchTypeFlag('isGoPumpMePosition', tokenId, blockNumber)
    ]);

    const flags = [isAgent, isKraken, isGoPumpMe].filter(Boolean).length;
    if (flags > 1) throw new Error(`Contradictory launch-type flags for tokenId ${tokenId}`);
    if (isGoPumpMe) return 'GO_PUMP_ME';
    if (isKraken) return 'KRAKEN_VERIFIED';
    if (isAgent) return 'AGENT';
    return 'STANDARD';
  }

  private async readLaunchTypeFlag(
    functionName: 'isAgentPosition' | 'isKrakenVerifiedPosition' | 'isGoPumpMePosition',
    tokenId: bigint,
    blockNumber: bigint
  ): Promise<boolean> {
    try {
      return Boolean(await this.client.readContract({
        address: this.factory,
        abi: sentryLaunchFactoryReadAbi,
        functionName,
        args: [tokenId],
        blockNumber
      }));
    } catch (error) {
      if (this.allowUnavailableGenericLaunchTypeFlags && isEvmRevert(error)) return false;
      throw error;
    }
  }
}

function compareLaunches(a: LaunchObserved, b: LaunchObserved): number {
  if (a.blockNumber < b.blockNumber) return -1;
  if (a.blockNumber > b.blockNumber) return 1;
  return a.logIndex - b.logIndex;
}

function isEvmRevert(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    const record = current as { name?: unknown; message?: unknown; cause?: unknown };
    const name = typeof record.name === 'string' ? record.name : '';
    const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
    if (
      name === 'ExecutionRevertedError' ||
      name === 'ContractFunctionRevertedError' ||
      message.includes('execution reverted') ||
      message.includes('reverted')
    ) return true;
    current = record.cause;
  }
  return false;
}
