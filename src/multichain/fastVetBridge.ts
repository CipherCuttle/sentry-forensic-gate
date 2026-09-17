import { evaluateFastVet, type FastVetInput, type FastVetResult } from '../evaluation/fastVet.js';
import type { CreatorOutcomeFeatureReceipt } from '../forensic/creatorOutcome.js';
import {
  EXECUTABLE_BASELINE_R1,
  HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1,
  type ExecutableBaselineBatch
} from '../shadow/baselineTypes.js';
import type { PortableFastVetBaselineEvidence } from './domain.js';

export interface PortableFastVetInput {
  baseline: PortableFastVetBaselineEvidence | null;
  creatorFeature: CreatorOutcomeFeatureReceipt | null;
}

const REVIEWED_BASELINE_POLICIES = new Set<string>([
  EXECUTABLE_BASELINE_R1,
  HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1
]);

/**
 * Compatibility bridge into the byte-frozen FAST_VET_R0 implementation.
 *
 * FAST_VET's current TypeScript signature names ExecutableBaselineBatch even
 * though its runtime decision function reads only PortableFastVetBaselineEvidence.
 * Do not synthesize a fake Ink/Tsunami market merely to satisfy that legacy type.
 * The single cast below is therefore isolated here and guarded by reviewed policy
 * and reverse-semantics checks; all decision logic remains in evaluateFastVet().
 */
export function evaluatePortableFastVet(input: PortableFastVetInput): FastVetResult {
  if (input.baseline) assertPortableFastVetEvidence(input.baseline);

  const frozenInput: FastVetInput = {
    baseline: input.baseline as unknown as ExecutableBaselineBatch | null,
    creatorFeature: input.creatorFeature
  };
  return evaluateFastVet(frozenInput);
}

export function assertPortableFastVetEvidence(baseline: PortableFastVetBaselineEvidence): void {
  if (!REVIEWED_BASELINE_POLICIES.has(baseline.policyVersion)) {
    throw new Error(`MULTICHAIN_FAST_VET_POLICY_UNAUTHORIZED:${baseline.policyVersion}`);
  }
  if (baseline.reverseSemantics !== 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL') {
    throw new Error(`MULTICHAIN_FAST_VET_REVERSE_SEMANTICS_MISMATCH:${baseline.reverseSemantics}`);
  }
  if (!baseline.authorityDigest) throw new Error('MULTICHAIN_FAST_VET_AUTHORITY_DIGEST_MISSING');
  if (!baseline.baselineId) throw new Error('MULTICHAIN_FAST_VET_BASELINE_ID_MISSING');
  if (!baseline.launchId) throw new Error('MULTICHAIN_FAST_VET_LAUNCH_ID_MISSING');
}
