import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  keccak256,
  type Address,
  type PublicClient
} from 'viem';
import type { Hex } from '../../../domain.js';
import { sha256Hex } from '../../../evidence/canonical.js';
import type {
  CanonicalJsonValue,
  LiquidityObservation,
  NormalizedBlockPoint,
  NormalizedMarket,
  PortableExitQuote,
  PortableUsdValuation,
  SourceAuthorityEnvelope
} from '../../../multichain/domain.js';
import type { ForwardOutcomeAdapter } from '../../../multichain/ports.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  erc20UsdIdentityReadAbi,
  ponsV2CurveQuoteReadAbi,
  ponsV2FactoryReadAbi,
  ponsV2LaunchDeployerReadAbi,
  ponsV2MemeHookReadAbi,
  uniswapV4QuoterReadAbi,
  uniswapV4StateViewReadAbi
} from './contracts.js';
import {
  assertPonsV2AuthorityBlock,
  validatePonsV2Authority,
  type PonsV2Authority
} from './authority.js';
import {
  assertPonsV2CurveTemplateBlock,
  validatePonsV2CurveTemplateAuthority,
  type PonsV2CurveTemplateAuthority
} from './curveTemplateAuthority.js';
import {
  computePonsV2CurveReverse,
  type PonsV2CurveQuoteState
} from './viemCurveQuoteAdapter.js';
import { ViemPonsV2LaunchAdapter } from './viemLaunchAdapter.js';
import {
  ROBINHOOD_USDG_EIP1967_IMPLEMENTATION_SLOT,
  ROBINHOOD_ETH_USDG_V4_POOL_KEY,
  assertRobinhoodUsdCalibrationBlock,
  validateRobinhoodUsdCalibrationAuthority,
  type RobinhoodUsdCalibrationAuthority
} from './v4UsdCalibrationAuthority.js';
import {
  assertPonsV2ForwardOutcomeBlock,
  validatePonsV2ForwardOutcomeAuthority,
  type PonsV2ForwardOutcomeAuthority
} from './forwardOutcomeAuthority.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});

const UINT128_MAX = (1n << 128n) - 1n;

export const PONS_V2_FORWARD_OUTCOME_ADAPTER_R1 =
  'PONS_V2_FORWARD_OUTCOME_ADAPTER_R1' as const;

type PonsV2LaunchRecord = {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: number;
  sweptQuote: bigint;
  sweptTokens: bigint;
  sweptAt: bigint;
  exists: boolean;
};

interface BaselineMarketAuthority {
  authorityId: string;
  factoryRuntimeCodeHash: Hex;
  factory: Hex;
  token: Hex;
  curve: Hex;
  pairToken: Hex;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  state: string;
}

interface V4PoolState {
  poolId: Hex;
  poolKey: {
    currency0: Hex;
    currency1: Hex;
    fee: number;
    tickSpacing: number;
    hooks: Hex;
  };
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
  liquidity: bigint;
}

type ObservedState =
  | {
      phase: 'CURVE_ACTIVE';
      blockHash: Hex;
      record: PonsV2LaunchRecord;
      curve: PonsV2CurveQuoteState;
    }
  | {
      phase: 'CURVE_HALTED_READY';
      blockHash: Hex;
      record: PonsV2LaunchRecord;
    }
  | {
      phase: 'SWEPT_PENDING_V4';
      blockHash: Hex;
      record: PonsV2LaunchRecord;
    }
  | {
      phase: 'V4_POOL_ACTIVE';
      blockHash: Hex;
      record: PonsV2LaunchRecord;
      v4: V4PoolState;
    }
  | {
      phase: 'RESCUED_TERMINAL';
      blockHash: Hex;
      record: PonsV2LaunchRecord;
    };

export interface ViemPonsV2ForwardOutcomeAdapterOptions {
  ponsAuthority: Readonly<PonsV2Authority>;
  curveTemplateAuthority: Readonly<PonsV2CurveTemplateAuthority>;
  usdAuthority: Readonly<RobinhoodUsdCalibrationAuthority>;
  outcomeAuthority: Readonly<PonsV2ForwardOutcomeAuthority>;
  rpcUrl?: string;
  client?: PublicClient;
}

