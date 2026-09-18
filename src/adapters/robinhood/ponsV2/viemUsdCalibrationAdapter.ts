import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  type Address,
  type PublicClient
} from 'viem';
import type { Hex } from '../../../domain.js';
import type {
  NormalizedLaunchCandidate,
  NormalizedMarket,
  UsdCalibrationObservation
} from '../../../multichain/domain.js';
import type { UsdCalibrationAdapter } from '../../../multichain/ports.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  erc20UsdIdentityReadAbi,
  uniswapV4QuoterReadAbi,
  uniswapV4StateViewReadAbi
} from './contracts.js';
import {
  ROBINHOOD_USDG_EIP1967_IMPLEMENTATION_SLOT,
  ROBINHOOD_ETH_USDG_V4_POOL_KEY,
  assertRobinhoodUsdCalibrationBlock,
  validateRobinhoodUsdCalibrationAuthority,
  type RobinhoodUsdCalibrationAuthority
} from './v4UsdCalibrationAuthority.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL } }
});

const UINT128_MAX = (1n << 128n) - 1n;

export const ROBINHOOD_USDG_EXACT_OUTPUT_CALIBRATION_R0 =
  'ROBINHOOD_USDG_EXACT_OUTPUT_CALIBRATION_R0' as const;

export interface ViemRobinhoodUsdCalibrationAdapterOptions {
  authority: Readonly<RobinhoodUsdCalibrationAuthority>;
  rpcUrl?: string;
  client?: PublicClient;
}

export class ViemRobinhoodUsdCalibrationAdapter implements UsdCalibrationAdapter {
  readonly chainId = ROBINHOOD_CHAIN_ID;
  readonly ecosystem = 'ROBINHOOD' as const;
  readonly launchProtocol = 'PONS' as const;
  readonly mode = 'SHADOW_ONLY' as const;

  private readonly authority: Readonly<RobinhoodUsdCalibrationAuthority>;
  private readonly client: PublicClient;

  constructor(options: ViemRobinhoodUsdCalibrationAdapterOptions) {
    validateRobinhoodUsdCalibrationAuthority(options.authority);
    this.authority = options.authority;
    this.client = options.client ?? createPublicClient({
      chain: robinhood,
      transport: http(options.rpcUrl ?? DEFAULT_ROBINHOOD_RPC_URL)
    });
  }

