import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  type Address,
  type Hash,
  type PublicClient
} from 'viem';
import type { Hex } from '../../../domain.js';
import type { NormalizedLaunchCandidate } from '../../../multichain/domain.js';
import type { ChainLaunchAdapter } from '../../../multichain/ports.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  erc20MetadataReadAbi,
  ponsV2FactoryReadAbi,
  ponsV2TokenLaunchedEvent
} from './contracts.js';
import {
  assertPonsV2AuthorityBlock,
  validatePonsV2Authority,
  type PonsV2Authority
} from './authority.js';
import { derivePonsV2EventId, derivePonsV2LaunchId } from './identity.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL } }
});

type PonsV2LaunchRecord = {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: number;
  sweptQuote: bigint;
  sweptTokens: bigint;
  sweptAt: bigint;
  exists: boolean;
};

type TokenLaunchedArgs = {
  token: Address;
  curve: Address;
  deployer: Address;
  pairToken: Address;
  launchConfigId: bigint;
  graduationThreshold: bigint;
};

export interface ViemPonsV2LaunchAdapterOptions {
  authority: Readonly<PonsV2Authority>;
  rpcUrl?: string;
  client?: PublicClient;
  now?: () => number;
}

export class ViemPonsV2LaunchAdapter implements ChainLaunchAdapter {
  readonly chainId = ROBINHOOD_CHAIN_ID;
  readonly ecosystem = 'ROBINHOOD' as const;
  readonly launchProtocol = 'PONS' as const;
  readonly mode = 'SHADOW_ONLY' as const;

  private readonly authority: Readonly<PonsV2Authority>;
  private readonly client: PublicClient;
  private readonly now: () => number;

  constructor(options: ViemPonsV2LaunchAdapterOptions) {
    validatePonsV2Authority(options.authority);
    this.authority = options.authority;
    this.client = options.client ?? createPublicClient({
      chain: robinhood,
      transport: http(options.rpcUrl ?? DEFAULT_ROBINHOOD_RPC_URL)
    });
    this.now = options.now ?? Date.now;
  }

