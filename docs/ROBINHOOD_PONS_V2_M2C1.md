# Robinhood / Pons V2 — M2C1 Curve Quote Semantics

## Objective

Freeze the exact arithmetic observed in the verified deployed Pons V2 bonding-curve implementation before wiring any RPC quote adapter.

Scientific state remains:

`EDGE_UNPROVEN`

M2C1 is pure arithmetic only. It performs no RPC write, wallet operation, approval, signing, transaction construction, BUY/SELL, bridge, or live-money action.

## Deployed-source authority

The arithmetic is anchored to a verified deployed launch lineage:

- Robinhood Chain `4663`;
- factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`;
- one-time-wired launch deployer `0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42`;
- sample token `0x9cA1cC0c90d97B4F36c5E2232d4fbD705a73c65d`;
- sample curve `0x0f0844B1074DE1070eC9fC42B762d71046B3D5f9`;
- compiler `v0.8.35+commit.47b9dedd`.

The sample token's verified constructor binds it to that curve and factory. The launch deployer's verified constructor binds it permanently to the same factory, and its deployed source constructs curves from `PonsV2BondingCurve.creationCode`.

This is enough to freeze the quote arithmetic in M2C1. It is **not** enough to authorize arbitrary runtime curve evidence: M2C2 must still bind the concrete launch curve to the reviewed factory/deployer epoch.

## Entry semantics

`quotePonsV2CurveEntry()` begins after Pons `_receiveQuote()` has determined the credited quote amount. It mirrors:

1. base fee;
2. creator tax;
3. recipient-specific `currentSnipeTaxBps()`;
4. the deployed snipe-tax clamp that preserves at least 1% net quote;
5. constant-product output;
6. sellable-token clamp;
7. exact-output gross-up for a partial final fill;
8. refund of unspent credited quote.

For native ETH launches, requested input equals credited input.

For ERC-20 quote assets, M2C1 deliberately does **not** assume that equality because the deployed curve credits the observed token balance delta. Fee-on-transfer behavior therefore remains a runtime-adapter authority problem.

## Reverse semantics

`quotePonsV2CurveReverse()` mirrors the deployed sell arithmetic against the same decision-state reserves: token input → gross quote output → base fee + creator tax → net quote output. No snipe tax applies to sells.

This remains `INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL`. It is a sellability/recovery diagnostic, not sequential paper PnL.

## Overflow semantics

Ordinary Solidity 0.8 multiplication/addition in `getAmountOut()` and `getAmountIn()` is reproduced with uint256 overflow checks.

The partial-fill gross-up is different: deployed `buy()` explicitly uses OpenZeppelin `Math.mulDiv(..., Math.Rounding.Ceil)`, so M2C1 uses full-precision BigInt for that operation and validates the final result fits uint256.

## Fixtures

The regression check uses hardcoded expected values for:

- normal buy;
- a requested 99% snipe tax clamped to the deployed minimum-net rule;
- partial final fill + refund;
- independent same-state reverse;
- zero/sparse liquidity;
- invalid fee domain;
- uint256 overflow parity.

## Next

M2C2 should add a read-only runtime quote adapter that:

1. accepts only `CURVE_ACTIVE` from M2B;
2. verifies the reviewed factory/deployer epoch and concrete curve identity;
3. reads frozen-block reserves, fees, sellable tokens, and `currentSnipeTaxBps(recipient)`;
4. uses M2C1 arithmetic;
5. initially treats native-ETH pair assets as exact;
6. fails closed on ERC-20 pair assets until credited-input / outgoing-recovery semantics are proven;
7. emits portable entry and independent-reverse quote receipts.

No strategy tuning is authorized.
