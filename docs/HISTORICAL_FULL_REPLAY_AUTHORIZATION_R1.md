# HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1

## Status

`DECISION OPEN / FULL 147 REPLAY NOT AUTHORIZED`

This is a governance-only successor to the closed `HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1` phase. It decides whether the bounded historical replay of all 147 recorded launches may be opened as a separate implementation phase.

This phase does **not** run the replay.

## Decision question

May the repository open a separate research-only implementation phase that replays the frozen 147 historical launches using only the already-reviewed historical baseline and historical outcome mechanics?

## Frozen predecessor evidence

The decision is based on exact predecessor closure head:

`28e598d738c633b0211bae914b8f92450ae61f90`

Predecessor verdict:

`HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS`

Exact-head verification at closure:

- ordinary CI run `34908787242`: `SUCCESS`
- historical baseline regression run `34908787280`: `SUCCESS`
- historical outcome regression run `34908787225`: `SUCCESS`
- all-horizon compatibility run `34908787293`: `SUCCESS`
- representative historical baselines: `9/9 COMPLETE`
- representative horizon outcomes: `45/45 COMPLETE`
- representative horizon outcomes UNVERIFIED: `0`
- launch-producing implementation cohorts represented: `9/9`
- frozen historical launch count: `147`

## Frozen replay contract if authorized

Authorization may cover only a later, separate `HISTORICAL_FULL_REPLAY_R1` implementation using:

- the frozen 147-launch historical set already identified by reviewed discovery;
- `HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1` without semantic modification;
- `HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1` without semantic modification;
- the canonical frozen horizons `1m / 5m / 30m / 2h / 24h`;
- point-in-time inputs only;
- the existing canonical first-block-at-or-after-target horizon algorithm;
- the existing launch/decision hash, reorg, authority, minimal-block, market, and executable-quote checks;
- exact-observed-block RedStone historical WETH valuation and nominal USDT0 valuation;
- fail-closed handling where provider or transport failure is not economic evidence.

No new pricing algorithm, oracle freshness cutoff, retrospective off-chain substitute, notional shrink, or second outcome algorithm may be introduced under this authorization.

## AUTHORIZE criteria

The decision may be `AUTHORIZE` only if all of the following remain true:

- the predecessor exact closure head and verdict are unchanged;
- all four predecessor exact-head verification workflows are green;
- the representative gate remains `9/9 baseline COMPLETE` and `45/45 outcome COMPLETE / 0 UNVERIFIED`;
- all nine historical launch-producing implementation cohorts are represented by the reviewed fixture;
- the full replay scope is exactly the frozen 147 historical launches, not a revised post-hoc cohort;
- the replay is research-only and point-in-time;
- replay implementation may not alter current R3/default behavior;
- any launch/horizon that cannot be reconstructed under the frozen policy must be emitted as explicit failure/UNVERIFIED rather than repaired post hoc;
- replay evidence must retain per-launch/per-horizon receipts sufficient to audit policy version, block/hash/timestamp, authority, valuation source, and failure classification;
- FAST_VET, canary, signing, transaction construction, transaction broadcast, and merge remain separately unauthorized.

## REJECT criteria

The decision must be `REJECT` if any prerequisite evidence is stale or inconsistent, if the 147-launch set cannot be frozen unambiguously, if the replay requires changing reviewed historical semantics, or if authorization would implicitly widen current/live execution authority.

## Scientific boundary

Representative 45/45 compatibility is evidence that the reviewed historical mechanics are portable across the nine known implementation cohorts and five frozen horizons. It is **not** evidence that the full 147 replay will be 100% COMPLETE.

The point of a full replay, if authorized, is to measure the complete historical cohort under frozen rules. Failures in that later replay are results to classify, not reasons to mutate the policy.

## Authority boundary

Current state:

- full 147 replay: `NOT AUTHORIZED`
- FAST_VET: `NOT AUTHORIZED`
- canary: `NOT AUTHORIZED`
- signing/execution: `NOT AUTHORIZED`
- merge: `NOT AUTHORIZED`

An `AUTHORIZE` decision may flip only the research-only full-147-replay authorization bit and may only open a separate `HISTORICAL_FULL_REPLAY_R1` implementation phase. It does not itself execute the replay and does not authorize any live trading capability.

## Completion policy

`PREREGISTER DECISION -> VERIFY PREDECESSOR EVIDENCE -> ONE independent hostile review -> fix Critical/High -> ONE targeted re-review only if needed -> AUTHORIZE or REJECT -> CLOSE -> MOVE FORWARD`

No review loops. Do not reopen closed predecessor review cycles absent evidence that invalidates their recorded receipts or frozen invariants.
