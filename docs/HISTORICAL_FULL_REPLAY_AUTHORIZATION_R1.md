# HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1

## Status

`DECISION OPEN / 147-LAUNCH SCOPE FROZEN / LIVE REVERIFY PENDING / FULL REPLAY NOT AUTHORIZED`

This is a governance-only successor to the closed `HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1` phase. It decides whether a bounded research-only replay of all 147 historical launches may be opened as a separate implementation phase. **This phase does not run the replay.**

## Frozen predecessor evidence

Decision basis: exact predecessor closure head `28e598d738c633b0211bae914b8f92450ae61f90`, verdict `HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS`. Exact-head closure runs: CI `34908787242`, baseline `34908787280`, outcome `34908787225`, all-horizon `34908787293` — all `SUCCESS`. Representative evidence remains `9/9` baselines COMPLETE and `45/45` horizon outcomes COMPLETE with `0` UNVERIFIED across all nine historical implementation cohorts.

## Frozen 147-launch scope

Scope-only discovery run `34910384086` recovered exactly `147` unique canonical deployment identities between blocks `39943476` and `49271598`. Artifact `10374237897` has GitHub artifact digest `sha256:d63713918a90f018badf2e583a2b8230355a9dc21b0fc94499d675cf9919e296`.

The frozen launch-identity digest is:

`b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211`

The canonical 147-row manifest is stored losslessly as deterministic gzip+base64 split across five repository chunks and indexed by `fixtures/historical-full-replay-scope-r1.json`. This is a storage representation only. The uncompressed payload SHA-256 is `c8188726b28e72a72ffc5c8233a416c2fb531d2e6e3229f8906969d9dc1609a0`; the deterministic gzip SHA-256 is `72a2b881c88ed1219b35406b129e5ea58968b0466cafcbe10a4a42468cd85813`. The validator decodes the chunks, verifies both hashes, parses all 147 identities, recomputes the identity digest, and fails closed on any mismatch.

The scope is now frozen but is **not yet authorization evidence by itself**. A fresh live chain-log discovery on the committed fixture must reproduce the exact 147 identities and digest.

## Frozen replay contract if later authorized

A later `HISTORICAL_FULL_REPLAY_R1` may use only the committed 147-launch scope, `HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1`, `HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1`, and horizons `1m / 5m / 30m / 2h / 24h`. Inputs remain point-in-time. Existing authority/reorg/minimal-block/market/quote checks and exact-observed-block RedStone WETH valuation remain unchanged. Provider or transport failure is never market evidence.

No new pricing algorithm, freshness cutoff, retrospective off-chain substitute, notional shrink, or alternate baseline/outcome implementation is authorized. Full-cohort failures or UNVERIFIED cells are results to retain, not reasons to mutate the policy.

## Decision boundary

`AUTHORIZE` is legal only after the committed scope receives a fresh exact-match live verification and one bounded hostile review closes without unresolved Critical/High findings. Authorization may flip only the research-only `full_147_replay` bit and may only open a separate implementation phase.

Current authority remains:

- full 147 replay: `NOT AUTHORIZED`
- FAST_VET: `NOT AUTHORIZED`
- canary: `NOT AUTHORIZED`
- signing/execution: `NOT AUTHORIZED`
- merge: `NOT AUTHORIZED`

## Completion policy

`PREREGISTER DECISION -> FREEZE 147-LAUNCH SCOPE -> LIVE REVERIFY FROZEN SCOPE -> ONE independent hostile review -> fix Critical/High -> ONE targeted re-review only if needed -> AUTHORIZE or REJECT -> CLOSE -> MOVE FORWARD`
