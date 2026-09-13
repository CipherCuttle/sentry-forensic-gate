import type { Hex, LaunchObserved } from '../domain.js';
import type { BaselineQuoteReceipt, LaunchMarket, UsdCalibration } from '../shadow/baselineTypes.js';

export interface RawQuoteResult {
  executable: boolean;
  amountIn: bigint;
  amountOut: bigint;
  failureReason?: string;
  sqrtPriceX96After?: bigint;
  initializedTicksCrossed?: number;
  gasEstimate?: bigint;
}

export interface ExecutableBaselineSource {
  getHeadBlockNumber(): Promise<bigint>;
  getBlockHash(blockNumber: bigint): Promise<Hex>;
  assertAuthority(blockNumber: bigint): Promise<void>;
  resolveMarket(launch: LaunchObserved, decisionBlock: bigint): Promise<LaunchMarket>;
  calibrateUsd(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
  }): Promise<UsdCalibration>;
  quoteEntry(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<BaselineQuoteReceipt>;
  quoteIndependentReverse(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<BaselineQuoteReceipt>;
}
