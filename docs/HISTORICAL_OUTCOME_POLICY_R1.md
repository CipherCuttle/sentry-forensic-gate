# HISTORICAL_OUTCOME_POLICY_R1

## Status

**Point-in-time outcome-oracle discovery: COMPLETE.**  
**Separately versioned historical outcome implementation: AUTHORIZED.**

No 147-launch replay, FAST_VET, canary, merge, signing, approvals, swaps, or transaction broadcast is authorized.

## Why a separate policy is required

`HISTORICAL_BASELINE_POLICY_R1` passed 9/9 historical representatives. The unchanged `FORWARD_OUTCOMES_R1` path then completed 7/9 exact-24h outcomes and returned deterministic `OUTCOME_USD_VALUATION_UNAVAILABLE` for the first two WETH-base cohorts at observed blocks `40029876` and `40118660`.

The exit/sellability quote itself is not the blocker. The non-portable component is the frozen WETH -> USDT0 USD-valuation route after a successful token -> WETH exit.

Current `FORWARD_OUTCOMES_R1` remains unchanged.

## Point-in-time discovery result

Before selecting a replacement, RedStone ETH/USD was queried at all nine exact 24h observed blocks selected by the existing horizon algorithm:

`40029876, 40118660, 42146879, 44224383, 45720972, 45900260, 46697772, 46723560, 46753934`

RedStone ETH/USD:

`0xe5867B1d421f0b52697F16e2ac437e87d66D5fbF`

At all nine blocks it had code and exposed:

- decimals: `8`
- description: `RedStone Price Feed for ETH`
- version: `1`
- positive answer
- nonzero `updatedAt`
- `updatedAt <= observedBlock.timestamp`

Observed ages in seconds were:

`6419, 83, 852, 13876, 9994, 5285, 1721, 5907, 7607`

No freshness cutoff is fitted to these observations.

## Frozen historical outcome policy

Policy version:

`HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1`

WETH valuation kind:

`WETH_REDSTONE_ETH_USD_OUTCOME_ASOF_V1`

### Horizon and execution semantics

Keep the existing `buildForwardOutcome()` algorithm and its exact horizon semantics unchanged:

- target = launch timestamp + `86,400,000 ms`;
- observed block = first block at or after the target timestamp;
- existing predecessor/non-minimal boundary checks remain unchanged;
- existing market authority and reorg checks remain unchanged;
- existing token -> base executable exit quote remains unchanged;
- primary entry notional remains `$1` (`1,000,000` USD micros).

### USDT0 base

Use existing nominal stablecoin valuation unchanged.

### WETH base

Only after the existing token -> WETH exit is executable and produces `baseAmount > 0`, query RedStone ETH/USD at the **same exact observed outcome block**.

Require:

1. oracle code present;
2. `decimals() == 8`;
3. `description() == "RedStone Price Feed for ETH"`;
4. `version() == 1`;
5. `latestRoundData().answer > 0`;
6. `updatedAt > 0`;
7. `updatedAt <= observedBlock.timestamp`;
8. valid WETH decimals at that same block.

Record oracle address, answer, decimals, description, version, update timestamp, observed-block timestamp, and `ageSeconds` in outcome valuation evidence.

Value WETH conservatively with integer floor division, matching the existing outcome valuation's truncating behavior:

`floor(baseAmount * oracleAnswer * 1_000_000 / (10^wethDecimals * 10^oracleDecimals))`

### Freshness semantics

This is retrospective point-in-time reconstruction of the last provider-published on-chain ETH/USD state available at the outcome block. It is not a live trading freshness claim.

No arbitrary age rejection threshold is introduced in R1. Oracle age is retained as evidence for later sensitivity analysis.

## Identity separation

The historical policy MUST NOT masquerade as current `FORWARD_OUTCOMES_R1`.

- outcome IDs must be derived under the historical policy version;
- receipt `policyVersion` must be the historical policy version;
- RedStone valuation evidence must be included in the evidence digest;
- callers without an explicit historical override must retain current `FORWARD_OUTCOMES_R1` IDs, valuation behavior, receipt shape, and digest semantics unchanged.

## Implementation boundary

Use the existing `buildForwardOutcome()` algorithm and `ForwardOutcomeSource` port. A historical source may replace only WETH USD valuation while delegating block selection, authority, market state, exit quoting, and reorg checks to the reviewed existing source.

Do not create a second outcome algorithm.

## Representative acceptance gate

Run the same nine historical representatives through:

1. the already-passed `HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1` baseline;
2. the existing exact-24h outcome algorithm;
3. the separately versioned historical RedStone-as-of WETH valuation.

Acceptance:

- 9 historical baselines COMPLETE;
- 9 exact-24h outcomes attempted;
- 9 exact-24h outcomes COMPLETE;
- 0 exact-24h outcomes UNVERIFIED;
- no provider, authority, horizon-boundary, or reorg failures;
- current R3/default tests remain unchanged and green.

A representative PASS still does not authorize the full 147 replay, FAST_VET, canary, merge, or any execution authority.