export class ViemPonsV2ForwardOutcomeAdapter
implements ForwardOutcomeAdapter {
  readonly chainId = ROBINHOOD_CHAIN_ID;
  readonly ecosystem = 'ROBINHOOD' as const;
  readonly launchProtocol = 'PONS' as const;
  readonly mode = 'SHADOW_ONLY' as const;

  private readonly ponsAuthority: Readonly<PonsV2Authority>;
  private readonly curveTemplateAuthority: Readonly<PonsV2CurveTemplateAuthority>;
  private readonly usdAuthority: Readonly<RobinhoodUsdCalibrationAuthority>;
  private readonly outcomeAuthority: Readonly<PonsV2ForwardOutcomeAuthority>;
  private readonly client: PublicClient;
  private readonly factoryGuard: ViemPonsV2LaunchAdapter;

  constructor(options: ViemPonsV2ForwardOutcomeAdapterOptions) {
    validatePonsV2Authority(options.ponsAuthority);
    validatePonsV2CurveTemplateAuthority(
      options.curveTemplateAuthority,
      options.ponsAuthority
    );
    validateRobinhoodUsdCalibrationAuthority(options.usdAuthority);
    validatePonsV2ForwardOutcomeAuthority(options.outcomeAuthority);
    if (
      options.outcomeAuthority.fromBlock < options.ponsAuthority.fromBlock ||
      options.outcomeAuthority.fromBlock <
        options.curveTemplateAuthority.fromBlock
    ) {
      throw new Error('PONS_V2_FORWARD_AUTHORITY_EPOCH_TOO_EARLY');
    }

    this.ponsAuthority = options.ponsAuthority;
    this.curveTemplateAuthority = options.curveTemplateAuthority;
    this.usdAuthority = options.usdAuthority;
    this.outcomeAuthority = options.outcomeAuthority;
    this.client =
      options.client ??
      createPublicClient({
        chain: robinhood,
        transport: http(options.rpcUrl ?? DEFAULT_ROBINHOOD_RPC_URL)
      });
    this.factoryGuard = new ViemPonsV2LaunchAdapter({
      authority: options.ponsAuthority,
      client: this.client
    });
  }

  async getHeadBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getBlockPoint(blockNumber: bigint): Promise<NormalizedBlockPoint> {
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) {
      throw new Error(`PONS_V2_FORWARD_BLOCK_HASH_MISSING:${blockNumber}`);
    }
    return {
      blockNumber,
      blockHash: normHex(block.hash),
      timestampMs: Number(block.timestamp) * 1000
    };
  }

  async assertMarketAuthority(
    market: NormalizedMarket,
    blockNumber: bigint
  ): Promise<void> {
    await this.readObservedState(market, blockNumber);
  }

  async readLiquidity(
    market: NormalizedMarket,
    blockNumber: bigint
  ): Promise<LiquidityObservation> {
    const state = await this.readObservedState(market, blockNumber);
    let liquidityState: LiquidityObservation['state'];
    if (state.phase === 'CURVE_ACTIVE') {
      liquidityState =
        state.curve.trackedQuote > 0n &&
        state.curve.quoteReserve > 0n &&
        state.curve.tokenReserve > 0n
          ? 'SURVIVED'
          : 'COLLAPSED';
    } else if (
      state.phase === 'CURVE_HALTED_READY' ||
      state.phase === 'SWEPT_PENDING_V4'
    ) {
      liquidityState = 'UNKNOWN';
    } else if (state.phase === 'V4_POOL_ACTIVE') {
      liquidityState = state.v4.liquidity > 0n ? 'SURVIVED' : 'COLLAPSED';
    } else {
      liquidityState = 'COLLAPSED';
    }

    return {
      state: liquidityState,
      sourceAuthority: {
        schema: 'ROBINHOOD_PONS_V2_FORWARD_LIQUIDITY_R1',
        payload: {
          policyVersion: PONS_V2_FORWARD_OUTCOME_ADAPTER_R1,
          outcomeAuthorityId: this.outcomeAuthority.authorityId,
          marketId: market.marketId,
          blockNumber: blockNumber.toString(),
          blockHash: state.blockHash,
          phase: state.phase,
          liquidityState,
          ...(state.phase === 'CURVE_ACTIVE'
            ? {
                trackedQuote: state.curve.trackedQuote.toString(),
                quoteReserve: state.curve.quoteReserve.toString(),
                tokenReserve: state.curve.tokenReserve.toString()
              }
            : {}),
          ...(state.phase === 'V4_POOL_ACTIVE'
            ? {
                poolId: state.v4.poolId,
                activeLiquidity: state.v4.liquidity.toString()
              }
            : {})
        }
      }
    };
  }

  async quoteExit(params: {
    market: NormalizedMarket;
    tokenAmount: bigint;
    blockNumber: bigint;
  }): Promise<PortableExitQuote> {
    if (params.tokenAmount <= 0n) {
      throw new Error('PONS_V2_FORWARD_EXIT_AMOUNT_INVALID');
    }
    const state = await this.readObservedState(
      params.market,
      params.blockNumber
    );

    if (state.phase === 'CURVE_ACTIVE') {
      const reverse = computePonsV2CurveReverse(
        params.tokenAmount,
        state.curve
      );
      return {
        executable: reverse.executable,
        amountOut: reverse.executable ? reverse.quoteOut : 0n,
        ...(reverse.failureReason
          ? { failureReason: reverse.failureReason }
          : {}),
        sourceAuthority: {
          schema: 'ROBINHOOD_PONS_V2_FORWARD_CURVE_EXIT_R1',
          payload: {
            policyVersion: PONS_V2_FORWARD_OUTCOME_ADAPTER_R1,
            marketId: params.market.marketId,
            blockNumber: params.blockNumber.toString(),
            blockHash: state.blockHash,
            curve: state.curve.curve,
            tokenAmount: params.tokenAmount.toString(),
            quoteReserve: state.curve.quoteReserve.toString(),
            tokenReserve: state.curve.tokenReserve.toString(),
            trackedQuote: state.curve.trackedQuote.toString(),
            feeBps: state.curve.feeBps.toString(),
            creatorTaxBps: state.curve.creatorTaxBps.toString(),
            grossQuoteOut: reverse.grossQuoteOut.toString(),
            quoteOut: reverse.quoteOut.toString(),
            executable: reverse.executable,
            failureReason: reverse.failureReason ?? null
          }
        }
      };
    }

    if (state.phase === 'V4_POOL_ACTIVE') {
      return this.quoteV4Exit(params.market, params.tokenAmount, params.blockNumber, state);
    }

    const failureReason =
      state.phase === 'RESCUED_TERMINAL'
        ? 'PONS_V2_FORWARD_RESCUED_TERMINAL'
        : 'PONS_V2_FORWARD_VENUE_TRANSITION_UNAVAILABLE';
    return {
      executable: false,
      amountOut: 0n,
      failureReason,
      sourceAuthority: {
        schema: 'ROBINHOOD_PONS_V2_FORWARD_EXIT_UNAVAILABLE_R1',
        payload: {
          policyVersion: PONS_V2_FORWARD_OUTCOME_ADAPTER_R1,
          marketId: params.market.marketId,
          blockNumber: params.blockNumber.toString(),
          blockHash: state.blockHash,
          phase: state.phase,
          failureReason
        }
      }
    };
  }

  async valueBaseAmountUsdMicros(params: {
    market: NormalizedMarket;
    baseAmount: bigint;
    blockNumber: bigint;
  }): Promise<PortableUsdValuation> {
    this.assertMarketIdentity(params.market);
    if (norm(params.market.baseAsset) !== norm(PONS_V2_NATIVE_PAIR_TOKEN)) {
      throw new Error('PONS_V2_FORWARD_USD_UNSUPPORTED_BASE');
    }
    if (params.baseAmount <= 0n || params.baseAmount > UINT128_MAX) {
      throw new Error('PONS_V2_FORWARD_USD_AMOUNT_INVALID');
    }

    const hashBefore = await this.getBlockHash(params.blockNumber);
    await this.assertUsdAuthority(params.blockNumber);

    const data = encodeFunctionData({
      abi: uniswapV4QuoterReadAbi,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey: {
          currency0: ROBINHOOD_ETH_USDG_V4_POOL_KEY.currency0 as Address,
          currency1: ROBINHOOD_ETH_USDG_V4_POOL_KEY.currency1 as Address,
          fee: ROBINHOOD_ETH_USDG_V4_POOL_KEY.fee,
          tickSpacing: ROBINHOOD_ETH_USDG_V4_POOL_KEY.tickSpacing,
          hooks: ROBINHOOD_ETH_USDG_V4_POOL_KEY.hooks as Address
        },
        zeroForOne: true,
        exactAmount: params.baseAmount,
        hookData: '0x'
      }]
    });

    let amountOut: bigint;
    let gasEstimate: bigint;
    try {
      const result = await this.client.call({
        to: this.usdAuthority.quoter as Address,
        data,
        blockNumber: params.blockNumber
      });
      if (!result.data) {
        throw new Error('PONS_V2_FORWARD_USD_QUOTER_EMPTY_RETURN');
      }
      [amountOut, gasEstimate] = decodeFunctionResult({
        abi: uniswapV4QuoterReadAbi,
        functionName: 'quoteExactInputSingle',
        data: result.data
      }) as readonly [bigint, bigint];
    } catch (error) {
      if (isEvmRevert(error)) {
        throw new Error(
          `PORTABLE_USD_VALUATION_UNAVAILABLE:PONS_V2:block=${params.blockNumber}`
        );
      }
      throw error;
    }

    if (amountOut <= 0n) {
      throw new Error(
        `PORTABLE_USD_VALUATION_UNAVAILABLE:PONS_V2:block=${params.blockNumber}`
      );
    }

    await this.assertUsdAuthority(params.blockNumber);
    const hashAfter = await this.getBlockHash(params.blockNumber);
    if (norm(hashAfter) !== norm(hashBefore)) {
      throw new Error(
        `PONS_V2_FORWARD_USD_REORG_DURING_READ:block=${params.blockNumber}`
      );
    }

    return {
      // USDG has six decimals, so raw USDG units are USD micros under the
      // already-frozen nominal-USDG convention.
      usdMicros: amountOut,
      sourceAuthority: {
        schema: 'ROBINHOOD_PONS_V2_FORWARD_ETH_USDG_VALUE_R1',
        payload: {
          policyVersion: PONS_V2_FORWARD_OUTCOME_ADAPTER_R1,
          usdAuthorityId: this.usdAuthority.authorityId,
          blockNumber: params.blockNumber.toString(),
          blockHash: hashAfter,
          baseAmount: params.baseAmount.toString(),
          usdgAmountOut: amountOut.toString(),
          usdConvention: 'USDG_NOMINAL_USD_PEG_V0',
          quoteMode: 'EXACT_INPUT',
          quoteGasEstimate: gasEstimate.toString(),
          poolId: norm(this.usdAuthority.poolId)
        }
      }
    };
  }

  private async readObservedState(
    market: NormalizedMarket,
    blockNumber: bigint
  ): Promise<ObservedState> {
    this.assertMarketIdentity(market);
    const baselineAuthority = readBaselineMarketAuthority(market);
    const expectedMarketId = await sha256Hex({
      kind: 'PONS_V2_CURVE_MARKET_V1',
      chainId: ROBINHOOD_CHAIN_ID,
      launchId: market.launchId,
      curve: norm(baselineAuthority.curve),
      pairToken: norm(baselineAuthority.pairToken)
    });
    if (market.marketId !== expectedMarketId) {
      throw new Error('PONS_V2_FORWARD_MARKET_ID_MISMATCH');
    }
    if (baselineAuthority.decisionBlock > blockNumber) {
      throw new Error('PONS_V2_FORWARD_OBSERVED_BEFORE_BASELINE');
    }
    assertPonsV2AuthorityBlock(this.ponsAuthority, blockNumber);
    assertPonsV2CurveTemplateBlock(this.curveTemplateAuthority, blockNumber);
    assertPonsV2ForwardOutcomeBlock(this.outcomeAuthority, blockNumber);

    const hashBefore = await this.getBlockHash(blockNumber);
    await this.assertOutcomeAuthority(blockNumber);

    const [recordRaw, graduated] = await Promise.all([
      this.client.readContract({
        address: this.ponsAuthority.factory as Address,
        abi: ponsV2FactoryReadAbi,
        functionName: 'getLaunchedToken',
        args: [market.launchedToken],
        blockNumber
      }),
      this.client.readContract({
        address: baselineAuthority.curve as Address,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'graduated',
        blockNumber
      })
    ]);

    const record = recordRaw as unknown as PonsV2LaunchRecord;
    this.assertRecord(market, baselineAuthority, record);

    let state: ObservedState;
    if (record.phase === 0) {
      if (graduated) {
        throw new Error('PONS_V2_FORWARD_PHASE_CONTRADICTION:CURVE_GRADUATED');
      }
      assertUnswept(record);
      const readyToGraduate = await this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'readyToGraduate',
        blockNumber
      });
      if (readyToGraduate) {
        state = {
          phase: 'CURVE_HALTED_READY',
          blockHash: hashBefore,
          record
        };
      } else {
        state = {
          phase: 'CURVE_ACTIVE',
          blockHash: hashBefore,
          record,
          curve: await this.readCurveState(record, market, blockNumber)
        };
      }
    } else {
      if (!graduated) {
        throw new Error('PONS_V2_FORWARD_PHASE_CONTRADICTION:POST_CURVE_NOT_GRADUATED');
      }
      if (record.phase === 1) {
        if (
          record.sweptQuote <= 0n ||
          record.sweptTokens <= 0n ||
          record.sweptAt <= 0n
        ) {
          throw new Error('PONS_V2_FORWARD_SWEPT_FIELDS_INVALID');
        }
        state = {
          phase: 'SWEPT_PENDING_V4',
          blockHash: hashBefore,
          record
        };
      } else if (record.phase === 2) {
        assertUnswept(record);
        state = {
          phase: 'V4_POOL_ACTIVE',
          blockHash: hashBefore,
          record,
          v4: await this.readV4PoolState(record, market, blockNumber)
        };
      } else if (record.phase === 3) {
        assertUnswept(record);
        state = {
          phase: 'RESCUED_TERMINAL',
          blockHash: hashBefore,
          record
        };
      } else {
        throw new Error(`PONS_V2_FORWARD_UNKNOWN_PHASE:${record.phase}`);
      }
    }

    await this.assertOutcomeAuthority(blockNumber);
    const hashAfter = await this.getBlockHash(blockNumber);
    if (norm(hashAfter) !== norm(hashBefore)) {
      throw new Error(
        `PONS_V2_FORWARD_REORG_DURING_STATE_READ:block=${blockNumber}`
      );
    }
    return { ...state, blockHash: hashAfter };
  }

  private async readCurveState(
    record: PonsV2LaunchRecord,
    market: NormalizedMarket,
    blockNumber: bigint
  ): Promise<PonsV2CurveQuoteState> {
    const [
      curveFactory,
      curveToken,
      pairToken,
      reservesRaw,
      trackedQuote,
      sellableTokens,
      feeBps,
      creatorTaxBps,
      curveCode
    ] = await Promise.all([
      this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'factory',
        blockNumber
      }),
      this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'token',
        blockNumber
      }),
      this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'pairToken',
        blockNumber
      }),
      this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'getReserves',
        blockNumber
      }),
      this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'trackedQuote',
        blockNumber
      }),
      this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'sellableTokens',
        blockNumber
      }),
      this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'feeBps',
        blockNumber
      }),
      this.client.readContract({
        address: record.curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'creatorTaxBps',
        blockNumber
      }),
      this.client.getBytecode({ address: record.curve, blockNumber })
    ]);

    if (!curveCode || curveCode === '0x') {
      throw new Error('PONS_V2_FORWARD_CURVE_CODE_MISSING');
    }
    requireAddressEqual('CURVE_FACTORY', curveFactory as Address, this.ponsAuthority.factory);
    requireAddressEqual('CURVE_TOKEN', curveToken as Address, market.launchedToken);
    requireAddressEqual('CURVE_PAIR_TOKEN', pairToken as Address, PONS_V2_NATIVE_PAIR_TOKEN);

    const reserves = reservesRaw as readonly [bigint, bigint];
    const curveState: PonsV2CurveQuoteState = {
      curve: normHex(record.curve),
      quoteReserve: reserves[0],
      tokenReserve: reserves[1],
      trackedQuote: trackedQuote as bigint,
      sellableTokens: sellableTokens as bigint,
      feeBps: feeBps as bigint,
      creatorTaxBps: creatorTaxBps as bigint,
      snipeTaxBps: 0n
    };
    if (
      curveState.quoteReserve <= 0n ||
      curveState.tokenReserve <= 0n ||
      curveState.feeBps < 0n ||
      curveState.creatorTaxBps < 0n ||
      curveState.feeBps + curveState.creatorTaxBps > 2_000n
    ) {
      throw new Error('PONS_V2_FORWARD_CURVE_STATE_INVALID');
    }
    if (Number(curveState.creatorTaxBps) !== record.creatorTaxBps) {
      throw new Error('PONS_V2_FORWARD_CREATOR_TAX_DRIFT');
    }
    return curveState;
  }

  private async readV4PoolState(
    record: PonsV2LaunchRecord,
    market: NormalizedMarket,
    blockNumber: bigint
  ): Promise<V4PoolState> {
    await this.assertUsdAuthority(blockNumber);
    const poolKey = {
      currency0: PONS_V2_NATIVE_PAIR_TOKEN,
      currency1: normHex(market.launchedToken),
      fee: record.poolFee,
      tickSpacing: record.tickSpacing,
      hooks: normHex(this.outcomeAuthority.memeHook)
    };
    const poolId = derivePoolId(poolKey);

    const [slot0Raw, liquidity, launchInfoRaw] = await Promise.all([
      this.client.readContract({
        address: this.usdAuthority.stateView as Address,
        abi: uniswapV4StateViewReadAbi,
        functionName: 'getSlot0',
        args: [poolId],
        blockNumber
      }),
      this.client.readContract({
        address: this.usdAuthority.stateView as Address,
        abi: uniswapV4StateViewReadAbi,
        functionName: 'getLiquidity',
        args: [poolId],
        blockNumber
      }),
      this.client.readContract({
        address: this.outcomeAuthority.memeHook as Address,
        abi: ponsV2MemeHookReadAbi,
        functionName: 'launches',
        args: [poolId],
        blockNumber
      })
    ]);

    const slot0 = slot0Raw as readonly [bigint, number, number, number];
    const launchInfo = launchInfoRaw as unknown as readonly [
      boolean,
      boolean,
      Address,
      Address,
      Address,
      Address,
      Address,
      number,
      number,
      number,
      number,
      number,
      boolean
    ];
    if (!launchInfo[0]) {
      throw new Error('PONS_V2_FORWARD_V4_POOL_NOT_REGISTERED');
    }
    if (launchInfo[1]) {
      throw new Error('PONS_V2_FORWARD_V4_NATIVE_ORDERING_MISMATCH');
    }
    requireAddressEqual('V4_MEMECOIN', launchInfo[2], market.launchedToken);
    requireAddressEqual('V4_QUOTE_TOKEN', launchInfo[3], PONS_V2_NATIVE_PAIR_TOKEN);
    if (slot0[0] <= 0n) {
      throw new Error('PONS_V2_FORWARD_V4_POOL_UNINITIALIZED');
    }
    if (Number(slot0[3]) !== record.poolFee) {
      throw new Error('PONS_V2_FORWARD_V4_FEE_DRIFT');
    }

    return {
      poolId,
      poolKey,
      sqrtPriceX96: slot0[0],
      tick: Number(slot0[1]),
      protocolFee: Number(slot0[2]),
      lpFee: Number(slot0[3]),
      liquidity: liquidity as bigint
    };
  }

  private async quoteV4Exit(
    market: NormalizedMarket,
    tokenAmount: bigint,
    blockNumber: bigint,
    state: Extract<ObservedState, { phase: 'V4_POOL_ACTIVE' }>
  ): Promise<PortableExitQuote> {
    if (tokenAmount > UINT128_MAX) {
      throw new Error('PONS_V2_FORWARD_V4_EXIT_AMOUNT_OVERFLOW');
    }
    const hashBefore = await this.getBlockHash(blockNumber);
    if (norm(hashBefore) !== norm(state.blockHash)) {
      throw new Error('PONS_V2_FORWARD_V4_EXIT_BLOCK_DRIFT');
    }
    await this.assertOutcomeAuthority(blockNumber);
    await this.assertUsdAuthority(blockNumber);

    const data = encodeFunctionData({
      abi: uniswapV4QuoterReadAbi,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey: {
          currency0: state.v4.poolKey.currency0 as Address,
          currency1: state.v4.poolKey.currency1 as Address,
          fee: state.v4.poolKey.fee,
          tickSpacing: state.v4.poolKey.tickSpacing,
          hooks: state.v4.poolKey.hooks as Address
        },
        zeroForOne: false,
        exactAmount: tokenAmount,
        hookData: '0x'
      }]
    });

    let amountOut = 0n;
    let gasEstimate: bigint | undefined;
    let failureReason: string | undefined;
    try {
      const result = await this.client.call({
        to: this.usdAuthority.quoter as Address,
        data,
        blockNumber
      });
      if (!result.data) throw new Error('PONS_V2_FORWARD_V4_QUOTER_EMPTY_RETURN');
      const decoded = decodeFunctionResult({
        abi: uniswapV4QuoterReadAbi,
        functionName: 'quoteExactInputSingle',
        data: result.data
      }) as readonly [bigint, bigint];
      [amountOut, gasEstimate] = decoded;
      if (amountOut <= 0n) {
        failureReason = 'PONS_V2_FORWARD_V4_ZERO_EXIT_OUTPUT';
      }
    } catch (error) {
      if (!isEvmRevert(error)) throw error;
      failureReason = 'PONS_V2_FORWARD_V4_EXIT_REVERTED';
    }

    await this.assertOutcomeAuthority(blockNumber);
    await this.assertUsdAuthority(blockNumber);
    const hashAfter = await this.getBlockHash(blockNumber);
    if (norm(hashAfter) !== norm(hashBefore)) {
      throw new Error(`PONS_V2_FORWARD_V4_EXIT_REORG:block=${blockNumber}`);
    }

    return {
      executable: !failureReason && amountOut > 0n,
      amountOut: !failureReason ? amountOut : 0n,
      ...(failureReason ? { failureReason } : {}),
      ...(gasEstimate !== undefined ? { gasEstimate } : {}),
      sourceAuthority: {
        schema: 'ROBINHOOD_PONS_V2_FORWARD_V4_EXIT_R1',
        payload: {
          policyVersion: PONS_V2_FORWARD_OUTCOME_ADAPTER_R1,
          marketId: market.marketId,
          blockNumber: blockNumber.toString(),
          blockHash: hashAfter,
          poolId: state.v4.poolId,
          poolKey: state.v4.poolKey,
          zeroForOne: false,
          exactAmount: tokenAmount.toString(),
          amountOut: amountOut.toString(),
          executable: !failureReason && amountOut > 0n,
          failureReason: failureReason ?? null,
          gasEstimate: gasEstimate?.toString() ?? null,
          activeLiquidity: state.v4.liquidity.toString()
        }
      }
    };
  }

  private async assertOutcomeAuthority(blockNumber: bigint): Promise<void> {
    assertPonsV2ForwardOutcomeBlock(this.outcomeAuthority, blockNumber);
    assertPonsV2CurveTemplateBlock(this.curveTemplateAuthority, blockNumber);
    await this.factoryGuard.assertAuthority(blockNumber);

    const [
      factoryMemeHook,
      factoryPoolManager,
      hookCode,
      hookFactory,
      hookPoolManager,
      configuredDeployer,
      deployerCode,
      deployerFactory
    ] = await Promise.all([
      this.client.readContract({
        address: this.ponsAuthority.factory as Address,
        abi: ponsV2FactoryReadAbi,
        functionName: 'memeHook',
        blockNumber
      }),
      this.client.readContract({
        address: this.ponsAuthority.factory as Address,
        abi: ponsV2FactoryReadAbi,
        functionName: 'poolManager',
        blockNumber
      }),
      this.client.getBytecode({
        address: this.outcomeAuthority.memeHook as Address,
        blockNumber
      }),
      this.client.readContract({
        address: this.outcomeAuthority.memeHook as Address,
        abi: ponsV2MemeHookReadAbi,
        functionName: 'factory',
        blockNumber
      }),
      this.client.readContract({
        address: this.outcomeAuthority.memeHook as Address,
        abi: ponsV2MemeHookReadAbi,
        functionName: 'poolManager',
        blockNumber
      }),
      this.client.readContract({
        address: this.ponsAuthority.factory as Address,
        abi: ponsV2FactoryReadAbi,
        functionName: 'launchDeployer',
        blockNumber
      }),
      this.client.getBytecode({
        address: this.curveTemplateAuthority.launchDeployer as Address,
        blockNumber
      }),
      this.client.readContract({
        address: this.curveTemplateAuthority.launchDeployer as Address,
        abi: ponsV2LaunchDeployerReadAbi,
        functionName: 'factory',
        blockNumber
      })
    ]);

    requireAddressEqual(
      'FACTORY_MEME_HOOK',
      factoryMemeHook as Address,
      this.outcomeAuthority.memeHook
    );
    requireAddressEqual(
      'FACTORY_POOL_MANAGER',
      factoryPoolManager as Address,
      this.usdAuthority.poolManager
    );
    requireAddressEqual(
      'HOOK_FACTORY',
      hookFactory as Address,
      this.ponsAuthority.factory
    );
    requireAddressEqual(
      'HOOK_POOL_MANAGER',
      hookPoolManager as Address,
      this.usdAuthority.poolManager
    );
    requireAddressEqual(
      'FACTORY_LAUNCH_DEPLOYER',
      configuredDeployer as Address,
      this.curveTemplateAuthority.launchDeployer
    );
    requireAddressEqual(
      'LAUNCH_DEPLOYER_FACTORY',
      deployerFactory as Address,
      this.ponsAuthority.factory
    );

    assertCodeHash(
      'MEME_HOOK',
      hookCode,
      this.outcomeAuthority.memeHookRuntimeCodeHash,
      blockNumber
    );
    assertCodeHash(
      'LAUNCH_DEPLOYER',
      deployerCode,
      this.curveTemplateAuthority.launchDeployerRuntimeCodeHash,
      blockNumber
    );
  }

  private async assertUsdAuthority(blockNumber: bigint): Promise<void> {
    assertRobinhoodUsdCalibrationBlock(this.usdAuthority, blockNumber);
    const chainId = await this.client.getChainId();
    if (chainId !== ROBINHOOD_CHAIN_ID) {
      throw new Error(`PONS_V2_FORWARD_CHAIN_DRIFT:${chainId}`);
    }

    const [
      poolManagerCode,
      stateViewCode,
      quoterCode,
      usdgProxyCode,
      usdgImplementationCode,
      implementationStorage,
      name,
      symbol,
      decimals,
      quoterPoolManager,
      usdSlot0Raw,
      usdLiquidity
    ] = await Promise.all([
      this.client.getBytecode({
        address: this.usdAuthority.poolManager as Address,
        blockNumber
      }),
      this.client.getBytecode({
        address: this.usdAuthority.stateView as Address,
        blockNumber
      }),
      this.client.getBytecode({
        address: this.usdAuthority.quoter as Address,
        blockNumber
      }),
      this.client.getBytecode({
        address: this.usdAuthority.usdg as Address,
        blockNumber
      }),
      this.client.getBytecode({
        address: this.usdAuthority.usdgImplementation as Address,
        blockNumber
      }),
      this.client.getStorageAt({
        address: this.usdAuthority.usdg as Address,
        slot: ROBINHOOD_USDG_EIP1967_IMPLEMENTATION_SLOT,
        blockNumber
      }),
      this.client.readContract({
        address: this.usdAuthority.usdg as Address,
        abi: erc20UsdIdentityReadAbi,
        functionName: 'name',
        blockNumber
      }),
      this.client.readContract({
        address: this.usdAuthority.usdg as Address,
        abi: erc20UsdIdentityReadAbi,
        functionName: 'symbol',
        blockNumber
      }),
      this.client.readContract({
        address: this.usdAuthority.usdg as Address,
        abi: erc20UsdIdentityReadAbi,
        functionName: 'decimals',
        blockNumber
      }),
      this.client.readContract({
        address: this.usdAuthority.quoter as Address,
        abi: uniswapV4QuoterReadAbi,
        functionName: 'poolManager',
        blockNumber
      }),
      this.client.readContract({
        address: this.usdAuthority.stateView as Address,
        abi: uniswapV4StateViewReadAbi,
        functionName: 'getSlot0',
        args: [this.usdAuthority.poolId],
        blockNumber
      }),
      this.client.readContract({
        address: this.usdAuthority.stateView as Address,
        abi: uniswapV4StateViewReadAbi,
        functionName: 'getLiquidity',
        args: [this.usdAuthority.poolId],
        blockNumber
      })
    ]);

    assertCodeHash(
      'POOL_MANAGER',
      poolManagerCode,
      this.usdAuthority.poolManagerRuntimeCodeHash,
      blockNumber
    );
    assertCodeHash(
      'STATE_VIEW',
      stateViewCode,
      this.usdAuthority.stateViewRuntimeCodeHash,
      blockNumber
    );
    assertCodeHash(
      'QUOTER',
      quoterCode,
      this.usdAuthority.quoterRuntimeCodeHash,
      blockNumber
    );
    assertCodeHash(
      'USDG_PROXY',
      usdgProxyCode,
      this.usdAuthority.usdgProxyRuntimeCodeHash,
      blockNumber
    );
    assertCodeHash(
      'USDG_IMPLEMENTATION',
      usdgImplementationCode,
      this.usdAuthority.usdgImplementationRuntimeCodeHash,
      blockNumber
    );

    if (
      !implementationStorage ||
      implementationStorage === '0x' ||
      /^0x0+$/.test(implementationStorage)
    ) {
      throw new Error('PONS_V2_FORWARD_USDG_IMPLEMENTATION_MISSING');
    }
    const implementation = `0x${implementationStorage.slice(-40)}`;
    requireAddressEqual(
      'USDG_IMPLEMENTATION',
      implementation as Address,
      this.usdAuthority.usdgImplementation
    );
    if (name !== 'Global Dollar' || symbol !== 'USDG' || Number(decimals) !== 6) {
      throw new Error('PONS_V2_FORWARD_USDG_IDENTITY_DRIFT');
    }
    requireAddressEqual(
      'QUOTER_POOL_MANAGER',
      quoterPoolManager as Address,
      this.usdAuthority.poolManager
    );

    const usdSlot0 = usdSlot0Raw as readonly [bigint, number, number, number];
    if (usdSlot0[0] <= 0n || (usdLiquidity as bigint) <= 0n) {
      throw new Error('PONS_V2_FORWARD_USD_POOL_UNAVAILABLE');
    }
    if (Number(usdSlot0[3]) !== ROBINHOOD_ETH_USDG_V4_POOL_KEY.fee) {
      throw new Error('PONS_V2_FORWARD_USD_POOL_FEE_DRIFT');
    }
  }

  private assertMarketIdentity(market: NormalizedMarket): void {
    if (
      market.chainId !== ROBINHOOD_CHAIN_ID ||
      market.ecosystem !== 'ROBINHOOD' ||
      market.launchProtocol !== 'PONS' ||
      market.venue !== 'PONS_V2_BONDING_CURVE' ||
      norm(market.baseAsset) !== norm(PONS_V2_NATIVE_PAIR_TOKEN)
    ) {
      throw new Error('PONS_V2_FORWARD_MARKET_IDENTITY_MISMATCH');
    }
  }

  private assertRecord(
    market: NormalizedMarket,
    baseline: BaselineMarketAuthority,
    record: PonsV2LaunchRecord
  ): void {
    if (!record.exists) throw new Error('PONS_V2_FORWARD_LAUNCH_RECORD_MISSING');
    if (
      baseline.authorityId !== this.ponsAuthority.authorityId ||
      norm(baseline.factoryRuntimeCodeHash) !==
        norm(this.ponsAuthority.factoryRuntimeCodeHash) ||
      norm(baseline.factory) !== norm(this.ponsAuthority.factory) ||
      norm(baseline.token) !== norm(market.launchedToken) ||
      norm(baseline.pairToken) !== norm(PONS_V2_NATIVE_PAIR_TOKEN) ||
      baseline.state !== 'CURVE_ACTIVE'
    ) {
      throw new Error('PONS_V2_FORWARD_BASELINE_AUTHORITY_MISMATCH');
    }
    requireAddressEqual('RECORD_TOKEN', record.token, market.launchedToken);
    requireAddressEqual('RECORD_CURVE', record.curve, baseline.curve);
    requireAddressEqual('RECORD_PAIR_TOKEN', record.pairToken, baseline.pairToken);
    if (
      record.poolFee !== baseline.poolFee ||
      record.tickSpacing !== baseline.tickSpacing ||
      record.creatorTaxBps !== baseline.creatorTaxBps
    ) {
      throw new Error('PONS_V2_FORWARD_LAUNCH_TERMS_DRIFT');
    }
  }

  private async getBlockHash(blockNumber: bigint): Promise<Hex> {
    const point = await this.getBlockPoint(blockNumber);
    return point.blockHash;
  }
}

