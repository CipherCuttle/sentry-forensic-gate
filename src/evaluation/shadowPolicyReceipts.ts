import { sha256Hex } from '../evidence/canonical.js';
import type { CreatorOutcomeFeatureReceipt } from '../forensic/creatorOutcome.js';
import type { PortableFastVetBaselineEvidence } from '../multichain/domain.js';
import {
  FAST_VET_R0_CONFIGURATION
} from './fastVet.js';
import {
  FAST_VET_R1_CAPACITY_GATE_CONFIGURATION,
  evaluateShadowPolicyComparison,
  type FastVetR1HypotheticalAction
} from './fastVetR1CapacityGate.js';

export const SHADOW_POLICY_DECISION_RECEIPTS_R1 =
  'SHADOW_POLICY_DECISION_RECEIPTS_R1' as const;
export const BUY_EVERY_EXECUTABLE_CONTROL_R1 =
  'BUY_EVERY_EXECUTABLE_CONTROL_R1' as const;

const CONTROL_CONFIGURATION = Object.freeze({
  policyVersion: BUY_EVERY_EXECUTABLE_CONTROL_R1,
  rule: 'MINIMUM_BIDIRECTIONAL_PROBE_EXECUTABLE',
  creatorEvidence: 'IGNORED',
  mode: 'SHADOW_ONLY',
  liveMoneyAuthority: false
} as const);

export interface ShadowPolicyDecisionReceipt {
  receiptVersion: typeof SHADOW_POLICY_DECISION_RECEIPTS_R1;
  receiptId: string;
  launchId: string;
  baselineId: string | null;
  decisionBlock: bigint | null;
  policyVersion: string;
  policyDigest: string;
  inputDigest: string;
  outputDigest: string;
  evidenceDigest: string;
  decision: string;
  hypotheticalAction: FastVetR1HypotheticalAction;
  reasons: readonly string[];
  uncertainties: readonly string[];
  capacityUsdMicros: bigint | null;
  mode: 'SHADOW_ONLY';
  liveMoneyAuthority: false;
  edge: 'UNPROVEN';
}

export interface ShadowPolicyComparisonReceipt {
  receiptVersion: typeof SHADOW_POLICY_DECISION_RECEIPTS_R1;
  comparisonId: string;
  launchId: string;
  baselineId: string | null;
  decisionBlock: bigint | null;
  inputDigest: string;
  receipts: {
    r0: ShadowPolicyDecisionReceipt;
    r1: ShadowPolicyDecisionReceipt;
    buyEveryExecutableControl: ShadowPolicyDecisionReceipt;
  };
  evidenceDigest: string;
  mode: 'SHADOW_ONLY';
  liveMoneyAuthority: false;
  edge: 'UNPROVEN';
}

export async function buildShadowPolicyComparisonReceipt(input: {
  launchId: string;
  baseline: PortableFastVetBaselineEvidence | null;
  creatorFeature: CreatorOutcomeFeatureReceipt | null;
}): Promise<ShadowPolicyComparisonReceipt> {
  assertBindings(input.launchId, input.baseline, input.creatorFeature);

  const comparison = evaluateShadowPolicyComparison({
    baseline: input.baseline,
    creatorFeature: input.creatorFeature
  });

  const inputDigest = await sha256Hex({
    receiptVersion: SHADOW_POLICY_DECISION_RECEIPTS_R1,
    launchId: input.launchId,
    baseline: input.baseline
      ? {
          baselineId: input.baseline.baselineId,
          authorityDigest: input.baseline.authorityDigest,
          decisionBlock: input.baseline.decisionBlock,
          decisionBlockHash: input.baseline.decisionBlockHash.toLowerCase(),
          status: input.baseline.status,
          policyVersion: input.baseline.policyVersion,
          reverseSemantics: input.baseline.reverseSemantics
        }
      : null,
    creator: input.creatorFeature
      ? {
          receiptId: input.creatorFeature.receiptId,
          evidenceDigest: input.creatorFeature.evidenceDigest,
          coverage: input.creatorFeature.coverage
        }
      : null
  });

  const [r0Digest, r1Digest, controlDigest] = await Promise.all([
    sha256Hex(FAST_VET_R0_CONFIGURATION),
    sha256Hex(FAST_VET_R1_CAPACITY_GATE_CONFIGURATION),
    sha256Hex(CONTROL_CONFIGURATION)
  ]);

  const r0 = await buildDecisionReceipt({
    launchId: input.launchId,
    baseline: input.baseline,
    policyVersion: comparison.r0.policyVersion,
    policyDigest: r0Digest,
    inputDigest,
    decision: comparison.r0.decision,
    hypotheticalAction:
      comparison.r0.action === 'BUY_ELIGIBLE' ? 'WOULD_TRADE' : 'WOULD_SKIP',
    reasons: comparison.r0.reasons,
    uncertainties: [],
    capacityUsdMicros: null,
    output: comparison.r0
  });

  const r1 = await buildDecisionReceipt({
    launchId: input.launchId,
    baseline: input.baseline,
    policyVersion: comparison.r1.policyVersion,
    policyDigest: r1Digest,
    inputDigest,
    decision: comparison.r1.decision,
    hypotheticalAction: comparison.r1.hypotheticalAction,
    reasons: comparison.r1.reasons,
    uncertainties: comparison.r1.uncertainties,
    capacityUsdMicros: comparison.r1.evidence.capacityUsdMicros,
    output: comparison.r1
  });

  const control = await buildDecisionReceipt({
    launchId: input.launchId,
    baseline: input.baseline,
    policyVersion: comparison.buyEveryExecutableControl.policyVersion,
    policyDigest: controlDigest,
    inputDigest,
    decision: comparison.buyEveryExecutableControl.decision,
    hypotheticalAction:
      comparison.buyEveryExecutableControl.hypotheticalAction,
    reasons: comparison.buyEveryExecutableControl.reasons,
    uncertainties: [],
    capacityUsdMicros:
      comparison.buyEveryExecutableControl.capacityUsdMicros,
    output: comparison.buyEveryExecutableControl
  });

  const comparisonId = await sha256Hex({
    kind: SHADOW_POLICY_DECISION_RECEIPTS_R1,
    launchId: input.launchId,
    inputDigest
  });
  const evidenceDigest = await sha256Hex({
    receiptVersion: SHADOW_POLICY_DECISION_RECEIPTS_R1,
    comparisonId,
    launchId: input.launchId,
    baselineId: input.baseline?.baselineId ?? null,
    decisionBlock: input.baseline?.decisionBlock ?? null,
    inputDigest,
    receiptEvidenceDigests: [
      r0.evidenceDigest,
      r1.evidenceDigest,
      control.evidenceDigest
    ]
  });

  return {
    receiptVersion: SHADOW_POLICY_DECISION_RECEIPTS_R1,
    comparisonId,
    launchId: input.launchId,
    baselineId: input.baseline?.baselineId ?? null,
    decisionBlock: input.baseline?.decisionBlock ?? null,
    inputDigest,
    receipts: {
      r0,
      r1,
      buyEveryExecutableControl: control
    },
    evidenceDigest,
    mode: 'SHADOW_ONLY',
    liveMoneyAuthority: false,
    edge: 'UNPROVEN'
  };
}

