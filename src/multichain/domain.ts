import type { Hex } from '../domain.js';

export const MULTICHAIN_SHADOW_RESEARCH_AUTHORITY = 'SHADOW_RESEARCH_ONLY_EDGE_UNPROVEN' as const;
export const MULTICHAIN_ADAPTER_MODE = 'SHADOW_ONLY' as const;

export type ResearchEcosystem = 'INK' | 'ROBINHOOD' | 'ARC';
export type LaunchProtocolId = 'SENTRY' | 'PONS' | 'PAR';

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

/** Protocol-specific authority retained at the normalization boundary. */
export interface SourceAuthorityEnvelope {
  schema: string;
  payload: CanonicalJsonValue;
}

/**
 * Chain-neutral launch identity used by the research engine.
 * Protocol-specific fields are not discarded; they remain in sourceAuthority.
 */
export interface NormalizedLaunchCandidate {
  chainId: number;
  ecosystem: ResearchEcosystem;
  launchProtocol: LaunchProtocolId;
  launchId: string;
  eventId: string;
  factory: Hex;
  txHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  logIndex: number;
  token: Hex;
  creator: Hex;
  name: string;
  symbol: string;
  sourceEventName: string;
  observedAtMs: number;
  sourceAuthority: SourceAuthorityEnvelope;
}

/**
 * Research-level market identity. DEX-specific pool/curve/orderbook state stays
 * inside sourceAuthority instead of forcing every ecosystem into Ink/Tsunami V3 semantics.
 */
export interface NormalizedMarket {
  marketId: string;
  launchId: string;
  chainId: number;
  ecosystem: ResearchEcosystem;
  launchProtocol: LaunchProtocolId;
  launchedToken: Hex;
  baseAsset: Hex;
  venue: string;
  sourceAuthority: SourceAuthorityEnvelope;
}

export interface UsdCalibrationObservation {
  notionalUsdMicros: bigint;
  baseAsset: Hex;
  baseAmount: bigint;
  baseDecimals: number;
  sourceAuthority: SourceAuthorityEnvelope;
}

export type PortableQuoteKind = 'ENTRY' | 'INDEPENDENT_REVERSE_EXIT';

export interface PortableQuoteObservation {
  quoteId: string;
  launchId: string;
  marketId: string;
  blockNumber: bigint;
  blockHash: Hex;
  observedAtMs: number;
  kind: PortableQuoteKind;
  notionalUsdMicros: bigint;
  tokenIn: Hex;
  tokenOut: Hex;
  amountIn: bigint;
  amountOut: bigint;
  executable: boolean;
  failureReason?: string;
  gasEstimate?: bigint;
  sourceAuthority: SourceAuthorityEnvelope;
}

export interface PortableBaselineLeg {
  notionalUsdMicros: bigint;
  calibration: UsdCalibrationObservation;
  entry: PortableQuoteObservation;
  reverse: PortableQuoteObservation | null;
  /** Same diagnostic-only meaning as the frozen Ink baseline. */
  independentReverseRecoveryBps: bigint | null;
}

/**
 * Portable evidence contract accepted by the unchanged FAST_VET_R0 decision logic.
 * reverseSemantics is intentionally frozen so quote diagnostics cannot become paper PnL.
 */
export interface PortableBaselineBatch {
  baselineId: string;
  authorityDigest: string;
  launchId: string;
  chainId: number;
  ecosystem: ResearchEcosystem;
  launchProtocol: LaunchProtocolId;
  policyVersion: string;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  observedAtMs: number;
  status: 'COMPLETE' | 'UNVERIFIED';
  reason?: string;
  market: NormalizedMarket | null;
  legs: readonly PortableBaselineLeg[];
  reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL';
  sourceAuthority: SourceAuthorityEnvelope;
}

export interface NormalizedBlockPoint {
  blockNumber: bigint;
  blockHash: Hex;
  timestampMs: number;
}

export type LiquiditySurvivalState = 'SURVIVED' | 'COLLAPSED' | 'UNKNOWN';

export interface LiquidityObservation {
  state: LiquiditySurvivalState;
  sourceAuthority: SourceAuthorityEnvelope;
}

export interface PortableExitQuote {
  executable: boolean;
  amountOut: bigint;
  failureReason?: string;
  gasEstimate?: bigint;
  sourceAuthority: SourceAuthorityEnvelope;
}

export interface PortableUsdValuation {
  usdMicros: bigint;
  sourceAuthority: SourceAuthorityEnvelope;
}

export type PortableOutcomeClassification =
  | 'CATASTROPHIC_LOSS'
  | 'EXIT_FAILURE'
  | 'LIQUIDITY_COLLAPSE'
  | 'NORMAL_LOSS'
  | 'NORMAL_WIN';

/** Common prospective result envelope; adapters provide evidence, not strategy labels. */
export interface PortableForwardOutcome {
  outcomeId: string;
  authorityDigest: string;
  chainId: number;
  ecosystem: ResearchEcosystem;
  launchProtocol: LaunchProtocolId;
  launchId: string;
  baselineId: string;
  horizonMs: number;
  status: 'COMPLETE' | 'UNVERIFIED';
  observedBlock: bigint;
  observedBlockHash: Hex;
  targetTimestampMs: number;
  observedTimestampMs: number;
  entryNotionalUsdMicros: bigint;
  exitExecutable: boolean;
  baseAsset: Hex;
  baseAmountOut: bigint;
  executableValueUsdMicros?: bigint;
  gasCostUsdMicros?: bigint;
  slippageBps?: bigint;
  classification?: PortableOutcomeClassification;
  liquidity: LiquidityObservation;
  sourceAuthority: SourceAuthorityEnvelope;
}
