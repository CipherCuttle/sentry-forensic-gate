import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  http,
  type Address,
  type PublicClient
} from 'viem';
import type { Hex, LaunchObserved } from '../domain.js';
import { deriveBaselineQuoteId, scaleUsdMicrosToTokenUnits, type BaselineQuoteReceipt, type LaunchMarket, type UsdCalibration } from '../shadow/baselineTypes.js';
import {
  DEFAULT_INK_RPC_URL,
  DEFAULT_SENTRY_LAUNCH_FACTORY,
  EIP1967_IMPLEMENTATION_SLOT,
  EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION,
  INK_CHAIN_ID
} from '../sentry/contracts.js';
import { classifyLaunchMarket } from './market.js';
import type { ExecutableBaselineSource, RawQuoteResult } from './ports.js';
import {
  erc20DecimalsAbi,
  positionManagerReadAbi,
  sentryBaselineReadAbi,
  TSUNAMI_FEE_TIERS,
  TSUNAMI_POSITION_MANAGER,
  TSUNAMI_QUOTER_V2,
  TSUNAMI_V3_FACTORY,
  tsunamiFactoryReadAbi,
  tsunamiPoolReadAbi,
  tsunamiQuoterV2Abi,
  USDT0,
  WETH9,
  ZERO_ADDRESS
} from './contracts.js';

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_INK_RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } }
});

export interface ViemBaselineSourceOptions {
  rpcUrl?: string;
  client?: PublicClient;
  now?: () => number;
}

export class ViemExecutableBaselineSource implements ExecutableBaselineSource {
  private readonly client: PublicClient;
  private readonly now: () => number;

  constructor(options: ViemBaselineSourceOptions = {}) {
    this.client = options.client ?? createPublicClient({
      chain: ink,
      transport: http(options.rpcUrl ?? DEFAULT_INK_RPC_URL)
    });
    this.now = options.now ?? Date.now;
  }

