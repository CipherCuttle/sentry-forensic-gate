import type { Hex } from '../domain.js';
import type { ProvenanceEdge } from './provenance.js';

export type EntityKind = 'TOKEN' | 'LAUNCH' | 'WALLET' | 'POOL' | 'FUNDING_SOURCE' | 'OUTCOME';

export interface GraphNode {
  id: string;
  kind: EntityKind;
  address?: Hex;
}

/** @deprecated Use ProvenanceEdge. Kept as a source-compatible alias for forensic ports. */
export type GraphEdge = ProvenanceEdge;
