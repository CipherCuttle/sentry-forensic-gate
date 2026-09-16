import type { Hex, LaunchObserved } from '../domain.js';
import type { ExecutableBaselineBatch } from '../shadow/baselineTypes.js';
import type { FastVetDecision } from '../evaluation/fastVet.js';
import type { CanarySwapIntent } from './swapIntent.js';

export type CanaryActionState = 'SKIPPED' | 'RESERVED' | 'SIGNED' | 'SUBMITTED' | 'INCLUDED' | 'REVERTED' | 'SAFE_HALT';

export interface CanaryCandidate {
  launch: LaunchObserved;
  baseline: ExecutableBaselineBatch;
}

export interface CanaryActionRecord {
  actionId: string;
  launchId: string;
  baselineId: string;
  decision: FastVetDecision;
  reasons: string[];
  state: CanaryActionState;
  originDecisionBlock: bigint;
  originDecisionBlockHash: Hex;
  intent: CanarySwapIntent | null;
  nonce: number | null;
  transactionHash: Hex | null;
  serializedTransaction: Hex | null;
  lastError: string | null;
  outputBalanceBefore: bigint | null;
  outputBalanceAfter: bigint | null;
  createdAtMs: number;
  updatedAtMs: number;
}
