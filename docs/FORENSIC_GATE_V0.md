# FORENSIC_GATE_V0

## Decision states

- PASS
- REJECT
- UNVERIFIED

## Risk bands

- LOW
- MODERATE
- ELEVATED
- HIGH
- UNKNOWN

## Rule

Unknown evidence never becomes safe evidence. Missing critical evidence is UNVERIFIED. Deterministic contradictions can REJECT. Reputation evidence is non-authoritative in V0.

## T0 hard-gate candidates

- canonical Sentry launch provenance
- recognized launch type
- token/pool relation resolved
- canonical infrastructure identity
- entry quote available
- immediate reverse quote available
- no contradictory authoritative chain state

All later evidence is append-only and cannot rewrite the historical T0 receipt.