  async getHeadBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getBlockHash(blockNumber: bigint): Promise<Hex> {
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`MISSING_BLOCK_HASH:${blockNumber}`);
    return block.hash;
  }

  async assertAuthority(blockNumber: bigint): Promise<void> {
    const chainId = await this.client.getChainId();
    if (chainId !== INK_CHAIN_ID) throw new Error(`INK_CHAIN_ID_DRIFT:expected=${INK_CHAIN_ID}:actual=${chainId}`);

    const sentryStorage = await this.client.getStorageAt({
      address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
      slot: EIP1967_IMPLEMENTATION_SLOT,
      blockNumber
    });
    if (!sentryStorage || sentryStorage === '0x' || /^0x0+$/.test(sentryStorage)) {
      throw new Error(`SENTRY_PROXY_IMPLEMENTATION_MISSING:block=${blockNumber}`);
    }
    const sentryImplementation = `0x${sentryStorage.slice(-40)}` as Hex;
    if (norm(sentryImplementation) !== norm(EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION)) {
      throw new Error(
        `SENTRY_PROXY_IMPLEMENTATION_DRIFT:expected=${EXPECTED_SENTRY_LAUNCH_IMPLEMENTATION}:actual=${sentryImplementation}:block=${blockNumber}`
      );
    }

    const [sentryNpm, npmFactory, quoterFactory, npmWeth, quoterWeth] = await Promise.all([
      this.client.readContract({
        address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
        abi: sentryBaselineReadAbi,
        functionName: 'npm',
        blockNumber
      }),
      this.client.readContract({ address: TSUNAMI_POSITION_MANAGER as Address, abi: positionManagerReadAbi, functionName: 'factory', blockNumber }),
      this.client.readContract({ address: TSUNAMI_QUOTER_V2 as Address, abi: tsunamiQuoterV2Abi, functionName: 'factory', blockNumber }),
      this.client.readContract({ address: TSUNAMI_POSITION_MANAGER as Address, abi: positionManagerReadAbi, functionName: 'WETH9', blockNumber }),
      this.client.readContract({ address: TSUNAMI_QUOTER_V2 as Address, abi: tsunamiQuoterV2Abi, functionName: 'WETH9', blockNumber })
    ]);

    requireAddress('SENTRY_NPM_DRIFT', sentryNpm as Address, TSUNAMI_POSITION_MANAGER);
    requireAddress('NPM_FACTORY_DRIFT', npmFactory as Address, TSUNAMI_V3_FACTORY);
    requireAddress('QUOTER_FACTORY_DRIFT', quoterFactory as Address, TSUNAMI_V3_FACTORY);
    requireAddress('NPM_WETH_DRIFT', npmWeth as Address, WETH9);
    requireAddress('QUOTER_WETH_DRIFT', quoterWeth as Address, WETH9);

    const codeAddresses = [
      DEFAULT_SENTRY_LAUNCH_FACTORY,
      sentryImplementation,
      TSUNAMI_V3_FACTORY,
      TSUNAMI_POSITION_MANAGER,
      TSUNAMI_QUOTER_V2
    ];
    const codes = await Promise.all(codeAddresses.map((address) =>
      this.client.getBytecode({ address: address as Address, blockNumber })
    ));
    codes.forEach((code, index) => {
      if (!code || code === '0x') throw new Error(`AUTHORITY_CODE_MISSING:${codeAddresses[index]}:block=${blockNumber}`);
    });
  }

  async resolveMarket(launch: LaunchObserved, decisionBlock: bigint): Promise<LaunchMarket> {
    const positionRaw = await this.client.readContract({
      address: TSUNAMI_POSITION_MANAGER as Address,
      abi: positionManagerReadAbi,
      functionName: 'positions',
      args: [launch.tokenId],
      blockNumber: launch.blockNumber
    }) as readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint];

    const position = {
      token0: positionRaw[2] as Hex,
      token1: positionRaw[3] as Hex,
      fee: Number(positionRaw[4]),
      liquidity: positionRaw[7]
    };

    const supportedBaseTokens = await this.client.readContract({
      address: DEFAULT_SENTRY_LAUNCH_FACTORY as Address,
      abi: sentryBaselineReadAbi,
      functionName: 'getSupportedBaseTokens',
      blockNumber: launch.blockNumber
    }) as readonly Address[];

    const pool = await this.client.readContract({
      address: TSUNAMI_V3_FACTORY as Address,
      abi: tsunamiFactoryReadAbi,
      functionName: 'getPool',
      args: [position.token0 as Address, position.token1 as Address, position.fee],
      blockNumber: launch.blockNumber
    }) as Address;
    if (norm(pool) === norm(ZERO_ADDRESS)) throw new Error(`SENTRY_POOL_MISSING:${launch.launchId}`);

    const [poolToken0, poolToken1, poolFee, activeLiquidity, slot0, poolCode] = await Promise.all([
      this.client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'token0', blockNumber: decisionBlock }),
      this.client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'token1', blockNumber: decisionBlock }),
      this.client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'fee', blockNumber: decisionBlock }),
      this.client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'liquidity', blockNumber: decisionBlock }),
      this.client.readContract({ address: pool, abi: tsunamiPoolReadAbi, functionName: 'slot0', blockNumber: decisionBlock }),
      this.client.getBytecode({ address: pool, blockNumber: decisionBlock })
    ]);
    if (!poolCode || poolCode === '0x') throw new Error(`SENTRY_POOL_CODE_MISSING:${pool}`);
    const slot = slot0 as readonly [bigint, number, number, number, number, number, boolean];

    return classifyLaunchMarket({
      launch,
      position,
      supportedBaseTokens: [...supportedBaseTokens] as Hex[],
      pool: pool as Hex,
      poolToken0: poolToken0 as Hex,
      poolToken1: poolToken1 as Hex,
      poolFee: Number(poolFee),
      activeLiquidity: activeLiquidity as bigint,
      sqrtPriceX96Before: slot[0]
    });
  }

  async calibrateUsd(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
  }): Promise<UsdCalibration> {
    const base = norm(params.market.baseToken);
    if (base === norm(USDT0)) {
      const decimals = Number(await this.client.readContract({
        address: USDT0 as Address,
        abi: erc20DecimalsAbi,
        functionName: 'decimals',
        blockNumber: params.decisionBlock
      }));
      return {
        kind: 'USDT0_NOMINAL_PEG_V0',
        notionalUsdMicros: params.notionalUsdMicros,
        baseToken: USDT0,
        baseAmount: scaleUsdMicrosToTokenUnits(params.notionalUsdMicros, decimals),
        baseDecimals: decimals
      };
    }

    if (base !== norm(WETH9)) throw new Error(`UNSUPPORTED_BASE_FOR_USD_CALIBRATION:${params.market.baseToken}`);

    const usdtDecimals = Number(await this.client.readContract({
      address: USDT0 as Address,
      abi: erc20DecimalsAbi,
      functionName: 'decimals',
      blockNumber: params.decisionBlock
    }));
    const wethDecimals = Number(await this.client.readContract({
      address: WETH9 as Address,
      abi: erc20DecimalsAbi,
      functionName: 'decimals',
      blockNumber: params.decisionBlock
    }));
    const targetUsdt = scaleUsdMicrosToTokenUnits(params.notionalUsdMicros, usdtDecimals);

    let best: { fee: number; pool: Hex; quote: RawQuoteResult } | null = null;
    for (const fee of TSUNAMI_FEE_TIERS) {
      const pool = await this.client.readContract({
        address: TSUNAMI_V3_FACTORY as Address,
        abi: tsunamiFactoryReadAbi,
        functionName: 'getPool',
        args: [WETH9 as Address, USDT0 as Address, fee],
        blockNumber: params.decisionBlock
      }) as Address;
      if (norm(pool) === norm(ZERO_ADDRESS)) continue;
      const quote = await this.callExactOutput({
        tokenIn: WETH9,
        tokenOut: USDT0,
        amountOut: targetUsdt,
        fee,
        blockNumber: params.decisionBlock
      });
      if (!quote.executable || quote.amountIn <= 0n || quote.amountOut <= 0n) continue;
      if (!best || quote.amountIn < best.quote.amountIn) best = { fee, pool: pool as Hex, quote };
    }
    if (!best) throw new Error(`USD_CALIBRATION_UNAVAILABLE:block=${params.decisionBlock}:notional=${params.notionalUsdMicros}`);

    const quoteId = await deriveBaselineQuoteId({
      launchId: params.launch.launchId,
      decisionBlockHash: params.decisionBlockHash,
      kind: 'USD_CALIBRATION',
      notionalUsdMicros: params.notionalUsdMicros
    });
    const quote: BaselineQuoteReceipt = {
      quoteId,
      launchId: params.launch.launchId,
      blockNumber: params.decisionBlock,
      blockHash: params.decisionBlockHash,
      observedAtMs: this.now(),
      kind: 'USD_CALIBRATION',
      mode: 'EXACT_OUTPUT',
      notionalUsdMicros: params.notionalUsdMicros,
      pool: best.pool,
      tokenIn: WETH9,
      tokenOut: USDT0,
      fee: best.fee,
      amountIn: best.quote.amountIn,
      amountOut: best.quote.amountOut,
      executable: true,
      ...(best.quote.sqrtPriceX96After !== undefined ? { sqrtPriceX96After: best.quote.sqrtPriceX96After } : {}),
      ...(best.quote.initializedTicksCrossed !== undefined ? { initializedTicksCrossed: best.quote.initializedTicksCrossed } : {}),
      ...(best.quote.gasEstimate !== undefined ? { gasEstimate: best.quote.gasEstimate } : {})
    };

    return {
      kind: 'WETH_USDT0_EXACT_OUTPUT_V0',
      notionalUsdMicros: params.notionalUsdMicros,
      baseToken: WETH9,
      baseAmount: best.quote.amountIn,
      baseDecimals: wethDecimals,
      quote
    };
  }

  async quoteEntry(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<BaselineQuoteReceipt> {
    const raw = await this.callExactInput({
      tokenIn: params.market.baseToken,
      tokenOut: params.market.launchedToken,
      amountIn: params.amountIn,
      fee: params.market.fee,
      blockNumber: params.decisionBlock
    });
    return this.makeQuote({ ...params, kind: 'ENTRY', tokenIn: params.market.baseToken, tokenOut: params.market.launchedToken, raw });
  }

  async quoteIndependentReverse(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<BaselineQuoteReceipt> {
    const raw = await this.callExactInput({
      tokenIn: params.market.launchedToken,
      tokenOut: params.market.baseToken,
      amountIn: params.amountIn,
      fee: params.market.fee,
      blockNumber: params.decisionBlock
    });
    return this.makeQuote({ ...params, kind: 'INDEPENDENT_REVERSE_EXIT', tokenIn: params.market.launchedToken, tokenOut: params.market.baseToken, raw });
  }

  private async makeQuote(params: {
    launch: LaunchObserved;
    market: LaunchMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
    kind: 'ENTRY' | 'INDEPENDENT_REVERSE_EXIT';
    tokenIn: Hex;
    tokenOut: Hex;
    raw: RawQuoteResult;
  }): Promise<BaselineQuoteReceipt> {
    const quoteId = await deriveBaselineQuoteId({
      launchId: params.launch.launchId,
      decisionBlockHash: params.decisionBlockHash,
      kind: params.kind,
      notionalUsdMicros: params.notionalUsdMicros
    });
    return {
      quoteId,
      launchId: params.launch.launchId,
      blockNumber: params.decisionBlock,
      blockHash: params.decisionBlockHash,
      observedAtMs: this.now(),
      kind: params.kind,
      mode: 'EXACT_INPUT',
      notionalUsdMicros: params.notionalUsdMicros,
      pool: params.market.pool,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      fee: params.market.fee,
      amountIn: params.amountIn,
      amountOut: params.raw.amountOut,
      executable: params.raw.executable,
      ...(params.raw.failureReason ? { failureReason: params.raw.failureReason } : {}),
      ...(params.raw.sqrtPriceX96After !== undefined ? { sqrtPriceX96After: params.raw.sqrtPriceX96After } : {}),
      ...(params.raw.initializedTicksCrossed !== undefined ? { initializedTicksCrossed: params.raw.initializedTicksCrossed } : {}),
      ...(params.raw.gasEstimate !== undefined ? { gasEstimate: params.raw.gasEstimate } : {})
    };
  }

  private async callExactInput(params: {
    tokenIn: Hex; tokenOut: Hex; amountIn: bigint; fee: number; blockNumber: bigint;
  }): Promise<RawQuoteResult> {
    const data = encodeFunctionData({
      abi: tsunamiQuoterV2Abi,
      functionName: 'quoteExactInputSingle',
      args: [{
        tokenIn: params.tokenIn as Address,
        tokenOut: params.tokenOut as Address,
        amountIn: params.amountIn,
        fee: params.fee,
        sqrtPriceLimitX96: 0n
      }]
    });
    try {
      const result = await this.client.call({ to: TSUNAMI_QUOTER_V2 as Address, data, blockNumber: params.blockNumber });
      if (!result.data) throw new Error('QUOTER_EMPTY_RETURN_DATA');
      const decoded = decodeFunctionResult({ abi: tsunamiQuoterV2Abi, functionName: 'quoteExactInputSingle', data: result.data }) as readonly [bigint, bigint, number, bigint];
      if (decoded[0] <= 0n) {
        return { executable: false, amountIn: params.amountIn, amountOut: 0n, failureReason: 'ZERO_OUTPUT' };
      }
      return {
        executable: true,
        amountIn: params.amountIn,
        amountOut: decoded[0],
        sqrtPriceX96After: decoded[1],
        initializedTicksCrossed: Number(decoded[2]),
        gasEstimate: decoded[3]
      };
    } catch (error) {
      if (isEvmRevert(error)) {
        return { executable: false, amountIn: params.amountIn, amountOut: 0n, failureReason: 'EVM_REVERT' };
      }
      throw error;
    }
  }

  private async callExactOutput(params: {
    tokenIn: Hex; tokenOut: Hex; amountOut: bigint; fee: number; blockNumber: bigint;
  }): Promise<RawQuoteResult> {
    const data = encodeFunctionData({
      abi: tsunamiQuoterV2Abi,
      functionName: 'quoteExactOutputSingle',
      args: [{
        tokenIn: params.tokenIn as Address,
        tokenOut: params.tokenOut as Address,
        amount: params.amountOut,
        fee: params.fee,
        sqrtPriceLimitX96: 0n
      }]
    });
    try {
      const result = await this.client.call({ to: TSUNAMI_QUOTER_V2 as Address, data, blockNumber: params.blockNumber });
      if (!result.data) throw new Error('QUOTER_EMPTY_RETURN_DATA');
      const decoded = decodeFunctionResult({ abi: tsunamiQuoterV2Abi, functionName: 'quoteExactOutputSingle', data: result.data }) as readonly [bigint, bigint, number, bigint];
      if (decoded[0] <= 0n || params.amountOut <= 0n) {
        return { executable: false, amountIn: 0n, amountOut: params.amountOut, failureReason: 'ZERO_AMOUNT' };
      }
      return {
        executable: true,
        amountIn: decoded[0],
        amountOut: params.amountOut,
        sqrtPriceX96After: decoded[1],
        initializedTicksCrossed: Number(decoded[2]),
        gasEstimate: decoded[3]
      };
    } catch (error) {
      if (isEvmRevert(error)) {
        return { executable: false, amountIn: 0n, amountOut: params.amountOut, failureReason: 'EVM_REVERT' };
      }
      throw error;
    }
  }
}

function requireAddress(label: string, actual: Address, expected: Hex): void {
  if (norm(actual) !== norm(expected)) throw new Error(`${label}:expected=${expected}:actual=${actual}`);
}

function norm(value: string): string { return value.toLowerCase(); }

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
