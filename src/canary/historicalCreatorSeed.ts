import type { CreatorOutcomeFeatureReceipt } from '../forensic/creatorOutcome.js';

export const CANARY_HISTORICAL_CREATOR_SEED_VERSION = 'FAST_VET_R0_HISTORICAL_CREATOR_SEED_R0' as const;
export const CANARY_HISTORICAL_CREATOR_SEED_SOURCE_RECEIPT_SHA256 = '916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825' as const;
export const CANARY_HISTORICAL_CREATOR_SEED_SOURCE_SMOKE_OUTPUT_DIGEST = '1b5bef1dd558e76e3b71a0ea7053c805952355968d1acad9bbe0f30897f2bc15' as const;
export const CANARY_HISTORICAL_CREATOR_SEED_SCOPE_LAUNCHES = 147 as const;

export interface HistoricalCreatorSeedRow {
  launchCount: number;
  catastrophicLossCount: number;
  exitFailureCount: number;
  liquidityCollapseCount: number;
  normalLossCount: number;
  normalWinCount: number;
  fatTailWinCount: number;
}

export const CANARY_HISTORICAL_CREATOR_SEED: Readonly<Record<string, HistoricalCreatorSeedRow>> = Object.freeze({
  '0x0ac3805f575af9c28e2cdb1e388d66e75be8ee7a': { launchCount: 2, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 1, fatTailWinCount: 0 },
  '0x0f15d678f14f436dc22ae3203487a0b2dc62b6de': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 0, fatTailWinCount: 0 },
  '0x2a9f4ab0ec37a215705705896f41392e5361ef14': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 0, fatTailWinCount: 0 },
  '0x2d9056df9f2481806e0f0d3d42706c31c83345bb': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
  '0x2f4ebcb2cce38e6691387295a1929dad30babbd0': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 0, fatTailWinCount: 0 },
  '0x5c33f18755df280954b0dcc9177f491662550696': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
  '0x702da71a3073cfa5c1e46784697d0676f35e2118': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
  '0x7171e64e979265aed6588577d1c6b60a701d7866': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 0, fatTailWinCount: 0 },
  '0x7389a4981d5ad2b19dfcb24e8c07b0b6aadac0c8': { launchCount: 2, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 1, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
  '0x7752725803c85090d85cf3cea7b6970de952401c': { launchCount: 13, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 11, normalLossCount: 1, normalWinCount: 1, fatTailWinCount: 0 },
  '0x797dd748f4b1e28ff46f0ff4aa306ee99140b49a': { launchCount: 94, catastrophicLossCount: 5, exitFailureCount: 0, liquidityCollapseCount: 82, normalLossCount: 4, normalWinCount: 3, fatTailWinCount: 0 },
  '0x831d3fe561f33c88cf378f5879a081729a9e21c3': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
  '0x93b860a8898f057a2b476c10ead04a42fc87521d': { launchCount: 5, catastrophicLossCount: 1, exitFailureCount: 0, liquidityCollapseCount: 1, normalLossCount: 2, normalWinCount: 1, fatTailWinCount: 0 },
  '0x95d6d69fb0fe3dd5d01869d3e15274f7c05541d7': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
  '0x96754d7dd3b85d95faa68813ab97287683ad9fb2': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 0, fatTailWinCount: 0 },
  '0x9f5e5dd436b8c942f6c8eb7f64fd36831359c37b': { launchCount: 2, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 1, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
  '0xa66106666ffb383abedd423c35c5b7e1a1d2cb3b': { launchCount: 3, catastrophicLossCount: 1, exitFailureCount: 0, liquidityCollapseCount: 2, normalLossCount: 0, normalWinCount: 0, fatTailWinCount: 0 },
  '0xac2e42af5d328510376df0ef9e0e3fec220754a6': { launchCount: 3, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 2, fatTailWinCount: 0 },
  '0xbe36405524603a845771db095b9d4213bf2894a5': { launchCount: 2, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 0, normalWinCount: 2, fatTailWinCount: 0 },
  '0xbf551eed83c7eaee63854a2013eb94f18600b7c5': { launchCount: 2, catastrophicLossCount: 1, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 0, fatTailWinCount: 0 },
  '0xca201506a887e1199ade152d88c60f6ed4ea3e36': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
  '0xcc4e448fb300cb168b9aa03fd58f320a67535096': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 0, fatTailWinCount: 0 },
  '0xe25e3f56769bc7f9eb564c419c0341f930dfcad9': { launchCount: 2, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 1, fatTailWinCount: 0 },
  '0xec0720d83838f95b0f19b204d6e12b5556bcb07b': { launchCount: 1, catastrophicLossCount: 0, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 1, normalWinCount: 0, fatTailWinCount: 0 },
  '0xfe22991deaecdbf580710d05ad7db648050d0231': { launchCount: 4, catastrophicLossCount: 3, exitFailureCount: 0, liquidityCollapseCount: 0, normalLossCount: 0, normalWinCount: 1, fatTailWinCount: 0 },
});

export function applyHistoricalCreatorSeed(
  feature: CreatorOutcomeFeatureReceipt,
  creator: string
): CreatorOutcomeFeatureReceipt {
  const seed = CANARY_HISTORICAL_CREATOR_SEED[creator.toLowerCase()];
  if (!seed) return feature;

  const seededClassified = seed.launchCount;
  const priorLaunchCount = feature.priorLaunchCount + seed.launchCount;
  const classifiedOutcomeCount = feature.classifiedOutcomeCount + seededClassified;
  const coverage = priorLaunchCount === 0
    ? 'NO_HISTORY'
    : classifiedOutcomeCount === 0
      ? 'UNKNOWN'
      : classifiedOutcomeCount === priorLaunchCount
        ? 'COMPLETE'
        : 'PARTIAL';

  // This is an in-memory FAST_VET adapter only. It deliberately does not
  // mutate or persist the underlying creator-outcome evidence receipt.
  return {
    ...feature,
    coverage,
    priorLaunchCount,
    outcomeReceiptCount: feature.outcomeReceiptCount + seededClassified,
    classifiedOutcomeCount,
    unresolvedOutcomeCount: priorLaunchCount - classifiedOutcomeCount,
    catastrophicLossCount: feature.catastrophicLossCount + seed.catastrophicLossCount,
    exitFailureCount: feature.exitFailureCount + seed.exitFailureCount,
    liquidityCollapseCount: feature.liquidityCollapseCount + seed.liquidityCollapseCount,
    normalLossCount: feature.normalLossCount + seed.normalLossCount,
    normalWinCount: feature.normalWinCount + seed.normalWinCount,
    fatTailWinCount: feature.fatTailWinCount + seed.fatTailWinCount
  };
}

export function historicalCreatorSeedSummary(): { creators: number; launches: number; adverseCreators: number } {
  const rows = Object.values(CANARY_HISTORICAL_CREATOR_SEED);
  return {
    creators: rows.length,
    launches: rows.reduce((sum, row) => sum + row.launchCount, 0),
    adverseCreators: rows.filter((row) =>
      row.catastrophicLossCount + row.exitFailureCount + row.liquidityCollapseCount > 0
    ).length
  };
}
