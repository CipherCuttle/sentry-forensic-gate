import type { Hex } from '../domain.js';
import { sha256Hex } from '../evidence/canonical.js';
import {
  DEFAULT_BASELINE_NOTIONALS_USD_MICROS,
  EXECUTABLE_BASELINE_R1,
  deriveBaselineId,
  independentRecoveryBps
} from '../shadow/baselineTypes.js';
import {
  MULTICHAIN_ADAPTER_MODE,
  MULTICHAIN_SHADOW_RESEARCH_AUTHORITY,
  type NormalizedLaunchCandidate,
  type NormalizedMarket,
  type PortableBaselineBatch,
  type PortableBaselineLeg,
  type PortableQuoteObservation,
  type SourceAuthorityEnvelope,
  type UsdCalibrationObservation
} from './domain.js';
import type {
  ChainLaunchAdapter,
  MarketQuoteAdapter,
  UsdCalibrationAdapter
} from './ports.js';

export const PORTABLE_BASELINE_DECISION_DELAY_BLOCKS = 2n;
export const PORTABLE_BASELINE_CONFIRMATIONS = 2n;
export const PORTABLE_BASELINE_NOTIONALS_USD_MICROS = Object.freeze([
  250_000n,
  500_000n,
  1_000_000n,
  2_000_000n,
  5_000_000n
] as const);

export const PORTABLE_EXECUTABLE_BASELINE_R1 =
  'PORTABLE_EXECUTABLE_BASELINE_R1' as const;

export interface PortableBaselineAdapters {
  readonly launch: ChainLaunchAdapter;
  readonly marketQuotes: MarketQuoteAdapter;
  readonly usdCalibration: UsdCalibrationAdapter;
}

type PortableBaselineWithoutDigest = Omit<PortableBaselineBatch, 'authorityDigest'>;

/**
 * Compose the frozen prospective baseline semantics through chain-neutral
 * adapters. Strategy parameters are intentionally not configurable here:
 * decision delay, confirmations, notional ladder and FAST_VET policy remain
 * identical to the existing prospective baseline.
 */