  async calibrateUsd(params: {
    launch: NormalizedLaunchCandidate;
    market: NormalizedMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
  }): Promise<UsdCalibrationObservation> {
    this.assertIdentity(params.launch, params.market);
    if (params.notionalUsdMicros <= 0n || params.notionalUsdMicros > UINT128_MAX) {
      throw new Error('ROBINHOOD_USD_CALIBRATION_NOTIONAL_INVALID');
    }
    assertRobinhoodUsdCalibrationBlock(this.authority, params.decisionBlock);

    const hashBefore = await this.getBlockHash(params.decisionBlock);
    if (norm(hashBefore) !== norm(params.decisionBlockHash)) {
      throw new Error(`ROBINHOOD_USD_CALIBRATION_DECISION_HASH_MISMATCH:block=${params.decisionBlock}`);
    }

    const authorityState = await this.assertAuthority(params.decisionBlock);
    const targetUsdg = params.notionalUsdMicros;

    const data = encodeFunctionData({
      abi: uniswapV4QuoterReadAbi,
      functionName: 'quoteExactOutputSingle',
      args: [{
        poolKey: {
          currency0: ROBINHOOD_ETH_USDG_V4_POOL_KEY.currency0 as Address,
          currency1: ROBINHOOD_ETH_USDG_V4_POOL_KEY.currency1 as Address,
          fee: ROBINHOOD_ETH_USDG_V4_POOL_KEY.fee,
          tickSpacing: ROBINHOOD_ETH_USDG_V4_POOL_KEY.tickSpacing,
          hooks: ROBINHOOD_ETH_USDG_V4_POOL_KEY.hooks as Address
        },
        zeroForOne: true,
        exactAmount: targetUsdg,
        hookData: '0x'
      }]
    });

    let amountIn: bigint;
    let gasEstimate: bigint;
    try {
      const result = await this.client.call({
        to: this.authority.quoter as Address,
        data,
        blockNumber: params.decisionBlock
      });
      if (!result.data) throw new Error('ROBINHOOD_USD_CALIBRATION_QUOTER_EMPTY_RETURN');
      const decoded = decodeFunctionResult({
        abi: uniswapV4QuoterReadAbi,
        functionName: 'quoteExactOutputSingle',
        data: result.data
      }) as readonly [bigint, bigint];
      [amountIn, gasEstimate] = decoded;
    } catch (error) {
      if (isEvmRevert(error)) {
        throw new Error(
          `ROBINHOOD_USD_CALIBRATION_UNAVAILABLE:block=${params.decisionBlock}:notional=${params.notionalUsdMicros}`
        );
      }
      throw error;
    }
    if (amountIn <= 0n) throw new Error('ROBINHOOD_USD_CALIBRATION_ZERO_ETH_INPUT');

    const authorityStateAfter = await this.assertAuthority(params.decisionBlock);
    if (
      authorityState.sqrtPriceX96 !== authorityStateAfter.sqrtPriceX96 ||
      authorityState.liquidity !== authorityStateAfter.liquidity ||
      authorityState.lpFee !== authorityStateAfter.lpFee
    ) {
      throw new Error('ROBINHOOD_USD_CALIBRATION_STATE_CHANGED_DURING_READ');
    }

    const hashAfter = await this.getBlockHash(params.decisionBlock);
    if (norm(hashAfter) !== norm(params.decisionBlockHash)) {
      throw new Error(`ROBINHOOD_USD_CALIBRATION_REORG_DURING_READ:block=${params.decisionBlock}`);
    }

    return {
      notionalUsdMicros: params.notionalUsdMicros,
      baseAsset: PONS_V2_NATIVE_PAIR_TOKEN,
      baseAmount: amountIn,
      baseDecimals: 18,
      sourceAuthority: {
        schema: 'ROBINHOOD_USDG_EXACT_OUTPUT_CALIBRATION_R0',
        payload: {
          policyVersion: ROBINHOOD_USDG_EXACT_OUTPUT_CALIBRATION_R0,
          authorityId: this.authority.authorityId,
          decisionBlock: params.decisionBlock.toString(),
          decisionBlockHash: norm(params.decisionBlockHash),
          poolId: norm(this.authority.poolId),
          poolManager: norm(this.authority.poolManager),
          poolManagerRuntimeCodeHash: norm(this.authority.poolManagerRuntimeCodeHash),
          stateView: norm(this.authority.stateView),
          stateViewRuntimeCodeHash: norm(this.authority.stateViewRuntimeCodeHash),
          quoter: norm(this.authority.quoter),
          quoterRuntimeCodeHash: norm(this.authority.quoterRuntimeCodeHash),
          usdg: norm(this.authority.usdg),
          usdgProxyRuntimeCodeHash: norm(this.authority.usdgProxyRuntimeCodeHash),
          usdgImplementation: norm(this.authority.usdgImplementation),
          usdgImplementationRuntimeCodeHash: norm(this.authority.usdgImplementationRuntimeCodeHash),
          usdgDecimals: 6,
          usdConvention: 'USDG_NOMINAL_USD_PEG_V0',
          targetUsdg: targetUsdg.toString(),
          nativeEthAmountIn: amountIn.toString(),
          quoteGasEstimate: gasEstimate.toString(),
          sqrtPriceX96: authorityState.sqrtPriceX96.toString(),
          tick: authorityState.tick,
          protocolFee: authorityState.protocolFee,
          lpFee: authorityState.lpFee,
          activeLiquidity: authorityState.liquidity.toString(),
          poolKey: {
            currency0: norm(ROBINHOOD_ETH_USDG_V4_POOL_KEY.currency0),
            currency1: norm(ROBINHOOD_ETH_USDG_V4_POOL_KEY.currency1),
            fee: ROBINHOOD_ETH_USDG_V4_POOL_KEY.fee,
            tickSpacing: ROBINHOOD_ETH_USDG_V4_POOL_KEY.tickSpacing,
            hooks: norm(ROBINHOOD_ETH_USDG_V4_POOL_KEY.hooks)
          },
          quoteMode: 'EXACT_OUTPUT'
        }
      }
    };
  }

