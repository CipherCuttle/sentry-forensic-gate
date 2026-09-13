import type { Hex } from '../domain.js';

export type EntityKind = 'TOKEN' | 'LAUNCH' | 'WALLET' | 'POOL' | 'FUNDING_SOURCE' | 'OUTCOME';
export type EdgeKind = 'DEPLOYED_BY' | 'FUNDED_BY' | 'BOUGHT_BY' | 'TRANSFERRED_TO' | 'CREATED_POOL' | 'PREVIOUS_LAUNCH' | 'SHARED_FUNDER';

export interface GraphNode {
  id: string;
  kind: EntityKind;
  address?: Hex;
}

export interface GraphEdge {
  id: string;
  kind: EdgeKind;
  from: string;
  to: string;
  observedBlock: bigint;
  source: string;
  confidence: number;
  evidenceDigest: string;
}
