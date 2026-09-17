import type { Hex } from '../domain.js';
import {
  MULTICHAIN_ADAPTER_MODE,
  MULTICHAIN_SHADOW_RESEARCH_AUTHORITY,
  type LaunchProtocolId,
  type LiquidityObservation,
  type NormalizedBlockPoint,
  type NormalizedLaunchCandidate,
  type NormalizedMarket,
  type PortableExitQuote,
  type PortableQuoteObservation,
  type PortableUsdValuation,
  type ResearchEcosystem,
  type UsdCalibrationObservation
} from './domain.js';

export interface ResearchAdapterIdentity {
  readonly chainId: number;
  readonly ecosystem: ResearchEcosystem;
  readonly launchProtocol: LaunchProtocolId;
  readonly mode: typeof MULTICHAIN_ADAPTER_MODE;
}

/** Prospectively ingests launches. Any authority ambiguity must throw, not guess. */
export interface ChainLaunchAdapter extends ResearchAdapterIdentity {
  getHeadBlockNumber(): Promise<bigint>;
  getBlockHash(blockNumber: bigint): Promise<Hex>;
  assertAuthority(blockNumber: bigint): Promise<void>;
  catchUp(fromBlock: bigint, toBlock: bigint): Promise<NormalizedLaunchCandidate[]>;
}

/** Resolves a canonical market and obtains read-only entry/reverse evidence. */
export interface MarketQuoteAdapter extends ResearchAdapterIdentity {
  resolveMarket(launch: NormalizedLaunchCandidate, decisionBlock: bigint): Promise<NormalizedMarket>;
  quoteEntry(params: {
    launch: NormalizedLaunchCandidate;
    market: NormalizedMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<PortableQuoteObservation>;
  quoteIndependentReverse(params: {
    launch: NormalizedLaunchCandidate;
    market: NormalizedMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<PortableQuoteObservation>;
}

/** Converts the frozen USD notional ladder into the market base asset at the decision block. */
export interface UsdCalibrationAdapter extends ResearchAdapterIdentity {
  calibrateUsd(params: {
    launch: NormalizedLaunchCandidate;
    market: NormalizedMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
  }): Promise<UsdCalibrationObservation>;
}

/** Read-only primitives used by the common prospective outcome engine. */
export interface ForwardOutcomeAdapter extends ResearchAdapterIdentity {
  getHeadBlockNumber(): Promise<bigint>;
  getBlockPoint(blockNumber: bigint): Promise<NormalizedBlockPoint>;
  assertMarketAuthority(market: NormalizedMarket, blockNumber: bigint): Promise<void>;
  readLiquidity(market: NormalizedMarket, blockNumber: bigint): Promise<LiquidityObservation>;
  quoteExit(params: {
    market: NormalizedMarket;
    tokenAmount: bigint;
    blockNumber: bigint;
  }): Promise<PortableExitQuote>;
  valueBaseAmountUsdMicros(params: {
    market: NormalizedMarket;
    baseAmount: bigint;
    blockNumber: bigint;
  }): Promise<PortableUsdValuation>;
}

export interface MultiChainResearchAdapter {
  readonly authority: typeof MULTICHAIN_SHADOW_RESEARCH_AUTHORITY;
  readonly launch: ChainLaunchAdapter;
  readonly marketQuotes: MarketQuoteAdapter;
  readonly usdCalibration: UsdCalibrationAdapter;
  readonly forwardOutcomes: ForwardOutcomeAdapter;
}

/**
 * Fail closed if independently constructed adapter components disagree about
 * chain/protocol identity or attempt to expose a non-shadow mode.
 */
export function assertAdapterIdentity(adapter: MultiChainResearchAdapter): void {
  if (adapter.authority !== MULTICHAIN_SHADOW_RESEARCH_AUTHORITY) {
    throw new Error('MULTICHAIN_ADAPTER_AUTHORITY_MISMATCH');
  }

  const components: readonly ResearchAdapterIdentity[] = [
    adapter.launch,
    adapter.marketQuotes,
    adapter.usdCalibration,
    adapter.forwardOutcomes
  ];
  const expected = adapter.launch;
  for (const component of components) {
    if (component.mode !== MULTICHAIN_ADAPTER_MODE) {
      throw new Error('MULTICHAIN_ADAPTER_NON_SHADOW_MODE');
    }
    if (
      component.chainId !== expected.chainId ||
      component.ecosystem !== expected.ecosystem ||
      component.launchProtocol !== expected.launchProtocol
    ) {
      throw new Error('MULTICHAIN_ADAPTER_IDENTITY_MISMATCH');
    }
  }
}
