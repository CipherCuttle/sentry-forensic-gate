import type { Hex } from '../domain.js';
import { sha256Hex } from '../evidence/canonical.js';
import {
  CATASTROPHIC_RECOVERY_BPS,
  PAR_RECOVERY_BPS,
  PRIMARY_OUTCOME_NOTIONAL_USD_MICROS
} from '../outcome/forwardTypes.js';
import type {
  NormalizedBlockPoint,
  NormalizedLaunchCandidate,
  PortableBaselineBatch,
  PortableForwardOutcome,
  SourceAuthorityEnvelope
} from './domain.js';
import type { ForwardOutcomeAdapter } from './ports.js';
import { assertPortableFastVetEvidence } from './fastVetBridge.js';

export const PORTABLE_FORWARD_OUTCOMES_R1 =
  'PORTABLE_FORWARD_OUTCOMES_R1' as const;

export async function buildPortableForwardOutcome(
  adapter: ForwardOutcomeAdapter,
  launch: NormalizedLaunchCandidate,
  baseline: PortableBaselineBatch,
  horizonMs: number,
  confirmedHeadPoint: NormalizedBlockPoint
): Promise<PortableForwardOutcome | null> {
  assertIdentity(adapter, launch, baseline);
  assertPortableFastVetEvidence(baseline);
  if (!Number.isInteger(horizonMs) || horizonMs <= 0) {
    throw new Error(`PORTABLE_OUTCOME_HORIZON_INVALID:${horizonMs}`);
  }
  if (baseline.status !== 'COMPLETE' || !baseline.market) return null;

  const primary = baseline.legs.find(
    (leg) => leg.notionalUsdMicros === PRIMARY_OUTCOME_NOTIONAL_USD_MICROS
  );
  if (!primary) {
    throw new Error(`PORTABLE_OUTCOME_PRIMARY_LEG_MISSING:${launch.launchId}`);
  }

  const [launchPoint, decisionPoint, confirmedPoint] = await Promise.all([
    adapter.getBlockPoint(launch.blockNumber),
    adapter.getBlockPoint(baseline.decisionBlock),
    adapter.getBlockPoint(confirmedHeadPoint.blockNumber)
  ]);
  assertPointHash('LAUNCH', launch.blockNumber, launch.blockHash, launchPoint);
  assertPointHash(
    'DECISION',
    baseline.decisionBlock,
    baseline.decisionBlockHash,
    decisionPoint
  );
  assertPointHash(
    'CONFIRMED_HEAD',
    confirmedHeadPoint.blockNumber,
    confirmedHeadPoint.blockHash,
    confirmedPoint
  );
  if (confirmedPoint.timestampMs !== confirmedHeadPoint.timestampMs) {
    throw new Error('PORTABLE_OUTCOME_CONFIRMED_HEAD_TIMESTAMP_DRIFT');
  }

  const targetTimestampMs = launchPoint.timestampMs + horizonMs;
  const lowerBound =
    baseline.decisionBlock > launch.blockNumber
      ? baseline.decisionBlock
      : launch.blockNumber;
  if (
    confirmedPoint.blockNumber < lowerBound ||
    confirmedPoint.timestampMs < targetTimestampMs
  ) {
    return null;
  }

  const observed = await findPortableFirstBlockAtOrAfterTimestamp(
    adapter,
    lowerBound,
    confirmedPoint.blockNumber,
    targetTimestampMs
  );
  if (!observed) return null;

  const predecessor = await captureBoundary(
    adapter,
    observed,
    lowerBound,
    targetTimestampMs
  );

  await adapter.assertMarketAuthority(baseline.market, observed.blockNumber);

  const liquidity = await adapter.readLiquidity(
    baseline.market,
    observed.blockNumber
  );
  const entryTokenAmount =
    primary.entry.executable && primary.entry.amountOut > 0n
      ? primary.entry.amountOut
      : 0n;

  let status: PortableForwardOutcome['status'] = 'COMPLETE';
  let reason: string | undefined;
  let exitExecutable = false;
  let baseAmountOut = 0n;
  let executableValueUsdMicros: bigint | undefined;
  let executableReturnBps: bigint | undefined;
  let classification: PortableForwardOutcome['classification'];
  let exitAuthority: SourceAuthorityEnvelope | null = null;
  let valuationAuthority: SourceAuthorityEnvelope | null = null;

  if (!primary.entry.executable || entryTokenAmount <= 0n) {
    status = 'UNVERIFIED';
    reason = 'PORTABLE_OUTCOME_BASELINE_ENTRY_NOT_EXECUTABLE';
  } else {
    const exit = await adapter.quoteExit({
      market: baseline.market,
      tokenAmount: entryTokenAmount,
      blockNumber: observed.blockNumber
    });
    exitAuthority = exit.sourceAuthority;

    if (exit.executable && exit.amountOut <= 0n) {
      throw new Error('PORTABLE_OUTCOME_EXECUTABLE_EXIT_WITHOUT_OUTPUT');
    }
    if (exit.executable && liquidity.state === 'COLLAPSED') {
      throw new Error('PORTABLE_OUTCOME_LIQUIDITY_COLLAPSE_WITH_EXECUTABLE_EXIT');
    }

    exitExecutable = exit.executable;
    baseAmountOut = exit.executable ? exit.amountOut : 0n;

    if (!exit.executable) {
      reason = exit.failureReason ?? 'PORTABLE_OUTCOME_EXIT_NOT_EXECUTABLE';
      if (liquidity.state === 'COLLAPSED') {
        executableValueUsdMicros = 0n;
        executableReturnBps = 0n;
        classification = 'LIQUIDITY_COLLAPSE';
      } else if (liquidity.state === 'SURVIVED') {
        executableValueUsdMicros = 0n;
        executableReturnBps = 0n;
        classification = 'EXIT_FAILURE';
      } else {
        // Critical for launchpads with venue migration: UNKNOWN liquidity /
        // unsupported successor venue is an evidence gap, not an adverse label.
        status = 'UNVERIFIED';
      }
    } else {
      try {
        const valuation = await adapter.valueBaseAmountUsdMicros({
          market: baseline.market,
          baseAmount: baseAmountOut,
          blockNumber: observed.blockNumber
        });
        valuationAuthority = valuation.sourceAuthority;
        if (valuation.usdMicros < 0n) {
          throw new Error('PORTABLE_OUTCOME_NEGATIVE_USD_VALUATION');
        }
        executableValueUsdMicros = valuation.usdMicros;
        executableReturnBps =
          (valuation.usdMicros * 10_000n) /
          PRIMARY_OUTCOME_NOTIONAL_USD_MICROS;
        classification = classifyPortableExecutableOutcome(
          executableReturnBps
        );
      } catch (error) {
        const valuationGap = stableErrorReason(error);
        if (!valuationGap.startsWith('PORTABLE_USD_VALUATION_UNAVAILABLE:')) {
          throw error;
        }
        status = 'UNVERIFIED';
        reason = valuationGap;
      }
    }
  }

  await adapter.assertMarketAuthority(baseline.market, observed.blockNumber);
  await assertEvidenceStable(
    adapter,
    launch,
    baseline,
    observed,
    predecessor,
    confirmedPoint,
    targetTimestampMs
  );

  const sourceAuthority: SourceAuthorityEnvelope = {
    schema: PORTABLE_FORWARD_OUTCOMES_R1,
    payload: {
      policyVersion: PORTABLE_FORWARD_OUTCOMES_R1,
      chainId: launch.chainId,
      ecosystem: launch.ecosystem,
      launchProtocol: launch.launchProtocol,
      launchId: launch.launchId,
      baselineId: baseline.baselineId,
      baselineAuthorityDigest: baseline.authorityDigest,
      horizonMs,
      targetTimestampMs,
      observedBlock: observed.blockNumber.toString(),
      observedBlockHash: observed.blockHash.toLowerCase(),
      observedTimestampMs: observed.timestampMs,
      predecessor: predecessor
        ? {
            blockNumber: predecessor.blockNumber.toString(),
            blockHash: predecessor.blockHash.toLowerCase(),
            timestampMs: predecessor.timestampMs
          }
        : null,
      marketId: baseline.market.marketId,
      marketSourceAuthority: authorityObject(baseline.market.sourceAuthority),
      entryNotionalUsdMicros: PRIMARY_OUTCOME_NOTIONAL_USD_MICROS.toString(),
      entryTokenAmount: entryTokenAmount.toString(),
      liquidity: authorityObject(liquidity.sourceAuthority),
      exit: exitAuthority ? authorityObject(exitAuthority) : null,
      valuation: valuationAuthority ? authorityObject(valuationAuthority) : null,
      classificationThresholds: {
        catastrophicRecoveryBps: CATASTROPHIC_RECOVERY_BPS.toString(),
        parRecoveryBps: PAR_RECOVERY_BPS.toString()
      }
    }
  };

  const authorityDigest = await sha256Hex(sourceAuthority);
  const outcomeId = await sha256Hex({
    kind: PORTABLE_FORWARD_OUTCOMES_R1,
    chainId: launch.chainId,
    launchId: launch.launchId,
    baselineId: baseline.baselineId,
    horizonMs
  });

  return {
    outcomeId,
    authorityDigest,
    chainId: launch.chainId,
    ecosystem: launch.ecosystem,
    launchProtocol: launch.launchProtocol,
    launchId: launch.launchId,
    baselineId: baseline.baselineId,
    horizonMs,
    status,
    ...(reason ? { reason } : {}),
    observedBlock: observed.blockNumber,
    observedBlockHash: observed.blockHash.toLowerCase() as Hex,
    targetTimestampMs,
    observedTimestampMs: observed.timestampMs,
    entryNotionalUsdMicros: PRIMARY_OUTCOME_NOTIONAL_USD_MICROS,
    exitExecutable,
    baseAsset: baseline.market.baseAsset,
    baseAmountOut,
    ...(executableValueUsdMicros !== undefined
      ? { executableValueUsdMicros }
      : {}),
    ...(executableReturnBps !== undefined ? { executableReturnBps } : {}),
    ...(classification !== undefined ? { classification } : {}),
    liquidity,
    sourceAuthority
  };
}

