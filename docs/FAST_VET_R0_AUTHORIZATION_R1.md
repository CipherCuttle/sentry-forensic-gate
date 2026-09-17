# FAST_VET_R0_AUTHORIZATION_R1

## Status

`CLOSED / AUTHORIZE_SMOKE / ONLY fast_vet_smoke=true`

This authorization phase is closed. It authorizes one separate **research-only historical FAST_VET_R0 smoke implementation** against the repaired 147-launch historical replay. It does not authorize general FAST_VET, OSINT, canary, signing, transaction construction, transaction broadcast, live execution, or merge.

## Frozen predecessor

`HISTORICAL_FULL_REPLAY_R1` is closed PASS on `75588056de53b94f92b5cf3b40e89e2b5521031a`.

Pinned replay evidence:

- run `35001582697`
- artifact `10410898359`
- artifact digest `sha256:ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a`
- aggregate receipt SHA-256 `916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825`
- 147/147 COMPLETE baselines
- 735/735 COMPLETE outcomes
- zero UNVERIFIED

The authorization workflow independently downloads and verifies this run/artifact/receipt rather than trusting packet constants.

## Frozen smoke rule

The rule is frozen from pre-existing PR #13 exact head `22fcce4c301e791a59c68b19b198bd1bea104138`, exact-head CI `34772418456` SUCCESS. The normalized fixture is `fixtures/fast-vet-r0-authorization-r1.json`, Git blob SHA-1 `a3266ab0bc2e1e1aaec26fafda64ae6be164c494`.

The authorization workflow fetches and verifies all six pinned direct/transitive source blobs and checks normalized decision/shadow semantics against those source bytes.

Frozen semantics remain:

- `$1` primary notional;
- `PASS / REJECT / UNKNOWN`;
- `UNKNOWN -> SKIP`;
- explicit non-executable entry or independent reverse => REJECT;
- known prior creator `CATASTROPHIC_LOSS`, `EXIT_FAILURE`, or `LIQUIDITY_COLLAPSE` => REJECT;
- missing/incomplete evidence remains UNKNOWN;
- exact 24h outcome target;
- COMPLETE-baseline control denominator;
- candidate exposure is PASS only;
- same-state independent reverse remains a sellability diagnostic, not sequential PnL;
- no recovery-BPS threshold;
- receipt status `SMOKE_ONLY`, strategy `EDGE_UNPROVEN`;
- no sample-adequacy, probability, p-value, ML, tuned-threshold, or promotion claim.

## Review closure

Initial Codex hostile review `5216435120` on `b2d21a3e45db0b344f5c5ffcfe8caf4c0f6319d7` found two P1s:

1. `4020758274` — bind predecessor replay provenance to the actual GitHub run/artifact/receipt bytes;
2. `4020758282` — prove normalized FAST_VET semantics match the fetched pre-existing source.

Both were repaired and resolved. Exact repair head `c54c58b75e34ff390e0bf7f541b155d93de1a93d` passed generic CI `35041509635` and dedicated authorization gate `35041509630`.

The single targeted Codex re-review request is `5690352056`. Bot-authored result `5690369864` reviewed `c54c58b75e` and reported **no major issues**. The bounded review loop is exhausted; no further authorization review is permitted.

## Historical adapter boundary

The implementation successor may consume only the repaired historical replay aggregate. It may adapt shape, not semantics. It must preserve historical source-policy identity, point-in-time creator history, classifications, executable values, `$1`, exact 24h target, `UNKNOWN -> SKIP`, and COMPLETE-baseline denominators.

The old PR #13 SQLite runner is not authority for this historical run.

## Authority after closure

Only:

`fast_vet_smoke=true`

Remain false:

`historical_full_replay / fast_vet / fast_vet_osint / canary / signing / transaction_construction / transaction_broadcast / live_execution / merge`

A smoke result cannot promote itself to canary or live authority.

## Next action

Open `FAST_VET_R0_HISTORICAL_SMOKE_R1` as a separate implementation phase. Do not execute it inside this authorization PR. Do not merge without explicit user authority.
