import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  type Address,
  type PublicClient
} from 'viem';
import type { Hex } from '../../../domain.js';
import { sha256Hex } from '../../../evidence/canonical.js';
import type {
  CanonicalJsonValue,
  NormalizedLaunchCandidate,
  NormalizedMarket,
  PortableQuoteObservation,
  SourceAuthorityEnvelope
} from '../../../multichain/domain.js';
import type { MarketQuoteAdapter } from '../../../multichain/ports.js';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL,
  ponsV2CurveQuoteReadAbi,
  ponsV2FactoryReadAbi,
  ponsV2LaunchDeployerReadAbi
} from './contracts.js';
import {
  type PonsV2Authority
} from './authority.js';
import {
  assertPonsV2CurveTemplateBlock,
  validatePonsV2CurveTemplateAuthority,
  type PonsV2CurveTemplateAuthority
} from './curveTemplateAuthority.js';
import { ViemPonsV2LaunchAdapter } from './viemLaunchAdapter.js';
import { ViemPonsV2MarketStateResolver } from './viemMarketStateResolver.js';

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL } }
});

const BASIS_POINTS = 10_000n;
const UINT256_MAX = (1n << 256n) - 1n;

export const PONS_V2_CURVE_QUOTE_R1 = 'PONS_V2_CURVE_QUOTE_R1' as const;

/**
 * Deterministic synthetic recipient for shadow pricing only.
 * sha256("SENTRY_PONS_SHADOW_QUOTE_RECIPIENT_V1"), low 20 bytes.
 * This is not a wallet, signer, custody surface, or live execution address.
 */
export const PONS_V2_SHADOW_QUOTE_RECIPIENT: Hex =
  '0xa2bb223b536714b33a045012d22af674232d61d9';

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

interface MarketAuthorityFields {
  authorityId: string;
  factoryRuntimeCodeHash: Hex;
  factory: Hex;
  token: Hex;
  curve: Hex;
  pairToken: Hex;
  creatorTaxBps: number;
  decisionBlock: bigint;
  decisionBlockHash: Hex;
  state: string;
}

interface CurveQuoteState {
  curve: Hex;
  quoteReserve: bigint;
  tokenReserve: bigint;
  trackedQuote: bigint;
  sellableTokens: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
  snipeTaxBps: bigint;
}

export interface ViemPonsV2CurveQuoteAdapterOptions {
  authority: Readonly<PonsV2Authority>;
  templateAuthority: Readonly<PonsV2CurveTemplateAuthority>;
  rpcUrl?: string;
  client?: PublicClient;
  now?: () => number;
}

export class ViemPonsV2CurveQuoteAdapter implements MarketQuoteAdapter {
  readonly chainId = ROBINHOOD_CHAIN_ID;
  readonly ecosystem = 'ROBINHOOD' as const;
  readonly launchProtocol = 'PONS' as const;
  readonly mode = 'SHADOW_ONLY' as const;

  private readonly authority: Readonly<PonsV2Authority>;
  private readonly templateAuthority: Readonly<PonsV2CurveTemplateAuthority>;
  private readonly client: PublicClient;
  private readonly authorityGuard: ViemPonsV2LaunchAdapter;
  private readonly marketResolver: ViemPonsV2MarketStateResolver;
  private readonly now: () => number;

  constructor(options: ViemPonsV2CurveQuoteAdapterOptions) {
    validatePonsV2CurveTemplateAuthority(options.templateAuthority, options.authority);
    this.authority = options.authority;
    this.templateAuthority = options.templateAuthority;
    this.client = options.client ?? createPublicClient({
      chain: robinhood,
      transport: http(options.rpcUrl ?? DEFAULT_ROBINHOOD_RPC_URL)
    });
    this.authorityGuard = new ViemPonsV2LaunchAdapter({
      authority: options.authority,
      client: this.client
    });
    this.marketResolver = new ViemPonsV2MarketStateResolver({
      authority: options.authority,
      client: this.client
    });
    this.now = options.now ?? Date.now;
  }

  async resolveMarket(
    launch: NormalizedLaunchCandidate,
    decisionBlock: bigint
  ): Promise<NormalizedMarket> {
    const resolution = await this.marketResolver.resolve(launch, decisionBlock);
    if (resolution.state !== 'CURVE_ACTIVE' || !resolution.market) {
      throw new Error(`PONS_V2_QUOTE_MARKET_NOT_ACTIVE:${resolution.state}:${launch.launchId}`);
    }
    return resolution.market;
  }

