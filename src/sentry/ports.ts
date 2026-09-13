import type { LaunchObserved, QuoteObservation } from '../domain.js';

export interface LaunchSource {
  catchUp(fromBlock: bigint, toBlock: bigint): Promise<LaunchObserved[]>;
  watch(onLaunch: (launch: LaunchObserved) => Promise<void>): Promise<() => Promise<void>>;
}

export interface ProtocolVerifier {
  verify(launch: LaunchObserved): Promise<{
    canonicalLaunch: boolean | null;
    poolResolved: boolean | null;
    infrastructureMatches: boolean | null;
    contradictoryChainState: boolean;
  }>;
}

export interface QuoteSource {
  quoteEntry(launch: LaunchObserved, usdMicros: bigint): Promise<QuoteObservation>;
  quoteReverseExit(entry: QuoteObservation): Promise<QuoteObservation>;
}
