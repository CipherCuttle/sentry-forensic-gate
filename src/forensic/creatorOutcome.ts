import type { Hex } from '../domain.js';
import { canonicalJson, sha256Hex } from '../evidence/canonical.js';
import type { OutcomeReceipt } from '../evidence/receipts.js';
import type { ProvenanceFact } from '../graph/provenance.js';
import type { BaselineDecisionPoint } from '../shadow/baselineStore.js';

export const CREATOR_OUTCOME_JOIN_V0 = 'CREATOR_OUTCOME_JOIN_V0' as const;
export const CREATOR_OUTCOME_HORIZON_MS = 86_400_000 as const;

export type CreatorOutcomeCoverage = 'NO_HISTORY' | 'UNKNOWN' | 'PARTIAL' | 'COMPLETE';

export interface CreatorOutcomeFeatureReceipt {
  receiptId: string;
  derivationVersion: typeof CREATOR_OUTCOME_JOIN_V0;
  chainId: number;
  launchId: string;
  creator: Hex;
  baselineId: string;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  horizonMs: typeof CREATOR_OUTCOME_HORIZON_MS;
  coverage: CreatorOutcomeCoverage;
  priorLaunchCount: number;
  outcomeReceiptCount: number;
  classifiedOutcomeCount: number;
  unresolvedOutcomeCount: number;
  unsellableOutcomeCount: number;
  catastrophicLossCount: number;
  exitFailureCount: number;
  liquidityCollapseCount: number;
  normalLossCount: number;
  normalWinCount: number;
  fatTailWinCount: number;
  sourceFactIds: string[];
  sourceOutcomeIds: string[];
  inputDigest: string;
  outputDigest: string;
  evidenceDigest: string;
}

export async function projectCreatorOutcomeFeatures(
  baselines: readonly BaselineDecisionPoint[],
  facts: readonly ProvenanceFact[],
  outcomes: readonly OutcomeReceipt[]
): Promise<CreatorOutcomeFeatureReceipt[]> {
  const factByLaunch = new Map(facts.map((fact) => [fact.launchId, fact]));
  const orderedFacts = [...facts].sort(compareFacts);
  const orderedBaselines = [...baselines].sort(compareBaselines);
  const receipts: CreatorOutcomeFeatureReceipt[] = [];

  for (const baseline of orderedBaselines) {
    const target = factByLaunch.get(baseline.launchId);
    if (!target) throw new Error(`CREATOR_OUTCOME_TARGET_FACT_MISSING:${baseline.launchId}`);

    const priorFacts = orderedFacts.filter((fact) =>
      fact.chainId === target.chainId &&
      fact.creator.toLowerCase() === target.creator.toLowerCase() &&
      compareFacts(fact, target) < 0
    );
    const priorLaunchIds = new Set(priorFacts.map((fact) => fact.launchId));
    const eligibleOutcomes = selectEligibleOutcomes(outcomes, priorLaunchIds, baseline.decisionBlock);

    const counts = classify(eligibleOutcomes, priorFacts.length);
    const output = {
      coverage: counts.coverage,
      priorLaunchCount: priorFacts.length,
      outcomeReceiptCount: eligibleOutcomes.length,
      classifiedOutcomeCount: counts.classifiedOutcomeCount,
      unresolvedOutcomeCount: priorFacts.length - counts.classifiedOutcomeCount,
      unsellableOutcomeCount: counts.unsellableOutcomeCount,
      catastrophicLossCount: counts.catastrophicLossCount,
      exitFailureCount: counts.exitFailureCount,
      liquidityCollapseCount: counts.liquidityCollapseCount,
      normalLossCount: counts.normalLossCount,
      normalWinCount: counts.normalWinCount,
      fatTailWinCount: counts.fatTailWinCount
    };

    const sourceFactIds = [target, ...priorFacts].map((fact) => fact.factId);
    const sourceOutcomeIds = eligibleOutcomes.map((outcome) => outcome.outcomeId);
    const inputDigest = await sha256Hex({
      derivationVersion: CREATOR_OUTCOME_JOIN_V0,
      horizonMs: CREATOR_OUTCOME_HORIZON_MS,
      baseline: {
        baselineId: baseline.baselineId,
        authorityDigest: baseline.authorityDigest,
        launchId: baseline.launchId,
        decisionBlock: baseline.decisionBlock,
        decisionBlockHash: baseline.decisionBlockHash.toLowerCase(),
        status: baseline.status
      },
      targetFact: { factId: target.factId, evidenceDigest: target.evidenceDigest },
      priorFacts: priorFacts.map((fact) => ({ factId: fact.factId, evidenceDigest: fact.evidenceDigest })),
      outcomes: eligibleOutcomes
    });
    const outputDigest = await sha256Hex(output);
    const receiptId = await sha256Hex({
      kind: CREATOR_OUTCOME_JOIN_V0,
      launchId: baseline.launchId,
      baselineId: baseline.baselineId
    });
    const evidenceDigest = await sha256Hex({
      receiptId,
      derivationVersion: CREATOR_OUTCOME_JOIN_V0,
      inputDigest,
      outputDigest,
      sourceFactIds,
      sourceOutcomeIds
    });

    receipts.push({
      receiptId,
      derivationVersion: CREATOR_OUTCOME_JOIN_V0,
      chainId: target.chainId,
      launchId: target.launchId,
      creator: target.creator.toLowerCase() as Hex,
      baselineId: baseline.baselineId,
      decisionBlock: baseline.decisionBlock,
      decisionBlockHash: baseline.decisionBlockHash.toLowerCase() as Hex,
      horizonMs: CREATOR_OUTCOME_HORIZON_MS,
      ...output,
      sourceFactIds,
      sourceOutcomeIds,
      inputDigest,
      outputDigest,
      evidenceDigest
    });
  }

  return receipts;
}

