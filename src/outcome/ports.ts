import type { Hex } from '../domain.js';
import type { LaunchMarket } from '../shadow/baselineTypes.js';

export interface OutcomeBlockPoint {
  blockNumber: bigint;
  blockHash: Hex;
  timestampMs: number;
}

export interface OutcomeMarketState {
  activeLiquidity: bigint;
}

export interface OutcomeExitQuote {
  executable: boolean;
  amountOut: bigint;
  failureReason?: string;
}

export interface ForwardOutcomeSource {
  getHeadBlockNumber(): Promise<bigint>;
  getBlockPoint(blockNumber: bigint): Promise<OutcomeBlockPoint>;
  assertMarketAuthority(market: LaunchMarket, blockNumber: bigint): Promise<void>;
  readMarketState(market: LaunchMarket, blockNumber: bigint): Promise<OutcomeMarketState>;
  quoteTokenToBase(params: {
    market: LaunchMarket;
    tokenAmount: bigint;
    blockNumber: bigint;
  }): Promise<OutcomeExitQuote>;
  valueBaseAmountUsdMicros(params: {
    baseToken: Hex;
    baseAmount: bigint;
    blockNumber: bigint;
  }): Promise<bigint>;
}
