# Robinhood / Pons V2 — M2H-C Forward Outcome Adapter

## Objective

Implement the chain-specific read-only `ForwardOutcomeAdapter` that M2H-B
deliberately left behind the transport boundary.

This slice reconstructs the real Pons venue at an observed historical block and
supports both of the venues a holder can legitimately face:

- the live Pons V2 bonding curve before graduation;
- the deterministic Uniswap V4 pool after `PoolCreated`.

It remains `SHADOW_ONLY` and grants no live-money authority.

## Frozen Pons V2 outcome authority

The reviewed factory remains the existing Pons V2 factory authority.

The graduated pool hook is pinned to:

`0xE5e702641Ea86F4ae6cC3cDaeD2B886F976Be044`

with reviewed runtime-code hash:

`0xc21b1e6c1b45403e81a581f22ed6d9c747997af1cfdac1b1dc9f4b1d346a10db`

The adapter verifies the runtime code at the observed block and also proves:

- the factory's `memeHook()` equals the pinned hook;
- factory and hook share the reviewed V4 PoolManager;
- the hook points back to the reviewed factory;
- the launch deployer remains the reviewed curve-template authority.

A credentialed RPC endpoint is transport only and cannot replace these checks.

## Observed phase semantics

### CURVE_ACTIVE

The adapter reads the observed curve reserves, real tracked quote, base fee and
creator tax. Token->ETH exit is computed with the same deployed constant-product
sell semantics already reviewed for the decision-block baseline.

The anti-snipe tax is not applied to sells.

### CURVE_HALTED_READY

The curve is ready to graduate and trading is halted, but no successor pool has
yet been proven.

Liquidity is `UNKNOWN` and exit is unavailable. M2H-B therefore records an
`UNVERIFIED` outcome rather than an exit failure.

### SWEPT_PENDING_V4

The curve reserves have been swept into the factory but the V4 pool has not yet
been created.

This is also `UNKNOWN` / `UNVERIFIED`, not an adverse strategy label.

### V4_POOL_ACTIVE

The adapter deterministically reconstructs the Pons V4 PoolKey from the frozen
launch record:

- native ETH as currency0;
- launched token as currency1;
- launch `poolFee`;
- launch `tickSpacing`;
- pinned Pons V2 meme hook.

It derives the PoolId, proves hook registration and StateView liquidity, then
uses the reviewed V4 Quoter exact-input path for token->ETH.

### RESCUED_TERMINAL

The launch has used the delayed graduation rescue path instead of creating a
trading venue. The outcome adapter reports collapsed liquidity and a
non-executable exit.

## Observed-block USD valuation

A successful token exit returns native ETH.

The adapter then quotes that exact ETH amount through the already-reviewed
ETH/USDG V4 authority using `quoteExactInputSingle` at the same observed
block.

USDG has six decimals under the existing `USDG_NOMINAL_USD_PEG_V0`
convention, therefore raw USDG output is the executable USD-micros value.

If the historical ETH->USDG quote is unavailable, M2H-B now records
`UNVERIFIED`; it does not convert missing valuation into a zero-dollar loss.

## Archive boundary

The implementation accepts an injected `PublicClient` / RPC transport.

The existing M2H-A requirement remains unchanged: the real matured Pons
candidate may only be reconstructed once the selected endpoint proves the
required historical contract state. No public latest-state fallback is
permitted.

## Authority

- no signer;
- no wallet;
- no approval;
- no transaction construction;
- no broadcast;
- no Robinhood live authority;
- no Arc live authority;
- existing Ink exact-$1 authority unchanged;
- `FAST_VET_R0` unchanged;
- `EDGE_UNPROVEN`.
