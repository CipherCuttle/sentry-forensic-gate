import type { Hex } from '../domain.js';
import type { OutcomeReceipt } from '../evidence/receipts.js';
import { sha256Hex } from '../evidence/canonical.js';
import type { ProvenanceFact } from '../graph/provenance.js';
import {
  projectCreatorOutcomeFeatures,
  type CreatorOutcomeFeatureReceipt
} from '../forensic/creatorOutcome.js';
import type {
  NormalizedLaunchCandidate,
  PortableBaselineBatch
} from './domain.js';

type ProvenanceLaunchInput = Pick<
  NormalizedLaunchCandidate,
  'chainId' | 'launchId' | 'creator' | 'blockNumber' | 'blockHash' | 'logIndex' | 'eventId'
>;

export async function buildNormalizedProvenanceFact(
  launch: ProvenanceLaunchInput
): Promise<ProvenanceFact> {
  const creator = launch.creator.toLowerCase() as Hex;
  const observedBlockHash = launch.blockHash.toLowerCase() as Hex;
  const factId = `provenance-fact:${launch.chainId}:${launch.launchId}`;
  const payload = {
    factId,
    kind: 'LAUNCH_DEPLOYED_BY_CREATOR' as const,
    chainId: launch.chainId,
    launchId: launch.launchId,
    creator,
    observedBlock: launch.blockNumber,
    observedBlockHash,
    logIndex: launch.logIndex,
    sourceEventId: launch.eventId
  };
  return {
    ...payload,
    evidenceDigest: await sha256Hex(payload)
  };
}

export async function projectPortableCreatorOutcomeFeature(
  baseline: PortableBaselineBatch,
  targetFact: ProvenanceFact,
  priorFacts: readonly ProvenanceFact[],
  outcomes: readonly OutcomeReceipt[]
): Promise<CreatorOutcomeFeatureReceipt> {
  if (
    targetFact.chainId !== baseline.chainId ||
    targetFact.launchId !== baseline.launchId
  ) {
    throw new Error('PORTABLE_CREATOR_TARGET_BINDING_MISMATCH');
  }

  const creator = targetFact.creator.toLowerCase();
  for (const fact of priorFacts) {
    if (
      fact.chainId !== targetFact.chainId ||
      fact.creator.toLowerCase() !== creator ||
      compareFactPosition(fact, targetFact) >= 0
    ) {
      throw new Error('PORTABLE_CREATOR_PRIOR_FACT_INVALID');
    }
  }

  const receipts = await projectCreatorOutcomeFeatures(
    [{
      baselineId: baseline.baselineId,
      authorityDigest: baseline.authorityDigest,
      launchId: baseline.launchId,
      decisionBlock: baseline.decisionBlock,
      decisionBlockHash: baseline.decisionBlockHash,
      status: baseline.status
    }],
    [targetFact, ...priorFacts],
    outcomes
  );
  if (receipts.length !== 1) {
    throw new Error(`PORTABLE_CREATOR_RECEIPT_CARDINALITY:${receipts.length}`);
  }
  return receipts[0]!;
}

function compareFactPosition(a: ProvenanceFact, b: ProvenanceFact): number {
  if (a.observedBlock !== b.observedBlock) {
    return a.observedBlock < b.observedBlock ? -1 : 1;
  }
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.factId.localeCompare(b.factId);
}

