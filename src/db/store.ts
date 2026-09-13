import type { LaunchObserved } from '../domain.js';
import type { DecisionReceipt, OutcomeReceipt } from '../evidence/receipts.js';
import type { ShadowEntry } from '../shadow/ports.js';

export interface Store {
  putLaunch(launch: LaunchObserved): Promise<'INSERTED' | 'DUPLICATE'>;
  putDecision(receipt: DecisionReceipt): Promise<'INSERTED' | 'DUPLICATE'>;
  putShadowEntry(entry: ShadowEntry): Promise<'INSERTED' | 'DUPLICATE'>;
  putOutcome(receipt: OutcomeReceipt): Promise<'INSERTED' | 'DUPLICATE'>;
  getLastProcessedBlock(): Promise<bigint | null>;
  setLastProcessedBlock(block: bigint): Promise<void>;
}
