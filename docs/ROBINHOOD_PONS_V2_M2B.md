# Robinhood / Pons V2 — M2B Decision-Block Market State

## Objective

Resolve which Pons V2 market state actually exists at the frozen decision block without pretending the protocol is structurally equivalent to Ink/Tsunami.

Scientific state remains:

`EDGE_UNPROVEN`

M2B is read-only and shadow-only. It adds no wallet, signer, transaction construction, approval, BUY/SELL, bridge, or live-money authority.

## Phase semantics

Pons V2 graduation is explicitly multi-phase:

- `NotGraduated`: the per-launch bonding curve is the trading venue;
- `Swept`: curve reserves have been drained and trading is halted, but the V4 pool does not yet exist;
- `PoolCreated`: the graduated Uniswap V4 pool exists;
- `Rescued`: terminal rescue after the V4 seed path became impossible.

There is also a persistent transition case while the factory still reports `NotGraduated`: the curve can be `readyToGraduate()` after its sellable allocation is exhausted. Pons' own curve refuses both buys and sells in that state. M2B therefore treats it as non-executable rather than calling it an active curve.

The normalized states are:

```
CURVE_ACTIVE
CURVE_HALTED_READY
SWEPT_PENDING_V4
V4_POOL_PENDING_ADAPTER
RESCUED_TERMINAL
```

Only `CURVE_ACTIVE` produces a `NormalizedMarket` in this slice.

## Authority

The resolver consumes the same explicit `PonsV2Authority` as M2A and reuses the M2A authority guard. At the decision block it:

1. verifies Robinhood chain ID and the pinned Pons factory runtime-code hash;
2. reads the canonical factory launch record;
3. cross-checks immutable launch identity against the M2A source-authority envelope;
4. reads curve state only for `NotGraduated`;
5. checks curve bytecode for an active/ready curve;
6. re-reads the decision-block hash after all evidence reads;
7. re-verifies factory authority.

A moving decision block or contradictory factory/curve phase fails closed.

## Deliberate quote boundary

M2B does **not** implement executable curve quotes yet.

Current repository source describes deterministic constant-product buy/sell math, but source inspection also exposed an anti-snipe integration mismatch between currently fetched repository files. Exact pricing evidence must be bound to the verified deployed runtime/source before it becomes a baseline authority.

Accordingly:

- `CURVE_ACTIVE` is resolved but not yet quoted;
- `CURVE_HALTED_READY` is non-executable;
- `SWEPT_PENDING_V4` is non-executable;
- `V4_POOL_PENDING_ADAPTER` awaits a reviewed V4 market adapter;
- `RESCUED_TERMINAL` is terminal/non-executable.

No fallback venue is inferred.

## Next

M2C should bind quote semantics to deployed Pons V2 source/runtime, then add exact-input curve entry and independent same-state reverse quotes. V4 quoting remains a separate authority surface if the decision point can occur after `PoolCreated`.
