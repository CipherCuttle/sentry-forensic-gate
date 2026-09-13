import type { LaunchObserved } from '../domain.js';
import type { DecisionReceipt, OutcomeReceipt } from '../evidence/receipts.js';
import type { ShadowEntry } from '../shadow/ports.js';
import type { Store } from './store.js';

export class MemoryStore implements Store {
  private launches = new Set<string>();
  private decisions = new Set<string>();
  private shadow = new Set<string>();
  private outcomes = new Set<string>();
  private lastBlock: bigint | null = null;

  async putLaunch(v: LaunchObserved) { return this.insert(this.launches, v.launchId); }
  async putDecision(v: DecisionReceipt) { return this.insert(this.decisions, v.decisionId); }
  async putShadowEntry(v: ShadowEntry) { return this.insert(this.shadow, `${v.launchId}:${v.notionalUsdMicros}`); }
  async putOutcome(v: OutcomeReceipt) { return this.insert(this.outcomes, v.outcomeId); }
  async getLastProcessedBlock() { return this.lastBlock; }
  async setLastProcessedBlock(block: bigint) { this.lastBlock = block; }

  private insert(set: Set<string>, key: string): 'INSERTED' | 'DUPLICATE' {
    if (set.has(key)) return 'DUPLICATE';
    set.add(key);
    return 'INSERTED';
  }
}