  async quoteEntry(params: {
    launch: NormalizedLaunchCandidate;
    market: NormalizedMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<PortableQuoteObservation> {
    if (params.amountIn <= 0n) throw new Error('PONS_V2_QUOTE_AMOUNT_IN_INVALID');
    const marketAuthority = await this.assertQuoteContext(params);
    const state = await this.readCurveQuoteState(params, marketAuthority);
    const entry = computeEntry(params.amountIn, state);

    const sourceAuthority = this.buildSourceAuthority({
      kind: 'ENTRY',
      params,
      marketAuthority,
      state,
      amountInRequested: params.amountIn,
      amountInExecutable: entry.spent,
      amountOut: entry.tokensOut,
      executable: entry.executable,
      failureReason: entry.failureReason,
      feeAmount: entry.fee,
      creatorTaxAmount: entry.creatorTax,
      snipeTaxAmount: entry.snipeTax,
      grossAmountOut: null,
      partialFill: entry.partialFill
    });
    const quoteId = await deriveQuoteId(
      'ENTRY',
      params.market.marketId,
      params.decisionBlockHash,
      params.notionalUsdMicros,
      params.amountIn
    );

    return {
      quoteId,
      launchId: params.launch.launchId,
      marketId: params.market.marketId,
      blockNumber: params.decisionBlock,
      blockHash: normHex(params.decisionBlockHash),
      observedAtMs: this.now(),
      kind: 'ENTRY',
      notionalUsdMicros: params.notionalUsdMicros,
      tokenIn: PONS_V2_NATIVE_PAIR_TOKEN,
      tokenOut: normHex(params.launch.token),
      amountIn: entry.spent,
      amountOut: entry.tokensOut,
      executable: entry.executable,
      ...(entry.failureReason ? { failureReason: entry.failureReason } : {}),
      sourceAuthority
    };
  }

  async quoteIndependentReverse(params: {
    launch: NormalizedLaunchCandidate;
    market: NormalizedMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
    notionalUsdMicros: bigint;
    amountIn: bigint;
  }): Promise<PortableQuoteObservation> {
    if (params.amountIn <= 0n) throw new Error('PONS_V2_QUOTE_AMOUNT_IN_INVALID');
    const marketAuthority = await this.assertQuoteContext(params);
    const state = await this.readCurveQuoteState(params, marketAuthority);
    const reverse = computeReverse(params.amountIn, state);

    const sourceAuthority = this.buildSourceAuthority({
      kind: 'INDEPENDENT_REVERSE_EXIT',
      params,
      marketAuthority,
      state,
      amountInRequested: params.amountIn,
      amountInExecutable: params.amountIn,
      amountOut: reverse.quoteOut,
      executable: reverse.executable,
      failureReason: reverse.failureReason,
      feeAmount: reverse.fee,
      creatorTaxAmount: reverse.creatorTax,
      snipeTaxAmount: 0n,
      grossAmountOut: reverse.grossQuoteOut,
      partialFill: false
    });
    const quoteId = await deriveQuoteId(
      'INDEPENDENT_REVERSE_EXIT',
      params.market.marketId,
      params.decisionBlockHash,
      params.notionalUsdMicros,
      params.amountIn
    );

    return {
      quoteId,
      launchId: params.launch.launchId,
      marketId: params.market.marketId,
      blockNumber: params.decisionBlock,
      blockHash: normHex(params.decisionBlockHash),
      observedAtMs: this.now(),
      kind: 'INDEPENDENT_REVERSE_EXIT',
      notionalUsdMicros: params.notionalUsdMicros,
      tokenIn: normHex(params.launch.token),
      tokenOut: PONS_V2_NATIVE_PAIR_TOKEN,
      amountIn: params.amountIn,
      amountOut: reverse.quoteOut,
      executable: reverse.executable,
      ...(reverse.failureReason ? { failureReason: reverse.failureReason } : {}),
      sourceAuthority
    };
  }

  private async assertQuoteContext(params: {
    launch: NormalizedLaunchCandidate;
    market: NormalizedMarket;
    decisionBlock: bigint;
    decisionBlockHash: Hex;
  }): Promise<MarketAuthorityFields> {
    const { launch, market } = params;
    if (
      launch.chainId !== ROBINHOOD_CHAIN_ID ||
      launch.ecosystem !== 'ROBINHOOD' ||
      launch.launchProtocol !== 'PONS' ||
      market.chainId !== ROBINHOOD_CHAIN_ID ||
      market.ecosystem !== 'ROBINHOOD' ||
      market.launchProtocol !== 'PONS'
    ) {
      throw new Error('PONS_V2_QUOTE_IDENTITY_MISMATCH');
    }
    if (launch.launchId !== market.launchId || norm(launch.token) !== norm(market.launchedToken)) {
      throw new Error('PONS_V2_QUOTE_LAUNCH_MARKET_MISMATCH');
    }
    if (norm(launch.factory) !== norm(this.authority.factory)) {
      throw new Error('PONS_V2_QUOTE_FACTORY_MISMATCH');
    }
    if (norm(market.baseAsset) !== norm(PONS_V2_NATIVE_PAIR_TOKEN)) {
      throw new Error(`PONS_V2_QUOTE_UNSUPPORTED_PAIR_TOKEN:${market.baseAsset}`);
    }

    const authority = readMarketAuthority(market);
    if (
      authority.authorityId !== this.authority.authorityId ||
      norm(authority.factoryRuntimeCodeHash) !== norm(this.authority.factoryRuntimeCodeHash) ||
      norm(authority.factory) !== norm(this.authority.factory) ||
      norm(authority.token) !== norm(launch.token) ||
      norm(authority.pairToken) !== norm(PONS_V2_NATIVE_PAIR_TOKEN) ||
      authority.decisionBlock !== params.decisionBlock ||
      norm(authority.decisionBlockHash) !== norm(params.decisionBlockHash) ||
      authority.state !== 'CURVE_ACTIVE'
    ) {
      throw new Error('PONS_V2_QUOTE_MARKET_AUTHORITY_MISMATCH');
    }

    const expectedMarketId = await sha256Hex({
      kind: 'PONS_V2_CURVE_MARKET_V1',
      chainId: ROBINHOOD_CHAIN_ID,
      launchId: launch.launchId,
      curve: norm(authority.curve),
      pairToken: norm(authority.pairToken)
    });
    if (market.marketId !== expectedMarketId) {
      throw new Error('PONS_V2_QUOTE_MARKET_ID_MISMATCH');
    }
    return authority;
  }

  private async readCurveQuoteState(
    params: {
      launch: NormalizedLaunchCandidate;
      market: NormalizedMarket;
      decisionBlock: bigint;
      decisionBlockHash: Hex;
    },
    marketAuthority: MarketAuthorityFields
  ): Promise<CurveQuoteState> {
    const hashBefore = await this.authorityGuard.getBlockHash(params.decisionBlock);
    if (norm(hashBefore) !== norm(params.decisionBlockHash)) {
      throw new Error(`PONS_V2_QUOTE_DECISION_HASH_MISMATCH:block=${params.decisionBlock}`);
    }

    await this.authorityGuard.assertAuthority(params.decisionBlock);
    await this.assertCurveTemplateAuthority(params.decisionBlock);

    const curve = marketAuthority.curve as Address;
    const [
      recordRaw,
      curveFactory,
      curveToken,
      pairToken,
      graduated,
      readyToGraduate,
      reservesRaw,
      trackedQuote,
      sellableTokens,
      feeBps,
      creatorTaxBps,
      snipeTaxExempt,
      snipeTaxBps,
      curveCode,
      shadowRecipientCode
    ] = await Promise.all([
      this.client.readContract({
        address: this.authority.factory as Address,
        abi: ponsV2FactoryReadAbi,
        functionName: 'getLaunchedToken',
        args: [params.launch.token],
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'factory',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'token',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'pairToken',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'graduated',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'readyToGraduate',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'getReserves',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'trackedQuote',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'sellableTokens',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'feeBps',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'creatorTaxBps',
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'snipeTaxExempt',
        args: [PONS_V2_SHADOW_QUOTE_RECIPIENT],
        blockNumber: params.decisionBlock
      }),
      this.client.readContract({
        address: curve,
        abi: ponsV2CurveQuoteReadAbi,
        functionName: 'currentSnipeTaxBps',
        args: [PONS_V2_SHADOW_QUOTE_RECIPIENT],
        blockNumber: params.decisionBlock
      }),
      this.client.getBytecode({ address: curve, blockNumber: params.decisionBlock }),
      this.client.getBytecode({
        address: PONS_V2_SHADOW_QUOTE_RECIPIENT as Address,
        blockNumber: params.decisionBlock
      })
    ]);

    const record = recordRaw as unknown as PonsV2LaunchRecord;
    const reserves = reservesRaw as readonly [bigint, bigint];

    if (!record.exists || record.phase !== 0 || record.sweptQuote !== 0n || record.sweptTokens !== 0n || record.sweptAt !== 0n) {
      throw new Error('PONS_V2_QUOTE_FACTORY_RECORD_NOT_ACTIVE');
    }
    requireSameAddress('RECORD_TOKEN', record.token, params.launch.token);
    requireSameAddress('RECORD_CURVE', record.curve, curve);
    requireSameAddress('RECORD_PAIR_TOKEN', record.pairToken, PONS_V2_NATIVE_PAIR_TOKEN);
    requireSameAddress('CURVE_FACTORY', curveFactory as Address, this.authority.factory);
    requireSameAddress('CURVE_TOKEN', curveToken as Address, params.launch.token);
    requireSameAddress('CURVE_PAIR_TOKEN', pairToken as Address, PONS_V2_NATIVE_PAIR_TOKEN);
    if (record.creatorTaxBps !== Number(creatorTaxBps)) {
      throw new Error('PONS_V2_QUOTE_CREATOR_TAX_MISMATCH');
    }
    if (record.creatorTaxBps !== marketAuthority.creatorTaxBps) {
      throw new Error('PONS_V2_QUOTE_MARKET_CREATOR_TAX_MISMATCH');
    }
    if (graduated || readyToGraduate) {
      throw new Error('PONS_V2_QUOTE_CURVE_NOT_ACTIVE');
    }
    if (!curveCode || curveCode === '0x') throw new Error('PONS_V2_QUOTE_CURVE_CODE_MISSING');
    if (shadowRecipientCode && shadowRecipientCode !== '0x') {
      throw new Error('PONS_V2_QUOTE_SHADOW_RECIPIENT_HAS_CODE');
    }
    if (snipeTaxExempt) {
      throw new Error('PONS_V2_QUOTE_SHADOW_RECIPIENT_EXEMPT');
    }

    const quoteReserve = reserves[0];
    const tokenReserve = reserves[1];
    if (quoteReserve <= 0n || tokenReserve <= 0n || sellableTokens <= 0n) {
      throw new Error('PONS_V2_QUOTE_RESERVES_INVALID');
    }
    if (feeBps < 0n || creatorTaxBps < 0n || feeBps + creatorTaxBps > 2_000n) {
      throw new Error('PONS_V2_QUOTE_FEE_TERMS_INVALID');
    }

    await this.authorityGuard.assertAuthority(params.decisionBlock);
    await this.assertCurveTemplateAuthority(params.decisionBlock);
    const hashAfter = await this.authorityGuard.getBlockHash(params.decisionBlock);
    if (norm(hashAfter) !== norm(params.decisionBlockHash)) {
      throw new Error(`PONS_V2_QUOTE_REORG_DURING_READ:block=${params.decisionBlock}`);
    }

    return {
      curve: normHex(curve),
      quoteReserve,
      tokenReserve,
      trackedQuote: trackedQuote as bigint,
      sellableTokens: sellableTokens as bigint,
      feeBps: feeBps as bigint,
      creatorTaxBps: creatorTaxBps as bigint,
      snipeTaxBps: snipeTaxBps as bigint
    };
  }

  private async assertCurveTemplateAuthority(blockNumber: bigint): Promise<void> {
    assertPonsV2CurveTemplateBlock(this.templateAuthority, blockNumber);
    const [configuredDeployer, deployerCode, boundFactory] = await Promise.all([
      this.client.readContract({
        address: this.authority.factory as Address,
        abi: ponsV2FactoryReadAbi,
        functionName: 'launchDeployer',
        blockNumber
      }),
      this.client.getBytecode({
        address: this.templateAuthority.launchDeployer as Address,
        blockNumber
      }),
      this.client.readContract({
        address: this.templateAuthority.launchDeployer as Address,
        abi: ponsV2LaunchDeployerReadAbi,
        functionName: 'factory',
        blockNumber
      })
    ]);

    requireSameAddress(
      'FACTORY_LAUNCH_DEPLOYER',
      configuredDeployer as Address,
      this.templateAuthority.launchDeployer
    );
    requireSameAddress('LAUNCH_DEPLOYER_FACTORY', boundFactory as Address, this.authority.factory);
    if (!deployerCode || deployerCode === '0x') {
      throw new Error('PONS_V2_CURVE_TEMPLATE_CODE_MISSING');
    }
    const actualHash = keccak256(deployerCode);
    if (norm(actualHash) !== norm(this.templateAuthority.launchDeployerRuntimeCodeHash)) {
      throw new Error(
        `PONS_V2_CURVE_TEMPLATE_CODE_HASH_DRIFT:expected=${this.templateAuthority.launchDeployerRuntimeCodeHash}:actual=${actualHash}`
      );
    }
  }

  private buildSourceAuthority(input: {
    kind: 'ENTRY' | 'INDEPENDENT_REVERSE_EXIT';
    params: {
      launch: NormalizedLaunchCandidate;
      market: NormalizedMarket;
      decisionBlock: bigint;
      decisionBlockHash: Hex;
      notionalUsdMicros: bigint;
      amountIn: bigint;
    };
    marketAuthority: MarketAuthorityFields;
    state: CurveQuoteState;
    amountInRequested: bigint;
    amountInExecutable: bigint;
    amountOut: bigint;
    executable: boolean;
    failureReason?: string;
    feeAmount: bigint;
    creatorTaxAmount: bigint;
    snipeTaxAmount: bigint;
    grossAmountOut: bigint | null;
    partialFill: boolean;
  }): SourceAuthorityEnvelope {
    return {
      schema: 'ROBINHOOD_PONS_V2_CURVE_QUOTE_R1',
      payload: {
        policyVersion: PONS_V2_CURVE_QUOTE_R1,
        kind: input.kind,
        authorityId: this.authority.authorityId,
        factoryRuntimeCodeHash: norm(this.authority.factoryRuntimeCodeHash),
        curveTemplateAuthorityId: this.templateAuthority.authorityId,
        launchDeployer: normHex(this.templateAuthority.launchDeployer),
        launchDeployerRuntimeCodeHash: norm(this.templateAuthority.launchDeployerRuntimeCodeHash),
        launchId: input.params.launch.launchId,
        marketId: input.params.market.marketId,
        decisionBlock: input.params.decisionBlock.toString(),
        decisionBlockHash: norm(input.params.decisionBlockHash),
        curve: input.state.curve,
        pairToken: PONS_V2_NATIVE_PAIR_TOKEN,
        shadowRecipient: PONS_V2_SHADOW_QUOTE_RECIPIENT,
        quoteReserve: input.state.quoteReserve.toString(),
        tokenReserve: input.state.tokenReserve.toString(),
        trackedQuote: input.state.trackedQuote.toString(),
        sellableTokens: input.state.sellableTokens.toString(),
        feeBps: input.state.feeBps.toString(),
        creatorTaxBps: input.state.creatorTaxBps.toString(),
        snipeTaxBps: input.state.snipeTaxBps.toString(),
        amountInRequested: input.amountInRequested.toString(),
        amountInExecutable: input.amountInExecutable.toString(),
        amountOut: input.amountOut.toString(),
        grossAmountOut: input.grossAmountOut?.toString() ?? null,
        feeAmount: input.feeAmount.toString(),
        creatorTaxAmount: input.creatorTaxAmount.toString(),
        snipeTaxAmount: input.snipeTaxAmount.toString(),
        partialFill: input.partialFill,
        executable: input.executable,
        failureReason: input.failureReason ?? null,
        reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
        marketState: input.marketAuthority.state
      }
    };
  }
}

function computeEntry(amountIn: bigint, state: CurveQuoteState): {
  spent: bigint;
  tokensOut: bigint;
  fee: bigint;
  creatorTax: bigint;
  snipeTax: bigint;
  partialFill: boolean;
  executable: boolean;
  failureReason?: string;
} {
  const snipeTaxBps = clampSnipeTax(state.feeBps, state.creatorTaxBps, state.snipeTaxBps);
  let spent = amountIn;
  let fee = bpsAmount(spent, state.feeBps);
  let creatorTax = bpsAmount(spent, state.creatorTaxBps);
  let snipeTax = bpsAmount(spent, snipeTaxBps);
  let net = spent - fee - creatorTax - snipeTax;
  if (net <= 0n) {
    return {
      spent,
      tokensOut: 0n,
      fee,
      creatorTax,
      snipeTax,
      partialFill: false,
      executable: false,
      failureReason: 'PONS_V2_CURVE_ZERO_NET_ENTRY'
    };
  }

  let tokensOut = getAmountOut(net, state.quoteReserve, state.tokenReserve);
  let partialFill = false;
  if (tokensOut > state.sellableTokens) {
    partialFill = true;
    tokensOut = state.sellableTokens;
    const netRequired = getAmountIn(tokensOut, state.quoteReserve, state.tokenReserve);
    const grossDenominator = BASIS_POINTS - state.feeBps - state.creatorTaxBps - snipeTaxBps;
    spent = min(ceilDiv(checkedMul(netRequired, BASIS_POINTS), grossDenominator), amountIn);
    fee = bpsAmount(spent, state.feeBps);
    creatorTax = bpsAmount(spent, state.creatorTaxBps);
    snipeTax = bpsAmount(spent, snipeTaxBps);
    net = spent - fee - creatorTax - snipeTax;
  }

  if (tokensOut <= 0n || net <= 0n) {
    return {
      spent,
      tokensOut: 0n,
      fee,
      creatorTax,
      snipeTax,
      partialFill,
      executable: false,
      failureReason: 'PONS_V2_CURVE_ZERO_ENTRY_OUTPUT'
    };
  }
  return { spent, tokensOut, fee, creatorTax, snipeTax, partialFill, executable: true };
}

function computeReverse(tokensIn: bigint, state: CurveQuoteState): {
  grossQuoteOut: bigint;
  quoteOut: bigint;
  fee: bigint;
  creatorTax: bigint;
  executable: boolean;
  failureReason?: string;
} {
  const grossQuoteOut = getAmountOut(tokensIn, state.tokenReserve, state.quoteReserve);
  if (grossQuoteOut <= 0n) {
    return {
      grossQuoteOut,
      quoteOut: 0n,
      fee: 0n,
      creatorTax: 0n,
      executable: false,
      failureReason: 'PONS_V2_CURVE_ZERO_REVERSE_OUTPUT'
    };
  }
  const fee = bpsAmount(grossQuoteOut, state.feeBps);
  const creatorTax = bpsAmount(grossQuoteOut, state.creatorTaxBps);
  const quoteOut = grossQuoteOut - fee - creatorTax;
  if (quoteOut <= 0n) {
    return {
      grossQuoteOut,
      quoteOut: 0n,
      fee,
      creatorTax,
      executable: false,
      failureReason: 'PONS_V2_CURVE_ZERO_REVERSE_OUTPUT'
    };
  }
  if (quoteOut > state.trackedQuote) {
    return {
      grossQuoteOut,
      quoteOut: 0n,
      fee,
      creatorTax,
      executable: false,
      failureReason: 'PONS_V2_CURVE_INSUFFICIENT_REAL_QUOTE'
    };
  }
  return { grossQuoteOut, quoteOut, fee, creatorTax, executable: true };
}

function clampSnipeTax(feeBps: bigint, creatorTaxBps: bigint, current: bigint): bigint {
  if (current <= 0n) return 0n;
  const max = BASIS_POINTS - feeBps - creatorTaxBps - 100n;
  if (max <= 0n) throw new Error('PONS_V2_QUOTE_SNIPE_TAX_BOUND_INVALID');
  return current > max ? max : current;
}

function bpsAmount(amount: bigint, bps: bigint): bigint {
  return checkedMul(amount, bps) / BASIS_POINTS;
}

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = checkedMul(amountIn, BASIS_POINTS);
  const numerator = checkedMul(amountInWithFee, reserveOut);
  const denominator = checkedAdd(checkedMul(reserveIn, BASIS_POINTS), amountInWithFee);
  return numerator / denominator;
}

function getAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= amountOut) {
    throw new Error('PONS_V2_QUOTE_INSUFFICIENT_LIQUIDITY');
  }
  const numerator = checkedMul(checkedMul(amountOut, reserveIn), BASIS_POINTS);
  const denominator = checkedMul(reserveOut - amountOut, BASIS_POINTS);
  return numerator / denominator + 1n;
}

