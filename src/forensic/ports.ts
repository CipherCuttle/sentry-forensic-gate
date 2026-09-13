import type { EvidenceState, LaunchObserved } from '../domain.js';
import type { GraphEdge } from '../graph/types.js';

export interface CreatorEvidence {
  state: EvidenceState;
  priorLaunches: number;
  priorCatastrophic: number;
  edges: GraphEdge[];
}

export interface CreatorForensics {
  inspect(launch: LaunchObserved, decisionBlock: bigint): Promise<CreatorEvidence>;
}

export interface FlowEvidence {
  state: EvidenceState;
  uniqueBuyers?: number;
  top1Pct?: number;
  top3Pct?: number;
  botting?: 'NONE' | 'MILD' | 'STRONG';
}

export interface EarlyFlowForensics {
  inspect(launch: LaunchObserved, asOfBlock: bigint): Promise<FlowEvidence>;
}