export async function buildPortableBaselineBatch(
  adapters: PortableBaselineAdapters,
  launch: NormalizedLaunchCandidate,
  now: () => number = Date.now
): Promise<PortableBaselineBatch> {
  assertFrozenStrategyParity();
  assertPortableBaselineIdentity(adapters, launch);

  const headBlock = await adapters.launch.getHeadBlockNumber();
  const decisionBlock = launch.blockNumber + PORTABLE_BASELINE_DECISION_DELAY_BLOCKS;
  const matureAt = decisionBlock + PORTABLE_BASELINE_CONFIRMATIONS;
  if (headBlock < matureAt) {
    throw new Error(
      `PORTABLE_BASELINE_LAUNCH_NOT_MATURE:head=${headBlock}:required=${matureAt}`
    );
  }

  await adapters.launch.assertAuthority(launch.blockNumber);
  const decisionBlockHash = await adapters.launch.getBlockHash(decisionBlock);
  await adapters.launch.assertAuthority(decisionBlock);

  const baselineId = await deriveBaselineId({
    launchId: launch.launchId,
    decisionBlock,
    decisionBlockHash,
    policyVersion: EXECUTABLE_BASELINE_R1
  });
  const observedAtMs = now();

  try {
    const market = await adapters.marketQuotes.resolveMarket(launch, decisionBlock);
    assertMarketBinding(launch, market);

    const legs: PortableBaselineLeg[] = [];
    const quoteIds = new Set<string>();

    for (const notionalUsdMicros of PORTABLE_BASELINE_NOTIONALS_USD_MICROS) {
      const calibration = await adapters.usdCalibration.calibrateUsd({
        launch,
        market,
        decisionBlock,
        decisionBlockHash,
        notionalUsdMicros
      });
      assertCalibrationBinding(calibration, market, notionalUsdMicros);

      const entry = await adapters.marketQuotes.quoteEntry({
        launch,
        market,
        decisionBlock,
        decisionBlockHash,
        notionalUsdMicros,
        amountIn: calibration.baseAmount
      });
      assertEntryBinding({
        launch,
        market,
        decisionBlock,
        decisionBlockHash,
        notionalUsdMicros,
        calibration,
        entry
      });
      assertUniqueQuoteId(quoteIds, entry.quoteId);

      let reverse: PortableQuoteObservation | null = null;
      let recovery: bigint | null = null;
      if (entry.executable && entry.amountOut > 0n) {
        reverse = await adapters.marketQuotes.quoteIndependentReverse({
          launch,
          market,
          decisionBlock,
          decisionBlockHash,
          notionalUsdMicros,
          amountIn: entry.amountOut
        });
        assertReverseBinding({
          launch,
          market,
          decisionBlock,
          decisionBlockHash,
          notionalUsdMicros,
          entry,
          reverse
        });
        assertUniqueQuoteId(quoteIds, reverse.quoteId);
        if (reverse.executable) {
          recovery = independentRecoveryBps(entry.amountIn, reverse.amountOut);
        }
      }

      legs.push({
        notionalUsdMicros,
        calibration,
        entry,
        reverse,
        independentReverseRecoveryBps: recovery
      });
    }

    assertFrozenLegSet(legs);
    await assertDecisionPointStable(adapters.launch, decisionBlock, decisionBlockHash);

    const sourceAuthority = buildSourceAuthority({
      baselineId,
      launch,
      decisionBlock,
      decisionBlockHash,
      status: 'COMPLETE',
      market,
      legs
    });
    const withoutDigest: PortableBaselineWithoutDigest = {
      baselineId,
      launchId: launch.launchId,
      policyVersion: EXECUTABLE_BASELINE_R1,
      decisionBlock,
      decisionBlockHash,
      observedAtMs,
      status: 'COMPLETE',
      market,
      legs,
      reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
      chainId: launch.chainId,
      ecosystem: launch.ecosystem,
      launchProtocol: launch.launchProtocol,
      sourceAuthority
    };
    const authorityDigest = await derivePortableBaselineAuthorityDigest(withoutDigest);
    return { ...withoutDigest, authorityDigest };
  } catch (error) {
    if (!isTerminalPortableEvidenceGap(error)) throw error;

    await assertDecisionPointStable(adapters.launch, decisionBlock, decisionBlockHash);
    const reason = stableErrorReason(error);
    const sourceAuthority = buildSourceAuthority({
      baselineId,
      launch,
      decisionBlock,
      decisionBlockHash,
      status: 'UNVERIFIED',
      reason,
      market: null,
      legs: []
    });
    const withoutDigest: PortableBaselineWithoutDigest = {
      baselineId,
      launchId: launch.launchId,
      policyVersion: EXECUTABLE_BASELINE_R1,
      decisionBlock,
      decisionBlockHash,
      observedAtMs,
      status: 'UNVERIFIED',
      reason,
      market: null,
      legs: [],
      reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
      chainId: launch.chainId,
      ecosystem: launch.ecosystem,
      launchProtocol: launch.launchProtocol,
      sourceAuthority
    };
    const authorityDigest = await derivePortableBaselineAuthorityDigest(withoutDigest);
    return { ...withoutDigest, authorityDigest };
  }
}

export async function derivePortableBaselineAuthorityDigest(
  batch: PortableBaselineWithoutDigest
): Promise<string> {
  return sha256Hex(portableBaselineAuthority(batch));
}

export function portableBaselineAuthority(
  batch: PortableBaselineWithoutDigest | PortableBaselineBatch
) {
  return {
    baselineId: batch.baselineId,
    launchId: batch.launchId,
    chainId: batch.chainId,
    ecosystem: batch.ecosystem,
    launchProtocol: batch.launchProtocol,
    policyVersion: batch.policyVersion,
    decisionBlock: batch.decisionBlock,
    decisionBlockHash: batch.decisionBlockHash.toLowerCase(),
    status: batch.status,
    reason: batch.reason ?? null,
    market: batch.market,
    legs: batch.legs.map((leg) => ({
      notionalUsdMicros: leg.notionalUsdMicros,
      calibration: leg.calibration,
      entry: stripObservedAt(leg.entry),
      reverse: leg.reverse ? stripObservedAt(leg.reverse) : null,
      independentReverseRecoveryBps: leg.independentReverseRecoveryBps
    })),
    reverseSemantics: batch.reverseSemantics,
    sourceAuthority: batch.sourceAuthority
  };
}

function assertPortableBaselineIdentity(
  adapters: PortableBaselineAdapters,
  launch: NormalizedLaunchCandidate
): void {
  const components = [
    adapters.launch,
    adapters.marketQuotes,
    adapters.usdCalibration
  ] as const;
  for (const component of components) {
    if (component.mode !== MULTICHAIN_ADAPTER_MODE) {
      throw new Error('PORTABLE_BASELINE_NON_SHADOW_ADAPTER');
    }
    if (
      component.chainId !== launch.chainId ||
      component.ecosystem !== launch.ecosystem ||
      component.launchProtocol !== launch.launchProtocol
    ) {
      throw new Error('PORTABLE_BASELINE_ADAPTER_IDENTITY_MISMATCH');
    }
  }
}

