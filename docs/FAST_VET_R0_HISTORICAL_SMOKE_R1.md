# FAST_VET_R0_HISTORICAL_SMOKE_R1

## Status

`IMPLEMENTATION / ONE PINNED HISTORICAL SMOKE AUTHORIZED / EDGE_UNPROVEN`

This phase executes the pre-existing frozen `FAST_VET_R0` rule once against the already-closed repaired 147-launch historical replay. It is a research-only smoke experiment. It does not authorize a canary, wallet, signing, transaction construction, transaction broadcast, live execution, OSINT expansion, rule tuning, or merge.

## Exact predecessor

The implementation starts from `FAST_VET_R0_AUTHORIZATION_R1` closure head:

`eedd320c7745c855d5830133d4686f65b47e57a2`

That phase authorized only `fast_vet_smoke=true`.

## Pinned input

Consume only the repaired `HISTORICAL_FULL_REPLAY_R1` aggregate from:

- run `35001582697`
- artifact `10410898359`
- artifact digest `sha256:ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a`
- aggregate receipt SHA-256 `916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825`

The input must remain exactly 147 COMPLETE baselines and 735 COMPLETE horizon outcomes under `HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1` and `HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1`.

Do not rerun the historical chain replay. Do not substitute a locally reconstructed ledger.

## Frozen rule

The evaluator and shadow metric implementation are reused byte-for-byte from PR #13 head `22fcce4c301e791a59c68b19b198bd1bea104138`. They are not copied into this successor commit: the dedicated workflow fetches the exact source head, materializes the four direct frozen files for that run, verifies all six direct/transitive Git blob identities, then builds and executes them.

The smoke keeps the frozen `$1` primary notional, `PASS / REJECT / UNKNOWN`, `UNKNOWN -> SKIP`, same-state independent reverse sellability diagnostic, prior adverse creator rejection, exact 24h target, COMPLETE-baseline control denominator, and `SMOKE_ONLY / EDGE_UNPROVEN` receipt semantics. No recovery-BPS threshold or post-hoc threshold is introduced.

## Historical shape adapter

The adapter is intentionally narrow:

1. validate the exact replay receipt SHA-256 and frozen 147 × 5 accounting;
2. preserve the historical baseline and outcome policy identities in the outer receipt;
3. convert serialized integer fields back to `bigint` only where the frozen evaluator requires them;
4. reconstruct creator history using earlier rows in the frozen canonical replay order only;
5. count a prior launch's 24h outcome as available at the target decision only when that historical outcome is COMPLETE and its observed block is at or before the target baseline decision block;
6. delegate every FAST_VET decision to the frozen `evaluateFastVet()` implementation;
7. delegate all compressed smoke metrics to the frozen `evaluateFastVetShadow()` implementation.

The frozen shadow evaluator accepts only `FORWARD_OUTCOMES_R1` target objects. For analyzer compatibility only, the adapter projects the already-validated historical 24h target into that input shape without changing its launch/baseline binding, classification, executable value, outcome id, or evidence digest. This compatibility field is **not** evidence authority. The outer receipt retains `HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1` as the actual source policy.

## Scientific boundary

The output answers only whether the frozen cheap filter looks directionally useful on the already-frozen historical cohort. No metric from this phase is a profitability claim, confidence statement, probability estimate, or automatic promotion decision.

The strategy label remains `EDGE_UNPROVEN` regardless of the observed smoke metrics.

## Verification

A valid implementation must:

- exact-match all six pinned frozen source blobs;
- pass the original frozen `fast-vet-check.mjs` regression;
- download and verify the pinned predecessor run/artifact/receipt;
- execute only the local artifact adapter, with no RPC or external data collector;
- emit a deterministic historical smoke receipt with explicit source-policy and projection metadata;
- pass generic repository CI;
- receive exactly one independent hostile review, fixing Critical/High findings and performing one targeted re-review only if such fixes are required.

## Authority

Only `fast_vet_smoke=true`.

`historical_full_replay / fast_vet / fast_vet_osint / canary / signing / transaction_construction / transaction_broadcast / live_execution / merge` remain false.
