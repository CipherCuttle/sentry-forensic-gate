import type { Hex } from '../../../domain.js';

export const PONS_V2_CURVE_QUOTE_SEMANTICS_R1 = 'PONS_V2_CURVE_QUOTE_SEMANTICS_R1' as const;
export const PONS_V2_QUOTE_BASIS_POINTS = 10_000n;
export const PONS_V2_MIN_BUY_NET_BPS = 100n;
export const PONS_V2_MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Verified-deployment reference used to freeze the arithmetic in this module.
 * Runtime quote authority still has to bind the concrete curve to the reviewed
 * factory/launch-deployer epoch before these calculations become evidence.
 */
export const PONS_V2_DEPLOYED_CURVE_REFERENCE = Object.freeze({
  chainId: 4663,
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as Hex,
  launchDeployer: '0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42' as Hex,
  sampleToken: '0x9cA1cC0c90d97B4F36c5E2232d4fbD705a73c65d' as Hex,
  sampleCurve: '0x0f0844B1074DE1070eC9fC42B762d71046B3D5f9' as Hex,
  compilerVersion: 'v0.8.35+commit.47b9dedd',
  verifiedAt: '2026-08-30T01:25:49.454554Z'
});

export interface PonsV2CurveQuoteState {
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellableTokens: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
}

export interface PonsV2CurveEntryQuoteInput extends PonsV2CurveQuoteState {
  /** Quote amount actually credited by the deployed curve's _receiveQuote(). */
  creditedQuoteIn: bigint;
  /** currentSnipeTaxBps(recipient) read at the same frozen decision block. */
  snipeTaxBps: bigint;
}

export interface PonsV2CurveEntryQuote {
  policyVersion: typeof PONS_V2_CURVE_QUOTE_SEMANTICS_R1;
  creditedQuoteIn: bigint;
  quoteSpent: bigint;
  quoteRefund: bigint;
  tokensOut: bigint;
  baseFee: bigint;
  creatorTax: bigint;
  snipeTax: bigint;
  appliedSnipeTaxBps: bigint;
  netQuoteIntoCurve: bigint;
  partialFill: boolean;
}

export interface PonsV2CurveReverseQuoteInput {
  tokensIn: bigint;
  quoteReserve: bigint;
  tokenReserve: bigint;
  feeBps: bigint;
  creatorTaxBps: bigint;
}

export interface PonsV2CurveReverseQuote {
  policyVersion: typeof PONS_V2_CURVE_QUOTE_SEMANTICS_R1;
  tokensIn: bigint;
  grossQuoteOut: bigint;
  baseFee: bigint;
  creatorTax: bigint;
  quoteOut: bigint;
}

/**
 * Mirrors deployed Pons V2 buy arithmetic after _receiveQuote() has determined
 * the credited input. Native ETH has credited == requested. ERC-20 quote assets
 * must not make that assumption until runtime balance-delta semantics are proven.
 */
