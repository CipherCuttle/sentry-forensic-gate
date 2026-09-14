import type { Hex, LaunchObserved } from '../domain.js';
import { resolveAuthorizedExecutableInfra } from '../authority/executableInfraAuthority.js';
import type { OutcomeReceipt } from '../evidence/receipts.js';
import { OUTCOME_HORIZONS } from '../outcome/horizons.js';
import type { ForwardOutcomeSource, OutcomeBlockPoint } from '../outcome/ports.js';
import type { ForwardOutcomeStore } from '../outcome/store.js';
import {
  CATASTROPHIC_RECOVERY_BPS,
  FORWARD_OUTCOMES_R1,
  PAR_RECOVERY_BPS,
  PRIMARY_OUTCOME_NOTIONAL_USD_MICROS,
  deriveForwardOutcomeEvidenceDigest,
  deriveForwardOutcomeId,
  type ForwardOutcomeReceipt
} from '../outcome/forwardTypes.js';
import type { ExecutableBaselineBatch } from '../shadow/baselineTypes.js';
import type { ExecutableBlockAuthorizer } from './executableBaseline.js';

export interface ForwardOutcomeOptions {
  confirmations: bigint;
  maxOutcomesPerSync: number;
  horizons?: readonly { label: string; ms: number }[];
  pollIntervalMs?: number;
}

export interface ForwardOutcomeReport {
  headBlock: bigint;
  confirmedHeadBlock: bigint | null;
  processed: number;
  complete: number;
  unverified: number;
  duplicates: number;
  pendingMaturity: number;
}

export async function syncForwardOutcomes(
  source: ForwardOutcomeSource,
  store: ForwardOutcomeStore,
  options: ForwardOutcomeOptions
): Promise<ForwardOutcomeReport> {
  validateOptions(options);
  const headBlock = await source.getHeadBlockNumber();
  if (headBlock < options.confirmations) {
    return {
      headBlock,
      confirmedHeadBlock: null,
      processed: 0,
      complete: 0,
      unverified: 0,
      duplicates: 0,
      pendingMaturity: 0
    };
  }

  const confirmedHeadBlock = headBlock - options.confirmations;
  const confirmedHeadPoint = await source.getBlockPoint(confirmedHeadBlock);
  const horizons = [...(options.horizons ?? OUTCOME_HORIZONS)].sort((a, b) => a.ms - b.ms);
  let remaining = options.maxOutcomesPerSync;
  let processed = 0;
  let complete = 0;
  let unverified = 0;
  let duplicates = 0;
  let pendingMaturity = 0;

  for (const horizon of horizons) {
    if (remaining <= 0) break;
    const batches = await store.listBaselineBatchesPendingOutcome(horizon.ms, remaining);
    for (const batch of batches) {
      if (remaining <= 0) break;
      const launch = await store.getLaunch(batch.launchId);
      if (!launch) throw new Error(`OUTCOME_LAUNCH_MISSING:${batch.launchId}`);
      const receipt = await buildForwardOutcome(source, launch, batch, horizon.ms, confirmedHeadPoint);
      if (!receipt) {
        pendingMaturity += 1;
        continue;
      }
      const result = await store.putOutcome(receipt);
      processed += 1;
      remaining -= 1;
      if (result === 'DUPLICATE') duplicates += 1;
      else if (receipt.status === 'COMPLETE') complete += 1;
      else unverified += 1;
    }
  }

  return { headBlock, confirmedHeadBlock, processed, complete, unverified, duplicates, pendingMaturity };
}

export async function runForwardOutcomes(
  source: ForwardOutcomeSource,
  store: ForwardOutcomeStore,
  options: ForwardOutcomeOptions,
  signal?: AbortSignal,
  onSync?: (report: ForwardOutcomeReport) => void
): Promise<void> {
  const pollMs = options.pollIntervalMs ?? 1500;
  if (!Number.isFinite(pollMs) || pollMs < 100) throw new Error('pollIntervalMs must be >= 100');
  while (!signal?.aborted) {
    const report = await syncForwardOutcomes(source, store, options);
    onSync?.(report);
    await sleep(pollMs, signal);
  }
}