  private assertIdentity(launch: NormalizedLaunchCandidate, market: NormalizedMarket): void {
    if (
      launch.chainId !== ROBINHOOD_CHAIN_ID ||
      launch.ecosystem !== 'ROBINHOOD' ||
      launch.launchProtocol !== 'PONS' ||
      market.chainId !== ROBINHOOD_CHAIN_ID ||
      market.ecosystem !== 'ROBINHOOD' ||
      market.launchProtocol !== 'PONS'
    ) {
      throw new Error('ROBINHOOD_USD_CALIBRATION_IDENTITY_MISMATCH');
    }
    if (launch.launchId !== market.launchId) {
      throw new Error('ROBINHOOD_USD_CALIBRATION_LAUNCH_MARKET_MISMATCH');
    }
    if (norm(market.baseAsset) !== norm(PONS_V2_NATIVE_PAIR_TOKEN)) {
      throw new Error(`ROBINHOOD_USD_CALIBRATION_UNSUPPORTED_BASE:${market.baseAsset}`);
    }
  }

  private async assertAuthority(blockNumber: bigint): Promise<{
    sqrtPriceX96: bigint;
    tick: number;
    protocolFee: number;
    lpFee: number;
    liquidity: bigint;
  }> {
    assertRobinhoodUsdCalibrationBlock(this.authority, blockNumber);
    const chainId = await this.client.getChainId();
    if (chainId !== ROBINHOOD_CHAIN_ID) {
      throw new Error(`ROBINHOOD_USD_CALIBRATION_CHAIN_DRIFT:actual=${chainId}`);
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
      slot0Raw,
      liquidity
    ] = await Promise.all([
      this.client.getBytecode({ address: this.authority.poolManager as Address, blockNumber }),
      this.client.getBytecode({ address: this.authority.stateView as Address, blockNumber }),
      this.client.getBytecode({ address: this.authority.quoter as Address, blockNumber }),
      this.client.getBytecode({ address: this.authority.usdg as Address, blockNumber }),
      this.client.getBytecode({ address: this.authority.usdgImplementation as Address, blockNumber }),
      this.client.getStorageAt({
        address: this.authority.usdg as Address,
        slot: ROBINHOOD_USDG_EIP1967_IMPLEMENTATION_SLOT,
        blockNumber
      }),
      this.client.readContract({
        address: this.authority.usdg as Address,
        abi: erc20UsdIdentityReadAbi,
        functionName: 'name',
        blockNumber
      }),
      this.client.readContract({
        address: this.authority.usdg as Address,
        abi: erc20UsdIdentityReadAbi,
        functionName: 'symbol',
        blockNumber
      }),
      this.client.readContract({
        address: this.authority.usdg as Address,
        abi: erc20UsdIdentityReadAbi,
        functionName: 'decimals',
        blockNumber
      }),
      this.client.readContract({
        address: this.authority.quoter as Address,
        abi: uniswapV4QuoterReadAbi,
        functionName: 'poolManager',
        blockNumber
      }),
      this.client.readContract({
        address: this.authority.stateView as Address,
        abi: uniswapV4StateViewReadAbi,
        functionName: 'getSlot0',
        args: [this.authority.poolId],
        blockNumber
      }),
      this.client.readContract({
        address: this.authority.stateView as Address,
        abi: uniswapV4StateViewReadAbi,
        functionName: 'getLiquidity',
        args: [this.authority.poolId],
        blockNumber
      })
    ]);

    assertCodeHash('POOL_MANAGER', poolManagerCode, this.authority.poolManagerRuntimeCodeHash, blockNumber);
    assertCodeHash('STATE_VIEW', stateViewCode, this.authority.stateViewRuntimeCodeHash, blockNumber);
    assertCodeHash('QUOTER', quoterCode, this.authority.quoterRuntimeCodeHash, blockNumber);
    assertCodeHash('USDG_PROXY', usdgProxyCode, this.authority.usdgProxyRuntimeCodeHash, blockNumber);
    assertCodeHash(
      'USDG_IMPLEMENTATION',
      usdgImplementationCode,
      this.authority.usdgImplementationRuntimeCodeHash,
      blockNumber
    );

    if (!implementationStorage || implementationStorage === '0x' || /^0x0+$/.test(implementationStorage)) {
      throw new Error('ROBINHOOD_USD_CALIBRATION_USDG_IMPLEMENTATION_MISSING');
    }
    const implementation = `0x${implementationStorage.slice(-40)}`;
    if (norm(implementation) !== norm(this.authority.usdgImplementation)) {
      throw new Error(
        `ROBINHOOD_USD_CALIBRATION_USDG_IMPLEMENTATION_DRIFT:expected=${this.authority.usdgImplementation}:actual=${implementation}`
      );
    }
    if (name !== 'Global Dollar' || symbol !== 'USDG' || Number(decimals) !== 6) {
      throw new Error('ROBINHOOD_USD_CALIBRATION_USDG_IDENTITY_DRIFT');
    }
    if (norm(quoterPoolManager as Address) !== norm(this.authority.poolManager)) {
      throw new Error('ROBINHOOD_USD_CALIBRATION_QUOTER_POOL_MANAGER_DRIFT');
    }

    const slot0 = slot0Raw as readonly [bigint, number, number, number];
    if (slot0[0] <= 0n || (liquidity as bigint) <= 0n) {
      throw new Error('ROBINHOOD_USD_CALIBRATION_POOL_UNAVAILABLE');
    }
    if (slot0[3] !== ROBINHOOD_ETH_USDG_V4_POOL_KEY.fee) {
      throw new Error(
        `ROBINHOOD_USD_CALIBRATION_POOL_FEE_DRIFT:expected=${ROBINHOOD_ETH_USDG_V4_POOL_KEY.fee}:actual=${slot0[3]}`
      );
    }

    return {
      sqrtPriceX96: slot0[0],
      tick: Number(slot0[1]),
      protocolFee: Number(slot0[2]),
      lpFee: Number(slot0[3]),
      liquidity: liquidity as bigint
    };
  }

