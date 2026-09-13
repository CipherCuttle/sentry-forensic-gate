import type { Hex } from '../domain.js';
import type { DecisionState, EvidenceState, LaunchObserved, RiskBand } from '../domain.js';

export interface FeatureEvidence {
  protocol: EvidenceState;
  exit: EvidenceState;
  creator: EvidenceState;
  provenance: EvidenceState;
  distribution: EvidenceState;
  earlyFlow: EvidenceState;
  liquidity: EvidenceState;
}

export interface DecisionReceipt {
  decisionId: string;
  launchId: string;
  decisionBlock: bigint;
  gateVersion: string;
  policyDigest: string;
  evidenceDigest: string;
  hardGate: DecisionState;
  riskBand: RiskBand;
  evidenceCompleteness: number;
  features: FeatureEvidence;
}

export interface LaunchReceipt {
  launch: LaunchObserved;
  evidenceDigest: string;
}

export interface OutcomeReceipt {
  outcomeId: string;
  launchId: string;
  horizonMs: number;
  observedBlock: bigint;
  executableValueUsdMicros?: bigint;
  sellable: boolean;
  liquidityUsdMicros?: bigint;
  classification?: 'CATASTROPHIC_LOSS' | 'EXIT_FAILURE' | 'LIQUIDITY_COLLAPSE' | 'NORMAL_LOSS' | 'NORMAL_WIN' | 'FAT_TAIL_WIN';

  // FORWARD_OUTCOMES_R1 adds these fields. They remain optional here so legacy
  // fixture receipts can still be replayed; ForwardOutcomeReceipt requires them.
  policyVersion?: string;
  status?: 'COMPLETE' | 'UNVERIFIED';
  reason?: string;
  observedBlockHash?: Hex;
  targetTimestampMs?: number;
  observedTimestampMs?: number;
  baselineId?: string;
  entryNotionalUsdMicros?: bigint;
  entryTokenAmount?: bigint;
  marketPool?: Hex;
  marketFee?: number;
  baseToken?: Hex;
  baseAmountOut?: bigint;
  executableReturnBps?: bigint;
  poolActiveLiquidity?: bigint;
  evidenceDigest?: string;
}