  async getHeadBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getBlockHash(blockNumber: bigint): Promise<Hex> {
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`PONS_V2_BLOCK_HASH_MISSING:${blockNumber}`);
    return block.hash;
  }

  async assertAuthority(blockNumber: bigint): Promise<void> {
    assertPonsV2AuthorityBlock(this.authority, blockNumber);

    const chainId = await this.client.getChainId();
    if (chainId !== ROBINHOOD_CHAIN_ID) {
      throw new Error(
        `PONS_V2_CHAIN_ID_DRIFT:expected=${ROBINHOOD_CHAIN_ID}:actual=${chainId}:block=${blockNumber}`
      );
    }

    const code = await this.client.getBytecode({
      address: this.authority.factory as Address,
      blockNumber
    });
    if (!code || code === '0x') {
      throw new Error(`PONS_V2_FACTORY_CODE_MISSING:${this.authority.factory}:block=${blockNumber}`);
    }
    const actualHash = keccak256(code);
    if (norm(actualHash) !== norm(this.authority.factoryRuntimeCodeHash)) {
      throw new Error(
        `PONS_V2_FACTORY_CODE_HASH_DRIFT:expected=${this.authority.factoryRuntimeCodeHash}:actual=${actualHash}:block=${blockNumber}`
      );
    }
  }

  async catchUp(fromBlock: bigint, toBlock: bigint): Promise<NormalizedLaunchCandidate[]> {
    if (toBlock < fromBlock) return [];

    await this.assertAuthority(fromBlock);
    if (toBlock !== fromBlock) await this.assertAuthority(toBlock);

    const logs = await this.client.getLogs({
      address: this.authority.factory as Address,
      event: ponsV2TokenLaunchedEvent,
      fromBlock,
      toBlock,
      strict: true
    });

    const launches: NormalizedLaunchCandidate[] = [];
    const seenEvents = new Set<string>();
    for (const log of logs) {
      if (
        log.blockNumber === null ||
        log.blockHash === null ||
        log.transactionHash === null ||
        log.logIndex === null
      ) {
        throw new Error('PONS_V2_TOKEN_LAUNCHED_LOG_INCOMPLETE');
      }

      const args = log.args as Partial<TokenLaunchedArgs>;
      if (
        typeof args.token !== 'string' ||
        typeof args.curve !== 'string' ||
        typeof args.deployer !== 'string' ||
        typeof args.pairToken !== 'string' ||
        typeof args.launchConfigId !== 'bigint' ||
        typeof args.graduationThreshold !== 'bigint'
      ) {
        throw new Error(`PONS_V2_TOKEN_LAUNCHED_LOG_MALFORMED:${log.transactionHash}`);
      }

      const candidate = await this.materializeLaunch({
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        logIndex: log.logIndex,
        args: args as TokenLaunchedArgs
      });
      if (seenEvents.has(candidate.eventId)) {
        throw new Error(`PONS_V2_DUPLICATE_EVENT_IN_RANGE:${candidate.eventId}`);
      }
      seenEvents.add(candidate.eventId);
      launches.push(candidate);
    }

    launches.sort(compareLaunches);
    await this.assertAuthority(toBlock);
    return launches;
  }

  private async materializeLaunch(input: {
    blockNumber: bigint;
    blockHash: Hash;
    transactionHash: Hash;
    logIndex: number;
    args: TokenLaunchedArgs;
  }): Promise<NormalizedLaunchCandidate> {
    await this.assertAuthority(input.blockNumber);
    const canonicalHash = await this.getBlockHash(input.blockNumber);
    if (norm(canonicalHash) !== norm(input.blockHash)) {
      throw new Error(
        `PONS_V2_REORG_DURING_READ:block=${input.blockNumber}:expected=${input.blockHash}:actual=${canonicalHash}`
      );
    }

    const [recordRaw, name, symbol, tokenCode, curveCode] = await Promise.all([
      this.client.readContract({
        address: this.authority.factory as Address,
        abi: ponsV2FactoryReadAbi,
        functionName: 'getLaunchedToken',
        args: [input.args.token],
        blockNumber: input.blockNumber
      }),
      this.client.readContract({
        address: input.args.token,
        abi: erc20MetadataReadAbi,
        functionName: 'name',
        blockNumber: input.blockNumber
      }),
      this.client.readContract({
        address: input.args.token,
        abi: erc20MetadataReadAbi,
        functionName: 'symbol',
        blockNumber: input.blockNumber
      }),
      this.client.getBytecode({ address: input.args.token, blockNumber: input.blockNumber }),
      this.client.getBytecode({ address: input.args.curve, blockNumber: input.blockNumber })
    ]);
    const record = recordRaw as unknown as PonsV2LaunchRecord;

    if (!record.exists) throw new Error(`PONS_V2_LAUNCH_RECORD_MISSING:${input.args.token}`);
    requireSameAddress('TOKEN', record.token, input.args.token);
    requireSameAddress('CURVE', record.curve, input.args.curve);
    requireSameAddress('DEPLOYER', record.deployer, input.args.deployer);
    requireSameAddress('PAIR_TOKEN', record.pairToken, input.args.pairToken);
    if (record.graduationThreshold !== input.args.graduationThreshold) {
      throw new Error(
        `PONS_V2_LAUNCH_RECORD_MISMATCH:GRADUATION_THRESHOLD:${input.args.token}`
      );
    }
    if (!tokenCode || tokenCode === '0x') {
      throw new Error(`PONS_V2_TOKEN_CODE_MISSING:${input.args.token}:block=${input.blockNumber}`);
    }
    if (!curveCode || curveCode === '0x') {
      throw new Error(`PONS_V2_CURVE_CODE_MISSING:${input.args.curve}:block=${input.blockNumber}`);
    }
    if (typeof name !== 'string' || typeof symbol !== 'string') {
      throw new Error(`PONS_V2_TOKEN_METADATA_MALFORMED:${input.args.token}`);
    }

    // Re-read the launch block after all evidence reads. A reorg between the
    // first hash check and these historical reads must not produce a mixed-state
    // normalized candidate.
    const canonicalHashAfter = await this.getBlockHash(input.blockNumber);
    if (norm(canonicalHashAfter) !== norm(input.blockHash)) {
      throw new Error(
        `PONS_V2_REORG_DURING_READ:block=${input.blockNumber}:expected=${input.blockHash}:actual=${canonicalHashAfter}`
      );
    }

    const factory = normHex(this.authority.factory);
    const txHash = normHex(input.transactionHash);
    const token = normHex(input.args.token);
    const creator = normHex(input.args.deployer);
    const curve = normHex(input.args.curve);
    const pairToken = normHex(input.args.pairToken);
    const blockHash = normHex(input.blockHash);

    const [launchId, eventId] = await Promise.all([
      derivePonsV2LaunchId({
        chainId: ROBINHOOD_CHAIN_ID,
        factory,
        txHash,
        token
      }),
      derivePonsV2EventId({
        chainId: ROBINHOOD_CHAIN_ID,
        factory,
        txHash,
        logIndex: input.logIndex
      })
    ]);

    return {
      chainId: ROBINHOOD_CHAIN_ID,
      ecosystem: 'ROBINHOOD',
      launchProtocol: 'PONS',
      launchId,
      eventId,
      factory,
      txHash,
      blockNumber: input.blockNumber,
      blockHash,
      logIndex: input.logIndex,
      token,
      creator,
      name,
      symbol,
      sourceEventName: 'TokenLaunched',
      observedAtMs: this.now(),
      sourceAuthority: {
        schema: 'ROBINHOOD_PONS_V2_TOKEN_LAUNCHED_V1',
        payload: {
          authorityId: this.authority.authorityId,
          authorityFromBlock: this.authority.fromBlock.toString(),
          authorityThroughBlock: this.authority.throughBlock?.toString() ?? null,
          factoryRuntimeCodeHash: norm(this.authority.factoryRuntimeCodeHash),
          launchId,
          eventId,
          chainId: ROBINHOOD_CHAIN_ID,
          factory,
          blockNumber: input.blockNumber.toString(),
          blockHash,
          txHash,
          logIndex: input.logIndex,
          token,
          curve,
          deployer: creator,
          pairToken,
          launchConfigId: input.args.launchConfigId.toString(),
          graduationThreshold: input.args.graduationThreshold.toString(),
          sourceEvent: 'TokenLaunched',
          recordVerifiedAtBlockEnd: true,
          tokenCodePresent: true,
          curveCodePresent: true
        }
      }
    };
  }
}

function requireSameAddress(label: string, actual: Address, expected: Address): void {
  if (norm(actual) !== norm(expected)) {
    throw new Error(`PONS_V2_LAUNCH_RECORD_MISMATCH:${label}:${expected}`);
  }
}

function compareLaunches(a: NormalizedLaunchCandidate, b: NormalizedLaunchCandidate): number {
  if (a.blockNumber < b.blockNumber) return -1;
  if (a.blockNumber > b.blockNumber) return 1;
  return a.logIndex - b.logIndex;
}

function norm(value: string): string {
  return value.toLowerCase();
}

function normHex(value: string): Hex {
  return value.toLowerCase() as Hex;
}
