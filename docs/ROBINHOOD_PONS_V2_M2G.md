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


## Split read-only transport

Live probing established two different keyless provider capabilities:

- the BlockReq public route can serve the recent historical state used by the frozen launch/decision baseline, but refuses old epoch logs/state;
- Robinhood's official public RPC is used as the canonical `eth_getLogs` backfill transport.

M2G therefore separates **state reads** from **historical log reads**. This changes no authority or evidence semantics:

- both clients are read-only;
- logs are still filtered by the reviewed factory + exact `TokenLaunched` event + indexed deployer;
- scan boundaries still cover the full reviewed factory epoch through the target;
- target and decision authority/hash fences still use the concrete chain adapters;
- any gap in any log range fails the scan.

Provider identity is transport metadata, not strategy authority.


## Immutable M2F handoff

The live M2F baseline completed successfully before public historical state aged out. M2G now consumes the checked-in immutable FAST_VET evidence projection at:

`evidence/robinhood/pons/m2f-hmn-fast-vet-baseline.json`

The receipt is bound to GitHub Actions run `35294153203`, M2F head `e7ff891…`, baseline ID, authority digest, launch/decision block hashes, and all five FAST_VET leg diagnostics.

M2G does not re-run old market state merely to recover creator history.

## Keyless indexed history source

Robinhood Blockscout's indexed Etherscan-compatible log API is used only for creator launch provenance. The scan:

- uses the reviewed factory address;
- filters exact `TokenLaunched` topic0 + indexed deployer topic3;
- partitions the complete reviewed factory epoch into 1,000,000-block chunks;
- requests up to 1000 matching events per chunk;
- recursively bisects any chunk that reaches the result cap;
- fails on any HTTP/API/parse gap;
- resolves prior block hashes through Blockscout's indexed block endpoint;
- requires the HMN target event exactly once and re-derives its Pons launch/event IDs.

This is an indexed evidence source, not execution authority. The immutable M2F receipt remains the baseline authority.


## Acquisition / evaluation boundary

The Dev Spine correctly rejects direct network escape hatches in research JavaScript/TypeScript. M2G therefore separates acquisition from evaluation:

1. the GitHub Actions workflow acquires raw Blockscout indexed responses into `artifacts/m2g-indexed/`;
2. the research evaluator performs local-only completeness checks, identity derivation, provenance projection, and FAST_VET evaluation.

Every expected 1,000,000-block range must exist. Only the exact Blockscout `OK` response or exact `No logs found` empty response is accepted. A range returning 1000 results fails as truncation risk. Every matching launch requires a separately acquired indexed block record, and HMN must match the immutable M2F launch ID, event ID, and launch block hash.

The raw responses are uploaded with the workflow artifact. No research JS/TS file performs network calls.
