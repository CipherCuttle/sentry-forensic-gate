# HISTORICAL_OUTCOME_POLICY_R1

## Status

**Discovery authorized. No historical outcome policy is authorized yet.**

`HISTORICAL_BASELINE_POLICY_R1` passed its live representative gate 9/9. The unchanged `FORWARD_OUTCOMES_R1` path then completed 7/9 exact-24h outcomes and returned deterministic `OUTCOME_USD_VALUATION_UNAVAILABLE` for the first two WETH-base cohorts.

This successor exists only to determine whether a separately versioned historical outcome valuation can be defined from information that was actually available at the exact observed 24h block.

## Frozen predecessor result

- historical baselines attempted: 9
- historical baselines COMPLETE: 9
- historical baselines UNVERIFIED: 0
- exact-24h outcomes attempted: 9
- exact-24h outcomes COMPLETE: 7
- exact-24h outcomes UNVERIFIED: 2
- blocking reason family: `OUTCOME_USD_VALUATION_UNAVAILABLE`
- blocked observed blocks: `40029876`, `40118660`

Current `FORWARD_OUTCOMES_R1` remains unchanged.

## Discovery question

At each of the exact nine observed 24h blocks produced by the existing horizon-selection algorithm, did the same RedStone ETH/USD feed used by the historical baseline policy have code and structurally valid point-in-time data?

The nine frozen observed blocks are:

`40029876, 40118660, 42146879, 44224383, 45720972, 45900260, 46697772, 46723560, 46753934`

## Candidate evidence

RedStone ETH/USD:

`0xe5867B1d421f0b52697F16e2ac437e87d66D5fbF`

Expected metadata, inherited from the preregistered historical baseline discovery:

- decimals: `8`
- description: `RedStone Price Feed for ETH`
- version: `1`

For each exact outcome block, discovery records block timestamp, contract code presence, metadata, `latestRoundData()` answer/update timestamp, and age in seconds.

## Preregistered rules

1. Query RedStone at the exact outcome observed block. **Do not reuse the launch/decision-block price.**
2. Do not introduce a freshness threshold chosen from the nine observed ages.
3. Provider/transport failures are not market evidence and abort the discovery run.
4. Missing code, metadata drift, non-positive answer, zero `updatedAt`, or an update from the future are explicit structural failures.
5. No outcome implementation is authorized until this discovery is complete.
6. If RedStone is structurally point-in-time usable at all nine outcome blocks, any replacement must be separately versioned from `FORWARD_OUTCOMES_R1` and preregistered before implementation.
7. USDT0-base historical outcomes retain the existing nominal stablecoin valuation semantics; this discovery targets the WETH USD-valuation portability gap.
8. Do not authorize the 147-launch replay, FAST_VET, canary, signing, swaps, broadcast, or merge from discovery success.

## Safety boundary

Read-only research only. This phase does not change current R3 baseline or outcome behavior and does not grant execution authority.
