import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type PublicClient
} from 'viem';
import type { Hex } from '../../../domain.js';
import { sha256Hex } from '../../../evidence/canonical.js';
import {
  type CanonicalJsonValue,
  type NormalizedLaunchCandidate,
  type NormalizedMarket,
  type SourceAuthorityEnvelope
} from '../../../multichain/domain.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ponsV2CurveStateReadAbi,
  ponsV2FactoryReadAbi
} from './contracts.js';
import type { PonsV2Authority } from './authority.js';
import { ViemPonsV2LaunchAdapter } from './viemLaunchAdapter.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL } }
});

export const PONS_V2_MARKET_STATE_R1 = 'PONS_V2_MARKET_STATE_R1' as const;

export type PonsV2MarketState =
  | 'CURVE_ACTIVE'
  | 'CURVE_HALTED_READY'
  | 'SWEPT_PENDING_V4'
  | 'V4_POOL_PENDING_ADAPTER'
  | 'RESCUED_TERMINAL';

export interface PonsV2MarketResolution {
  policyVersion: typeof PONS_V2_MARKET_STATE_R1;
  launchId: string;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  state: PonsV2MarketState;
  market: NormalizedMarket | null;
  sourceAuthority: SourceAuthorityEnvelope;
}

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

interface LaunchAuthorityFields {
  curve: Hex;
  pairToken: Hex;
  graduationThreshold: bigint;
}

export interface ViemPonsV2MarketStateResolverOptions {
  authority: Readonly<PonsV2Authority>;
  rpcUrl?: string;
  client?: PublicClient;
}

export class ViemPonsV2MarketStateResolver {
  readonly chainId = ROBINHOOD_CHAIN_ID;
  readonly ecosystem = 'ROBINHOOD' as const;
  readonly launchProtocol = 'PONS' as const;
  readonly mode = 'SHADOW_ONLY' as const;

  private readonly authority: Readonly<PonsV2Authority>;
  private readonly client: PublicClient;
  private readonly authorityGuard: ViemPonsV2LaunchAdapter;

  constructor(options: ViemPonsV2MarketStateResolverOptions) {
    this.authority = options.authority;
    this.client = options.client ?? createPublicClient({
      chain: robinhood,
      transport: http(options.rpcUrl ?? DEFAULT_ROBINHOOD_RPC_URL)
    });
    this.authorityGuard = new ViemPonsV2LaunchAdapter({
      authority: options.authority,
      client: this.client
    });
  }

  async resolve(launch: NormalizedLaunchCandidate, decisionBlock: bigint): Promise<PonsV2MarketResolution> {
    this.assertLaunchIdentity(launch);
    if (decisionBlock < launch.blockNumber) {
      throw new Error(
        `PONS_V2_MARKET_DECISION_BEFORE_LAUNCH:launch=${launch.blockNumber}:decision=${decisionBlock}`
      );
    }

    const launchAuthority = readLaunchAuthority(launch);
    await this.authorityGuard.assertAuthority(decisionBlock);
    const decisionBlockHash = await this.authorityGuard.getBlockHash(decisionBlock);

    const recordRaw = await this.client.readContract({
      address: this.authority.factory as Address,
      abi: ponsV2FactoryReadAbi,
      functionName: 'getLaunchedToken',
      args: [launch.token],
      blockNumber: decisionBlock
    });
    const record = recordRaw as unknown as PonsV2LaunchRecord;
    this.assertRecordStable(launch, launchAuthority, record);

    let state: PonsV2MarketState;
    if (record.phase === 0) {
      const [graduated, readyToGraduate, curveCode] = await Promise.all([
        this.client.readContract({
          address: record.curve,
          abi: ponsV2CurveStateReadAbi,
          functionName: 'graduated',
          blockNumber: decisionBlock
        }),
        this.client.readContract({
          address: record.curve,
          abi: ponsV2CurveStateReadAbi,
          functionName: 'readyToGraduate',
          blockNumber: decisionBlock
        }),
        this.client.getBytecode({
          address: record.curve,
          blockNumber: decisionBlock
        })
      ]);

      if (!curveCode || curveCode === '0x') {
        throw new Error(`PONS_V2_MARKET_CURVE_CODE_MISSING:${record.curve}:block=${decisionBlock}`);
      }
      if (graduated) {
        throw new Error(`PONS_V2_MARKET_PHASE_CONTRADICTION:NOT_GRADUATED_BUT_CURVE_GRADUATED:${launch.launchId}`);
      }
      state = readyToGraduate ? 'CURVE_HALTED_READY' : 'CURVE_ACTIVE';
    } else if (record.phase === 1) {
      state = 'SWEPT_PENDING_V4';
    } else if (record.phase === 2) {
      state = 'V4_POOL_PENDING_ADAPTER';
    } else if (record.phase === 3) {
      state = 'RESCUED_TERMINAL';
    } else {
      throw new Error(`PONS_V2_MARKET_UNKNOWN_GRADUATION_PHASE:${record.phase}`);
    }

    const decisionBlockHashAfter = await this.authorityGuard.getBlockHash(decisionBlock);
    if (norm(decisionBlockHashAfter) !== norm(decisionBlockHash)) {
      throw new Error(
        `PONS_V2_MARKET_REORG_DURING_READ:block=${decisionBlock}:expected=${decisionBlockHash}:actual=${decisionBlockHashAfter}`
      );
    }
    await this.authorityGuard.assertAuthority(decisionBlock);

    const sourceAuthority: SourceAuthorityEnvelope = {
      schema: 'ROBINHOOD_PONS_V2_MARKET_STATE_R1',
      payload: {
        authorityId: this.authority.authorityId,
        factoryRuntimeCodeHash: norm(this.authority.factoryRuntimeCodeHash),
        launchId: launch.launchId,
        decisionBlock: decisionBlock.toString(),
        decisionBlockHash: norm(decisionBlockHash),
        factory: normHex(this.authority.factory),
        token: normHex(record.token),
        curve: normHex(record.curve),
        pairToken: normHex(record.pairToken),
        graduationThreshold: record.graduationThreshold.toString(),
        poolFee: record.poolFee,
        tickSpacing: record.tickSpacing,
        creatorTaxBps: record.creatorTaxBps,
        phase: record.phase,
        state,
        sweptQuote: record.sweptQuote.toString(),
        sweptTokens: record.sweptTokens.toString(),
        sweptAt: record.sweptAt.toString()
      }
    };

    let market: NormalizedMarket | null = null;
    if (state === 'CURVE_ACTIVE') {
      const marketId = await sha256Hex({
        kind: 'PONS_V2_CURVE_MARKET_V1',
        chainId: ROBINHOOD_CHAIN_ID,
        launchId: launch.launchId,
        curve: norm(record.curve),
        pairToken: norm(record.pairToken)
      });
      market = {
        marketId,
        launchId: launch.launchId,
        chainId: ROBINHOOD_CHAIN_ID,
        ecosystem: 'ROBINHOOD',
        launchProtocol: 'PONS',
        launchedToken: normHex(record.token),
        baseAsset: normHex(record.pairToken),
        venue: 'PONS_V2_BONDING_CURVE',
        sourceAuthority
      };
    }

    return {
      policyVersion: PONS_V2_MARKET_STATE_R1,
      launchId: launch.launchId,
      decisionBlock,
      decisionBlockHash: normHex(decisionBlockHash),
      state,
      market,
      sourceAuthority
    };
  }

