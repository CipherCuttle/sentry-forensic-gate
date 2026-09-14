# HISTORICAL_BASELINE_POLICY_R1

## Status

**Stage A calibration-surface discovery is complete. Stage B point-in-time oracle availability discovery is authorized. No historical baseline policy is authorized yet.**

This successor exists because `HISTORICAL_COMPATIBILITY_R1` reached the real frozen baseline pipeline on all nine reviewed historical implementation representatives but only one representative produced a COMPLETE baseline. The other eight were deterministic `UNVERIFIED` with `USD_CALIBRATION_UNAVAILABLE`.

Current R3 remains unchanged. The purpose of this phase is to determine whether a separately versioned historical baseline can be grounded in evidence that actually existed at each decision block.

## Frozen predecessor semantics

`EXECUTABLE_BASELINE_R1` remains unchanged for current R3. Its decision point is launch block + 2 blocks and its five USD notionals remain exactly:

- $0.25
- $0.50
- $1
- $2
- $5

For WETH-base launches, R1 converts each target notional into WETH with a point-in-time WETH -> USDT0 exact-output quote against the authorized historical factory/quoter. It tries fee tiers 500, 3000, and 10000 and accepts the least WETH input among executable routes.

This phase MUST NOT reduce the notionals, substitute a later price, or choose a different sizing rule merely because doing so increases coverage.

## Stage A — calibration-surface result

Live archive-RPC discovery attempted the same nine reviewed implementation representatives at exactly launch block + 2 using the frozen R1 notionals.

Observed result:

- 9/9 representatives attempted;
- 8 WETH-base launches and 1 USDT0-base launch;
- only 1/9 representatives supports all five frozen R1 calibration notionals;
- the first two WETH representatives have no WETH/USDT0 pool at fee 500, 3000, or 10000;
- the other six WETH representatives have a usable 3000-fee WETH/USDT0 route for $0.25, $0.50, and $1, but $2 and $5 exact-output quotes revert;
- the sole full-calibration representative is USDT0-base and therefore uses the R1 nominal-peg path rather than WETH/USDT0 market calibration.

This falsifies an adapter-only explanation. `EXECUTABLE_BASELINE_R1` is genuinely non-portable across the reviewed historical representatives because the required calibration market did not yet exist or was too shallow.

The result does **not** authorize shrinking notionals. Doing so after observing failures would redefine the measurement rather than reconstruct it.

## Stage B — preregistered on-chain oracle availability discovery

The next question is whether contemporaneous on-chain ETH/USD evidence existed at the same decision blocks. Current Ink documentation is used only to identify candidate contract addresses; current documentation is **not** evidence that a feed existed historically.

Candidates are frozen before the historical reads:

1. `EORACLE_ETH_USD` — `0xdFc720E1ef024bfc768ed9E6F0e7Fc80E28f8CFA` — documented by Ink as ETH/USD with 8 decimals.
2. `REDSTONE_ETH_USD` — `0xe5867B1d421f0b52697F16e2ac437e87d66D5fbF` — documented by Ink as ETH/USD.

The probe uses only read-only AggregatorV3-style calls at the exact historical decision block and records:

- bytecode presence;
- `decimals()`;
- `description()` when supported;
- `version()` when supported;
- `latestRoundData()`;
- whether answer > 0;
- whether `updatedAt` is nonzero and no later than the decision-block timestamp;
- `age_seconds = decision_block_timestamp - updatedAt`.

### Important anti-overfitting rule

**No freshness threshold is selected in Stage B.** The probe records update ages but does not classify a feed as fresh/stale using a threshold chosen after seeing those ages. No oracle is selected as the historical policy winner in this discovery gate.

A candidate is only *structurally point-in-time usable* at a representative when its contract has code at that historical block and `latestRoundData()` returns a positive answer with nonzero `updatedAt <= decisionBlock.timestamp`.

## Decision rules after Stage B

1. If no candidate is structurally usable across all WETH representatives, do not backfill with future prices or retrospective centralized-exchange prices. The next policy decision must consider a non-USD or explicitly partially observed historical evidence contract.
2. If one or more candidates are structurally usable across all WETH representatives, define a **separately versioned** historical calibration policy and freeze its oracle-selection and freshness rules before testing historical baselines.
3. Current `EXECUTABLE_BASELINE_R1` remains untouched in either case.
4. The 147-launch replay remains unauthorized until the replacement historical policy has its own preregistration, tests, live representative evidence, and explicit replay authorization.

## Safety / authority boundary

Read-only research only. This phase does not authorize historical replay, FAST_VET, canary execution, wallet access, approvals, swap construction, signing, private keys, transaction broadcast, or merge.
