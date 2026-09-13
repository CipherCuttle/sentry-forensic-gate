import type { LaunchObserved } from '../domain.js';
import type { DecisionReceipt, OutcomeReceipt } from '../evidence/receipts.js';
import { normalizeLaunchHex, sameLaunchAuthority } from '../sentry/identity.js';
import type { ShadowEntry } from '../shadow/ports.js';
import type { ChainCheckpoint, Store } from './store.js';

export class MemoryStore implements Store {
  private launches = new Map<string, LaunchObserved>();
  private decisions = new Map<string, DecisionReceipt>();
  private shadow = new Map<string, ShadowEntry>();
  private outcomes = new Map<string, OutcomeReceipt>();
  private checkpoint: ChainCheckpoint | null = null;

  get launchCount(): number { return this.launches.size; }

  async putLaunch(v: LaunchObserved): Promise<'INSERTED' | 'DUPLICATE'> {
    const normalized = normalizeLaunchHex(v);
    const existing = this.launches.get(normalized.launchId);
    if (existing) {
      if (!sameLaunchAuthority(existing, normalized)) {
        throw new Error(`LAUNCH_IDENTITY_CONFLICT:${normalized.launchId}`);
      }
      return 'DUPLICATE';
    }
    const economicCollision = [...this.launches.values()].find((launch) =>
      launch.chainId === normalized.chainId &&
      launch.txHash === normalized.txHash &&
      launch.token === normalized.token
    );
    if (economicCollision) throw new Error(`LAUNCH_IDENTITY_CONFLICT:${normalized.launchId}`);
    this.launches.set(normalized.launchId, normalized);
    return 'INSERTED';
  }

  async getLaunch(launchId: string): Promise<LaunchObserved | null> {
    return this.launches.get(launchId) ?? null;
  }

  async putDecision(v: DecisionReceipt) { return this.insertMap(this.decisions, v.decisionId, v); }
  async putShadowEntry(v: ShadowEntry) {
    return this.insertMap(this.shadow, `${v.launchId}:${v.notionalUsdMicros}`, v);
  }
  async putOutcome(v: OutcomeReceipt) { return this.insertMap(this.outcomes, v.outcomeId, v); }

  async getCheckpoint(): Promise<ChainCheckpoint | null> {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  async commitCheckpoint(checkpoint: ChainCheckpoint): Promise<void> {
    this.checkpoint = { ...checkpoint, blockHash: checkpoint.blockHash.toLowerCase() as ChainCheckpoint['blockHash'] };
  }

  async rewindFromBlock(fromBlock: bigint): Promise<void> {
    const removed = new Set<string>();
    for (const [id, launch] of this.launches) {
      if (launch.blockNumber >= fromBlock) {
        removed.add(id);
        this.launches.delete(id);
      }
    }
    for (const [id, receipt] of this.decisions) if (removed.has(receipt.launchId)) this.decisions.delete(id);
    for (const [id, entry] of this.shadow) if (removed.has(entry.launchId)) this.shadow.delete(id);
    for (const [id, receipt] of this.outcomes) if (removed.has(receipt.launchId)) this.outcomes.delete(id);
    if (this.checkpoint && this.checkpoint.blockNumber >= fromBlock) this.checkpoint = null;
  }

  private insertMap<T>(map: Map<string, T>, key: string, value: T): 'INSERTED' | 'DUPLICATE' {
    if (map.has(key)) return 'DUPLICATE';
    map.set(key, value);
    return 'INSERTED';
  }
}
