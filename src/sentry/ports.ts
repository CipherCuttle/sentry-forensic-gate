import type { Hex, LaunchObserved, QuoteObservation } from '../domain.js';

export interface LaunchSource {
  getHeadBlockNumber(): Promise<bigint>;
  getBlockHash(blockNumber: bigint): Promise<Hex>;
  assertAuthority(blockNumber: bigint): Promise<void>;
  catchUp(fromBlock: bigint, toBlock: bigint): Promise<LaunchObserved[]>;
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
