import type { Hex, LaunchObserved } from '../domain.js';
import type { DecisionReceipt, OutcomeReceipt } from '../evidence/receipts.js';
import type { ShadowEntry } from '../shadow/ports.js';

export interface ChainCheckpoint {
  blockNumber: bigint;
  blockHash: Hex;
}

export interface Store {
  putLaunch(launch: LaunchObserved): Promise<'INSERTED' | 'DUPLICATE'>;
  getLaunch(launchId: string): Promise<LaunchObserved | null>;
  putDecision(receipt: DecisionReceipt): Promise<'INSERTED' | 'DUPLICATE'>;
  putShadowEntry(entry: ShadowEntry): Promise<'INSERTED' | 'DUPLICATE'>;
  putOutcome(receipt: OutcomeReceipt): Promise<'INSERTED' | 'DUPLICATE'>;
  getCheckpoint(): Promise<ChainCheckpoint | null>;
  commitCheckpoint(checkpoint: ChainCheckpoint): Promise<void>;
  rewindFromBlock(fromBlock: bigint): Promise<void>;
}
