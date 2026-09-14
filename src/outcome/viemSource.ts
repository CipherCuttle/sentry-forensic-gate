import {
  createPublicClient,
  decodeFunctionResult,
  defineChain,
  encodeFunctionData,
  http,
  type Address,
  type PublicClient
} from 'viem';
import type { Hex } from '../domain.js';
import { CURRENT_READ_AUTHORITY_CONTEXT, type ReadAuthorityContext } from '../authority/readAuthorityContext.js';
import type { ForwardOutcomeSource, OutcomeBlockPoint, OutcomeExitQuote, OutcomeMarketState } from './ports.js';
import type { LaunchMarket } from '../shadow/baselineTypes.js';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from '../sentry/contracts.js';
import {
  erc20DecimalsAbi,
  TSUNAMI_FEE_TIERS,
  tsunamiFactoryReadAbi,
  tsunamiPoolReadAbi,
  tsunamiQuoterV2Abi,
  USDT0,
  ZERO_ADDRESS
} from '../tsunami/contracts.js';

const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_INK_RPC_URL] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } }
});

export interface ViemForwardOutcomeSourceOptions {
  rpcUrl?: string;
  client?: PublicClient;
  authority?: Readonly<ReadAuthorityContext>;
}

export class ViemForwardOutcomeSource implements ForwardOutcomeSource {
  private readonly client: PublicClient;
  private readonly authority: Readonly<ReadAuthorityContext>;

  constructor(options: ViemForwardOutcomeSourceOptions = {}) {
    this.client = options.client ?? createPublicClient({
      chain: ink,
      transport: http(options.rpcUrl ?? DEFAULT_INK_RPC_URL)
    });
    this.authority = options.authority ?? CURRENT_READ_AUTHORITY_CONTEXT;
  }

