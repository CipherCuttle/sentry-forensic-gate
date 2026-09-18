import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type PublicClient
} from 'viem';
import type { Hex } from '../../../domain.js';
import type { ProvenanceFact } from '../../../graph/provenance.js';
import {
  buildNormalizedProvenanceFact
} from '../../../multichain/provenance.js';
import type {
  NormalizedLaunchCandidate,
  SourceAuthorityEnvelope
} from '../../../multichain/domain.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ponsV2TokenLaunchedEvent
} from './contracts.js';
import {
  validatePonsV2Authority,
  type PonsV2Authority
} from './authority.js';
import {
  derivePonsV2EventId,
  derivePonsV2LaunchId
} from './identity.js';
import { ViemPonsV2LaunchAdapter } from './viemLaunchAdapter.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});

export const PONS_V2_CREATOR_HISTORY_MAX_RANGE_BLOCKS = 5_000_000n;

type TokenLaunchedArgs = {
  token: Address;
  curve: Address;
  deployer: Address;
  pairToken: Address;
  launchConfigId: bigint;
  graduationThreshold: bigint;
};

type CreatorLaunchLog = {
  blockNumber: bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  logIndex: number | null;
  args: Partial<TokenLaunchedArgs>;
};

export interface PonsV2CreatorHistoryScan {
  targetFact: ProvenanceFact;
  priorFacts: ProvenanceFact[];
  creator: Hex;
  scannedFromBlock: bigint;
  scannedThroughBlock: bigint;
  scannedRanges: readonly {
    fromBlock: bigint;
    toBlock: bigint;
  }[];
  sourceAuthority: SourceAuthorityEnvelope;
}

export interface ViemPonsV2CreatorHistoryAdapterOptions {
  authority: Readonly<PonsV2Authority>;
  rpcUrl?: string;
  client?: PublicClient;
  maxRangeBlocks?: bigint;
}

export class ViemPonsV2CreatorHistoryAdapter {
  private readonly authority: Readonly<PonsV2Authority>;
  private readonly client: PublicClient;
  private readonly launchAuthority: ViemPonsV2LaunchAdapter;
  private readonly maxRangeBlocks: bigint;

  constructor(options: ViemPonsV2CreatorHistoryAdapterOptions) {
    validatePonsV2Authority(options.authority);
    this.authority = options.authority;
    this.client = options.client ?? createPublicClient({
      chain: robinhood,
      transport: http(options.rpcUrl ?? DEFAULT_ROBINHOOD_RPC_URL)
    });
    this.launchAuthority = new ViemPonsV2LaunchAdapter({
      authority: options.authority,
      client: this.client
    });
    this.maxRangeBlocks =
      options.maxRangeBlocks ?? PONS_V2_CREATOR_HISTORY_MAX_RANGE_BLOCKS;
    if (this.maxRangeBlocks <= 0n) {
      throw new Error('PONS_V2_CREATOR_HISTORY_RANGE_INVALID');
    }
  }

