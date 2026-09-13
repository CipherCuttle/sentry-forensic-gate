import type { Hex, LaunchObserved } from '../domain.js';
import {
  DEFAULT_BASELINE_NOTIONALS_USD_MICROS,
  EXECUTABLE_BASELINE_R1,
  deriveBaselineAuthorityDigest,
  deriveBaselineId,
  independentRecoveryBps,
  isLaunchEligibleForDecision,
  type BaselineLeg,
  type ExecutableBaselineBatch
} from '../shadow/baselineTypes.js';
import type { BaselineStore } from '../shadow/baselineStore.js';
import type { ExecutableBaselineSource } from '../tsunami/ports.js';

export interface ExecutableBaselineOptions {
  decisionDelayBlocks: bigint;
  confirmations: bigint;
  maxLaunchesPerSync: number;
  notionalsUsdMicros?: readonly bigint[];
  pollIntervalMs?: number;
}

export interface ExecutableBaselineReport {
  headBlock: bigint;
  eligibleThroughLaunchBlock: bigint | null;
  processed: number;
  complete: number;
  unverified: number;
  duplicates: number;
}

export async function syncExecutableBaseline(
  source: ExecutableBaselineSource,
  store: BaselineStore,
  options: ExecutableBaselineOptions
): Promise<ExecutableBaselineReport> {
  validateOptions(options);
  const headBlock = await source.getHeadBlockNumber();
  const maturityBlocks = options.decisionDelayBlocks + options.confirmations;
  if (headBlock < maturityBlocks) {
    return { headBlock, eligibleThroughLaunchBlock: null, processed: 0, complete: 0, unverified: 0, duplicates: 0 };
  }

  const maxLaunchBlock = headBlock - maturityBlocks;
  const launches = await store.listLaunchesPendingBaseline(maxLaunchBlock, options.maxLaunchesPerSync);
  const notionals = [...(options.notionalsUsdMicros ?? DEFAULT_BASELINE_NOTIONALS_USD_MICROS)];
  let processed = 0;
  let complete = 0;
  let unverified = 0;
  let duplicates = 0;

  for (const launch of launches) {
    if (!isLaunchEligibleForDecision(launch, headBlock, options.decisionDelayBlocks, options.confirmations)) continue;
    const batch = await buildBaselineBatch(source, launch, options.decisionDelayBlocks, notionals);
    const result = await store.putBaselineBatch(batch);
    processed += 1;
    if (result === 'DUPLICATE') duplicates += 1;
    else if (batch.status === 'COMPLETE') complete += 1;
    else unverified += 1;
  }

  return { headBlock, eligibleThroughLaunchBlock: maxLaunchBlock, processed, complete, unverified, duplicates };
}

export async function runExecutableBaseline(
  source: ExecutableBaselineSource,
  store: BaselineStore,
  options: ExecutableBaselineOptions,
  signal?: AbortSignal,
  onSync?: (report: ExecutableBaselineReport) => void
): Promise<void> {
  const pollMs = options.pollIntervalMs ?? 1500;
  if (!Number.isFinite(pollMs) || pollMs < 100) throw new Error('pollIntervalMs must be >= 100');
  while (!signal?.aborted) {
    const report = await syncExecutableBaseline(source, store, options);
    onSync?.(report);
    await sleep(pollMs, signal);
  }
}

