import { createPublicClient, defineChain, http, type Address, type PublicClient } from 'viem';
import type { Hex, LaunchObserved } from '../domain.js';
import { sha256Hex } from '../evidence/canonical.js';
import type { ReadAuthorityContext } from '../authority/readAuthorityContext.js';
import type { ExecutableBaselineBatch, LaunchMarket } from '../shadow/baselineTypes.js';
import { INK_CHAIN_ID, DEFAULT_INK_RPC_URL } from '../sentry/contracts.js';
import { erc20DecimalsAbi } from '../tsunami/contracts.js';
import { buildForwardOutcome } from '../runtime/forwardOutcomes.js';
import type { ExecutableBlockAuthorizer } from '../runtime/executableBaseline.js';
import type { OutcomeBlockPoint, OutcomeExitQuote, OutcomeMarketState, ForwardOutcomeSource } from './ports.js';
import { ViemForwardOutcomeSource } from './viemSource.js';
import type { ForwardOutcomeReceipt } from './forwardTypes.js';

export const HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1 = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1' as const;
export const WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1 = 'WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1' as const;
export const REDSTONE_ETH_USD_OUTCOME_ORACLE: Hex = '0xe5867B1d421f0b52697F16e2ac437e87d66D5fbF';

const EXPECTED_ORACLE_DECIMALS = 8;
const EXPECTED_ORACLE_DESCRIPTION = 'RedStone Price Feed for ETH';
const EXPECTED_ORACLE_VERSION = 1n;

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_INK_RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } }
});

const aggregatorV3Abi = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { type: 'function', name: 'description', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function', name: 'latestRoundData', stateMutability: 'view', inputs: [], outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' }
    ]
  }
] as const;

export interface HistoricalOutcomeValuationEvidence {
  kind: typeof WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1;
  oracleAddress: Hex;
  oracleAnswer: bigint;
  oracleDecimals: number;
  oracleDescription: string;
  oracleVersion: bigint;
  oracleUpdatedAt: bigint;
  observedBlockTimestamp: bigint;
  ageSeconds: bigint;
  baseDecimals: number;
}

export type HistoricalForwardOutcomeReceipt = Omit<ForwardOutcomeReceipt, 'policyVersion' | 'evidenceDigest'> & {
  policyVersion: typeof HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1;
  valuationEvidence?: HistoricalOutcomeValuationEvidence;
  evidenceDigest: string;
};

export interface HistoricalRedstoneOutcomeSourceOptions {
  rpcUrl?: string;
  client?: PublicClient;
  authority: Readonly<ReadAuthorityContext>;
  delegate?: ViemForwardOutcomeSource;
}

export class HistoricalRedstoneOutcomeSource implements ForwardOutcomeSource {
  private readonly delegate: ViemForwardOutcomeSource;
  private readonly client: PublicClient;
  private readonly authority: Readonly<ReadAuthorityContext>;
  private readonly valuationEvidence = new Map<string, HistoricalOutcomeValuationEvidence>();

  constructor(options: HistoricalRedstoneOutcomeSourceOptions) {
    this.authority = options.authority;
    this.client = options.client ?? createPublicClient({ chain: ink, transport: http(options.rpcUrl ?? DEFAULT_INK_RPC_URL) });
    this.delegate = options.delegate ?? new ViemForwardOutcomeSource({
      client: this.client,
      authority: options.authority
    });
  }

  getHeadBlockNumber(): Promise<bigint> { return this.delegate.getHeadBlockNumber(); }
  getBlockPoint(blockNumber: bigint): Promise<OutcomeBlockPoint> { return this.delegate.getBlockPoint(blockNumber); }
  assertMarketAuthority(market: LaunchMarket, blockNumber: bigint): Promise<void> { return this.delegate.assertMarketAuthority(market, blockNumber); }
  readMarketState(market: LaunchMarket, blockNumber: bigint): Promise<OutcomeMarketState> { return this.delegate.readMarketState(market, blockNumber); }
  quoteTokenToBase(params: { market: LaunchMarket; tokenAmount: bigint; blockNumber: bigint }): Promise<OutcomeExitQuote> {
    return this.delegate.quoteTokenToBase(params);
  }