  private async getBlockHash(blockNumber: bigint): Promise<Hex> {
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`ROBINHOOD_USD_CALIBRATION_BLOCK_HASH_MISSING:${blockNumber}`);
    return block.hash;
  }
}

function assertCodeHash(
  label: string,
  code: Hex | undefined,
  expected: Hex,
  blockNumber: bigint
): void {
  if (!code || code === '0x') {
    throw new Error(`ROBINHOOD_USD_CALIBRATION_${label}_CODE_MISSING:block=${blockNumber}`);
  }
  const actual = keccak256(code);
  if (norm(actual) !== norm(expected)) {
    throw new Error(
      `ROBINHOOD_USD_CALIBRATION_${label}_CODE_HASH_DRIFT:expected=${expected}:actual=${actual}:block=${blockNumber}`
    );
  }
}

function isEvmRevert(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth += 1) {
    const record = current as { name?: unknown; message?: unknown; cause?: unknown };
    const name = typeof record.name === 'string' ? record.name : '';
    const message = typeof record.message === 'string' ? record.message.toLowerCase() : '';
    if (
      name === 'ExecutionRevertedError' ||
      name === 'ContractFunctionRevertedError' ||
      message.includes('execution reverted') ||
      message.includes('reverted')
    ) return true;
    current = record.cause;
  }
  return false;
}

function norm(value: string): string {
  return value.toLowerCase();
}