  async scan(params: {
    target: NormalizedLaunchCandidate;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
  }): Promise<PonsV2CreatorHistoryScan> {
    const { target, decisionBlock, decisionBlockHash } = params;
    this.assertTarget(target, decisionBlock);

    await this.launchAuthority.assertAuthority(this.authority.fromBlock);
    await this.launchAuthority.assertAuthority(decisionBlock);
    await this.assertBlockHash(target.blockNumber, target.blockHash, 'TARGET');
    await this.assertBlockHash(decisionBlock, decisionBlockHash, 'DECISION');

    const scannedRanges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const logs: CreatorLaunchLog[] = [];
    let fromBlock = this.authority.fromBlock;
    while (fromBlock <= target.blockNumber) {
      const toBlock = minBigInt(
        target.blockNumber,
        fromBlock + this.maxRangeBlocks - 1n
      );
      const rangeLogs = await this.getLogsAdaptive(
        fromBlock,
        toBlock,
        target.creator,
        scannedRanges
      );
      logs.push(...rangeLogs);
      fromBlock = toBlock + 1n;
    }

    const seenEvents = new Set<string>();
    const priorFacts: ProvenanceFact[] = [];
    let targetMatches = 0;

    for (const log of logs.sort(compareLogs)) {
      const parsed = await this.parseLog(log, target.creator);
      if (seenEvents.has(parsed.eventId)) {
        throw new Error(`PONS_V2_CREATOR_HISTORY_DUPLICATE_EVENT:${parsed.eventId}`);
      }
      seenEvents.add(parsed.eventId);

      const isTarget =
        parsed.blockNumber === target.blockNumber &&
        parsed.logIndex === target.logIndex &&
        norm(parsed.txHash) === norm(target.txHash) &&
        norm(parsed.token) === norm(target.token);

      if (isTarget && (
        parsed.launchId !== target.launchId ||
        parsed.eventId !== target.eventId
      )) {
        throw new Error('PONS_V2_CREATOR_HISTORY_TARGET_IDENTITY_DERIVATION_MISMATCH');
      }

      if (isTarget) {
        targetMatches += 1;
        continue;
      }

      if (
        parsed.blockNumber < target.blockNumber ||
        (
          parsed.blockNumber === target.blockNumber &&
          parsed.logIndex < target.logIndex
        )
      ) {
        priorFacts.push(await buildNormalizedProvenanceFact(parsed));
      }
    }

    if (targetMatches !== 1) {
      throw new Error(
        `PONS_V2_CREATOR_HISTORY_TARGET_CARDINALITY:${targetMatches}`
      );
    }

    await this.launchAuthority.assertAuthority(decisionBlock);
    await this.assertBlockHash(decisionBlock, decisionBlockHash, 'DECISION_FINAL');

    const targetFact = await buildNormalizedProvenanceFact(target);
    priorFacts.sort(compareFacts);

    return {
      targetFact,
      priorFacts,
      creator: target.creator.toLowerCase() as Hex,
      scannedFromBlock: this.authority.fromBlock,
      scannedThroughBlock: target.blockNumber,
      scannedRanges,
      sourceAuthority: {
        schema: 'ROBINHOOD_PONS_V2_CREATOR_HISTORY_R0',
        payload: {
          authorityId: this.authority.authorityId,
          chainId: ROBINHOOD_CHAIN_ID,
          factory: norm(this.authority.factory),
          factoryRuntimeCodeHash: norm(this.authority.factoryRuntimeCodeHash),
          creator: norm(target.creator),
          scannedFromBlock: this.authority.fromBlock.toString(),
          scannedThroughBlock: target.blockNumber.toString(),
          targetLaunchId: target.launchId,
          targetEventId: target.eventId,
          targetBlock: target.blockNumber.toString(),
          targetLogIndex: target.logIndex,
          decisionBlock: decisionBlock.toString(),
          decisionBlockHash: norm(decisionBlockHash),
          priorLaunchCount: priorFacts.length,
          sourceEvent: 'TokenLaunched',
          completeness: 'FULL_REVIEWED_FACTORY_EPOCH_TO_TARGET'
        }
      }
    };
  }

  private async getLogsAdaptive(
    fromBlock: bigint,
    toBlock: bigint,
    creator: Hex,
    scannedRanges: Array<{ fromBlock: bigint; toBlock: bigint }>
  ): Promise<CreatorLaunchLog[]> {
    try {
      const logs = await this.client.getLogs({
        address: this.authority.factory as Address,
        event: ponsV2TokenLaunchedEvent,
        args: { deployer: creator as Address },
        fromBlock,
        toBlock,
        strict: true
      });
      scannedRanges.push({ fromBlock, toBlock });
      return logs as unknown as CreatorLaunchLog[];
    } catch (error) {
      if (!isRangeCapacityError(error) || fromBlock === toBlock) throw error;
      const midpoint = fromBlock + ((toBlock - fromBlock) / 2n);
      const left = await this.getLogsAdaptive(
        fromBlock,
        midpoint,
        creator,
        scannedRanges
      );
      const right = await this.getLogsAdaptive(
        midpoint + 1n,
        toBlock,
        creator,
        scannedRanges
      );
      return [...left, ...right];
    }
  }

