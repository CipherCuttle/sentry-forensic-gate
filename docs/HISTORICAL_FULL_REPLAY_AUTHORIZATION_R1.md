# HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1

## Status

`CLOSED / AUTHORIZE / 147-LAUNCH SCOPE FROZEN + LIVE VERIFIED / SEPARATE REPLAY IMPLEMENTATION MAY OPEN / REPLAY NOT EXECUTED`

This governance phase authorizes opening a separate research-only `HISTORICAL_FULL_REPLAY_R1` implementation phase. It does **not** execute the replay, change current R3/default behavior, authorize live trading, or authorize merge.

## Frozen predecessor evidence

Decision basis: exact predecessor closure head `28e598d738c633b0211bae914b8f92450ae61f90`, verdict `HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS`. Exact-head closure runs: CI `34908787242`, baseline `34908787280`, outcome `34908787225`, all-horizon `34908787293` — all `SUCCESS`. Representative evidence remains `9/9` baselines COMPLETE and `45/45` horizon outcomes COMPLETE with `0` UNVERIFIED across all nine historical implementation cohorts.

## Frozen 147-launch scope

Scope-only discovery run `34910384086` recovered exactly `147` unique canonical deployment identities between blocks `39943476` and `49271598`. Artifact `10374237897` has GitHub artifact digest `sha256:d63713918a90f018badf2e583a2b8230355a9dc21b0fc94499d675cf9919e296`.

The frozen launch-identity digest is:

`b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211`

The canonical 147-row manifest is stored losslessly as deterministic gzip+base64 split across five repository chunks and indexed by `fixtures/historical-full-replay-scope-r1.json`. The uncompressed payload SHA-256 is `c8188726b28e72a72ffc5c8233a416c2fb531d2e6e3229f8906969d9dc1609a0`; deterministic gzip SHA-256 is `72a2b881c88ed1219b35406b129e5ea58968b0466cafcbe10a4a42468cd85813`. The validator decodes the chunks, verifies both hashes, parses all 147 identities, recomputes the identity digest, and fails closed on any mismatch.

Fresh live verification run `34912185853` completed `SUCCESS`; artifact `10375315812` (`sha256:8eb03c983121261f3c4ed8923bc826f1e02c8f2c79ceecbfe345646059cb870a`) reports `147` observed/unique launches, `fixturePresent=true`, `fixtureMatch=true`, and the same frozen identity digest. Scope status is `FROZEN_VERIFIED`.

## Hostile review closure

The independent hostile Codex review `5204327465` reviewed exact head `be0259b1845787b651ad8ffdad32b693bc2c76ce` and found two P1 governance defects:

1. `4010865142` — the authorization object did not reject unrecognized keys, allowing implicit live/execution authority to be advertised outside the bounded allowlist.
2. `4010865149` — the future `AUTHORIZED` state was not structurally bound to successful hostile-review closure evidence for the reviewed authorization head.

Both were repaired on `e527255949ffd72409284a379cf4428c48aa855f`. That repair head passed all five exact-head gates: CI `34914133647`, historical baseline `34914133681`, historical outcome `34914133633`, all-horizon compatibility `34914133649`, and authorization/scope verification `34914133623`.

The single permitted targeted re-review `5204380099` reviewed that exact repair head and found one remaining P1, `4010914490`: review evidence was checked only by shape rather than pinned to the actual targeted review. The bounded final repair therefore hard-pins targeted review `5204380099` to reviewed head `e527255949ffd72409284a379cf4428c48aa855f` and binds the decision result to those exact values. No third review loop is opened under the bounded completion policy; closure requires exact-head repository verification of this mechanical repair.

## Closed authorization boundary

The authorization keyset is exact and closed. Unrecognized authorization keys fail validation. The only bit enabled by this decision is:

- `full_147_replay=true`

All live or downstream authority remains explicitly false:

- `fast_vet=false`
- `canary=false`
- `signing=false`
- `transaction_construction=false`
- `transaction_broadcast=false`
- `live_execution=false`
- `merge=false`

`historical_authorization_granted=true` means only that a separate research implementation phase may now be opened. It is not transaction, canary, production, or merge authority.

## Frozen replay contract

`HISTORICAL_FULL_REPLAY_R1` may use only the committed 147-launch scope, `HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1`, `HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1`, and horizons `1m / 5m / 30m / 2h / 24h`. Inputs remain point-in-time. Existing authority/reorg/minimal-block/market/quote checks and exact-observed-block RedStone WETH valuation remain unchanged. Provider or transport failure is never market evidence.

No new pricing algorithm, freshness cutoff, retrospective off-chain substitute, notional shrink, or alternate baseline/outcome implementation is authorized. Full-cohort failures or UNVERIFIED cells are evidence to retain, not reasons to mutate policy.

## Decision

`AUTHORIZE`

Basis:

- predecessor closure evidence is intact and green;
- the complete 147-launch population is cryptographically frozen;
- a fresh independent chain scan matched the committed 147 identities exactly;
- the authorization keyset is fail-closed and explicitly denies all live execution capabilities;
- hostile-review evidence is pinned to the actual review IDs and exact reviewed heads;
- the single targeted re-review was used as required and no review loop is extended;
- current R3/default behavior remains unchanged.

Next action: `OPEN_HISTORICAL_FULL_REPLAY_R1_IMPLEMENTATION`.

## Completion policy

`PREREGISTER DECISION -> FREEZE 147-LAUNCH SCOPE -> LIVE REVERIFY FROZEN SCOPE -> ONE independent hostile review -> fix Critical/High -> ONE targeted re-review -> bounded mechanical repair if required -> exact-head VERIFY -> AUTHORIZE -> CLOSE -> MOVE FORWARD`

PR #22 remains unmerged. Merge still requires explicit user authority.
