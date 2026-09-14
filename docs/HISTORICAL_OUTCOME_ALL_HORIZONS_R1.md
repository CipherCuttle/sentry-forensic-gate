# HISTORICAL_OUTCOME_ALL_HORIZONS_R1

## Objective

Verify that the reviewed historical baseline and historical outcome compatibility paths work across the complete frozen forward-outcome horizon contract:

- `1m`
- `5m`
- `30m`
- `2h`
- `24h`

This phase is a verification gate. It does not introduce a new market policy and does not authorize the full 147-launch replay.

## Frozen evidence set

Use the same nine reviewed representatives from:

`fixtures/historical-compatibility-r1.json`

Build exactly one historical baseline per representative with the existing historical baseline builder and require all nine baselines to be `COMPLETE`.

Then iterate the exported `OUTCOME_HORIZONS` from `src/outcome/horizons.ts` and call the existing `buildHistoricalForwardOutcome()` implementation for every representative/horizon combination.

Expected evidence matrix:

`9 representatives × 5 horizons = 45 outcomes`

## Horizon semantics

Do not hard-code shorter-horizon observed block numbers.

For every horizon the existing reviewed outcome algorithm must derive the first canonical block at or after the target timestamp from live archive data. Existing reorg, authority, sellability, valuation, and evidence-digest semantics remain authoritative.

The exact-24h predecessor's known block list is a regression fixture for that predecessor only. It must not be extrapolated into guessed 1m/5m/30m/2h block lists.

## Acceptance

The gate passes only when all of the following are true:

- representatives attempted: `9`
- historical baselines attempted: `9`
- historical baselines `COMPLETE`: `9`
- historical baselines `UNVERIFIED`: `0`
- horizons per representative: `5`
- outcomes attempted: `45`
- outcomes `COMPLETE`: `45`
- outcomes `UNVERIFIED`: `0`
- live archive RPC evidence is used
- point-in-time evidence semantics are preserved
- current R3/default behavior is unchanged
- historical baseline semantics are unchanged
- historical RedStone outcome semantics are unchanged
- full 147 replay remains unauthorized
- FAST_VET remains unauthorized
- canary remains unauthorized
- merge remains unauthorized

Success verdict:

`HISTORICAL_OUTCOME_ALL_HORIZONS_R1_PASS`

## Fail-closed rules

A provider or transport failure is not market evidence and must not be converted into a market-loss classification or a PASS.

If any representative/horizon combination exposes a real compatibility defect, stop and report it. Do not broaden historical semantics simply to achieve 45/45.

Missing/null outcome evidence is `UNVERIFIED` and fails this gate.

## Safety boundary

Read-only research only.

No signing, private-key custody, approvals, swap construction, transaction broadcast, automatic trading, or execution authority is introduced here.

A representative PASS does not self-authorize later phases.