function assertMarketBinding(
  launch: NormalizedLaunchCandidate,
  market: NormalizedMarket
): void {
  if (
    market.launchId !== launch.launchId ||
    market.chainId !== launch.chainId ||
    market.ecosystem !== launch.ecosystem ||
    market.launchProtocol !== launch.launchProtocol ||
    norm(market.launchedToken) !== norm(launch.token)
  ) {
    throw new Error('PORTABLE_BASELINE_MARKET_BINDING_MISMATCH');
  }
}

function assertCalibrationBinding(
  calibration: UsdCalibrationObservation,
  market: NormalizedMarket,
  notionalUsdMicros: bigint
): void {
  if (
    calibration.notionalUsdMicros !== notionalUsdMicros ||
    norm(calibration.baseAsset) !== norm(market.baseAsset) ||
    calibration.baseAmount <= 0n ||
    !Number.isInteger(calibration.baseDecimals) ||
    calibration.baseDecimals < 0
  ) {
    throw new Error('PORTABLE_BASELINE_CALIBRATION_BINDING_MISMATCH');
  }
}

function assertEntryBinding(params: {
  launch: NormalizedLaunchCandidate;
  market: NormalizedMarket;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  notionalUsdMicros: bigint;
  calibration: UsdCalibrationObservation;
  entry: PortableQuoteObservation;
}): void {
  const { launch, market, decisionBlock, decisionBlockHash, notionalUsdMicros, calibration, entry } =
    params;
  if (
    entry.kind !== 'ENTRY' ||
    entry.launchId !== launch.launchId ||
    entry.marketId !== market.marketId ||
    entry.blockNumber !== decisionBlock ||
    norm(entry.blockHash) !== norm(decisionBlockHash) ||
    entry.notionalUsdMicros !== notionalUsdMicros ||
    norm(entry.tokenIn) !== norm(calibration.baseAsset) ||
    norm(entry.tokenOut) !== norm(launch.token) ||
    entry.amountIn <= 0n ||
    entry.amountIn > calibration.baseAmount ||
    entry.amountOut < 0n
  ) {
    throw new Error('PORTABLE_BASELINE_ENTRY_BINDING_MISMATCH');
  }
  if (entry.executable && entry.amountOut <= 0n) {
    throw new Error('PORTABLE_BASELINE_ENTRY_EXECUTABLE_WITHOUT_OUTPUT');
  }
}

function assertReverseBinding(params: {
  launch: NormalizedLaunchCandidate;
  market: NormalizedMarket;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  notionalUsdMicros: bigint;
  entry: PortableQuoteObservation;
  reverse: PortableQuoteObservation;
}): void {
  const { launch, market, decisionBlock, decisionBlockHash, notionalUsdMicros, entry, reverse } =
    params;
  if (
    reverse.kind !== 'INDEPENDENT_REVERSE_EXIT' ||
    reverse.launchId !== launch.launchId ||
    reverse.marketId !== market.marketId ||
    reverse.blockNumber !== decisionBlock ||
    norm(reverse.blockHash) !== norm(decisionBlockHash) ||
    reverse.notionalUsdMicros !== notionalUsdMicros ||
    norm(reverse.tokenIn) !== norm(launch.token) ||
    norm(reverse.tokenOut) !== norm(market.baseAsset) ||
    reverse.amountIn !== entry.amountOut ||
    reverse.amountOut < 0n
  ) {
    throw new Error('PORTABLE_BASELINE_REVERSE_BINDING_MISMATCH');
  }
  if (reverse.executable && reverse.amountOut <= 0n) {
    throw new Error('PORTABLE_BASELINE_REVERSE_EXECUTABLE_WITHOUT_OUTPUT');
  }
}

function assertFrozenStrategyParity(): void {
  if (
    DEFAULT_BASELINE_NOTIONALS_USD_MICROS.length !==
    PORTABLE_BASELINE_NOTIONALS_USD_MICROS.length
  ) {
    throw new Error('PORTABLE_BASELINE_STRATEGY_DRIFT:NOTIONAL_COUNT');
  }
  for (let index = 0; index < PORTABLE_BASELINE_NOTIONALS_USD_MICROS.length; index += 1) {
    if (
      DEFAULT_BASELINE_NOTIONALS_USD_MICROS[index] !==
      PORTABLE_BASELINE_NOTIONALS_USD_MICROS[index]
    ) {
      throw new Error(`PORTABLE_BASELINE_STRATEGY_DRIFT:NOTIONAL_${index}`);
    }
  }
}

