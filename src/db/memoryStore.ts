import type { LaunchObserved } from '../domain.js';
import type { DecisionReceipt, OutcomeReceipt } from '../evidence/receipts.js';
import type { ProvenanceEdge, ProvenanceFact } from '../graph/provenance.js';
import { normalizeLaunchHex, sameLaunchAuthority } from '../sentry/identity.js';
import type { ExecutableBaselineBatch } from '../shadow/baselineTypes.js';
import type { BaselineStore } from '../shadow/baselineStore.js';
import type { ShadowEntry } from '../shadow/ports.js';
import type { ChainCheckpoint, Store } from './store.js';

export class MemoryStore implements Store, BaselineStore {
  private launches = new Map<string, LaunchObserved>();
  private provenanceFacts = new Map<string, ProvenanceFact>();
  private provenanceEdges = new Map<string, ProvenanceEdge>();
  private decisions = new Map<string, DecisionReceipt>();
  private shadow = new Map<string, ShadowEntry>();
  private outcomes = new Map<string, OutcomeReceipt>();
  private baselines = new Map<string, ExecutableBaselineBatch>();
  private checkpoint: ChainCheckpoint | null = null;

  get launchCount(): number { return this.launches.size; }
  get baselineCount(): number { return this.baselines.size; }

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

  async putProvenanceFact(fact: ProvenanceFact): Promise<'INSERTED' | 'DUPLICATE'> {
    if (!this.launches.has(fact.launchId)) throw new Error(`PROVENANCE_LAUNCH_MISSING:${fact.launchId}`);
    const existing = this.provenanceFacts.get(fact.factId);
    const launchCollision = [...this.provenanceFacts.values()].find((item) => item.launchId === fact.launchId);
    const collision = existing ?? launchCollision;
    if (collision) {
      if (collision.factId !== fact.factId || collision.evidenceDigest !== fact.evidenceDigest) {
        throw new Error(`PROVENANCE_FACT_IDENTITY_CONFLICT:${fact.factId}`);
      }
      return 'DUPLICATE';
    }
    this.provenanceFacts.set(fact.factId, fact);
    return 'INSERTED';
  }

  async listProvenanceFacts(): Promise<ProvenanceFact[]> {
    return [...this.provenanceFacts.values()].sort(compareFacts);
  }

  async replaceProvenanceEdges(edges: ProvenanceEdge[]): Promise<void> {
    const next = new Map<string, ProvenanceEdge>();
    for (const edge of edges) {
      const existing = next.get(edge.edgeId);
      if (existing && existing.evidenceDigest !== edge.evidenceDigest) {
        throw new Error(`PROVENANCE_EDGE_IDENTITY_CONFLICT:${edge.edgeId}`);
      }
      next.set(edge.edgeId, edge);
    }
    this.provenanceEdges = next;
  }

  async listProvenanceEdges(): Promise<ProvenanceEdge[]> {
    return [...this.provenanceEdges.values()].sort(compareEdges);
  }

  async putDecision(v: DecisionReceipt) { return this.insertMap(this.decisions, v.decisionId, v); }
  async putShadowEntry(v: ShadowEntry) {
    return this.insertMap(this.shadow, `${v.launchId}:${v.notionalUsdMicros}`, v);
  }
  async putOutcome(v: OutcomeReceipt) { return this.insertMap(this.outcomes, v.outcomeId, v); }

  async listLaunchesPendingBaseline(maxLaunchBlock: bigint, limit: number): Promise<LaunchObserved[]> {
    return [...this.launches.values()]
      .filter((launch) => launch.blockNumber <= maxLaunchBlock && !this.baselines.has(launch.launchId))
      .sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1)
      .slice(0, limit);
  }

  async putBaselineBatch(batch: ExecutableBaselineBatch): Promise<'INSERTED' | 'DUPLICATE'> {
    if (!this.launches.has(batch.launchId)) throw new Error(`BASELINE_LAUNCH_MISSING:${batch.launchId}`);
    const existing = this.baselines.get(batch.launchId);
    if (existing) {
      if (existing.baselineId !== batch.baselineId || existing.authorityDigest !== batch.authorityDigest) {
        throw new Error(`BASELINE_IDENTITY_CONFLICT:${batch.launchId}`);
      }
      return 'DUPLICATE';
    }
    this.baselines.set(batch.launchId, batch);
    return 'INSERTED';
  }

  async getCheckpoint(): Promise<ChainCheckpoint | null> {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  async commitCheckpoint(checkpoint: ChainCheckpoint): Promise<void> {
    this.checkpoint = {
      ...checkpoint,
      blockHash: checkpoint.blockHash.toLowerCase() as ChainCheckpoint['blockHash'],
      guardBlockHash: checkpoint.guardBlockHash
        ? checkpoint.guardBlockHash.toLowerCase() as NonNullable<ChainCheckpoint['guardBlockHash']>
        : null
    };
  }

  async rewindFromBlock(fromBlock: bigint): Promise<void> {
    const removedLaunches = new Set<string>();
    for (const [id, launch] of this.launches) {
      if (launch.blockNumber >= fromBlock) {
        removedLaunches.add(id);
        this.launches.delete(id);
      }
    }

    for (const [id, fact] of this.provenanceFacts) {
      if (removedLaunches.has(fact.launchId) || fact.observedBlock >= fromBlock) this.provenanceFacts.delete(id);
    }
    for (const [id, edge] of this.provenanceEdges) {
      if (edge.observedBlock >= fromBlock || edge.sourceFactIds.some((factId) => !this.provenanceFacts.has(factId))) {
        this.provenanceEdges.delete(id);
      }
    }

    // Evidence is invalidated by its own observation block as well as by launch ancestry.
    for (const [id, receipt] of this.decisions) {
      if (removedLaunches.has(receipt.launchId) || receipt.decisionBlock >= fromBlock) this.decisions.delete(id);
    }
    for (const [id, entry] of this.shadow) {
      if (removedLaunches.has(entry.launchId) || entry.entry.blockNumber >= fromBlock || entry.immediateExit.blockNumber >= fromBlock) {
        this.shadow.delete(id);
      }
    }
    for (const [id, receipt] of this.outcomes) {
      if (removedLaunches.has(receipt.launchId) || receipt.observedBlock >= fromBlock) this.outcomes.delete(id);
    }
    for (const [launchId, batch] of this.baselines) {
      if (removedLaunches.has(launchId) || batch.decisionBlock >= fromBlock) this.baselines.delete(launchId);
    }

    if (this.checkpoint && this.checkpoint.blockNumber >= fromBlock) this.checkpoint = null;
  }

  private insertMap<T>(map: Map<string, T>, key: string, value: T): 'INSERTED' | 'DUPLICATE' {
    if (map.has(key)) return 'DUPLICATE';
    map.set(key, value);
    return 'INSERTED';
  }
}

function compareFacts(a: ProvenanceFact, b: ProvenanceFact): number {
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (a.observedBlock !== b.observedBlock) return a.observedBlock < b.observedBlock ? -1 : 1;
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.factId.localeCompare(b.factId);
}

function compareEdges(a: ProvenanceEdge, b: ProvenanceEdge): number {
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (a.observedBlock !== b.observedBlock) return a.observedBlock < b.observedBlock ? -1 : 1;
  return a.edgeId.localeCompare(b.edgeId);
}