export async function buildForwardOutcome(
  source: ForwardOutcomeSource,
  launch: LaunchObserved,
  batch: ExecutableBaselineBatch,
  horizonMs: number,
  confirmedHeadPoint: OutcomeBlockPoint,
  authorizeExecutableBlock: ExecutableBlockAuthorizer = resolveAuthorizedExecutableInfra
): Promise<ForwardOutcomeReceipt | null> {
  if (batch.launchId !== launch.launchId) throw new Error(`OUTCOME_BASELINE_LAUNCH_MISMATCH:${launch.launchId}`);
  authorizeExecutableBlock(launch.blockNumber);
  authorizeExecutableBlock(batch.decisionBlock);
  if (batch.status !== 'COMPLETE' || !batch.market) return null;
  if (!Number.isInteger(horizonMs) || horizonMs <= 0) throw new Error(`INVALID_OUTCOME_HORIZON:${horizonMs}`);

  const primaryLeg = batch.legs.find((leg) => leg.notionalUsdMicros === PRIMARY_OUTCOME_NOTIONAL_USD_MICROS);
  if (!primaryLeg) throw new Error(`OUTCOME_PRIMARY_LEG_MISSING:${launch.launchId}`);

  const [launchPoint, decisionPoint] = await Promise.all([
    source.getBlockPoint(launch.blockNumber),
    source.getBlockPoint(batch.decisionBlock)
  ]);
  assertHash('OUTCOME_LAUNCH_REORG', launch.blockNumber, launch.blockHash, launchPoint.blockHash);
  assertHash('OUTCOME_BASELINE_REORG', batch.decisionBlock, batch.decisionBlockHash, decisionPoint.blockHash);

  const targetTimestampMs = launchPoint.timestampMs + horizonMs;
  const lowerBound = batch.decisionBlock > launch.blockNumber ? batch.decisionBlock : launch.blockNumber;
  if (confirmedHeadPoint.blockNumber < lowerBound || confirmedHeadPoint.timestampMs < targetTimestampMs) return null;

  const observed = await findFirstBlockAtOrAfterTimestamp(
    source,
    lowerBound,
    confirmedHeadPoint.blockNumber,
    targetTimestampMs
  );
  if (!observed) return null;
  const predecessor = await captureHorizonBoundary(source, observed, lowerBound, targetTimestampMs);

  await source.assertMarketAuthority(batch.market, observed.blockNumber);
  const state = await source.readMarketState(batch.market, observed.blockNumber);
  const outcomeId = await deriveForwardOutcomeId({ launchId: launch.launchId, baselineId: batch.baselineId, horizonMs });
  const entryTokenAmount = primaryLeg.entry.executable ? primaryLeg.entry.amountOut : 0n;

  let status: ForwardOutcomeReceipt['status'] = 'COMPLETE';
  let reason: string | undefined;
  let sellable = false;
  let baseAmountOut = 0n;
  let executableValueUsdMicros: bigint | undefined;
  let executableReturnBps: bigint | undefined;
  let classification: OutcomeReceipt['classification'];

  if (!primaryLeg.entry.executable || entryTokenAmount <= 0n) {
    status = 'UNVERIFIED';
    reason = 'BASELINE_ENTRY_NOT_EXECUTABLE';
  } else {
    const exit = await source.quoteTokenToBase({
      market: batch.market,
      tokenAmount: entryTokenAmount,
      blockNumber: observed.blockNumber
    });
    sellable = exit.executable && exit.amountOut > 0n;
    baseAmountOut = sellable ? exit.amountOut : 0n;

    if (!sellable) {
      executableValueUsdMicros = 0n;
      executableReturnBps = 0n;
      classification = state.activeLiquidity === 0n ? 'LIQUIDITY_COLLAPSE' : 'EXIT_FAILURE';
      reason = exit.failureReason;
    } else {
      try {
        executableValueUsdMicros = await source.valueBaseAmountUsdMicros({
          baseToken: batch.market.baseToken,
          baseAmount: baseAmountOut,
          blockNumber: observed.blockNumber
        });
        executableReturnBps = (executableValueUsdMicros * 10_000n) / PRIMARY_OUTCOME_NOTIONAL_USD_MICROS;
        classification = classifyExecutableOutcome(executableReturnBps);
      } catch (error) {
        if (!isDeterministicValuationGap(error)) throw error;
        status = 'UNVERIFIED';
        reason = stableErrorReason(error);
      }
    }
  }

  await source.assertMarketAuthority(batch.market, observed.blockNumber);
  await assertEvidenceStable(source, launch, batch, observed, predecessor, targetTimestampMs);

  const withoutDigest: Omit<ForwardOutcomeReceipt, 'evidenceDigest'> = {
    outcomeId,
    launchId: launch.launchId,
    horizonMs,
    observedBlock: observed.blockNumber,
    policyVersion: FORWARD_OUTCOMES_R1,
    status,
    observedBlockHash: observed.blockHash.toLowerCase() as Hex,
    targetTimestampMs,
    observedTimestampMs: observed.timestampMs,
    baselineId: batch.baselineId,
    entryNotionalUsdMicros: PRIMARY_OUTCOME_NOTIONAL_USD_MICROS,
    entryTokenAmount,
    marketPool: batch.market.pool.toLowerCase() as Hex,
    marketFee: batch.market.fee,
    baseToken: batch.market.baseToken.toLowerCase() as Hex,
    baseAmountOut,
    poolActiveLiquidity: state.activeLiquidity,
    sellable,
    ...(reason ? { reason } : {}),
    ...(executableValueUsdMicros !== undefined ? { executableValueUsdMicros } : {}),
    ...(executableReturnBps !== undefined ? { executableReturnBps } : {}),
    ...(classification !== undefined ? { classification } : {})
  };
  const evidenceDigest = await deriveForwardOutcomeEvidenceDigest(withoutDigest);
  return { ...withoutDigest, evidenceDigest };
}

