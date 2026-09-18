# Robinhood / Pons V2 — M2J-A Prospective Cohort Manifest

## Objective

Freeze a genuinely prospective Pons V2 cohort before policy decisions or +24h outcomes are inspected.

M2J-A is membership selection only. It answers:

> Which canonical, currently unmatured native-pair Pons launches belong to the next prospective comparison cohort?

It does **not** evaluate FAST_VET_R0, FAST_VET_R1, creator history, or forward outcomes.

Scientific state remains:

`EDGE_UNPROVEN`

## Frozen cohort rule

At one canonical Robinhood head block:

1. scan the preceding **30,000 blocks** for Pons V2 `TokenLaunched` events;
2. retain only launches using the reviewed native-ETH pair;
3. retain only launches whose canonical launch timestamp is within the preceding **12 hours**;
4. require every retained launch's +24h target timestamp to still be in the future relative to the frozen head;
5. include **every** launch satisfying those rules;
6. fail closed if more than **20** launches satisfy the rule rather than silently truncating;
7. order members by `blockNumber, logIndex`;
8. content-address the resulting cohort manifest.

The rule is policy-blind. A launch is not included or excluded because R0/R1 would accept or reject it.

## Why membership is separated from evaluation

The prospective comparison must eventually measure:

- participation / coverage;
- false rejection and missed upside;
- catastrophic loss;
- exit failure;
- liquidity collapse;
- lower-tail outcomes;
- median executable outcome;
- fat-tail capture;
- capacity utilization.

Therefore rejected candidates must remain in the denominator.

M2J-A freezes membership before any of those outcome or decision labels are known. M2J-B may then reconstruct the frozen decision-block baseline, creator evidence available at that decision point, and immutable R0/R1/control receipts for **every** member.

A later M2J-C may collect the +24h executable outcome for **every** frozen member after maturity.

## Acquisition / evaluation boundary

Workflow shell performs read-only Robinhood JSON-RPC acquisition and writes raw responses under `artifacts/m2j-a-acquisition/`.

The local JavaScript evaluator:

- performs no network calls;
- validates the frozen head;
- validates every scanned log and canonical block hash;
- decodes the reviewed `TokenLaunched` event;
- applies only the preregistered membership rule;
- derives deterministic Pons launch/event IDs;
- emits a content-addressed cohort manifest.

Transport is not authority.

## Permanent boundaries

M2J-A adds no:

- wallet;
- signer;
- approvals;
- transaction construction;
- broadcast;
- live money;
- Robinhood live authority;
- Arc live authority;
- policy tuning;
- outcome peeking.

The existing Ink exact-$1 authority is unchanged.

## Next

`M2J-B`:

`frozen cohort → decision-block portable baseline + point-in-time creator evidence → R0/R1/control receipts`

Then, only after each member matures:

`M2J-C`:

`frozen cohort + immutable policy receipts → +24h executable outcomes → cohort comparison`

No policy promotion follows from M2J-A.