export async function findPortableFirstBlockAtOrAfterTimestamp(
  adapter: Pick<ForwardOutcomeAdapter, 'getBlockPoint'>,
  lowBlock: bigint,
  highBlock: bigint,
  targetTimestampMs: number
): Promise<NormalizedBlockPoint | null> {
  if (lowBlock > highBlock) return null;

  const highPoint = await adapter.getBlockPoint(highBlock);
  if (highPoint.timestampMs < targetTimestampMs) return null;

  let low = lowBlock;
  let high = highBlock;
  let answer = highPoint;

  while (low <= high) {
    const mid = low + (high - low) / 2n;
    const point =
      mid === highBlock ? highPoint : await adapter.getBlockPoint(mid);
    if (point.timestampMs >= targetTimestampMs) {
      answer = point;
      if (mid === 0n) break;
      high = mid - 1n;
    } else {
      low = mid + 1n;
    }
  }
  return answer;
}

export function classifyPortableExecutableOutcome(
  recoveryBps: bigint
): NonNullable<PortableForwardOutcome['classification']> {
  if (recoveryBps <= CATASTROPHIC_RECOVERY_BPS) {
    return 'CATASTROPHIC_LOSS';
  }
  if (recoveryBps < PAR_RECOVERY_BPS) return 'NORMAL_LOSS';
  return 'NORMAL_WIN';
}