function derivePoolId(poolKey: {
  currency0: Hex;
  currency1: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
}): Hex {
  return keccak256(encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'address' },
      { type: 'uint24' },
      { type: 'int24' },
      { type: 'address' }
    ],
    [
      poolKey.currency0,
      poolKey.currency1,
      poolKey.fee,
      poolKey.tickSpacing,
      poolKey.hooks
    ]
  ));
}

function readBaselineMarketAuthority(
  market: NormalizedMarket
): BaselineMarketAuthority {
  if (market.sourceAuthority.schema !== 'ROBINHOOD_PONS_V2_MARKET_STATE_R1') {
    throw new Error('PONS_V2_FORWARD_MARKET_SCHEMA_MISMATCH');
  }
  const payload = market.sourceAuthority.payload;
  if (!isRecord(payload)) {
    throw new Error('PONS_V2_FORWARD_MARKET_AUTHORITY_MALFORMED');
  }
  return {
    authorityId: requireString(payload, 'authorityId'),
    factoryRuntimeCodeHash: requireHash(payload, 'factoryRuntimeCodeHash'),
    factory: requireAddress(payload, 'factory'),
    token: requireAddress(payload, 'token'),
    curve: requireAddress(payload, 'curve'),
    pairToken: requireAddress(payload, 'pairToken'),
    poolFee: requireNumber(payload, 'poolFee'),
    tickSpacing: requireNumber(payload, 'tickSpacing'),
    creatorTaxBps: requireNumber(payload, 'creatorTaxBps'),
    decisionBlock: requireBigIntString(payload, 'decisionBlock'),
    decisionBlockHash: requireHash(payload, 'decisionBlockHash'),
    state: requireString(payload, 'state')
  };
}