  private async parseLog(
    log: CreatorLaunchLog,
    expectedCreator: Hex
  ): Promise<ProvenanceLaunch> {
    if (
      log.blockNumber === null ||
      log.blockHash === null ||
      log.transactionHash === null ||
      log.logIndex === null
    ) {
      throw new Error('PONS_V2_CREATOR_HISTORY_LOG_INCOMPLETE');
    }
    const args = log.args;
    if (
      typeof args.token !== 'string' ||
      typeof args.deployer !== 'string'
    ) {
      throw new Error('PONS_V2_CREATOR_HISTORY_LOG_MALFORMED');
    }
    if (norm(args.deployer) !== norm(expectedCreator)) {
      throw new Error('PONS_V2_CREATOR_HISTORY_CREATOR_FILTER_BREACH');
    }

    const factory = normHex(this.authority.factory);
    const txHash = normHex(log.transactionHash);
    const token = normHex(args.token);
    const creator = normHex(args.deployer);
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
        logIndex: log.logIndex
      })
    ]);

    return {
      chainId: ROBINHOOD_CHAIN_ID,
      launchId,
      eventId,
      creator,
      blockNumber: log.blockNumber,
      blockHash: normHex(log.blockHash),
      logIndex: log.logIndex,
      txHash,
      token
    };
  }

  private assertTarget(
    target: NormalizedLaunchCandidate,
    decisionBlock: bigint
  ): void {
    if (
      target.chainId !== ROBINHOOD_CHAIN_ID ||
      target.ecosystem !== 'ROBINHOOD' ||
      target.launchProtocol !== 'PONS' ||
      norm(target.factory) !== norm(this.authority.factory) ||
      target.sourceEventName !== 'TokenLaunched'
    ) {
      throw new Error('PONS_V2_CREATOR_HISTORY_TARGET_IDENTITY_MISMATCH');
    }
    if (decisionBlock < target.blockNumber) {
      throw new Error('PONS_V2_CREATOR_HISTORY_DECISION_BEFORE_TARGET');
    }
  }

  private async assertBlockHash(
    blockNumber: bigint,
    expected: Hex,
    label: string
  ): Promise<void> {
    const actual = await this.launchAuthority.getBlockHash(blockNumber);
    if (norm(actual) !== norm(expected)) {
      throw new Error(
        `PONS_V2_CREATOR_HISTORY_${label}_HASH_MISMATCH:block=${blockNumber}`
      );
    }
  }
}

type ProvenanceLaunch = {
  chainId: number;
  launchId: string;
  eventId: string;
  creator: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  logIndex: number;
  txHash: Hex;
  token: Hex;
};

function isRangeCapacityError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    const record = current as { message?: unknown; details?: unknown; cause?: unknown };
    const message = [
      typeof record.message === 'string' ? record.message : '',
      typeof record.details === 'string' ? record.details : ''
    ].join(' ').toLowerCase();
    if (
      message.includes('block range') ||
      message.includes('range too large') ||
      message.includes('max range') ||
      message.includes('too many results') ||
      message.includes('query returned more than') ||
      message.includes('response size')
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function compareLogs(a: CreatorLaunchLog, b: CreatorLaunchLog): number {
  if (a.blockNumber === null || b.blockNumber === null) return 0;
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }
  return (a.logIndex ?? 0) - (b.logIndex ?? 0);
}

function compareFacts(a: ProvenanceFact, b: ProvenanceFact): number {
  if (a.observedBlock !== b.observedBlock) {
    return a.observedBlock < b.observedBlock ? -1 : 1;
  }
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.factId.localeCompare(b.factId);
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function norm(value: string): string {
  return value.toLowerCase();
}

function normHex(value: string): Hex {
  return value.toLowerCase() as Hex;
}
