import type { Hex, LaunchObserved } from '../domain.js';
import type { DecisionReceipt, OutcomeReceipt } from '../evidence/receipts.js';
import type { ProvenanceEdge, ProvenanceFact } from '../graph/provenance.js';
import type { ShadowEntry } from '../shadow/ports.js';

export interface ChainCheckpoint {
  blockNumber: bigint;
  blockHash: Hex;
  /** One configured reorg horizon behind blockNumber; null only for legacy checkpoints. */
  guardBlockNumber: bigint | null;
  guardBlockHash: Hex | null;
}

export interface Store {
  putLaunch(launch: LaunchObserved): Promise<'INSERTED' | 'DUPLICATE'>;
  getLaunch(launchId: string): Promise<LaunchObserved | null>;
  listLaunchesMissingProvenance(): Promise<LaunchObserved[]>;
  putProvenanceFact(fact: ProvenanceFact): Promise<'INSERTED' | 'DUPLICATE'>;
  listProvenanceFacts(): Promise<ProvenanceFact[]>;
  replaceProvenanceEdges(edges: ProvenanceEdge[]): Promise<void>;
  listProvenanceEdges(): Promise<ProvenanceEdge[]>;
  putDecision(receipt: DecisionReceipt): Promise<'INSERTED' | 'DUPLICATE'>;
  putShadowEntry(entry: ShadowEntry): Promise<'INSERTED' | 'DUPLICATE'>;
  putOutcome(receipt: OutcomeReceipt): Promise<'INSERTED' | 'DUPLICATE'>;
  getCheckpoint(): Promise<ChainCheckpoint | null>;
  commitCheckpoint(checkpoint: ChainCheckpoint): Promise<void>;
  rewindFromBlock(fromBlock: bigint): Promise<void>;
}