function assertUnswept(record: PonsV2LaunchRecord): void {
  if (
    record.sweptQuote !== 0n ||
    record.sweptTokens !== 0n ||
    record.sweptAt !== 0n
  ) {
    throw new Error('PONS_V2_FORWARD_UNSWEPT_FIELDS_NONZERO');
  }
}

function assertCodeHash(
  label: string,
  code: Hex | undefined,
  expected: Hex,
  blockNumber: bigint
): void {
  if (!code || code === '0x') {
    throw new Error(
      `PONS_V2_FORWARD_${label}_CODE_MISSING:block=${blockNumber}`
    );
  }
  const actual = keccak256(code);
  if (norm(actual) !== norm(expected)) {
    throw new Error(
      `PONS_V2_FORWARD_${label}_CODE_HASH_DRIFT:expected=${expected}:actual=${actual}:block=${blockNumber}`
    );
  }
}

function requireAddressEqual(
  label: string,
  actual: Address,
  expected: string
): void {
  if (norm(actual) !== norm(expected)) {
    throw new Error(`PONS_V2_FORWARD_${label}_MISMATCH`);
  }
}

function isEvmRevert(error: unknown): boolean {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 8 && current && typeof current === 'object';
    depth += 1
  ) {
    const record = current as {
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const name = typeof record.name === 'string' ? record.name : '';
    const message =
      typeof record.message === 'string' ? record.message.toLowerCase() : '';
    if (
      name === 'ExecutionRevertedError' ||
      name === 'ContractFunctionRevertedError' ||
      message.includes('execution reverted') ||
      message.includes('reverted')
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function isRecord(
  value: CanonicalJsonValue
): value is Readonly<Record<string, CanonicalJsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`PONS_V2_FORWARD_FIELD_INVALID:${key}`);
  }
  return value;
}

function requireNumber(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`PONS_V2_FORWARD_FIELD_INVALID:${key}`);
  }
  return value;
}

function requireBigIntString(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): bigint {
  const value = requireString(payload, key);
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`PONS_V2_FORWARD_FIELD_INVALID:${key}`);
  }
  return BigInt(value);
}

function requireAddress(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): Hex {
  const value = requireString(payload, key);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`PONS_V2_FORWARD_FIELD_INVALID:${key}`);
  }
  return normHex(value);
}

function requireHash(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): Hex {
  const value = requireString(payload, key);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`PONS_V2_FORWARD_FIELD_INVALID:${key}`);
  }
  return normHex(value);
}

function norm(value: string): string {
  return value.toLowerCase();
}

function normHex(value: string): Hex {
  return value.toLowerCase() as Hex;
}