function checkedMul(a: bigint, b: bigint): bigint {
  const out = a * b;
  if (out > UINT256_MAX) throw new Error('PONS_V2_QUOTE_MATH_OVERFLOW');
  return out;
}

function checkedAdd(a: bigint, b: bigint): bigint {
  const out = a + b;
  if (out > UINT256_MAX) throw new Error('PONS_V2_QUOTE_MATH_OVERFLOW');
  return out;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('PONS_V2_QUOTE_DIVISION_BY_ZERO');
  return numerator === 0n ? 0n : ((numerator - 1n) / denominator) + 1n;
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

async function deriveQuoteId(
  kind: 'ENTRY' | 'INDEPENDENT_REVERSE_EXIT',
  marketId: string,
  blockHash: Hex,
  notionalUsdMicros: bigint,
  amountIn: bigint
): Promise<string> {
  return sha256Hex({
    kind: PONS_V2_CURVE_QUOTE_R1,
    quoteKind: kind,
    marketId,
    blockHash: norm(blockHash),
    notionalUsdMicros,
    amountIn
  });
}

function readMarketAuthority(market: NormalizedMarket): MarketAuthorityFields {
  if (market.sourceAuthority.schema !== 'ROBINHOOD_PONS_V2_MARKET_STATE_R1') {
    throw new Error('PONS_V2_QUOTE_MARKET_SCHEMA_MISMATCH');
  }
  const payload = market.sourceAuthority.payload;
  if (!isRecord(payload)) throw new Error('PONS_V2_QUOTE_MARKET_AUTHORITY_MALFORMED');
  return {
    authorityId: requireString(payload, 'authorityId'),
    factoryRuntimeCodeHash: requireHash(payload, 'factoryRuntimeCodeHash'),
    factory: requireAddress(payload, 'factory'),
    token: requireAddress(payload, 'token'),
    curve: requireAddress(payload, 'curve'),
    pairToken: requireAddress(payload, 'pairToken'),
    creatorTaxBps: requireNumber(payload, 'creatorTaxBps'),
    decisionBlock: requireBigIntString(payload, 'decisionBlock'),
    decisionBlockHash: requireHash(payload, 'decisionBlockHash'),
    state: requireString(payload, 'state')
  };
}

function isRecord(value: CanonicalJsonValue): value is Readonly<Record<string, CanonicalJsonValue>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(payload: Readonly<Record<string, CanonicalJsonValue>>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`PONS_V2_QUOTE_FIELD_INVALID:${key}`);
  return value;
}