async function buildDecisionReceipt(input: {
  launchId: string;
  baseline: PortableFastVetBaselineEvidence | null;
  policyVersion: string;
  policyDigest: string;
  inputDigest: string;
  decision: string;
  hypotheticalAction: FastVetR1HypotheticalAction;
  reasons: readonly string[];
  uncertainties: readonly string[];
  capacityUsdMicros: bigint | null;
  output: unknown;
}): Promise<ShadowPolicyDecisionReceipt> {
  const outputDigest = await sha256Hex(input.output);
  const receiptId = await sha256Hex({
    kind: SHADOW_POLICY_DECISION_RECEIPTS_R1,
    policyVersion: input.policyVersion,
    launchId: input.launchId,
    inputDigest: input.inputDigest
  });
  const evidenceDigest = await sha256Hex({
    receiptVersion: SHADOW_POLICY_DECISION_RECEIPTS_R1,
    receiptId,
    policyVersion: input.policyVersion,
    policyDigest: input.policyDigest,
    inputDigest: input.inputDigest,
    outputDigest
  });

  return {
    receiptVersion: SHADOW_POLICY_DECISION_RECEIPTS_R1,
    receiptId,
    launchId: input.launchId,
    baselineId: input.baseline?.baselineId ?? null,
    decisionBlock: input.baseline?.decisionBlock ?? null,
    policyVersion: input.policyVersion,
    policyDigest: input.policyDigest,
    inputDigest: input.inputDigest,
    outputDigest,
    evidenceDigest,
    decision: input.decision,
    hypotheticalAction: input.hypotheticalAction,
    reasons: [...input.reasons],
    uncertainties: [...input.uncertainties],
    capacityUsdMicros: input.capacityUsdMicros,
    mode: 'SHADOW_ONLY',
    liveMoneyAuthority: false,
    edge: 'UNPROVEN'
  };
}

function assertBindings(
  launchId: string,
  baseline: PortableFastVetBaselineEvidence | null,
  creatorFeature: CreatorOutcomeFeatureReceipt | null
): void {
  if (!launchId) throw new Error('SHADOW_POLICY_RECEIPT_LAUNCH_ID_MISSING');
  if (baseline && baseline.launchId !== launchId) {
    throw new Error('SHADOW_POLICY_RECEIPT_BASELINE_BINDING_MISMATCH');
  }
  if (creatorFeature && creatorFeature.launchId !== launchId) {
    throw new Error('SHADOW_POLICY_RECEIPT_CREATOR_BINDING_MISMATCH');
  }
  if (
    baseline &&
    creatorFeature &&
    creatorFeature.baselineId !== baseline.baselineId
  ) {
    throw new Error('SHADOW_POLICY_RECEIPT_CREATOR_BASELINE_MISMATCH');
  }
}
