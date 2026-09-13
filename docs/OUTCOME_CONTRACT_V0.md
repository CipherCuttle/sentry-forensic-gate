# OUTCOME_CONTRACT_V0

Every launch is observed at 1m, 5m, 30m, 2h, and 24h where evidence is available.

Core fields:

- executable value
- sellability
- reverse-quote loss
- liquidity
- max executable drawdown
- max executable runup

Candidate catastrophic label for preregistration:

`executable_value_24h <= 20% of entry OR defined sellability failure OR deterministic liquidity failure`.

The exact threshold must be frozen before a prospective evaluation and may not be edited after seeing its results.
