import { getAddress, type Address, type Hex } from 'viem';
import type { LaunchObserved } from '../domain.js';
import type { BaselineQuoteReceipt, LaunchMarket } from '../shadow/baselineTypes.js';
import { CANARY_PRIMARY_NOTIONAL_USD_MICROS } from './swapIntent.js';
import { CanaryApprovalStore } from './approvalStore.js';
import { CanaryExitStore } from './exitStore.js';
import {
  advanceCanaryE0RoundTrip,
  type CanaryE0RoundTripExecutor,
  type CanaryE0RoundTripRuntimeAction,
  type CanaryE0RoundTripRuntimeOptions,
  type CanaryE0RoundTripRuntimeReport
} from './roundTripRuntime.js';
import { CanaryStore } from './store.js';
import { assertCanaryQuoteBlockHash } from './viemCanaryExecutor.js';

export const CANARY_E0_LIVE_WIRING_READINESS_R0 = 'CANARY_E0_LIVE_WIRING_READINESS_R0' as const;

export interface CanaryE0RoundTripLaunchStore {
  getLaunch(launchId: string): Promise<LaunchObserved | null> | LaunchObserved | null;
}

export interface CanaryE0RoundTripQuoteSource {
  getHeadBlockNumber(): Promise<bigint>;
  getBlockHash(blockNumber: bigint): Promise<Hex>;
  assertAuthority(blockNumber: bigint): Promise<void>;
  resolveMarket(launch: LaunchObserved, decisionBlock: bigint): Promise<LaunchMarket>;
  quoteIndependentReverse(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<BaselineQuoteReceipt>;
}

export type CanaryE0RoundTripWiringAction =
  | 'DISABLED'
  | 'DRY_ARMED'
  | 'WAITING_BUY'
  | 'BUY_NOT_INCLUDED'
  | CanaryE0RoundTripRuntimeAction;

export interface CanaryE0RoundTripWiringReport {
  version: typeof CANARY_E0_LIVE_WIRING_READINESS_R0;
  action: CanaryE0RoundTripWiringAction;
  buyActionId?: string;
  quoteBlockNumber?: bigint;
  runtime?: CanaryE0RoundTripRuntimeReport;
  reason?: string;
}

export async function syncCanaryE0RoundTripWiring(params: {
  enabled: boolean;
  launchStore: CanaryE0RoundTripLaunchStore;
  buyStore: CanaryStore;
  approvalStore: CanaryApprovalStore;
  exitStore: CanaryExitStore;
  quoteSource: CanaryE0RoundTripQuoteSource;
  executor: CanaryE0RoundTripExecutor | null;
  options: CanaryE0RoundTripRuntimeOptions;
}): Promise<CanaryE0RoundTripWiringReport> {
  if (!params.enabled) return report('DISABLED');
  if (!params.executor) return report('DRY_ARMED');

  const buy = params.buyStore.getCommittedBuy();
  if (!buy) return report('WAITING_BUY');
  if (buy.state !== 'INCLUDED') {
    return report('BUY_NOT_INCLUDED', {
      buyActionId: buy.actionId,
      reason: `CANARY_E0_BUY_NOT_INCLUDED:${buy.state}`
    });
  }

  const first = await advanceCanaryE0RoundTrip({
    buyActionId: buy.actionId,
    buyStore: params.buyStore,
    approvalStore: params.approvalStore,
    exitStore: params.exitStore,
    executor: params.executor,
    options: params.options
  });
  if (first.action !== 'NEEDS_EXIT_QUOTE') return fromRuntime(first);

  const intent = buy.intent;
  if (!intent || buy.outputBalanceBefore === null || buy.outputBalanceAfter === null) {
    return report('BLOCKED_SETUP', { buyActionId: buy.actionId, reason: 'CANARY_E0_INCLUDED_BUY_EVIDENCE_INCOMPLETE' });
  }
  const acquired = buy.outputBalanceAfter - buy.outputBalanceBefore;
  if (acquired <= 0n) {
    return report('BLOCKED_SETUP', { buyActionId: buy.actionId, reason: 'CANARY_E0_INCLUDED_BUY_ACQUIRED_NONPOSITIVE' });
  }

  try {
    const launch = await params.launchStore.getLaunch(buy.launchId);
    if (!launch) throw new Error('CANARY_E0_LAUNCH_MISSING');

    const quoteBlockNumber = await params.quoteSource.getHeadBlockNumber();
    if (quoteBlockNumber < intent.quoteBlockNumber) throw new Error('CANARY_E0_EXIT_QUOTE_BLOCK_BEFORE_BUY_QUOTE');
    const quoteBlockHash = await params.quoteSource.getBlockHash(quoteBlockNumber);
    await params.quoteSource.assertAuthority(quoteBlockNumber);
    const market = await params.quoteSource.resolveMarket(launch, quoteBlockNumber);
    assertMarketBoundToBuy(market, intent.tokenIn, intent.tokenOut, intent.fee, buy.launchId);

    const exitQuote = await params.quoteSource.quoteIndependentReverse({
      launch,
      market,
      decisionBlock: quoteBlockNumber,
      decisionBlockHash: quoteBlockHash,
      notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
      amountIn: acquired
    });
    if (!exitQuote.executable || exitQuote.amountOut <= 0n) throw new Error('CANARY_E0_FRESH_EXIT_NOT_EXECUTABLE');

    const quoteBlockHashAfter = await params.quoteSource.getBlockHash(quoteBlockNumber);
    assertCanaryQuoteBlockHash(quoteBlockHash, quoteBlockHashAfter);

    const second = await advanceCanaryE0RoundTrip({
      buyActionId: buy.actionId,
      buyStore: params.buyStore,
      approvalStore: params.approvalStore,
      exitStore: params.exitStore,
      executor: params.executor,
      options: params.options,
      exitQuote
    });
    return {
      ...fromRuntime(second),
      quoteBlockNumber
    };
  } catch (error) {
    return report('BLOCKED_SETUP', {
      buyActionId: buy.actionId,
      reason: stableError(error)
    });
  }
}

function assertMarketBoundToBuy(
  market: LaunchMarket,
  expectedBase: Address,
  expectedLaunched: Address,
  expectedFee: number,
  expectedLaunchId: string
): void {
  if (market.launchId !== expectedLaunchId) throw new Error('CANARY_E0_EXIT_MARKET_LAUNCH_MISMATCH');
  if (getAddress(market.baseToken) !== getAddress(expectedBase)) throw new Error('CANARY_E0_EXIT_MARKET_BASE_TOKEN_MISMATCH');
  if (getAddress(market.launchedToken) !== getAddress(expectedLaunched)) throw new Error('CANARY_E0_EXIT_MARKET_LAUNCHED_TOKEN_MISMATCH');
  if (market.fee !== expectedFee) throw new Error('CANARY_E0_EXIT_MARKET_FEE_MISMATCH');
}

function fromRuntime(runtime: CanaryE0RoundTripRuntimeReport): CanaryE0RoundTripWiringReport {
  return {
    version: CANARY_E0_LIVE_WIRING_READINESS_R0,
    action: runtime.action,
    buyActionId: runtime.buyActionId,
    runtime
  };
}

function report(
  action: CanaryE0RoundTripWiringAction,
  extra: { buyActionId?: string; reason?: string } = {}
): CanaryE0RoundTripWiringReport {
  return {
    version: CANARY_E0_LIVE_WIRING_READINESS_R0,
    action,
    ...extra
  };
}

function stableError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
