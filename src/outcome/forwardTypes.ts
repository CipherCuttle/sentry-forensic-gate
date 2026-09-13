import type { Hex } from '../domain.js';
import { sha256Hex } from '../evidence/canonical.js';
import type { OutcomeReceipt } from '../evidence/receipts.js';

export const FORWARD_OUTCOMES_R1 = 'FORWARD_OUTCOMES_R1' as const;
export const PRIMARY_OUTCOME_NOTIONAL_USD_MICROS = 1_000_000n;
export const CATASTROPHIC_RECOVERY_BPS = 2_000n;
export const PAR_RECOVERY_BPS = 10_000n;

export type ForwardOutcomeStatus = 'COMPLETE' | 'UNVERIFIED';

export interface ForwardOutcomeReceipt extends OutcomeReceipt {
  policyVersion: typeof FORWARD_OUTCOMES_R1;
  status: ForwardOutcomeStatus;
  observedBlockHash: Hex;
  targetTimestampMs: number;
  observedTimestampMs: number;
  baselineId: string;
  entryNotionalUsdMicros: bigint;
  entryTokenAmount: bigint;
  marketPool: Hex;
  marketFee: number;
  baseToken: Hex;
  baseAmountOut: bigint;
  executableReturnBps?: bigint;
  poolActiveLiquidity: bigint;
  evidenceDigest: string;
}

export async function deriveForwardOutcomeId(input: {
  launchId: string;
  baselineId: string;
  horizonMs: number;
}): Promise<string> {
  return sha256Hex({
    kind: FORWARD_OUTCOMES_R1,
    launchId: input.launchId,
    baselineId: input.baselineId,
    horizonMs: input.horizonMs
  });
}

export async function deriveForwardOutcomeEvidenceDigest(receipt: Omit<ForwardOutcomeReceipt, 'evidenceDigest'>): Promise<string> {
  return sha256Hex({
    ...receipt,
    observedBlockHash: receipt.observedBlockHash.toLowerCase(),
    marketPool: receipt.marketPool.toLowerCase(),
    baseToken: receipt.baseToken.toLowerCase()
  });
}
