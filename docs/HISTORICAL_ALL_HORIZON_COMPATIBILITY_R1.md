# HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1

## Status

`IMPLEMENTATION_AUTHORIZED / LIVE 45-CELL GATE NOT YET RUN`

This is a bounded successor to `HISTORICAL_OUTCOME_POLICY_R1`. It does not reopen that phase and does not alter current R3/default behavior.

## Objective

Test whether the already-reviewed historical baseline and historical outcome policies are portable across the complete frozen `FORWARD_OUTCOMES_R1` horizon contract for the same nine reviewed historical implementation representatives.

The frozen horizons are:

- `1m` = `60,000 ms`
- `5m` = `300,000 ms`
- `30m` = `1,800,000 ms`
- `2h` = `7,200,000 ms`
- `24h` = `86,400,000 ms`

Expected outcome cells: `9 representatives × 5 horizons = 45`.

## Frozen mechanics

Reuse without semantic modification:

- `HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1`
- `HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1`
- existing `buildForwardOutcome()` horizon-boundary algorithm
- existing launch/decision hash and reorg checks
- existing predecessor minimality checks
- existing market authority and executable exit quote behavior
- exact-observed-block RedStone ETH/USD valuation for historical WETH outcomes
- nominal USDT0 valuation

The historical baseline is reconstructed once per representative. Each COMPLETE baseline is then evaluated at all five frozen horizons.

## Preregistration

Before live execution, the following are frozen:

- representative fixture: `fixtures/historical-compatibility-r1.json`
- representative count: `9`
- horizon count: `5`
- expected outcome attempts: `45`
- baseline COMPLETE required: `9/9`
- outcome COMPLETE required: `45/45`
- outcome UNVERIFIED required: `0`
- point-in-time inputs only
- provider/transport failure is not economic evidence
- current R3/default behavior remains unchanged
- full 147 replay remains unauthorized
- FAST_VET remains unauthorized
- canary remains unauthorized
- merge remains unauthorized

Observed outcome blocks are deliberately **not preregistered**. They are outputs of the existing first-canonical-block-at-or-after-target algorithm and must be recorded from live evidence rather than hard-coded before discovery.

## Acceptance gate

PASS requires all of the following:

- representatives attempted = `9/9`
- historical baseline COMPLETE = `9/9`
- horizon cells attempted = `45/45`
- outcome COMPLETE = `45`
- outcome UNVERIFIED = `0`
- no provider/transport failure counted as economic evidence
- no authority failure
- no reorg/hash failure
- no horizon-boundary/minimal-block failure
- no current R3/default behavior change
- ordinary repository CI green
- research-only guardrails green

If a horizon exposes a genuine historical incompatibility, stop. Do not broaden the historical policy, fit a new oracle freshness threshold, substitute retrospective off-chain prices, shrink notionals, or create a second outcome algorithm to manufacture 45/45.

## Authorization boundary

A 45/45 PASS may authorize only a successor decision phase named `HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1`.

It does **not** authorize the 147-launch replay itself, FAST_VET, canary, signing, transaction construction, transaction broadcast, or merge.

## Bounded completion

`IMPLEMENT -> TEST -> ONE independent hostile review -> fix Critical/High -> ONE targeted re-review only if Critical/High fixes were needed -> CLOSE -> MOVE FORWARD`

Do not reopen review cycles on `HISTORICAL_BASELINE_POLICY_R1` or `HISTORICAL_OUTCOME_POLICY_R1`.
