import type { LaunchObserved, QuoteObservation } from '../domain.js';

export interface ShadowEntry {
  launchId: string;
  notionalUsdMicros: bigint;
  entry: QuoteObservation;
  immediateExit: QuoteObservation;
}

export interface ShadowExecutor {
  simulate(launch: LaunchObserved, notionalUsdMicros: bigint): Promise<ShadowEntry>;
}
