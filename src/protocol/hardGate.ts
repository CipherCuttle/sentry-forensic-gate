import type { DecisionState } from '../domain.js';

export interface HardGateEvidence {
  canonicalLaunch: boolean | null;
  poolResolved: boolean | null;
  infrastructureMatches: boolean | null;
  entryExecutable: boolean | null;
  reverseExitExecutable: boolean | null;
  contradictoryChainState: boolean;
}

export interface HardGateResult {
  state: DecisionState;
  reasons: string[];
}

export function evaluateHardGate(e: HardGateEvidence): HardGateResult {
  const reasons: string[] = [];
  if (e.contradictoryChainState) return { state: 'REJECT', reasons: ['CONTRADICTORY_CHAIN_STATE'] };
  if (e.canonicalLaunch === false) reasons.push('NON_CANONICAL_LAUNCH');
  if (e.poolResolved === false) reasons.push('POOL_RELATION_INVALID');
  if (e.infrastructureMatches === false) reasons.push('INFRASTRUCTURE_MISMATCH');
  if (e.entryExecutable === false) reasons.push('ENTRY_UNEXECUTABLE');
  if (e.reverseExitExecutable === false) reasons.push('REVERSE_EXIT_UNEXECUTABLE');
  if (reasons.length) return { state: 'REJECT', reasons };

  const missing = [e.canonicalLaunch, e.poolResolved, e.infrastructureMatches, e.entryExecutable, e.reverseExitExecutable].some((v) => v === null);
  return missing ? { state: 'UNVERIFIED', reasons: ['CRITICAL_EVIDENCE_MISSING'] } : { state: 'PASS', reasons: [] };
}
