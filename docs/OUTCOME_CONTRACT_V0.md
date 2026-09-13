# OUTCOME_CONTRACT_V0

Every launch is observed at 1m, 5m, 30m, 2h, and 24h where evidence is available.

Core fields:

- executable value
- sellability
- reverse-quote loss / executable recovery
- liquidity evidence
- max executable drawdown
- max executable runup

The first live acquisition implementation is `FORWARD_OUTCOMES_R1`. It uses the persisted `$1` executable-baseline position and canonical launch-block time; see `FORWARD_OUTCOMES_R1.md` for exact block-selection and valuation semantics.

## Frozen catastrophic label

`executable_value <= 20% of entry OR defined sellability failure OR deterministic liquidity failure`.

For `FORWARD_OUTCOMES_R1`, the resolved label vocabulary is applied with this precedence:

1. `LIQUIDITY_COLLAPSE` — the executable exit fails and the current active-liquidity scalar is zero;
2. `EXIT_FAILURE` — no positive executable exit quote while active liquidity is non-zero;
3. `CATASTROPHIC_LOSS` — positive executable exit valued at `<= 20%` of the `$1` entry notional;
4. `NORMAL_LOSS` — positive executable exit valued above `20%` but below entry;
5. `NORMAL_WIN` — positive executable exit valued at or above entry.

The current V3 active-liquidity scalar is retained as evidence but is not, by itself, proof of non-executability: an executable quote remains authoritative because swaps can traverse empty current ranges to later initialized liquidity.

`FAT_TAIL_WIN` remains reserved and is not emitted by R1. Its threshold belongs to a later preregistered evaluation contract, not to post-hoc outcome acquisition.

Missing, immature, provider-failed, or otherwise unvalued evidence is UNKNOWN / UNVERIFIED and may not be coerced into a clean or adverse label.

The thresholds above are frozen before live forward-outcome collection and may not be edited after seeing results without a new versioned contract.
