import type { Hex, LaunchObserved } from '../domain.js';
import { sha256Hex } from '../evidence/canonical.js';

export const EXECUTABLE_BASELINE_R1 = 'EXECUTABLE_BASELINE_R1';
export const DEFAULT_BASELINE_NOTIONALS_USD_MICROS = [250_000n, 500_000n, 1_000_000n, 2_000_000n, 5_000_000n] as const;

export type BaselineStatus = 'COMPLETE' | 'UNVERIFIED';
export type BaselineQuoteKind = 'USD_CALIBRATION' | 'ENTRY' | 'INDEPENDENT_REVERSE_EXIT';
export type QuoteMode = 'EXACT_INPUT' | 'EXACT_OUTPUT';

export interface LaunchMarket {
  launchId: string;
  launchedToken: Hex;
  baseToken: Hex;
  token0: Hex;
  token1: Hex;
  fee: number;
  pool: Hex;
  positionLiquidity: bigint;
  activeLiquidity: bigint;
  sqrtPriceX96Before: bigint;
}

export interface BaselineQuoteReceipt {
  quoteId: string;
  launchId: string;
  blockNumber: bigint;
  blockHash: Hex;
  observedAtMs: number;
  kind: BaselineQuoteKind;
  mode: QuoteMode;
  notionalUsdMicros: bigint;
  pool: Hex;
  tokenIn: Hex;
  tokenOut: Hex;
  fee: number;
  amountIn: bigint;
  amountOut: bigint;
  executable: boolean;
  failureReason?: string;
  sqrtPriceX96After?: bigint;
  initializedTicksCrossed?: number;
  gasEstimate?: bigint;
}

export interface UsdCalibration {
  kind: 'USDT0_NOMINAL_PEG_V0' | 'WETH_USDT0_EXACT_OUTPUT_V0';
  notionalUsdMicros: bigint;
  baseToken: Hex;
  baseAmount: bigint;
  baseDecimals: number;
  quote?: BaselineQuoteReceipt;
}

export interface BaselineLeg {
  notionalUsdMicros: bigint;
  calibration: UsdCalibration;
  entry: BaselineQuoteReceipt;
  reverse: BaselineQuoteReceipt | null;
  /**
   * This is intentionally NOT a sequential paper-PnL estimate. Entry and reverse
   * quotes read the same pre-trade pool state. It is only a sellability/recovery
   * diagnostic and must never be promoted to realized or simulated return.
   */
  independentReverseRecoveryBps: bigint | null;
}

export interface ExecutableBaselineBatch {
  baselineId: string;
  authorityDigest: string;
  launchId: string;
  policyVersion: typeof EXECUTABLE_BASELINE_R1;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  observedAtMs: number;
  status: BaselineStatus;
  reason?: string;
  market: LaunchMarket | null;
  legs: BaselineLeg[];
  reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL';
}

export function scaleUsdMicrosToTokenUnits(usdMicros: bigint, decimals: number): bigint {
  if (usdMicros <= 0n) throw new Error('usdMicros must be > 0');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`INVALID_TOKEN_DECIMALS:${decimals}`);
  }
  const scale = 10n ** BigInt(decimals);
  const amount = (usdMicros * scale) / 1_000_000n;
  if (amount <= 0n) throw new Error(`USD_NOTIONAL_ROUNDS_TO_ZERO:${usdMicros}:${decimals}`);
  return amount;
}

export function independentRecoveryBps(entryAmountIn: bigint, reverseAmountOut: bigint): bigint {
  if (entryAmountIn <= 0n) throw new Error('entryAmountIn must be > 0');
  if (reverseAmountOut < 0n) throw new Error('reverseAmountOut must be >= 0');
  return (reverseAmountOut * 10_000n) / entryAmountIn;
}

export async function deriveBaselineId(input: {
  launchId: string;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
}): Promise<string> {
  return sha256Hex({
    kind: EXECUTABLE_BASELINE_R1,
    launchId: input.launchId,
    decisionBlock: input.decisionBlock,
    decisionBlockHash: input.decisionBlockHash.toLowerCase()
  });
}

export async function deriveBaselineQuoteId(input: {
  launchId: string;
  decisionBlockHash: Hex;
  kind: BaselineQuoteKind;
  notionalUsdMicros: bigint;
}): Promise<string> {
  return sha256Hex({
    kind: 'BASELINE_QUOTE_R1',
    launchId: input.launchId,
    decisionBlockHash: input.decisionBlockHash.toLowerCase(),
    quoteKind: input.kind,
    notionalUsdMicros: input.notionalUsdMicros
  });
}

export async function deriveBaselineAuthorityDigest(batch: Omit<ExecutableBaselineBatch, 'authorityDigest'>): Promise<string> {
  return sha256Hex(baselineAuthority(batch));
}

export function baselineAuthority(batch: Omit<ExecutableBaselineBatch, 'authorityDigest'> | ExecutableBaselineBatch) {
  return {
    baselineId: batch.baselineId,
    launchId: batch.launchId,
    policyVersion: batch.policyVersion,
    decisionBlock: batch.decisionBlock,
    decisionBlockHash: batch.decisionBlockHash.toLowerCase(),
    status: batch.status,
    reason: batch.reason ?? null,
    market: batch.market,
    legs: batch.legs.map((leg) => ({
      ...leg,
      calibration: {
        ...leg.calibration,
        quote: leg.calibration.quote ? stripObservedAt(leg.calibration.quote) : undefined
      },
      entry: stripObservedAt(leg.entry),
      reverse: leg.reverse ? stripObservedAt(leg.reverse) : null
    })),
    reverseSemantics: batch.reverseSemantics
  };
}

export function flattenBaselineQuotes(batch: ExecutableBaselineBatch): BaselineQuoteReceipt[] {
  const quotes: BaselineQuoteReceipt[] = [];
  for (const leg of batch.legs) {
    if (leg.calibration.quote) quotes.push(leg.calibration.quote);
    quotes.push(leg.entry);
    if (leg.reverse) quotes.push(leg.reverse);
  }
  return quotes;
}

export function isLaunchEligibleForDecision(
  launch: LaunchObserved,
  headBlock: bigint,
  decisionDelayBlocks: bigint,
  confirmations: bigint = 0n
): boolean {
  return launch.blockNumber + decisionDelayBlocks + confirmations <= headBlock;
}

function stripObservedAt(quote: BaselineQuoteReceipt) {
  const { observedAtMs: _ignored, ...authority } = quote;
  return authority;
}