export function quotePonsV2CurveEntry(input: PonsV2CurveEntryQuoteInput): PonsV2CurveEntryQuote {
  assertEntryState(input);
  assertUint256('creditedQuoteIn', input.creditedQuoteIn);
  assertUint256('snipeTaxBps', input.snipeTaxBps);
  if (input.creditedQuoteIn === 0n) throw new Error('PONS_V2_QUOTE_ZERO_INPUT');
  if (input.sellableTokens === 0n) throw new Error('PONS_V2_QUOTE_CURVE_READY_TO_GRADUATE');

  const maxSnipeTaxBps =
    PONS_V2_QUOTE_BASIS_POINTS - input.feeBps - input.creatorTaxBps - PONS_V2_MIN_BUY_NET_BPS;
  if (maxSnipeTaxBps < 0n) throw new Error('PONS_V2_QUOTE_FEE_DOMAIN_INVALID');
  const appliedSnipeTaxBps = input.snipeTaxBps > maxSnipeTaxBps ? maxSnipeTaxBps : input.snipeTaxBps;

  let quoteSpent = input.creditedQuoteIn;
  let baseFee = bpsAmount(quoteSpent, input.feeBps);
  let creatorTax = bpsAmount(quoteSpent, input.creatorTaxBps);
  let snipeTax = bpsAmount(quoteSpent, appliedSnipeTaxBps);
  let netQuoteIntoCurve = checkedSub4(
    quoteSpent, baseFee, creatorTax, snipeTax, 'PONS_V2_QUOTE_FEE_EXCEEDS_INPUT'
  );

  let tokensOut = curveAmountOut(netQuoteIntoCurve, input.quoteReserve, input.tokenReserve, 0n);
  let partialFill = false;

  if (tokensOut > input.sellableTokens) {
    partialFill = true;
    tokensOut = input.sellableTokens;

    const netRequired = curveAmountIn(input.sellableTokens, input.quoteReserve, input.tokenReserve, 0n);
    const grossDenominatorBps =
      PONS_V2_QUOTE_BASIS_POINTS - input.feeBps - input.creatorTaxBps - appliedSnipeTaxBps;
    if (grossDenominatorBps <= 0n) throw new Error('PONS_V2_QUOTE_FEE_DOMAIN_INVALID');

    // Deployed buy() uses OpenZeppelin Math.mulDiv(..., Ceil) here, so the
    // intermediate product is full-precision rather than uint256-overflowing.
    const grossRequired = mulDivCeilFullPrecision(
      netRequired, PONS_V2_QUOTE_BASIS_POINTS, grossDenominatorBps
    );
    quoteSpent = grossRequired < input.creditedQuoteIn ? grossRequired : input.creditedQuoteIn;

    baseFee = bpsAmount(quoteSpent, input.feeBps);
    creatorTax = bpsAmount(quoteSpent, input.creatorTaxBps);
    snipeTax = bpsAmount(quoteSpent, appliedSnipeTaxBps);
    netQuoteIntoCurve = checkedSub4(
      quoteSpent, baseFee, creatorTax, snipeTax, 'PONS_V2_QUOTE_FEE_EXCEEDS_INPUT'
    );
  }

  return {
    policyVersion: PONS_V2_CURVE_QUOTE_SEMANTICS_R1,
    creditedQuoteIn: input.creditedQuoteIn,
    quoteSpent,
    quoteRefund: input.creditedQuoteIn - quoteSpent,
    tokensOut,
    baseFee,
    creatorTax,
    snipeTax,
    appliedSnipeTaxBps,
    netQuoteIntoCurve,
    partialFill
  };
}

/** Independent same-state recovery diagnostic. This is not sequential paper PnL. */
export function quotePonsV2CurveReverse(input: PonsV2CurveReverseQuoteInput): PonsV2CurveReverseQuote {
  assertUint256('tokensIn', input.tokensIn);
  assertUint256('quoteReserve', input.quoteReserve);
  assertUint256('tokenReserve', input.tokenReserve);
  assertUint256('feeBps', input.feeBps);
  assertUint256('creatorTaxBps', input.creatorTaxBps);
  if (input.tokensIn === 0n) throw new Error('PONS_V2_QUOTE_ZERO_INPUT');
  if (input.quoteReserve === 0n || input.tokenReserve === 0n) {
    throw new Error('PONS_V2_QUOTE_INSUFFICIENT_LIQUIDITY');
  }
  assertTradeFeeDomain(input.feeBps, input.creatorTaxBps);

  const grossQuoteOut = curveAmountOut(input.tokensIn, input.tokenReserve, input.quoteReserve, 0n);
  const baseFee = bpsAmount(grossQuoteOut, input.feeBps);
  const creatorTax = bpsAmount(grossQuoteOut, input.creatorTaxBps);
  const quoteOut = checkedSub3(grossQuoteOut, baseFee, creatorTax, 'PONS_V2_QUOTE_FEE_EXCEEDS_OUTPUT');

  return {
    policyVersion: PONS_V2_CURVE_QUOTE_SEMANTICS_R1,
    tokensIn: input.tokensIn,
    grossQuoteOut,
    baseFee,
    creatorTax,
    quoteOut
  };
}

function assertEntryState(input: PonsV2CurveEntryQuoteInput): void {
  assertUint256('quoteReserve', input.quoteReserve);
  assertUint256('tokenReserve', input.tokenReserve);
  assertUint256('sellableTokens', input.sellableTokens);
  assertUint256('feeBps', input.feeBps);
  assertUint256('creatorTaxBps', input.creatorTaxBps);
  if (input.quoteReserve === 0n || input.tokenReserve === 0n) {
    throw new Error('PONS_V2_QUOTE_INSUFFICIENT_LIQUIDITY');
  }
  if (input.sellableTokens > input.tokenReserve) throw new Error('PONS_V2_QUOTE_SELLABLE_EXCEEDS_RESERVE');
  assertTradeFeeDomain(input.feeBps, input.creatorTaxBps);
}

