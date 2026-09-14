import {
  createPublicClient,
  http,
  type Address,
  type PublicClient
} from 'viem';
import type { Hex, LaunchObserved } from '../domain.js';
import type { ReadAuthorityContext } from '../authority/readAuthorityContext.js';
import {
  HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1,
  deriveBaselineQuoteId,
  type BaselineQuoteReceipt,
  type LaunchMarket,
  type UsdCalibration
} from '../shadow/baselineTypes.js';
import { DEFAULT_INK_RPC_URL } from '../sentry/contracts.js';
import { erc20DecimalsAbi, USDT0 } from './contracts.js';
import type { ExecutableBaselineSource } from './ports.js';
import { ViemExecutableBaselineSource } from './viemBaselineSource.js';

export const REDSTONE_ETH_USD = '0xe5867B1d421f0b52697F16e2ac437e87d66D5fbF' as Hex;
export const REDSTONE_ETH_USD_DECIMALS = 8;
export const REDSTONE_ETH_USD_DESCRIPTION = 'RedStone Price Feed for ETH';
export const REDSTONE_ETH_USD_VERSION = 1n;

const aggregatorV3Abi = [
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  },
  {
    type: 'function',
    name: 'description',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }]
  },
  {
    type: 'function',
    name: 'version',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' }
    ]
  }
] as const;

export interface HistoricalRedstoneBaselineSourceOptions {
  rpcUrl?: string;
  client?: PublicClient;
  authority: Readonly<ReadAuthorityContext>;
  now?: () => number;
}

export class HistoricalRedstoneBaselineSource implements ExecutableBaselineSource {
  private readonly client: PublicClient;
  private readonly authority: Readonly<ReadAuthorityContext>;
  private readonly delegate: ViemExecutableBaselineSource;

  constructor(options: HistoricalRedstoneBaselineSourceOptions) {
    this.client = options.client ?? createPublicClient({ transport: http(options.rpcUrl ?? DEFAULT_INK_RPC_URL) });
    this.authority = options.authority;
    this.delegate = new ViemExecutableBaselineSource({
      client: this.client,
      authority: this.authority,
      ...(options.now ? { now: options.now } : {})
    });
  }

  getHeadBlockNumber(): Promise<bigint> {
    return this.delegate.getHeadBlockNumber();
  }

  getBlockHash(blockNumber: bigint): Promise<Hex> {
    return this.delegate.getBlockHash(blockNumber);
  }

  assertAuthority(blockNumber: bigint): Promise<void> {
    return this.delegate.assertAuthority(blockNumber);
  }

  resolveMarket(launch: LaunchObserved, decisionBlock: bigint): Promise<LaunchMarket> {
    return this.delegate.resolveMarket(launch, decisionBlock);
  }