function requireNumber(payload: Readonly<Record<string, CanonicalJsonValue>>, key: string): number {
  const value = payload[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`PONS_V2_QUOTE_FIELD_INVALID:${key}`);
  return value;
}

function requireBigIntString(
  payload: Readonly<Record<string, CanonicalJsonValue>>,
  key: string
): bigint {
  const value = requireString(payload, key);
  if (!/^[0-9]+$/.test(value)) throw new Error(`PONS_V2_QUOTE_FIELD_INVALID:${key}`);
  return BigInt(value);
}

function requireAddress(payload: Readonly<Record<string, CanonicalJsonValue>>, key: string): Hex {
  const value = requireString(payload, key);
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`PONS_V2_QUOTE_FIELD_INVALID:${key}`);
  return normHex(value);
}

function requireHash(payload: Readonly<Record<string, CanonicalJsonValue>>, key: string): Hex {
  const value = requireString(payload, key);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`PONS_V2_QUOTE_FIELD_INVALID:${key}`);
  return normHex(value);
}

function requireSameAddress(label: string, actual: Address, expected: string): void {
  if (norm(actual) !== norm(expected)) throw new Error(`PONS_V2_QUOTE_${label}_MISMATCH`);
}

function norm(value: string): string {
  return value.toLowerCase();
}

function normHex(value: string): Hex {
  return value.toLowerCase() as Hex;
}