export async function buildBaselineBatch(
  source: ExecutableBaselineSource,
  launch: LaunchObserved,
  decisionDelayBlocks: bigint,
  notionalsUsdMicros: readonly bigint[]
): Promise<ExecutableBaselineBatch> {
  const decisionBlock = launch.blockNumber + decisionDelayBlocks;
  const decisionBlockHash = await source.getBlockHash(decisionBlock);

  // Authority drift is global, not a per-launch data gap. Fail closed and do not
  // persist an UNVERIFIED row that would let the worker continue under new semantics.
  await source.assertAuthority(decisionBlock);

  const baselineId = await deriveBaselineId({ launchId: launch.launchId, decisionBlock, decisionBlockHash });
  const observedAtMs = Date.now();

  try {
    const market = await source.resolveMarket(launch, decisionBlock);
    const legs: BaselineLeg[] = [];

    for (const notionalUsdMicros of notionalsUsdMicros) {
      const calibration = await source.calibrateUsd({
        launch, market, decisionBlock, decisionBlockHash, notionalUsdMicros
      });
      const entry = await source.quoteEntry({
        launch,
        market,
        decisionBlock,
        decisionBlockHash,
        notionalUsdMicros,
        amountIn: calibration.baseAmount
      });

      let reverse = null;
      let recovery: bigint | null = null;
      if (entry.executable && entry.amountOut > 0n) {
        // Deliberately use the token amount the entry quote says we would receive.
        // Passing the original base amount here would be a unit/direction bug.
        reverse = await source.quoteIndependentReverse({
          launch,
          market,
          decisionBlock,
          decisionBlockHash,
          notionalUsdMicros,
          amountIn: entry.amountOut
        });
        if (reverse.executable) recovery = independentRecoveryBps(entry.amountIn, reverse.amountOut);
      }

      legs.push({
        notionalUsdMicros,
        calibration,
        entry,
        reverse,
        independentReverseRecoveryBps: recovery
      });
    }

    await assertDecisionPointStable(source, decisionBlock, decisionBlockHash);
    await source.assertAuthority(decisionBlock);

    const withoutDigest = {
      baselineId,
      launchId: launch.launchId,
      policyVersion: EXECUTABLE_BASELINE_R1 as typeof EXECUTABLE_BASELINE_R1,
      decisionBlock,
      decisionBlockHash,
      observedAtMs,
      status: 'COMPLETE' as const,
      market,
      legs,
      reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL' as const
    };
    const authorityDigest = await deriveBaselineAuthorityDigest(withoutDigest);
    return { ...withoutDigest, authorityDigest };
  } catch (error) {
    // Reorg and authority drift are not ordinary missing evidence. They invalidate the
    // observation point itself and must escape without writing a terminal batch.
    if (isAuthorityOrReorgError(error)) throw error;

    await assertDecisionPointStable(source, decisionBlock, decisionBlockHash);
    await source.assertAuthority(decisionBlock);
    const reason = stableErrorReason(error);
    const withoutDigest = {
      baselineId,
      launchId: launch.launchId,
      policyVersion: EXECUTABLE_BASELINE_R1 as typeof EXECUTABLE_BASELINE_R1,
      decisionBlock,
      decisionBlockHash,
      observedAtMs,
      status: 'UNVERIFIED' as const,
      reason,
      market: null,
      legs: [],
      reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL' as const
    };
    const authorityDigest = await deriveBaselineAuthorityDigest(withoutDigest);
    return { ...withoutDigest, authorityDigest };
  }
}

async function assertDecisionPointStable(source: ExecutableBaselineSource, block: bigint, expectedHash: Hex): Promise<void> {
  const actual = await source.getBlockHash(block);
  if (actual.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(`BASELINE_REORG_DURING_READ:block=${block}`);
  }
}

function validateOptions(options: ExecutableBaselineOptions): void {
  if (options.decisionDelayBlocks < 0n) throw new Error('decisionDelayBlocks must be >= 0');
  if (options.confirmations < 0n) throw new Error('confirmations must be >= 0');
  if (!Number.isInteger(options.maxLaunchesPerSync) || options.maxLaunchesPerSync < 1 || options.maxLaunchesPerSync > 10_000) {
    throw new Error('maxLaunchesPerSync must be an integer in [1, 10000]');
  }
  const notionals = options.notionalsUsdMicros ?? DEFAULT_BASELINE_NOTIONALS_USD_MICROS;
  if (notionals.length === 0 || notionals.some((v) => v <= 0n)) throw new Error('baseline notionals must be > 0');
  const unique = new Set(notionals.map(String));
  if (unique.size !== notionals.length) throw new Error('baseline notionals must be unique');
}

function stableErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512);
}

function isAuthorityOrReorgError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:_DRIFT|AUTHORITY_CODE_MISSING|SENTRY_PROXY_IMPLEMENTATION_MISSING|BASELINE_REORG_DURING_READ)/.test(message);
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