function assertTradeFeeDomain(feeBps: bigint, creatorTaxBps: bigint): void {
  if (feeBps > PONS_V2_QUOTE_BASIS_POINTS || creatorTaxBps > PONS_V2_QUOTE_BASIS_POINTS) {
    throw new Error('PONS_V2_QUOTE_FEE_DOMAIN_INVALID');
  }
  if (feeBps + creatorTaxBps > PONS_V2_QUOTE_BASIS_POINTS - PONS_V2_MIN_BUY_NET_BPS) {
    throw new Error('PONS_V2_QUOTE_FEE_DOMAIN_INVALID');
  }
}

function bpsAmount(amount: bigint, bps: bigint): bigint {
  return checkedMul(amount, bps, 'PONS_V2_QUOTE_UINT256_OVERFLOW') / PONS_V2_QUOTE_BASIS_POINTS;
}

function curveAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint): bigint {
  if (amountIn === 0n) throw new Error('PONS_V2_QUOTE_ZERO_INPUT');
  if (reserveIn === 0n || reserveOut === 0n || feeBps >= PONS_V2_QUOTE_BASIS_POINTS) {
    throw new Error('PONS_V2_QUOTE_INSUFFICIENT_LIQUIDITY');
  }
  const amountInWithFee = checkedMul(
    amountIn, PONS_V2_QUOTE_BASIS_POINTS - feeBps, 'PONS_V2_QUOTE_UINT256_OVERFLOW'
  );
  const numerator = checkedMul(amountInWithFee, reserveOut, 'PONS_V2_QUOTE_UINT256_OVERFLOW');
  const denominator = checkedAdd(
    checkedMul(reserveIn, PONS_V2_QUOTE_BASIS_POINTS, 'PONS_V2_QUOTE_UINT256_OVERFLOW'),
    amountInWithFee,
    'PONS_V2_QUOTE_UINT256_OVERFLOW'
  );
  const amountOut = numerator / denominator;
  if (amountOut === 0n) throw new Error('PONS_V2_QUOTE_ZERO_OUTPUT');
  return amountOut;
}

function curveAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint, feeBps: bigint): bigint {
  if (amountOut === 0n) throw new Error('PONS_V2_QUOTE_ZERO_OUTPUT');
  if (reserveIn === 0n || reserveOut <= amountOut || feeBps >= PONS_V2_QUOTE_BASIS_POINTS) {
    throw new Error('PONS_V2_QUOTE_INSUFFICIENT_LIQUIDITY');
  }
  // Deployed PonsV2BondingCurveMath.getAmountIn uses ordinary Solidity
  // multiplication here, so these intermediates intentionally retain uint256
  // overflow checks. Full-precision Math.mulDiv happens only in buy() gross-up.
  const numerator = checkedMul(
    checkedMul(amountOut, reserveIn, 'PONS_V2_QUOTE_UINT256_OVERFLOW'),
    PONS_V2_QUOTE_BASIS_POINTS,
    'PONS_V2_QUOTE_UINT256_OVERFLOW'
  );
  const denominator = checkedMul(
    reserveOut - amountOut,
    PONS_V2_QUOTE_BASIS_POINTS - feeBps,
    'PONS_V2_QUOTE_UINT256_OVERFLOW'
  );
  const amountIn = checkedAdd(numerator / denominator, 1n, 'PONS_V2_QUOTE_UINT256_OVERFLOW');
  return amountIn;
}

function mulDivCeilFullPrecision(x: bigint, y: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('PONS_V2_QUOTE_DIVISION_BY_ZERO');
  const product = x * y;
  const result = product / denominator + (product % denominator === 0n ? 0n : 1n);
  assertUint256('mulDivCeil', result);
  return result;
}

function checkedMul(a: bigint, b: bigint, code: string): bigint {
  const result = a * b;
  if (result > PONS_V2_MAX_UINT256) throw new Error(code);
  return result;
}

function checkedAdd(a: bigint, b: bigint, code: string): bigint {
  const result = a + b;
  if (result > PONS_V2_MAX_UINT256) throw new Error(code);
  return result;
}

function checkedSub3(a: bigint, b: bigint, c: bigint, code: string): bigint {
  const result = a - b - c;
  if (result < 0n) throw new Error(code);
  return result;
}

function checkedSub4(a: bigint, b: bigint, c: bigint, d: bigint, code: string): bigint {
  const result = a - b - c - d;
  if (result < 0n) throw new Error(code);
  return result;
}

function assertUint256(label: string, value: bigint): void {
  if (typeof value !== 'bigint' || value < 0n || value > PONS_V2_MAX_UINT256) {
    throw new Error('PONS_V2_QUOTE_UINT256_INVALID:' + label);
  }
}