  async getHeadBlockNumber(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async getBlockPoint(blockNumber: bigint): Promise<OutcomeBlockPoint> {
    const block = await this.client.getBlock({ blockNumber });
    if (!block.hash) throw new Error(`MISSING_BLOCK_HASH:${blockNumber}`);
    const timestampMs = Number(block.timestamp) * 1000;
    if (!Number.isSafeInteger(timestampMs)) throw new Error(`BLOCK_TIMESTAMP_OUT_OF_RANGE:${blockNumber}`);
    return { blockNumber, blockHash: block.hash, timestampMs };
  }

  async assertMarketAuthority(market: LaunchMarket, blockNumber: bigint): Promise<void> {
    const chainId = await this.client.getChainId();
    if (chainId !== INK_CHAIN_ID) throw new Error(`INK_CHAIN_ID_DRIFT:expected=${INK_CHAIN_ID}:actual=${chainId}`);

    const [quoterFactory, quoterWeth, poolToken0, poolToken1, poolFee, factoryCode, quoterCode, poolCode] = await Promise.all([
      this.client.readContract({ address: this.authority.quoterV2 as Address, abi: tsunamiQuoterV2Abi, functionName: 'factory', blockNumber }),
      this.client.readContract({ address: this.authority.quoterV2 as Address, abi: tsunamiQuoterV2Abi, functionName: 'WETH9', blockNumber }),
      this.client.readContract({ address: market.pool as Address, abi: tsunamiPoolReadAbi, functionName: 'token0', blockNumber }),
      this.client.readContract({ address: market.pool as Address, abi: tsunamiPoolReadAbi, functionName: 'token1', blockNumber }),
      this.client.readContract({ address: market.pool as Address, abi: tsunamiPoolReadAbi, functionName: 'fee', blockNumber }),
      this.client.getBytecode({ address: this.authority.factory as Address, blockNumber }),
      this.client.getBytecode({ address: this.authority.quoterV2 as Address, blockNumber }),
      this.client.getBytecode({ address: market.pool as Address, blockNumber })
    ]);

    requireAddress('OUTCOME_QUOTER_FACTORY_DRIFT', quoterFactory as Address, this.authority.factory);
    requireAddress('OUTCOME_QUOTER_WETH_DRIFT', quoterWeth as Address, this.authority.weth);
    requireAddress('OUTCOME_POOL_TOKEN0_DRIFT', poolToken0 as Address, market.token0);
    requireAddress('OUTCOME_POOL_TOKEN1_DRIFT', poolToken1 as Address, market.token1);
    if (Number(poolFee) !== market.fee) {
      throw new Error(`OUTCOME_POOL_FEE_DRIFT:expected=${market.fee}:actual=${Number(poolFee)}:block=${blockNumber}`);
    }
    if (!factoryCode || factoryCode === '0x') throw new Error(`OUTCOME_AUTHORITY_CODE_MISSING:${this.authority.factory}:block=${blockNumber}`);
    if (!quoterCode || quoterCode === '0x') throw new Error(`OUTCOME_AUTHORITY_CODE_MISSING:${this.authority.quoterV2}:block=${blockNumber}`);
    if (!poolCode || poolCode === '0x') throw new Error(`OUTCOME_POOL_CODE_MISSING:${market.pool}:block=${blockNumber}`);
  }

  async readMarketState(market: LaunchMarket, blockNumber: bigint): Promise<OutcomeMarketState> {
    const activeLiquidity = await this.client.readContract({
      address: market.pool as Address,
      abi: tsunamiPoolReadAbi,
      functionName: 'liquidity',
      blockNumber
    }) as bigint;
    return { activeLiquidity };
  }

  async quoteTokenToBase(params: {
    market: LaunchMarket;
    tokenAmount: bigint;
    blockNumber: bigint;
  }): Promise<OutcomeExitQuote> {
    const quote = await this.callExactInput({
      tokenIn: params.market.launchedToken,
      tokenOut: params.market.baseToken,
      amountIn: params.tokenAmount,
      fee: params.market.fee,
      blockNumber: params.blockNumber
    });
    return {
      executable: quote.executable,
      amountOut: quote.amountOut,
      ...(quote.failureReason ? { failureReason: quote.failureReason } : {})
    };
  }

  async valueBaseAmountUsdMicros(params: {
    baseToken: Hex;
    baseAmount: bigint;
    blockNumber: bigint;
  }): Promise<bigint> {
    if (params.baseAmount < 0n) throw new Error('baseAmount must be >= 0');
    if (params.baseAmount === 0n) return 0n;
    const base = norm(params.baseToken);

    if (base === norm(USDT0)) {
      const decimals = Number(await this.client.readContract({
        address: USDT0 as Address,
        abi: erc20DecimalsAbi,
        functionName: 'decimals',
        blockNumber: params.blockNumber
      }));
      return tokenUnitsToUsdMicros(params.baseAmount, decimals);
    }

    if (base !== norm(this.authority.weth)) {
      throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:UNSUPPORTED_BASE:${params.baseToken}`);
    }

    const usdtDecimals = Number(await this.client.readContract({
      address: USDT0 as Address,
      abi: erc20DecimalsAbi,
      functionName: 'decimals',
      blockNumber: params.blockNumber
    }));

    let bestOut = 0n;
    for (const fee of TSUNAMI_FEE_TIERS) {
      const pool = await this.client.readContract({
        address: this.authority.factory as Address,
        abi: tsunamiFactoryReadAbi,
        functionName: 'getPool',
        args: [this.authority.weth as Address, USDT0 as Address, fee],
        blockNumber: params.blockNumber
      }) as Address;
      if (norm(pool) === norm(ZERO_ADDRESS)) continue;
      const quote = await this.callExactInput({
        tokenIn: this.authority.weth,
        tokenOut: USDT0,
        amountIn: params.baseAmount,
        fee,
        blockNumber: params.blockNumber
      });
      if (quote.executable && quote.amountOut > bestOut) bestOut = quote.amountOut;
    }

    if (bestOut <= 0n) {
      throw new Error(`OUTCOME_USD_VALUATION_UNAVAILABLE:block=${params.blockNumber}:baseAmount=${params.baseAmount}`);
    }
    return tokenUnitsToUsdMicros(bestOut, usdtDecimals);
  }

  private async callExactInput(params: {
    tokenIn: Hex;
    tokenOut: Hex;
    amountIn: bigint;
    fee: number;
    blockNumber: bigint;
  }): Promise<{ executable: boolean; amountOut: bigint; failureReason?: string }> {
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
      const result = await this.client.call({
        to: this.authority.quoterV2 as Address,
        data,
        blockNumber: params.blockNumber
      });
      if (!result.data) throw new Error('QUOTER_EMPTY_RETURN_DATA');
      const decoded = decodeFunctionResult({
        abi: tsunamiQuoterV2Abi,
        functionName: 'quoteExactInputSingle',
        data: result.data
      }) as readonly [bigint, bigint, number, bigint];
      if (decoded[0] <= 0n) return { executable: false, amountOut: 0n, failureReason: 'ZERO_OUTPUT' };
      return { executable: true, amountOut: decoded[0] };
    } catch (error) {
      if (isEvmRevert(error)) return { executable: false, amountOut: 0n, failureReason: 'EVM_REVERT' };
      throw error;
    }
  }
}

export function tokenUnitsToUsdMicros(amount: bigint, decimals: number): bigint {
  if (amount < 0n) throw new Error('amount must be >= 0');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`INVALID_TOKEN_DECIMALS:${decimals}`);
  }
  return (amount * 1_000_000n) / (10n ** BigInt(decimals));
}

function requireAddress(label: string, actual: Address, expected: Hex): void {
  if (norm(actual) !== norm(expected)) throw new Error(`${label}:expected=${expected}:actual=${actual}`);
}

function norm(value: string): string {
  return value.toLowerCase();
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