function assertFrozenLegSet(legs: readonly PortableBaselineLeg[]): void {
  if (legs.length !== PORTABLE_BASELINE_NOTIONALS_USD_MICROS.length) {
    throw new Error('PORTABLE_BASELINE_NOTIONAL_SET_MISMATCH');
  }
  for (let index = 0; index < PORTABLE_BASELINE_NOTIONALS_USD_MICROS.length; index += 1) {
    if (legs[index]?.notionalUsdMicros !== PORTABLE_BASELINE_NOTIONALS_USD_MICROS[index]) {
      throw new Error('PORTABLE_BASELINE_NOTIONAL_SET_MISMATCH');
    }
  }
}

async function assertDecisionPointStable(
  launchAdapter: ChainLaunchAdapter,
  decisionBlock: bigint,
  expectedHash: Hex
): Promise<void> {
  // Authority recheck comes first. The final chain-dependent read is the
  // decision-block hash, matching the fail-closed evidence fence used by M2B-D.
  await launchAdapter.assertAuthority(decisionBlock);
  const actual = await launchAdapter.getBlockHash(decisionBlock);
  if (norm(actual) !== norm(expectedHash)) {
    throw new Error(`PORTABLE_BASELINE_REORG_DURING_READ:block=${decisionBlock}`);
  }
}

function buildSourceAuthority(input: {
  baselineId: string;
  launch: NormalizedLaunchCandidate;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  status: 'COMPLETE' | 'UNVERIFIED';
  reason?: string;
  market: NormalizedMarket | null;
  legs: readonly PortableBaselineLeg[];
}): SourceAuthorityEnvelope {
  return {
    schema: 'PORTABLE_EXECUTABLE_BASELINE_R1',
    payload: {
      authority: MULTICHAIN_SHADOW_RESEARCH_AUTHORITY,
      baselineVersion: PORTABLE_EXECUTABLE_BASELINE_R1,
      baselineId: input.baselineId,
      launchId: input.launch.launchId,
      chainId: input.launch.chainId,
      ecosystem: input.launch.ecosystem,
      launchProtocol: input.launch.launchProtocol,
      policyVersion: EXECUTABLE_BASELINE_R1,
      decisionDelayBlocks: PORTABLE_BASELINE_DECISION_DELAY_BLOCKS.toString(),
      confirmations: PORTABLE_BASELINE_CONFIRMATIONS.toString(),
      decisionBlock: input.decisionBlock.toString(),
      decisionBlockHash: norm(input.decisionBlockHash),
      status: input.status,
      reason: input.reason ?? null,
      reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
      notionalsUsdMicros: PORTABLE_BASELINE_NOTIONALS_USD_MICROS.map(String),
      launchSourceAuthority: authorityObject(input.launch.sourceAuthority),
      marketSourceAuthority: input.market ? authorityObject(input.market.sourceAuthority) : null,
      legAuthority: input.legs.map((leg) => ({
        notionalUsdMicros: leg.notionalUsdMicros.toString(),
        calibration: authorityObject(leg.calibration.sourceAuthority),
        entry: authorityObject(leg.entry.sourceAuthority),
        reverse: leg.reverse ? authorityObject(leg.reverse.sourceAuthority) : null
      }))
    }
  };
}

function authorityObject(authority: SourceAuthorityEnvelope) {
  return { schema: authority.schema, payload: authority.payload };
}

function assertUniqueQuoteId(ids: Set<string>, quoteId: string): void {
  if (!quoteId || ids.has(quoteId)) throw new Error('PORTABLE_BASELINE_QUOTE_ID_DUPLICATE');
  ids.add(quoteId);
}

function stripObservedAt(quote: PortableQuoteObservation) {
  const { observedAtMs: _ignored, ...authority } = quote;
  return authority;
}

function isTerminalPortableEvidenceGap(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /^(?:PONS_V2_QUOTE_MARKET_NOT_ACTIVE|PONS_V2_QUOTE_UNSUPPORTED_PAIR_TOKEN|ROBINHOOD_USD_CALIBRATION_UNSUPPORTED_BASE|ROBINHOOD_USD_CALIBRATION_UNAVAILABLE)(?::|$)/.test(
    message
  );
}

function stableErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 512);
}

function norm(value: string): string {
  return value.toLowerCase();
}