  async valueBaseAmountUsdMicros(params: { baseToken: Hex; baseAmount: bigint; blockNumber: bigint }): Promise<bigint> {
    if (norm(params.baseToken) !== norm(this.authority.weth)) return this.delegate.valueBaseAmountUsdMicros(params);
    if (params.baseAmount < 0n) throw new Error('baseAmount must be >= 0');
    if (params.baseAmount === 0n) return 0n;

    const [block, oracleCode, baseDecimalsRaw, oracleDecimalsRaw, oracleDescription, oracleVersion, roundData] = await Promise.all([
      this.client.getBlock({ blockNumber: params.blockNumber }),
      this.client.getBytecode({ address: REDSTONE_ETH_USD_OUTCOME_ORACLE as Address, blockNumber: params.blockNumber }),
      this.client.readContract({ address: this.authority.weth as Address, abi: erc20DecimalsAbi, functionName: 'decimals', blockNumber: params.blockNumber }),
      this.client.readContract({ address: REDSTONE_ETH_USD_OUTCOME_ORACLE as Address, abi: aggregatorV3Abi, functionName: 'decimals', blockNumber: params.blockNumber }),
      this.client.readContract({ address: REDSTONE_ETH_USD_OUTCOME_ORACLE as Address, abi: aggregatorV3Abi, functionName: 'description', blockNumber: params.blockNumber }),
      this.client.readContract({ address: REDSTONE_ETH_USD_OUTCOME_ORACLE as Address, abi: aggregatorV3Abi, functionName: 'version', blockNumber: params.blockNumber }),
      this.client.readContract({ address: REDSTONE_ETH_USD_OUTCOME_ORACLE as Address, abi: aggregatorV3Abi, functionName: 'latestRoundData', blockNumber: params.blockNumber })
    ]);

    if (!oracleCode || oracleCode === '0x') throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:REDSTONE_CODE_MISSING:block=${params.blockNumber}`);
    const baseDecimals = Number(baseDecimalsRaw);
    const oracleDecimals = Number(oracleDecimalsRaw);
    if (!Number.isInteger(baseDecimals) || baseDecimals < 0 || baseDecimals > 36) throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:INVALID_WETH_DECIMALS:${baseDecimals}`);
    if (oracleDecimals !== EXPECTED_ORACLE_DECIMALS) throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:REDSTONE_DECIMALS_DRIFT:${oracleDecimals}`);
    if (oracleDescription !== EXPECTED_ORACLE_DESCRIPTION) throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:REDSTONE_DESCRIPTION_DRIFT:${oracleDescription}`);
    if (oracleVersion !== EXPECTED_ORACLE_VERSION) throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:REDSTONE_VERSION_DRIFT:${oracleVersion}`);

    const [, answer, , updatedAt] = roundData;
    if (answer <= 0n) throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:REDSTONE_NONPOSITIVE_ANSWER:block=${params.blockNumber}`);
    if (updatedAt <= 0n) throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:REDSTONE_ZERO_UPDATED_AT:block=${params.blockNumber}`);
    if (updatedAt > block.timestamp) throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:REDSTONE_FUTURE_UPDATE:block=${params.blockNumber}`);

    const valueUsdMicros = (params.baseAmount * answer * 1_000_000n) /
      ((10n ** BigInt(baseDecimals)) * (10n ** BigInt(oracleDecimals)));
    const evidence: HistoricalOutcomeValuationEvidence = {
      kind: WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1,
      oracleAddress: REDSTONE_ETH_USD_OUTCOME_ORACLE,
      oracleAnswer: answer,
      oracleDecimals,
      oracleDescription,
      oracleVersion,
      oracleUpdatedAt: updatedAt,
      observedBlockTimestamp: block.timestamp,
      ageSeconds: block.timestamp - updatedAt,
      baseDecimals
    };
    this.valuationEvidence.set(evidenceKey(params.blockNumber, params.baseAmount), evidence);
    return valueUsdMicros;
  }

  takeValuationEvidence(blockNumber: bigint, baseAmount: bigint): HistoricalOutcomeValuationEvidence | undefined {
    const key = evidenceKey(blockNumber, baseAmount);
    const evidence = this.valuationEvidence.get(key);
    this.valuationEvidence.delete(key);
    return evidence;
  }

  isWeth(baseToken: Hex): boolean { return norm(baseToken) === norm(this.authority.weth); }
}

export async function buildHistoricalForwardOutcome(
  source: HistoricalRedstoneOutcomeSource,
  launch: LaunchObserved,
  batch: ExecutableBaselineBatch,
  horizonMs: number,
  confirmedHeadPoint: OutcomeBlockPoint,
  authorizeExecutableBlock: ExecutableBlockAuthorizer
): Promise<HistoricalForwardOutcomeReceipt | null> {
  const current = await buildForwardOutcome(source, launch, batch, horizonMs, confirmedHeadPoint, authorizeExecutableBlock);
  if (!current) return null;

  const valuationEvidence = source.takeValuationEvidence(current.observedBlock, current.baseAmountOut);
  if (current.status === 'COMPLETE' && current.sellable && source.isWeth(current.baseToken) && !valuationEvidence) {
    throw new Error(`HISTORICAL_OUTCOME_VALUATION_EVIDENCE_MISSING:block=${current.observedBlock}:baseAmount=${current.baseAmountOut}`);
  }

  const outcomeId = await deriveHistoricalOutcomeId({ launchId: current.launchId, baselineId: current.baselineId, horizonMs: current.horizonMs });
  const { evidenceDigest: _oldDigest, policyVersion: _oldPolicy, outcomeId: _oldId, ...rest } = current;
  const withoutDigest = {
    ...rest,
    outcomeId,
    policyVersion: HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1,
    ...(valuationEvidence ? { valuationEvidence } : {})
  };
  const evidenceDigest = await sha256Hex({
    ...withoutDigest,
    observedBlockHash: withoutDigest.observedBlockHash.toLowerCase(),
    marketPool: withoutDigest.marketPool.toLowerCase(),
    baseToken: withoutDigest.baseToken.toLowerCase(),
    ...(valuationEvidence ? { valuationEvidence: { ...valuationEvidence, oracleAddress: valuationEvidence.oracleAddress.toLowerCase() } } : {})
  });
  return { ...withoutDigest, evidenceDigest };
}

export async function deriveHistoricalOutcomeId(input: { launchId: string; baselineId: string; horizonMs: number }): Promise<string> {
  return sha256Hex({ kind: HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1, launchId: input.launchId, baselineId: input.baselineId, horizonMs: input.horizonMs });
}

function evidenceKey(blockNumber: bigint, baseAmount: bigint): string { return `${blockNumber}:${baseAmount}`; }
function norm(value: string): string { return value.toLowerCase(); }
