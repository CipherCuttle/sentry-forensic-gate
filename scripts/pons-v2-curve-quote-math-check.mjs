import assert from 'node:assert/strict';
import {
  PONS_V2_CURVE_QUOTE_SEMANTICS_R1,
  PONS_V2_DEPLOYED_CURVE_REFERENCE,
  PONS_V2_MAX_UINT256,
  quotePonsV2CurveEntry,
  quotePonsV2CurveReverse
} from '../dist/adapters/robinhood/ponsV2/curveQuoteMath.js';

const initial = {
  quoteReserve: 1_680_000_000_000_000_000n,
  tokenReserve: 1_000_000_000_000_000_000_000_000_000n,
  sellableTokens: 714_285_714_285_714_285_714_285_715n,
  feeBps: 100n,
  creatorTaxBps: 0n
};

const normal = quotePonsV2CurveEntry({
  ...initial,
  creditedQuoteIn: 10_000_000_000_000_000n,
  snipeTaxBps: 0n
});
assert.equal(normal.policyVersion, PONS_V2_CURVE_QUOTE_SEMANTICS_R1);
assert.equal(normal.quoteSpent, 10_000_000_000_000_000n);
assert.equal(normal.quoteRefund, 0n);
assert.equal(normal.baseFee, 100_000_000_000_000n);
assert.equal(normal.creatorTax, 0n);
assert.equal(normal.snipeTax, 0n);
assert.equal(normal.netQuoteIntoCurve, 9_900_000_000_000_000n);
assert.equal(normal.tokensOut, 5_858_334_812_710_811_290_608_911n);
assert.equal(normal.partialFill, false);

const snipe = quotePonsV2CurveEntry({
  ...initial,
  creditedQuoteIn: 10_000_000_000_000_000n,
  snipeTaxBps: 9_900n
});
assert.equal(snipe.appliedSnipeTaxBps, 9_800n);
assert.equal(snipe.baseFee, 100_000_000_000_000n);
assert.equal(snipe.snipeTax, 9_800_000_000_000_000n);
assert.equal(snipe.netQuoteIntoCurve, 100_000_000_000_000n);
assert.equal(snipe.tokensOut, 59_520_266_650_794_595_559_788n);

const partial = quotePonsV2CurveEntry({
  quoteReserve: initial.quoteReserve,
  tokenReserve: initial.tokenReserve,
  sellableTokens: 1_000_000_000_000_000_000_000n,
  feeBps: 100n,
  creatorTaxBps: 200n,
  creditedQuoteIn: 1_000_000_000_000_000_000n,
  snipeTaxBps: 500n
});
assert.equal(partial.partialFill, true);
assert.equal(partial.tokensOut, 1_000_000_000_000_000_000_000n);
assert.equal(partial.quoteSpent, 1_826_088_782_611n);
assert.equal(partial.quoteRefund, 999_998_173_911_217_389n);
assert.equal(partial.baseFee, 18_260_887_826n);
assert.equal(partial.creatorTax, 36_521_775_652n);
assert.equal(partial.snipeTax, 91_304_439_130n);
assert.equal(partial.netQuoteIntoCurve, 1_680_001_680_003n);

const reverse = quotePonsV2CurveReverse({
  tokensIn: normal.tokensOut,
  quoteReserve: initial.quoteReserve,
  tokenReserve: initial.tokenReserve,
  feeBps: 100n,
  creatorTaxBps: 0n
});
assert.equal(reverse.grossQuoteOut, 9_784_680_550_653_018n);
assert.equal(reverse.baseFee, 97_846_805_506_530n);
assert.equal(reverse.creatorTax, 0n);
assert.equal(reverse.quoteOut, 9_686_833_745_146_488n);

assert.throws(
  () => quotePonsV2CurveEntry({ ...initial, creditedQuoteIn: 1n, snipeTaxBps: 0n, sellableTokens: initial.tokenReserve }),
  /PONS_V2_QUOTE_SELLABLE_NOT_BELOW_RESERVE/
);
assert.throws(
  () => quotePonsV2CurveEntry({ ...initial, creditedQuoteIn: 1n, snipeTaxBps: 0n, sellableTokens: 0n }),
  /PONS_V2_QUOTE_CURVE_READY_TO_GRADUATE/
);
assert.throws(
  () => quotePonsV2CurveEntry({ ...initial, creditedQuoteIn: 1n, snipeTaxBps: 0n, feeBps: 2_001n }),
  /PONS_V2_QUOTE_FEE_DOMAIN_INVALID/
);
assert.throws(
  () => quotePonsV2CurveReverse({
    tokensIn: 1n,
    quoteReserve: 0n,
    tokenReserve: initial.tokenReserve,
    feeBps: 100n,
    creatorTaxBps: 0n
  }),
  /PONS_V2_QUOTE_INSUFFICIENT_LIQUIDITY/
);
assert.throws(
  () => quotePonsV2CurveEntry({
    ...initial,
    quoteReserve: PONS_V2_MAX_UINT256,
    creditedQuoteIn: 1n,
    snipeTaxBps: 0n
  }),
  /PONS_V2_QUOTE_UINT256_OVERFLOW/
);

const deployedIntermediateOverflowInput = PONS_V2_MAX_UINT256 / 10_000n + 1n;
assert.throws(
  () => quotePonsV2CurveEntry({
    quoteReserve: 1n,
    tokenReserve: 2n,
    sellableTokens: 1n,
    feeBps: 0n,
    creatorTaxBps: 0n,
    creditedQuoteIn: deployedIntermediateOverflowInput,
    snipeTaxBps: 0n
  }),
  /PONS_V2_QUOTE_UINT256_OVERFLOW/
);
assert.equal(PONS_V2_DEPLOYED_CURVE_REFERENCE.chainId, 4663);
assert.equal(PONS_V2_DEPLOYED_CURVE_REFERENCE.factory, '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e');
assert.equal(PONS_V2_DEPLOYED_CURVE_REFERENCE.launchDeployer, '0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42');
assert.equal(PONS_V2_DEPLOYED_CURVE_REFERENCE.sampleCurve, '0x0f0844B1074DE1070eC9fC42B762d71046B3D5f9');

console.log(JSON.stringify({
  verdict: 'PONS_V2_CURVE_QUOTE_SEMANTICS_PASS',
  policyVersion: PONS_V2_CURVE_QUOTE_SEMANTICS_R1,
  sourceBoundToVerifiedDeployedCurve: true,
  snipeTaxClampCovered: true,
  partialFillCovered: true,
  reverseSameStateCovered: true,
  runtimeAdapterAuthorityRequiredNext: true,
  liveMoneyAuthority: false
}, null, 2));
