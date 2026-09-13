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
}

export class ViemSentryLaunchSource {
  readonly factory: Hex;
  private readonly client: PublicClient;
  private readonly now: () => number;

  constructor(options: ViemSentryLaunchSourceOptions = {}) {
    this.factory = options.factory ?? DEFAULT_SENTRY_LAUNCH_FACTORY;
    this.client = options.client ?? createPublicClient({
      chain: ink,
      transport: http(options.rpcUrl ?? DEFAULT_INK_RPC_URL)
    });
    this.now = options.now ?? Date.now;
  }

  async getHeadBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getBlockHash(blockNumber: bigint): Promise<Hex> {
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`Missing block hash for ${blockNumber}`);
    return block.hash;
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
        event.blockNumber0!== first.blockNumber ||
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
      this.client.readContract({
        address: this.factory,
        abi: sentryLaunchFactoryReadAbi,
        functionName: 'isAgentPosition',
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.factory,
        abi: sentryLaunchFactoryReadAbi,
        functionName: 'isKrakenVerifiedPosition',
        args: [tokenId],
        blockNumber
      }),
      this.client.readContract({
        address: this.factory,
        abi: sentryLaunchFactoryReadAbi,
        functionName: 'isGoPumpMePosition',
        args: [tokenId],
        blockNumber
      })
    ]);

    const flags = [Boolean(isAgent), Boolean(isKraken), Boolean(isGoPumpMe)].filter(Boolean).length;
    if (flags > 1) throw new Error(`Contradictory launch-type flags for tokenId ${tokenId}`);
    if (isGoPumpMe) return 'GO_PUMP_ME';
    if (isKraken) return 'KRAKEN_VERIFIED';
    if (isAgent) return 'AGENT';
    return 'STANDARD';
  }
}

function compareLaunches(a: LaunchObserved, b: LaunchObserved): number {
  if (a.blockNumber < b.blockNumber) return -1;
  if (a.blockNumber > b.blockNumber) return 1;
  return a.logIndex - b.logIndex;
}
