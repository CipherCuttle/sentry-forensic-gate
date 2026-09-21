# PONS S0 Research Export V1

## Status

`SHADOW_ONLY / EDGE_UNPROVEN`

This contract is the PR-A implementation bridge from SENTRY evidence into
QntyLab research. It grants no live-money, signing, broadcast, model-promotion,
or merge authority.

## Purpose

Export two physically separate deterministic streams:

1. `PONS_S0_FEATURE_PACKET_V1` — information admissible at the frozen
   decision point.
2. `PONS_S0_OUTCOME_PACKET_V1` — post-outcome evidence that is explicitly
   forbidden as model input.

The streams are content-addressed by `PONS_S0_EXPORT_MANIFEST_V1`.

## Feature packet

The feature packet is Pons/Robinhood-specific and contains only already-proven
SENTRY evidence:

- canonical launch identity and Pons launch configuration;
- frozen portable baseline identity and decision block/hash;
- all five frozen bidirectional probe rungs;
- Pons curve reserves / tracked quote / sellable tokens;
- fee / creator-tax / snipe-tax terms;
- entry/reverse executability and quote amounts;
- creator-history summary available at the decision point;
- deterministic C0 / R0 / R1 shadow-policy receipts;
- diagnostic provenance edges whose observation block is no later than the
  decision block;
- local capture timing fields, explicitly labeled as
  `LOCAL_CAPTURE_WALL_CLOCK_NOT_CHAIN_TIMESTAMP`;
- execution-persona treatment for the canonical Pons shadow recipient.

The packet contains no future outcome for the target launch.

### Point-in-time fail-closed rules

Export fails if:

- launch/baseline identity is not Robinhood/Pons;
- a baseline entry/reverse quote is not bound to the exact decision block/hash;
- creator evidence is not bound to the exact creator, baseline and decision
  block/hash;
- a selected provenance edge is observed after the decision block;
- the Pons quote/launch source-authority schema is not the reviewed version.

## Capacity semantics

`capacityUsdMicros` remains source-compatible but its meaning is now explicitly
frozen as:

`INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL`

It is the largest contiguous same-state bidirectionally executable probe rung.

It is **not**:

- sequential BUY -> new state -> SELL capacity;
- position sizing;
- live-money authority;
- a promise of fill quality.

The same semantics are exposed in FAST_VET R1 configuration and S0 feature
packets.

## Execution persona

The research quote persona is the frozen Pons shadow recipient.

The export binds:

- recipient address;
- observed snipe-tax treatment;
- the adapter invariants that the recipient has no code and is not
  snipe-tax-exempt.

Its parity status is deliberately:

`SHADOW_RECIPIENT_BOUND_LIVE_WALLET_UNVERIFIED`

A future live strategy may not claim research/live parity merely because the
model passed on the shadow persona. Live wallet treatment must be separately
verified.

## Outcome packet

Outcome packets contain:

- frozen horizon;
- exact observed block/hash and timestamps;
- executable exit state/value;
- executable return;
- liquidity state;
- classification;
- outcome authority digests;
- optional cost-aware projection.

Outcome packets are marked:

`forbiddenAsFeatureInput: true`

## Net-cost projection

PR-A does not infer complete costs from gas estimates.

A net projection becomes `COMPLETE` only when the caller supplies separately
evidenced:

`PONS_S0_FULL_EXECUTION_COST_V1`, whose canonical evidence binds:

- launch id;
- baseline id;
- outcome horizon;
- entry transaction cost;
- approval transaction costs;
- exit transaction cost;
- recovery transaction costs;
- other execution costs;
- derived total and SHA-256 evidence digest.

The projection semantics are:

`gross executable value - verified full execution-path cost`

Without that bound evidence, the packet reports
`UNVERIFIED_EXECUTION_COST`. A cost receipt for another launch, baseline or
horizon is rejected rather than reused.

This prevents an exit-only gas estimate or partial fee estimate from silently
becoming strategy net P&L.

## Manifest / serialization

`buildPonsS0ResearchExportBundle`:

- sorts packets deterministically;
- refuses duplicate launch feature packets;
- refuses duplicate launch/baseline/horizon outcome packets;
- serializes each stream as canonical JSON Lines;
- SHA-256 hashes the raw UTF-8 JSONL streams;
- binds packet evidence digests into the manifest.

The canonical evidence authority remains the packet JSON/JSONL and manifest.
Parquet/DuckDB materializations in QntyLab are derived caches only.

## Deliberate non-goals

PR-A does not add:

- model training;
- scikit-learn;
- DuckDB / Polars;
- a feature store;
- a shared database;
- a new experiment ledger;
- model serialization;
- strategy inference;
- wallet/signing/broadcast code;
- live candidate selection.

Those belong to later, separately authorized stages.

## Verification

Canonical check:

```bash
pnpm build
pnpm fastvetr1check
pnpm ponss0exportcheck
```

The full repository `pnpm test` also includes the S0 export check.
