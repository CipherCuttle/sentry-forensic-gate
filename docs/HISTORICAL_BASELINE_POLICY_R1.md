# HISTORICAL_BASELINE_POLICY_R1

## Status

**Stage A calibration-surface discovery: COMPLETE.**  
**Stage B point-in-time oracle discovery: COMPLETE.**  
**Stage C separately versioned historical baseline implementation: AUTHORIZED.**

No full historical replay, FAST_VET, canary, merge, signing, or execution is authorized.

## Why a separate policy is required

`EXECUTABLE_BASELINE_R1` remains the frozen current-R3 policy. Its decision point is launch block + 2 blocks and its five notionals remain exactly $0.25, $0.50, $1, $2, and $5.

Historical discovery established that the R1 WETH -> USDT0 exact-output sizing route is genuinely non-portable:

- the earliest two WETH representatives have no WETH/USDT0 pool at the frozen fee tiers;
- the later six WETH representatives have a 3000-fee route that handles $0.25/$0.50/$1 but reverts at $2/$5;
- the sole representative with all five R1 notionals is USDT0-base and therefore uses nominal stablecoin sizing.

That is market/infrastructure history, not an adapter defect. We therefore do not shrink the frozen notionals or rewrite `EXECUTABLE_BASELINE_R1`.

## Point-in-time oracle discovery

Before selecting a replacement, two Ink-documented ETH/USD contracts were frozen and queried at all nine historical decision blocks.

### eOracle

`0xdFc720E1ef024bfc768ed9E6F0e7Fc80E28f8CFA`

Code and metadata existed at all nine decision blocks, but `latestRoundData()` reverted at every representative. It is not selected.

### RedStone

`0xe5867B1d421f0b52697F16e2ac437e87d66D5fbF`

At all nine decision blocks the contract had code and exposed:

- decimals: `8`
- description: `RedStone Price Feed for ETH`
- version: `1`
- positive `latestRoundData()` answer
- nonzero `updatedAt`
- `updatedAt <= decisionBlock.timestamp`

Observed ages in seconds were:

`2483, 97, 398, 13044, 1995, 10723, 103, 18055, 14689`

No feed-specific Ink heartbeat was independently established before policy selection. A rejection threshold is therefore **not** fitted to these observed ages.

## Frozen Stage C policy

Policy version:

`HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1`

WETH calibration kind:

`WETH_REDSTONE_ETH_USD_ASOF_V1`

### Decision point and notionals

Unchanged from R1:

- decision block = launch block + 2
- $0.25
- $0.50
- $1
- $2
- $5

### USDT0 base

Use the existing `USDT0_NOMINAL_PEG_V0` calibration unchanged.

### WETH base

At the exact historical decision block:

1. require RedStone ETH/USD contract code;
2. require `decimals() == 8`;
3. require `description() == "RedStone Price Feed for ETH"`;
4. require `version() == 1`;
5. read `latestRoundData()` at that same block;
6. require `answer > 0`;
7. require `updatedAt > 0`;
8. require `updatedAt <= decisionBlock.timestamp`;
9. record the oracle answer, decimals, update timestamp, decision-block timestamp, and `ageSeconds` in calibration authority evidence;
10. size WETH using ceiling division:

`ceil(notionalUsdMicros * 10^wethDecimals * 10^oracleDecimals / (1_000_000 * oracleAnswer))`

Ceiling division prevents the requested USD notional from being silently undershot by integer truncation.

### Freshness semantics

This policy reconstructs the **last provider-published on-chain ETH/USD state available as of the decision block**. It does not claim that every such value would satisfy a live trading risk freshness standard.

No arbitrary age cutoff is introduced in R1 of the historical policy. Oracle age is retained as evidence so later analysis can stratify or sensitivity-test historical results without changing which information was available at the decision point.

This is a historical reconstruction policy, not production execution authority.

## Identity separation

The historical policy MUST NOT masquerade as current `EXECUTABLE_BASELINE_R1`.

- baseline IDs must be derived under the historical policy version;
- quote IDs must be policy-separated;
- batch `policyVersion` must be the historical version;
- RedStone calibration evidence must be included in the authority digest;
- existing callers without an explicit historical override must retain current R1 IDs and semantics unchanged.

## Implementation boundary

Use the existing `buildBaselineBatch()` algorithm and the existing `ExecutableBaselineSource` port. The historical source may replace only `calibrateUsd()` and policy-scoped quote identity while delegating market resolution, entry quoting, reverse quoting, authority checks, and reorg checks to the reviewed pipeline.

Do not create a second baseline algorithm.

## Representative gate

Run the same nine historical representatives through the real existing baseline pipeline using the new historical policy.

Baseline acceptance:

- 9 attempted
- 9 COMPLETE
- 0 UNVERIFIED

After each COMPLETE baseline, probe the existing exact-24h outcome path unchanged. If the outcome path is historically non-portable, report and stop that as a separate successor problem; do not repair outcome semantics inside this baseline-policy gate.

## Authority boundary

Even a 9/9 baseline PASS does not authorize:

- the 147-launch replay;
- FAST_VET;
- canary trading;
- signing;
- approvals;
- swap construction;
- transaction broadcast;
- merge.
