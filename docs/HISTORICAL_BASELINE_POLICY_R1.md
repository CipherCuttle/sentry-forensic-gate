# HISTORICAL_BASELINE_POLICY_R1

## Status

**Stage A calibration-surface discovery: COMPLETE.**  
**Stage B point-in-time oracle discovery: COMPLETE.**  
**Stage C separately versioned historical baseline implementation: PASS.**  
**Unchanged exact-24h outcome probe: BLOCKED_BY_HISTORICAL_USD_VALUATION.**

Held state:

`HISTORICAL_BASELINE_POLICY_PASS_OUTCOME_VALUATION_BLOCKED`

No full historical replay, FAST_VET, canary, merge, signing, or execution is authorized.

## Why a separate baseline policy was required

`EXECUTABLE_BASELINE_R1` remains the frozen current-R3 policy. Its decision point is launch block + 2 blocks and its five notionals remain exactly $0.25, $0.50, $1, $2, and $5.

Historical discovery established that the R1 WETH -> USDT0 exact-output sizing route is genuinely non-portable:

- the earliest two WETH representatives have no WETH/USDT0 pool at the frozen fee tiers;
- the later six WETH representatives have a 3000-fee route that handles $0.25/$0.50/$1 but reverts at $2/$5;
- the sole representative with all five R1 notionals is USDT0-base and therefore uses nominal stablecoin sizing.

This is market/infrastructure history, not an adapter defect. R1 notionals were not shrunk and current `EXECUTABLE_BASELINE_R1` was not rewritten.

## Point-in-time oracle discovery

Two preregistered Ink ETH/USD candidates were queried at all nine historical decision blocks.

### eOracle

`0xdFc720E1ef024bfc768ed9E6F0e7Fc80E28f8CFA`

Code and metadata existed at all nine decision blocks, but `latestRoundData()` reverted at every representative. It was not selected.

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

No feed-specific Ink heartbeat was independently established before policy selection, so no rejection threshold was fitted to these observed ages.

## Frozen historical baseline policy

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

Use existing `USDT0_NOMINAL_PEG_V0` unchanged.

### WETH base

At the exact historical decision block:

1. require RedStone ETH/USD contract code;
2. require `decimals() == 8`;
3. require `description() == "RedStone Price Feed for ETH"`;
4. require `version() == 1`;
5. read `latestRoundData()` at that block;
6. require `answer > 0`;
7. require `updatedAt > 0`;
8. require `updatedAt <= decisionBlock.timestamp`;
9. record answer, decimals, update timestamp, decision-block timestamp, and `ageSeconds` in calibration authority evidence;
10. size WETH with ceiling division:

`ceil(notionalUsdMicros * 10^wethDecimals * 10^oracleDecimals / (1_000_000 * oracleAnswer))`

Ceiling division prevents integer truncation from silently undershooting the requested USD notional.

No arbitrary age cutoff is introduced. This policy reconstructs the last provider-published on-chain ETH/USD state available as of the decision block; it is not a production trading-freshness policy.

## Identity and implementation separation

The historical policy does not masquerade as current R1:

- historical baseline IDs use the historical policy version;
- historical quote IDs are policy-separated;
- batch `policyVersion` is the historical version;
- RedStone evidence is included in the authority digest;
- existing callers without an explicit historical override retain current R1 IDs and semantics unchanged.

Implementation reuses the existing `buildBaselineBatch()` algorithm and `ExecutableBaselineSource` port. The historical source replaces only WETH USD calibration and policy-scoped quote identity while delegating market resolution, entry quoting, reverse quoting, authority checks, and reorg checks to the reviewed pipeline. There is no second baseline algorithm.

## Stage C live representative evidence

Source head:

`b15dcb24dc73cf583039c0f9e95e4c706556d1a1`

GitHub Actions run:

`34856771194`

Uploaded receipt artifact:

`10352059780`

Baseline result:

- representatives attempted: **9/9**
- baseline COMPLETE: **9/9**
- baseline UNVERIFIED: **0/9**
- verdict: **PASS**

This satisfies the preregistered Stage C baseline acceptance contract.

## Exact-24h outcome diagnostic

The existing exact-24h outcome path was then probed unchanged, as preregistered.

Result:

- outcomes attempted: **9/9**
- outcomes COMPLETE: **7/9**
- outcomes UNVERIFIED: **2/9**
- blocker family: `OUTCOME_USD_VALUATION_UNAVAILABLE`

Blocked representatives:

1. launch block `39943476`, tokenId `1`, observed block `40029876` — `OUTCOME_USD_VALUATION_UNAVAILABLE:block=40029876:baseAmount=49475793190238`
2. launch block `40032260`, tokenId `5`, observed block `40118660` — `OUTCOME_USD_VALUATION_UNAVAILABLE:block=40118660:baseAmount=19726984103325`

The outcome implementation values WETH through the historical Tsunami WETH -> USDT0 DEX route. The same early-market portability problem therefore survives at these two 24h outcome blocks.

Per the frozen Stage C decision rule, this outcome problem is **not repaired in this phase**. It becomes a separately versioned successor problem.

## Closure verdict

`BASELINE_POLICY_PASS / OUTCOME_VALUATION_BLOCKED / FULL_147_REPLAY_NOT_AUTHORIZED / FAST_VET_NOT_AUTHORIZED / CANARY_NOT_AUTHORIZED / MERGE_NOT_AUTHORIZED`

Next action:

`OPEN_HISTORICAL_OUTCOME_VALUATION_POLICY_R1_SUCCESSOR`
