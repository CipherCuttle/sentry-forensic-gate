# Robinhood / Pons V2 — M2G Creator History

## Objective

Eliminate the remaining `FAST_VET_R0` creator-evidence gap without changing FAST_VET or inventing history.

M2G reuses the frozen `CREATOR_OUTCOME_JOIN_V0` projection. It adds only a chain-neutral provenance projection and a Pons-specific canonical-log scanner.

## Authority law

For a target Pons launch, creator history is derived only from:

`TokenLaunched(... indexed deployer ...)`

emitted by the reviewed Pons V2 factory.

The scan covers the complete reviewed factory epoch:

`authority.fromBlock → target launch block`

with the creator/deployer as an indexed event filter.

A zero-prior result becomes `NO_HISTORY` only if:

- the scan starts exactly at the frozen reviewed factory epoch boundary;
- reviewed factory runtime authority holds again at the target and decision blocks;
- target launch block/hash still matches;
- frozen decision block/hash still matches;
- every scan range completes;
- the target event is present exactly once;
- the final decision-block authority/hash fence still holds.

The epoch-start block/code hash are preregistered M2A authority, not re-fetched historical state on every evaluation. This keeps log completeness independent from archive-state retention while still re-proving the pinned runtime at the target and decision points.

Any provider/range/reorg/identity failure escapes. Partial scans never become clean history.

## Frozen join semantics

M2G feeds the resulting target/prior provenance facts into the existing:

`CREATOR_OUTCOME_JOIN_V0`

with no scoring change.

Therefore:

- zero prior canonical Pons launches → `NO_HISTORY`;
- prior launches but no eligible classified 24h outcomes → `UNKNOWN`;
- partial outcome coverage → `PARTIAL`;
- complete coverage → `COMPLETE`.

FAST_VET remains byte-frozen.

## Range handling

The scanner uses bounded 5,000,000-block transport ranges. If a provider reports a range-capacity error, that range is recursively bisected. Rate-limit or unrelated RPC errors are not treated as range-capacity errors and fail the scan.

This is transport behavior only; the evidence universe remains the complete reviewed factory epoch through the target.

## Boundaries

No wallet, signer, approvals, transactions, broadcast, live capital, strategy tuning, creator score, or fabricated outcomes.

`EDGE_UNPROVEN` remains explicit.