  private assertLaunchIdentity(launch: NormalizedLaunchCandidate): void {
    if (
      launch.chainId !== ROBINHOOD_CHAIN_ID ||
      launch.ecosystem !== 'ROBINHOOD' ||
      launch.launchProtocol !== 'PONS'
    ) {
      throw new Error(`PONS_V2_MARKET_LAUNCH_IDENTITY_MISMATCH:${launch.launchId}`);
    }
    if (norm(launch.factory) !== norm(this.authority.factory)) {
      throw new Error(`PONS_V2_MARKET_FACTORY_MISMATCH:${launch.factory}`);
    }
  }

  private assertRecordStable(
    launch: NormalizedLaunchCandidate,
    launchAuthority: LaunchAuthorityFields,
    record: PonsV2LaunchRecord
  ): void {
    if (!record.exists) throw new Error(`PONS_V2_MARKET_LAUNCH_RECORD_MISSING:${launch.launchId}`);
    requireSameAddress('TOKEN', record.token, launch.token);
    requireSameAddress('CURVE', record.curve, launchAuthority.curve);
    requireSameAddress('PAIR_TOKEN', record.pairToken, launchAuthority.pairToken);
    if (record.graduationThreshold !== launchAuthority.graduationThreshold) {
      throw new Error(`PONS_V2_MARKET_LAUNCH_RECORD_MISMATCH:GRADUATION_THRESHOLD:${launch.launchId}`);
    }
  }
}

function readLaunchAuthority(launch: NormalizedLaunchCandidate): LaunchAuthorityFields {
  if (launch.sourceAuthority.schema !== 'ROBINHOOD_PONS_V2_TOKEN_LAUNCHED_V1') {
    throw new Error(`PONS_V2_MARKET_SOURCE_AUTHORITY_SCHEMA_MISMATCH:${launch.sourceAuthority.schema}`);
  }
  const payload = launch.sourceAuthority.payload;
  if (!isJsonRecord(payload)) {
    throw new Error(`PONS_V2_MARKET_SOURCE_AUTHORITY_MALFORMED:${launch.launchId}`);
  }
  const curve = requireHexField(payload, 'curve', launch.launchId);
  const pairToken = requireHexField(payload, 'pairToken', launch.launchId);
  const graduationThresholdRaw = payload.graduationThreshold;
  if (typeof graduationThresholdRaw !== 'string' || !/^[0-9]+$/.test(graduationThresholdRaw)) {
    throw new Error(`PONS_V2_MARKET_SOURCE_AUTHORITY_GRADUATION_THRESHOLD_INVALID:${launch.launchId}`);
  }
  return {
    curve,
    pairToken,
    graduationThreshold: BigInt(graduationThresholdRaw)
  };
}

function requireHexField(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  key: string,
  launchId: string
): Hex {
  const value = payload[key];
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`PONS_V2_MARKET_SOURCE_AUTHORITY_${key.toUpperCase()}_INVALID:${launchId}`);
  }
  return normHex(value);
}

function isJsonRecord(
  value: CanonicalJsonValue
): value is Readonly<Record<string, CanonicalJsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireSameAddress(label: string, actual: Address, expected: string): void {
  if (norm(actual) !== norm(expected)) {
    throw new Error(`PONS_V2_MARKET_LAUNCH_RECORD_MISMATCH:${label}:${expected}`);
  }
}

function norm(value: string): string {
  return value.toLowerCase();
}

function normHex(value: string): Hex {
  return value.toLowerCase() as Hex;
}
