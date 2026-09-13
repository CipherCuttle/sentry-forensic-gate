export type Hex = `0x${string}`;
export type DecisionState = 'PASS' | 'REJECT' | 'UNVERIFIED';
export type RiskBand = 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' | 'UNKNOWN';
export type EvidenceState = 'GOOD' | 'BAD' | 'UNKNOWN' | 'CONTRADICTORY' | 'NOT_OBSERVED';
export type LaunchType = 'STANDARD' | 'AGENT' | 'KRAKEN_VERIFIED' | 'GO_PUMP_ME';
export type LaunchEventName = 'TokenDeployed' | 'KrakenVerifiedTokenDeployed' | 'GoPumpMeTokenDeployed';

export interface ChainPoint {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex;
  observedAtMs: number;
}

export interface LaunchObserved extends ChainPoint {
  /** Canonical economic identity. Collapses duplicate deployment-event variants in one tx. */
  launchId: string;
  /** Source log identity for audit/replay. */
  eventId: string;
  factory: Hex;
  txHash: Hex;
  logIndex: number;
  token: Hex;
  creator: Hex;
  tokenId: bigint;
  name: string;
  symbol: string;
  launchType: LaunchType;
  sourceEvent: LaunchEventName;
}

export interface QuoteObservation extends ChainPoint {
  launchId: string;
  direction: 'ENTRY' | 'REVERSE_EXIT';
  notionalUsdMicros: bigint;
  amountIn: bigint;
  amountOut: bigint;
  executable: boolean;
  failureReason?: string;
}
