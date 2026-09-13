export type Hex = `0x${string}`;
export type DecisionState = 'PASS' | 'REJECT' | 'UNVERIFIED';
export type RiskBand = 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH' | 'UNKNOWN';
export type EvidenceState = 'GOOD' | 'BAD' | 'UNKNOWN' | 'CONTRADICTORY' | 'NOT_OBSERVED';

export interface ChainPoint {
  chainId: number;
  blockNumber: bigint;
  blockHash: Hex;
  observedAtMs: number;
}

export interface LaunchObserved extends ChainPoint {
  launchId: string;
  factory: Hex;
  txHash: Hex;
  logIndex: number;
  token: Hex;
  creator: Hex;
  launchType: string;
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