function assertIdentity(
  adapter: ForwardOutcomeAdapter,
  launch: NormalizedLaunchCandidate,
  baseline: PortableBaselineBatch
): void {
  if (baseline.launchId !== launch.launchId) {
    throw new Error('PORTABLE_OUTCOME_BASELINE_LAUNCH_MISMATCH');
  }
  if (
    adapter.mode !== 'SHADOW_ONLY' ||
    adapter.chainId !== launch.chainId ||
    adapter.ecosystem !== launch.ecosystem ||
    adapter.launchProtocol !== launch.launchProtocol ||
    baseline.chainId !== launch.chainId ||
    baseline.ecosystem !== launch.ecosystem ||
    baseline.launchProtocol !== launch.launchProtocol
  ) {
    throw new Error('PORTABLE_OUTCOME_IDENTITY_MISMATCH');
  }
}

async function captureBoundary(
  adapter: Pick<ForwardOutcomeAdapter, 'getBlockPoint'>,
  observed: NormalizedBlockPoint,
  lowerBound: bigint,
  targetTimestampMs: number
): Promise<NormalizedBlockPoint | null> {
  if (observed.timestampMs < targetTimestampMs) {
    throw new Error('PORTABLE_OUTCOME_HORIZON_BEFORE_TARGET');
  }
  if (observed.blockNumber === lowerBound) return null;

  const predecessor = await adapter.getBlockPoint(observed.blockNumber - 1n);
  if (predecessor.timestampMs >= targetTimestampMs) {
    throw new Error('PORTABLE_OUTCOME_HORIZON_NONMINIMAL');
  }
  return predecessor;
}