export async function findFirstBlockAtOrAfterTimestamp(
  source: ForwardOutcomeSource,
  lowBlock: bigint,
  highBlock: bigint,
  targetTimestampMs: number
): Promise<OutcomeBlockPoint | null> {
  if (lowBlock > highBlock) return null;
  const highPoint = await source.getBlockPoint(highBlock);
  if (highPoint.timestampMs < targetTimestampMs) return null;

  let low = lowBlock;
  let high = highBlock;
  let answer = highPoint;
  while (low <= high) {
    const mid = low + ((high - low) / 2n);
    const point = mid === highBlock ? highPoint : await source.getBlockPoint(mid);
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

export function classifyExecutableOutcome(recoveryBps: bigint): NonNullable<OutcomeReceipt['classification']> {
  if (recoveryBps <= CATASTROPHIC_RECOVERY_BPS) return 'CATASTROPHIC_LOSS';
  if (recoveryBps < PAR_RECOVERY_BPS) return 'NORMAL_LOSS';
  return 'NORMAL_WIN';
}

async function captureHorizonBoundary(
  source: ForwardOutcomeSource,
  observed: OutcomeBlockPoint,
  lowerBound: bigint,
  targetTimestampMs: number
): Promise<OutcomeBlockPoint | null> {
  if (observed.timestampMs < targetTimestampMs) {
    throw new Error(`OUTCOME_HORIZON_BEFORE_TARGET:block=${observed.blockNumber}`);
  }
  if (observed.blockNumber === lowerBound) return null;
  const predecessor = await source.getBlockPoint(observed.blockNumber - 1n);
  if (predecessor.timestampMs >= targetTimestampMs) {
    throw new Error(
      `OUTCOME_HORIZON_NONMINIMAL:block=${observed.blockNumber}:predecessor=${predecessor.blockNumber}`
    );
  }
  return predecessor;
}

async function assertEvidenceStable(
  source: ForwardOutcomeSource,
  launch: LaunchObserved,
  batch: ExecutableBaselineBatch,
  observed: OutcomeBlockPoint,
  predecessor: OutcomeBlockPoint | null,
  targetTimestampMs: number
): Promise<void> {
  const [launchAgain, decisionAgain] = await Promise.all([
    source.getBlockPoint(launch.blockNumber),
    source.getBlockPoint(batch.decisionBlock)
  ]);
  assertHash('OUTCOME_LAUNCH_REORG', launch.blockNumber, launch.blockHash, launchAgain.blockHash);
  assertHash('OUTCOME_BASELINE_REORG', batch.decisionBlock, batch.decisionBlockHash, decisionAgain.blockHash);

  if (predecessor) {
    const predecessorAgain = await source.getBlockPoint(predecessor.blockNumber);
    assertHash('OUTCOME_REORG_DURING_BOUNDARY_READ', predecessor.blockNumber, predecessor.blockHash, predecessorAgain.blockHash);
    if (predecessorAgain.timestampMs >= targetTimestampMs) {
      throw new Error(
        `OUTCOME_HORIZON_NONMINIMAL:block=${observed.blockNumber}:predecessor=${predecessor.blockNumber}`
      );
    }
  }

  const observedAgain = await source.getBlockPoint(observed.blockNumber);
  assertHash('OUTCOME_REORG_DURING_READ', observed.blockNumber, observed.blockHash, observedAgain.blockHash);
  if (observedAgain.timestampMs < targetTimestampMs) {
    throw new Error(`OUTCOME_HORIZON_BEFORE_TARGET:block=${observed.blockNumber}`);
  }
}

function assertHash(label: string, blockNumber: bigint, expected: Hex, actual: Hex): void {
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error(`${label}:block=${blockNumber}:expected=${expected}:actual=${actual}`);
  }
}

function validateOptions(options: ForwardOutcomeOptions): void {
  if (options.confirmations < 0n) throw new Error('confirmations must be >= 0');
  if (!Number.isInteger(options.maxOutcomesPerSync) || options.maxOutcomesPerSync < 1 || options.maxOutcomesPerSync > 10_000) {
    throw new Error('maxOutcomesPerSync must be an integer in [1, 10000]');
  }
  const horizons = options.horizons ?? OUTCOME_HORIZONS;
  if (horizons.length === 0 || horizons.some((horizon) => !Number.isInteger(horizon.ms) || horizon.ms <= 0)) {
    throw new Error('outcome horizons must be positive integer milliseconds');
  }
  if (new Set(horizons.map((horizon) => horizon.ms)).size !== horizons.length) {
    throw new Error('outcome horizons must be unique');
  }
}

function isDeterministicValuationGap(error: unknown): boolean {
  return stableErrorReason(error).startsWith('OUTCOME_USD_VALUATION_UNAVAILABLE:');
}

function stableErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
