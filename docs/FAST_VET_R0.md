# FAST_VET_R0

## Objective

Create a deliberately small, disposable shadow filter from evidence already produced by `sentry-forensic-gate`. This is a compressed smoke experiment, not a legitimacy score and not trading authority.

## Frozen R0 rule

The primary notional is the existing `$1` executable-baseline leg.

- `REJECT` when the `$1` entry is explicitly non-executable.
- `REJECT` when the `$1` independent reverse/sellability diagnostic is explicitly non-executable.
- `REJECT` when point-in-time creator history already contains at least one canonical prior `CATASTROPHIC_LOSS`, `EXIT_FAILURE`, or `LIQUIDITY_COLLAPSE` outcome.
- `UNKNOWN` when the baseline/primary leg/creator feature is missing or unverified.
- `UNKNOWN` when creator-history coverage is `UNKNOWN` or `PARTIAL` and no adverse history has already been established.
- `PASS` only for a complete executable baseline plus creator coverage of `NO_HISTORY` or `COMPLETE`, with no known prior adverse creator outcome.

`UNKNOWN` maps to `SKIP`; it is never rewritten as clean or adverse evidence.

The independent reverse quote remains the existing same-state sellability diagnostic. R0 does not reinterpret it as sequential paper PnL and deliberately adds no recovery-BPS threshold.

## Compressed shadow semantics

`FAST_VET_SHADOW_R0` uses only canonical `FORWARD_OUTCOMES_R1` receipts at the frozen 24h horizon. The control cohort requires a complete executable baseline; candidate exposure is the subset whose R0 decision is `PASS`. It reports trade retention, adverse exposure removed, ordinary-win retention, and positive executable upside capture.

There is deliberately no sample-adequacy claim, probability, p-value, confidence interval, ML model, tuned threshold, or promotion decision. Receipt status is always `SMOKE_ONLY`; strategy label remains `EDGE_UNPROVEN`.

## Run against an existing ledger

The runner is read-only and does not perform RPC or other network reads:

```bash
pnpm build
DB_PATH=./data/sentry-forensic-gate.sqlite pnpm start:fast-vet-shadow
```

It rebuilds creator features from the canonical provenance facts and 24h R1 outcomes already stored in the ledger, joins them to stored executable baseline batches, and emits one JSON smoke receipt. The output explicitly records `READ_ONLY_LOCAL_LEDGER_SMOKE_NO_CHAIN_REFETCH`; it is for fast directional screening, not final evidence promotion.

## Deferred

- RekTrace early-buyer concentration/botting features.
- Website/domain, Telegram, X, GitHub, funding provenance, or identity graphs.
- New direct-network collectors.
- Live gate integration, wallet keys, signing, approvals, transaction construction, or broadcast.

Those are only worth adding if this cheap smoke path is directionally useful.
