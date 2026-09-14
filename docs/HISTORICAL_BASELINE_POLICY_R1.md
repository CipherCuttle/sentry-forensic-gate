# HISTORICAL_BASELINE_POLICY_R1

## Status

**Discovery authorized. No historical baseline policy is authorized yet.**

This successor exists because `HISTORICAL_COMPATIBILITY_R1` reached the real frozen baseline pipeline on all nine reviewed historical implementation representatives but only one representative produced a COMPLETE baseline. The other eight were deterministic `UNVERIFIED` with `USD_CALIBRATION_UNAVAILABLE`.

The purpose of this phase is to determine whether that incompatibility is caused by an adapter defect or by the actual point-in-time market/infrastructure surface.

## Frozen predecessor semantics

`EXECUTABLE_BASELINE_R1` remains unchanged for current R3. Its decision point is launch block + 2 blocks and its five USD notionals remain exactly:

- $0.25
- $0.50
- $1
- $2
- $5

For WETH-base launches, R1 converts each target notional into WETH with a point-in-time WETH -> USDT0 exact-output quote against the authorized historical factory/quoter. It tries fee tiers 500, 3000, and 10000 and accepts the least WETH input among executable routes.

This discovery phase MUST NOT reduce the notionals, substitute a later price, or choose a different sizing rule merely because doing so increases coverage.

## Preregistered hypotheses

**H1 — depth failure.** The WETH/USDT0 route exists but cannot execute one or more frozen notionals at many historical decision blocks.

**H2 — infrastructure absence.** One or more epochs lack the required pool/token/code surface entirely.

**H3 — later transition.** Full R1 calibration becomes available only after a later infrastructure/liquidity transition, so the current R1 policy is genuinely non-portable to earlier launches.

## Discovery measurements

For the same nine representatives used by `HISTORICAL_COMPATIBILITY_R1`, at exactly launch block + 2, the live archive-RPC probe records:

- canonical launch identity and base token recovered through the reviewed historical tuple;
- block timestamp and hash;
- WETH and USDT0 code/decimals;
- WETH/USDT0 pool existence for fee tiers 500, 3000, and 10000;
- pool bytecode, token identity, fee, and active liquidity;
- exact-output quote executability for every frozen notional at every available fee tier;
- the result of the existing baseline adapter's `calibrateUsd()` for each frozen notional.

Provider, authority, or reorg failures abort. Missing pools, shallow liquidity, and quote reverts are recorded as market/infrastructure evidence rather than silently upgraded to PASS.

## Decision rules

1. If the historical route is in fact executable for all frozen notionals and the previous failure is caused by the compatibility adapter, repair only that adapter defect and keep `EXECUTABLE_BASELINE_R1` unchanged.
2. If the route is genuinely absent or too shallow, do **not** shrink notionals post hoc and do **not** reinterpret R1 to manufacture compatibility.
3. If R1 is genuinely non-portable, any historical replacement must be a separately versioned policy using only data available at the decision block and must be preregistered before the 147-launch replay.
4. Future prices, retrospective centralized-exchange prices, outcome-conditioned sizing, and per-token adaptive notionals are forbidden as rescue mechanisms.

## Safety / authority boundary

Read-only research only. This phase does not authorize historical replay, FAST_VET, canary execution, wallet access, approvals, swap construction, signing, private keys, transaction broadcast, or merge.
