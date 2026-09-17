# HISTORICAL_FULL_REPLAY_R1

## Status

`STAGE A FROZEN + VERIFIED / STAGE B 147×5 REPLAY NEXT / ECONOMIC REPLAY NOT YET RUN`

This phase is the separately authorized research-only successor to `HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1`. It will replay the frozen historical cohort only after an exact historical authority map is frozen. It does not broaden current R3 or live execution authority.

## Authorization basis

Authorization predecessor: PR #22, exact closure head:

`efade9f625aeffc3f6e88494e13ac058c9ffb1ae`

All five exact-head predecessor workflows were `SUCCESS`:

- CI `34914934591`
- historical baseline `34914934649`
- historical outcome `34914934625`
- all-horizon compatibility `34914934604`
- full-replay authorization / frozen-scope verifier `34914934640`

The bounded hostile-review gate is closed. Only the research `full_147_replay` authority is open. FAST_VET, canary, signing, transaction construction, transaction broadcast, live execution, and merge remain unauthorized.

## Frozen replay scope

The population is the already-committed canonical manifest:

- launches: exactly `147`
- first launch block: `39943476`
- final launch block: `49271598`
- launch identity SHA-256: `b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211`

No launch may be added, removed, substituted, or silently skipped.

## Frozen scientific contract

Baseline policy:

`HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1`

Outcome policy:

`HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1`

Decision point remains launch block + 2. Baseline notionals remain exactly `$0.25 / $0.50 / $1 / $2 / $5`.

Horizons remain exactly:

`1m / 5m / 30m / 2h / 24h`

Inputs remain point-in-time. Historical RedStone valuation and all existing authority, reorg, minimal-block, market, quote, and evidence-digest rules remain unchanged.

## Stage A — freeze the 147-row historical authority map

The frozen launch manifest identifies the 147 launches but does not itself encode the historical Sentry implementation active for each launch. The reviewed compatibility evidence already established nine chronological launch-producing implementation cohorts and their launch counts:

`2 / 5 / 22 / 29 / 4 / 22 / 2 / 2 / 59`

These sum to exactly `147`.

Stage A must:

1. load the frozen launch manifest in canonical ordinal order;
2. partition that order using the reviewed nine cohort counts;
3. verify the start of every partition against the reviewed first-launch representative for that implementation cohort;
4. assign every launch ordinal exactly once to one reviewed implementation;
5. emit a deterministic 147-row authority-map fixture;
6. compute and pin a canonical SHA-256 for the map;
7. fail closed if any count, boundary identity, ordering, or uniqueness invariant disagrees.

Expected cohort start ordinals are:

`1 / 3 / 8 / 30 / 59 / 63 / 85 / 87 / 89`

Do **not** infer authority from approximate block ranges. A boundary mismatch is a STOP, not permission to guess.

Stage A is now frozen and verified. Authority-map discovery run `34917993958` produced exactly 147 rows across the nine reviewed cohorts. Artifact `10376329939` has GitHub artifact digest `sha256:64ff2b9915cd0c449ac4edca8da96dfae773bd0de49e3225eac6720a1ac619c1`. The canonical authority-map digest is `c5346e572255385acd1744552633d5ad533d86d3821a8d857a432471e6022275`. Stage B is eligible only while the committed fixture re-generates to this exact digest and row set.

## Stage B — execute the frozen 147 × 5 replay

After Stage A passes, reuse the already-reviewed baseline and outcome pipelines used by `historicalAllHorizonCompatibilityCli.ts`; do not create a second economic algorithm.

The replay must produce:

- exactly `147` launch/baseline receipts;
- exactly `735` launch × horizon cells;
- explicit COMPLETE/UNVERIFIED status and reason for every attempted scientific result;
- enough identity/policy/authority evidence to bind every row back to the frozen scope and historical implementation map.

### PASS semantics

`HISTORICAL_FULL_REPLAY_R1` is an accounting/invariant gate, not a demand that history manufacture successful liquidity.

Phase PASS requires:

- all 147 frozen launches accounted for;
- all 735 frozen horizon cells accounted for;
- frozen scope/policy/authority invariants preserved;
- no silent omissions;
- UNVERIFIED results retained explicitly;
- no post-hoc policy mutation.

It does **not** require all 147 baselines or all 735 outcomes to be economically `COMPLETE`.

A genuine historical inability to price/quote/execute under the frozen policy is evidence. A provider or transport failure is a separate limitation and is never market evidence.

## Prohibitions

- no replay before Stage A authority-map verification;
- no policy fitting after seeing full-cohort results;
- no shrinking notionals;
- no alternate baseline/outcome implementation;
- no retrospective off-chain price substitution;
- no conversion of transport failures into market outcomes;
- no current-R3 behavior change;
- no meaningful FAST_VET;
- no canary;
- no signing, transaction construction, transaction broadcast, or live execution;
- no merge without explicit user authority.

## Completion policy

`PREREGISTER -> STAGE A AUTHORITY MAP -> VERIFY -> STAGE B 147x5 REPLAY -> VERIFY -> ONE independent hostile review -> fix Critical/High -> ONE targeted re-review only if needed -> CLOSE -> MOVE FORWARD`

No review loops.