  async calibrateUsd(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
  }): Promise<UsdCalibration> {
    const base = norm(params.market.baseToken);
    if (base === norm(USDT0)) return this.delegate.calibrateUsd(params);
    if (base !== norm(this.authority.weth)) {
      throw new Error(`UNSUPPORTED_BASE_FOR_USD_CALIBRATION:${params.market.baseToken}`);
    }

    const [oracleCode, decimalsRaw, description, version, roundData, block, wethDecimalsRaw] = await Promise.all([
      this.client.getBytecode({ address: REDSTONE_ETH_USD as Address, blockNumber: params.decisionBlock }),
      this.client.readContract({ address: REDSTONE_ETH_USD as Address, abi: aggregatorV3Abi, functionName: 'decimals', blockNumber: params.decisionBlock }),
      this.client.readContract({ address: REDSTONE_ETH_USD as Address, abi: aggregatorV3Abi, functionName: 'description', blockNumber: params.decisionBlock }),
      this.client.readContract({ address: REDSTONE_ETH_USD as Address, abi: aggregatorV3Abi, functionName: 'version', blockNumber: params.decisionBlock }),
      this.client.readContract({ address: REDSTONE_ETH_USD as Address, abi: aggregatorV3Abi, functionName: 'latestRoundData', blockNumber: params.decisionBlock }),
      this.client.getBlock({ blockNumber: params.decisionBlock }),
      this.client.readContract({ address: this.authority.weth as Address, abi: erc20DecimalsAbi, functionName: 'decimals', blockNumber: params.decisionBlock })
    ]);

    if (!oracleCode || oracleCode === '0x') {
      throw new Error(`HISTORICAL_REDSTONE_CODE_MISSING:block=${params.decisionBlock}`);
    }

    const decimals = Number(decimalsRaw);
    if (decimals !== REDSTONE_ETH_USD_DECIMALS) {
      throw new Error(`HISTORICAL_REDSTONE_DECIMALS_DRIFT:expected=${REDSTONE_ETH_USD_DECIMALS}:actual=${decimals}:block=${params.decisionBlock}`);
    }
    if (description !== REDSTONE_ETH_USD_DESCRIPTION) {
      throw new Error(`HISTORICAL_REDSTONE_DESCRIPTION_DRIFT:block=${params.decisionBlock}`);
    }
    if (version !== REDSTONE_ETH_USD_VERSION) {
      throw new Error(`HISTORICAL_REDSTONE_VERSION_DRIFT:expected=${REDSTONE_ETH_USD_VERSION}:actual=${version}:block=${params.decisionBlock}`);
    }

    const [, answer, , updatedAt] = roundData;
    if (answer <= 0n) throw new Error(`HISTORICAL_REDSTONE_NONPOSITIVE_ANSWER:block=${params.decisionBlock}`);
    if (updatedAt <= 0n) throw new Error(`HISTORICAL_REDSTONE_ZERO_UPDATED_AT:block=${params.decisionBlock}`);
    if (updatedAt > block.timestamp) {
      throw new Error(`HISTORICAL_REDSTONE_FUTURE_UPDATE:block=${params.decisionBlock}:updatedAt=${updatedAt}:timestamp=${block.timestamp}`);
    }

    const wethDecimals = Number(wethDecimalsRaw);
    if (!Number.isInteger(wethDecimals) || wethDecimals < 0 || wethDecimals > 36) {
      throw new Error(`INVALID_TOKEN_DECIMALS:${wethDecimals}`);
    }

    const baseAmount = scaleUsdMicrosByOracleCeil(
      params.notionalUsdMicros,
      wethDecimals,
      decimals,
      answer
    );

    return {
      kind: 'WETH_REDSTONE_ETH_USD_ASOF_V1',
      notionalUsdMicros: params.notionalUsdMicros,
      baseToken: this.authority.weth,
      baseAmount,
      baseDecimals: wethDecimals,
      oracleEvidence: {
        oracle: REDSTONE_ETH_USD,
        answer,
        decimals,
        description,
        version,
        updatedAt,
        decisionBlockTimestamp: block.timestamp,
        ageSeconds: block.timestamp - updatedAt
      }
    };
  }

  async quoteEntry(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<BaselineQuoteReceipt> {
    const quote = await this.delegate.quoteEntry(params);
    return { ...quote, quoteId: await historicalQuoteId(params, 'ENTRY') };
  }

  async quoteIndependentReverse(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<BaselineQuoteReceipt> {
    const quote = await this.delegate.quoteIndependentReverse(params);
    return { ...quote, quoteId: await historicalQuoteId(params, 'INDEPENDENT_REVERSE_EXIT') };
  }
}

export function scaleUsdMicrosByOracleCeil(
  notionalUsdMicros: bigint,
  baseDecimals: number,
  oracleDecimals: number,
  oracleAnswer: bigint
): bigint {
  if (notionalUsdMicros <= 0n) throw new Error('notionalUsdMicros must be > 0');
  if (oracleAnswer <= 0n) throw new Error('oracleAnswer must be > 0');
  if (!Number.isInteger(baseDecimals) || baseDecimals < 0 || baseDecimals > 36) {
    throw new Error(`INVALID_TOKEN_DECIMALS:${baseDecimals}`);
  }
  if (!Number.isInteger(oracleDecimals) || oracleDecimals < 0 || oracleDecimals > 36) {
    throw new Error(`INVALID_ORACLE_DECIMALS:${oracleDecimals}`);
  }

  const numerator = notionalUsdMicros * (10n ** BigInt(baseDecimals)) * (10n ** BigInt(oracleDecimals));
  const denominator = 1_000_000n * oracleAnswer;
  const amount = (numerator + denominator - 1n) / denominator;
  if (amount <= 0n) throw new Error(`USD_NOTIONAL_ROUNDS_TO_ZERO:${notionalUsdMicros}:${baseDecimals}`);
  return amount;
}

async function historicalQuoteId(
  params: { launch: LaunchObserved; decisionBlockHash: Hex; notionalUsdMicros: bigint },
  kind: 'ENTRY' | 'INDEPENDENT_REVERSE_EXIT'
): Promise<string> {
  return deriveBaselineQuoteId({
    launchId: params.launch.launchId,
    decisionBlockHash: params.decisionBlockHash,
    kind,
    notionalUsdMicros: params.notionalUsdMicros,
    policyVersion: HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1
  });
}

function norm(value: string): string {
  return value.toLowerCase();
}