function selectEligibleOutcomes(
  outcomes: readonly OutcomeReceipt[],
  priorLaunchIds: ReadonlySet<string>,
  decisionBlock: bigint
): OutcomeReceipt[] {
  const byLaunch = new Map<string, OutcomeReceipt>();
  for (const outcome of outcomes) {
    if (outcome.horizonMs !== CREATOR_OUTCOME_HORIZON_MS || !priorLaunchIds.has(outcome.launchId)) continue;
    const existing = byLaunch.get(outcome.launchId);
    if (existing) {
      if (existing.outcomeId !== outcome.outcomeId || !sameOutcome(existing, outcome)) {
        throw new Error(`CREATOR_OUTCOME_DUPLICATE_24H:${outcome.launchId}`);
      }
      continue;
    }
    if (outcome.observedBlock <= decisionBlock) byLaunch.set(outcome.launchId, outcome);
  }
  return [...byLaunch.values()].sort((a, b) => a.launchId.localeCompare(b.launchId) || a.outcomeId.localeCompare(b.outcomeId));
}

function classify(outcomes: readonly OutcomeReceipt[], priorLaunchCount: number) {
  let classifiedOutcomeCount = 0;
  let unsellableOutcomeCount = 0;
  let catastrophicLossCount = 0;
  let exitFailureCount = 0;
  let liquidityCollapseCount = 0;
  let normalLossCount = 0;
  let normalWinCount = 0;
  let fatTailWinCount = 0;

  for (const outcome of outcomes) {
    if (outcome.classification !== undefined && !outcome.sellable) unsellableOutcomeCount += 1;
    switch (outcome.classification) {
      case 'CATASTROPHIC_LOSS': classifiedOutcomeCount += 1; catastrophicLossCount += 1; break;
      case 'EXIT_FAILURE': classifiedOutcomeCount += 1; exitFailureCount += 1; break;
      case 'LIQUIDITY_COLLAPSE': classifiedOutcomeCount += 1; liquidityCollapseCount += 1; break;
      case 'NORMAL_LOSS': classifiedOutcomeCount += 1; normalLossCount += 1; break;
      case 'NORMAL_WIN': classifiedOutcomeCount += 1; normalWinCount += 1; break;
      case 'FAT_TAIL_WIN': classifiedOutcomeCount += 1; fatTailWinCount += 1; break;
      case undefined: break;
    }
  }

  const coverage: CreatorOutcomeCoverage = priorLaunchCount === 0
    ? 'NO_HISTORY'
    : classifiedOutcomeCount === 0
      ? 'UNKNOWN'
      : classifiedOutcomeCount === priorLaunchCount
        ? 'COMPLETE'
        : 'PARTIAL';

  return {
    coverage,
    classifiedOutcomeCount,
    unsellableOutcomeCount,
    catastrophicLossCount,
    exitFailureCount,
    liquidityCollapseCount,
    normalLossCount,
    normalWinCount,
    fatTailWinCount
  };
}

function compareFacts(a: ProvenanceFact, b: ProvenanceFact): number {
  if (a.chainId !== b.chainId) return a.chainId - b.chainId;
  if (a.observedBlock !== b.observedBlock) return a.observedBlock < b.observedBlock ? -1 : 1;
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.factId.localeCompare(b.factId);
}

function compareBaselines(a: BaselineDecisionPoint, b: BaselineDecisionPoint): number {
  if (a.decisionBlock !== b.decisionBlock) return a.decisionBlock < b.decisionBlock ? -1 : 1;
  return a.launchId.localeCompare(b.launchId);
}

function sameOutcome(a: OutcomeReceipt, b: OutcomeReceipt): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
