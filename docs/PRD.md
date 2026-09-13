# PRD — Sentry Forensic Gate v0.1

## Objective

Determine whether evidence available at or shortly after a Sentry launch can reduce catastrophic executable losses without destroying positive-tail expectancy.

## Non-goals

No live execution, wallet signing, mempool manipulation, private keys, autonomous retraining, or claims that a token is "safe".

## Strategies

- BASELINE: every canonical executable launch.
- PROTOCOL_GATE: deterministic protocol + exit checks.
- FORENSIC_GATE: protocol gate plus point-in-time forensic evidence.

Every launch receives outcomes even when a gate rejects it.

## Frozen evidence families

1. protocol integrity
2. exit executability
3. creator history
4. funding provenance
5. initial distribution
6. early participant topology
7. liquidity trajectory

## Outcome horizons

1m, 5m, 30m, 2h, 24h.

## V0 DoD

A launch is captured once, replayable, receives versioned decision receipts, multi-notional shadow quotes, forward outcomes, and can be compared across the three strategies without look-ahead leakage.
