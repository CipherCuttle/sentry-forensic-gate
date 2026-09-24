# Pons speed observer V0 — ONE targeted rereview

2026-09-24 CEST. Parent hostile review: `docs/reviews/PONS_SPEED_OBSERVER_V0_HOSTILE_REVIEW.md`.

## H1 correction
- Original High: downstream adapter-materialization samples were selected by the source that arrived FIRST; provider-specific head availability could bias sample success and latency.
- Exact fix in runner: only the first **HTTP-observed** instance of an event (FIRST or MATCHED) can launch the optional deep read. WS delivery timestamps remain in the independent same-process comparator, never reset by HTTP sampling.
- The offline regression now asserts this exact gating expression in the read-only source and tests same-hash pairing, partial matches, duplicates, fork conflicts, removals, identity errors and capacity limits.
- Precise corrected code head: `f123ddc06d11d3b89609349bddc3401748357df3`; exact-head [read-only offline qualification](https://github.com/CipherCuttle/sentry-forensic-gate/actions/runs/35944206244): **PASS**.

## Constraints reviewed again
- Provider URLs/tokens are never printed by code or loaded from Git; no credential discovery, wallet client, signing, broadcasting, transaction construction, grants or recurring collector.
- Same-process monotonic matched log delivery, not absolute sequencer arrival and not a gas-fee priority experiment.
- HTTP retries keep coverage cursor on failure; overlap prevents header-before-logs timing gaps when the head is unchanged.
- Orphaned-but-not-removed paired logs may exist; no canonical-finality or economic-outcome claim is allowed from this observer.
- Public RPC smoke is an optional **availability** observation. Its build/network status cannot strengthen the separate offline qualification or imply WebSocket superiority. True HTTP/WS comparison requires a genuine private RPC WebSocket endpoint supplied outside this repo.
- The unmerged S1 branches #73–#75 and #76 have incompatible prospectively proposed enrollment rules; no launch data or activation authority is merged by this speed PR.

**Targeted rereview verdict: PASS_OFFLINE_OBSERVER_ONLY. Remaining Critical: 0, High: 0 within this bounded self-review.** No independent external sign-off, live latency superiority, S1 activation, execution-capital authorization, merge or model promotion.