async function assertEvidenceStable(
  adapter: Pick<ForwardOutcomeAdapter, 'getBlockPoint'>,
  launch: NormalizedLaunchCandidate,
  baseline: PortableBaselineBatch,
  observed: NormalizedBlockPoint,
  predecessor: NormalizedBlockPoint | null,
  confirmed: NormalizedBlockPoint,
  targetTimestampMs: number
): Promise<void> {
  const [launchAgain, decisionAgain, observedAgain, confirmedAgain] =
    await Promise.all([
      adapter.getBlockPoint(launch.blockNumber),
      adapter.getBlockPoint(baseline.decisionBlock),
      adapter.getBlockPoint(observed.blockNumber),
      adapter.getBlockPoint(confirmed.blockNumber)
    ]);

  assertPointHash('LAUNCH_FINAL', launch.blockNumber, launch.blockHash, launchAgain);
  assertPointHash(
    'DECISION_FINAL',
    baseline.decisionBlock,
    baseline.decisionBlockHash,
    decisionAgain
  );
  assertPointHash(
    'OBSERVED_FINAL',
    observed.blockNumber,
    observed.blockHash,
    observedAgain
  );
  assertPointHash(
    'CONFIRMED_HEAD_FINAL',
    confirmed.blockNumber,
    confirmed.blockHash,
    confirmedAgain
  );
  if (
    observedAgain.timestampMs < targetTimestampMs ||
    confirmedAgain.timestampMs !== confirmed.timestampMs
  ) {
    throw new Error('PORTABLE_OUTCOME_TIMESTAMP_DRIFT');
  }

  if (predecessor) {
    const predecessorAgain = await adapter.getBlockPoint(
      predecessor.blockNumber
    );
    assertPointHash(
      'PREDECESSOR_FINAL',
      predecessor.blockNumber,
      predecessor.blockHash,
      predecessorAgain
    );
    if (predecessorAgain.timestampMs >= targetTimestampMs) {
      throw new Error('PORTABLE_OUTCOME_HORIZON_NONMINIMAL');
    }
  }
}

function authorityObject(authority: SourceAuthorityEnvelope) {
  return { schema: authority.schema, payload: authority.payload };
}

function assertPointHash(
  label: string,
  blockNumber: bigint,
  expected: Hex,
  point: NormalizedBlockPoint
): void {
  if (
    point.blockNumber !== blockNumber ||
    point.blockHash.toLowerCase() !== expected.toLowerCase()
  ) {
    throw new Error(
      `PORTABLE_OUTCOME_${label}_REORG:block=${blockNumber}`
    );
  }
}

function stableErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512);
}
