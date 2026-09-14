# HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1

## Status

`CLOSED / PASS — 9/9 BASELINES COMPLETE / 45/45 OUTCOMES COMPLETE / 0 UNVERIFIED`

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

Before live execution, the following were frozen:

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

Observed outcome blocks were deliberately **not preregistered**. They remained outputs of the existing first-canonical-block-at-or-after-target algorithm and were recorded from live evidence rather than hard-coded before discovery.

## Acceptance gate

PASS required all of the following:

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

If a horizon exposed a genuine historical incompatibility, the phase was required to stop rather than broaden the historical policy, fit a new oracle freshness threshold, substitute retrospective off-chain prices, shrink notionals, or create a second outcome algorithm to manufacture 45/45.

## Result

The preregistered gate passed on repaired exact implementation head `58ded45899b288f159ef3248365a664896fa0665`:

- representatives attempted: `9/9`
- historical baselines COMPLETE: `9/9`
- historical baselines UNVERIFIED: `0`
- horizon cells attempted: `45/45`
- outcomes COMPLETE: `45`
- outcomes UNVERIFIED: `0`
- results per frozen horizon: `1m=9`, `5m=9`, `30m=9`, `2h=9`, `24h=9`
- all-horizon workflow run: `34901882252` — `SUCCESS`
- evidence artifact: `10370608538`
- artifact digest: `sha256:f1b616164c851f2bb9afa896064fb1c6f1ba8b709ea5a978d61b44c02f61380e`
- ordinary CI run: `34901882036` — `SUCCESS`
- historical outcome predecessor regression run: `34901882028` — `SUCCESS`
- historical baseline predecessor regression run: `34901882212` — initial attempt transport-rate-limited, bounded retry `SUCCESS`

The initial predecessor baseline failure was an Ink public-RPC rate-limit transport error (`Your IP has exceeded its request rate limit`), not economic evidence. The bounded retry passed after the all-horizon RPC workload completed.

## Review closure

The single independent hostile Codex review on `3a1366ccc5f550eb8bd3a779858cf81a168561ff` found one P1: the all-horizon workflow did not trigger for all transitive evidence-critical source changes.

The repair on `58ded45899b288f159ef3248365a664896fa0665` broadened the pull-request trigger to `src/**`. It did not change baseline, outcome, valuation, authority, or current-R3 semantics.

The one allowed targeted Codex re-review examined exact repaired head `58ded45899b288f159ef3248365a664896fa0665` and reported no major issues. The P1 review thread is resolved. No additional review cycle is authorized or required.

## Authorization boundary

This 45/45 PASS authorizes only opening the successor decision phase `HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1`.

It does **not** authorize the 147-launch replay itself, FAST_VET, canary, signing, transaction construction, transaction broadcast, or merge.

## Verdict

`HISTORICAL_ALL_HORIZON_COMPATIBILITY_PASS`

Next action: `OPEN_HISTORICAL_FULL_REPLAY_AUTHORIZATION_R1_DECISION`.

## Bounded completion

`IMPLEMENT -> TEST -> ONE independent hostile review -> fix Critical/High -> ONE targeted re-review only if Critical/High fixes were needed -> CLOSE -> MOVE FORWARD`

This phase is closed. Do not reopen review cycles on `HISTORICAL_BASELINE_POLICY_R1`, `HISTORICAL_OUTCOME_POLICY_R1`, or this phase absent evidence that invalidates the recorded result or a frozen invariant.
