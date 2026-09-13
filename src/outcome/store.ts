import type { LaunchObserved } from '../domain.js';
import type { OutcomeReceipt } from '../evidence/receipts.js';
import type { ExecutableBaselineBatch } from '../shadow/baselineTypes.js';

export interface ForwardOutcomeStore {
  listBaselineBatchesPendingOutcome(horizonMs: number, limit: number): Promise<ExecutableBaselineBatch[]>;
  getLaunch(launchId: string): Promise<LaunchObserved | null>;
  putOutcome(receipt: OutcomeReceipt): Promise<'INSERTED' | 'DUPLICATE'>;
}
