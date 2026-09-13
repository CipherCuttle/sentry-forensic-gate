# sentry-forensic-gate

Point-in-time adverse-selection research for newly launched Sentry tokens on Ink.

**Current authority:** shadow/research only. No private keys, signing, approvals, swap construction, transaction broadcast, or execution authority.

## Current slices

- **Receipt spine:** immutable/versioned evidence contracts and fail-closed gate states.
- **SENTRY_TRUTH_R1:** confirmed-block Sentry deployment capture with deterministic identity, SQLite exactly-once persistence, guarded reorg recovery, and pinned proxy implementation authority.
- **EXECUTABLE_BASELINE_R1:** deterministic point-in-time Tsunami market resolution plus read-only multi-notional entry/reverse diagnostics and atomic baseline receipts.
- **PROVENANCE_FACTS_R1:** immutable creator-deployment facts plus deterministic `DEPLOYED_BY` / `PREVIOUS_LAUNCH` projections with legacy backfill and restart-safe rebuilding.
- **CREATOR_OUTCOME_JOIN_V0:** deterministic 24h creator-history feature receipts evaluated at the same decision block as the executable baseline, with explicit unknown/partial coverage and no score or probability claim.
- **FORWARD_OUTCOMES_R1:** read-only 1m / 5m / 30m / 2h / 24h executable outcomes for the persisted `$1` baseline position, pinned to canonical horizon blocks with restart/reorg-safe receipts.
- **CREATOR_SIGNAL_EVAL_V0:** retrospective, digest-bound comparison of buy-every-complete-baseline versus the frozen creator-history rejection rule. Favorable output can justify a prospective test but remains `EDGE_UNPROVEN`.
- Funding provenance, statistical promotion, and live forensic gating remain intentionally unimplemented.

## Install and test

```bash
corepack enable
pnpm install
pnpm test
```

`pnpm test` runs scaffold, Sentry truth/reorg, executable-baseline, provenance, creator-outcome, forward-outcome, and creator-signal behavioral checks including SQLite parity where applicable.

## Run Sentry truth

```bash
cp .env.example .env
# Set SENTRY_START_BLOCK deliberately.
set -a && . ./.env && set +a
pnpm build
pnpm start:truth -- --once
pnpm start:truth
```

## Run executable baseline

The baseline reads canonical launches already stored in the shared SQLite database. It evaluates each launch at a fixed point in time (`launch block + BASELINE_DECISION_DELAY_BLOCKS`, default `2`), waits `BASELINE_CONFIRMATIONS` (default `2`) before persistence, and records `$0.25 / $0.50 / $1 / $2 / $5` read-only quote evidence.

```bash
set -a && . ./.env && set +a
pnpm build
pnpm start:baseline -- --once
pnpm start:baseline
```

Important: the immediate reverse quote is an **independent quote against the same pre-trade historical state**. It is a sellability/recovery diagnostic, not sequential paper PnL. The receipt explicitly records `INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL` so later analysis cannot silently reinterpret it.

## Collect forward outcomes

Forward outcomes consume the already-persisted `$1` baseline token amount and value it at the canonical 1m / 5m / 30m / 2h / 24h horizon blocks. This remains historical, read-only research; no swap is constructed or executed.

```bash
set -a && . ./.env && set +a
pnpm build
pnpm start:outcomes -- --once
pnpm start:outcomes
```

## Project creator outcome features

This command reads the existing local ledger only. It does not fetch or synthesize outcomes; it emits deterministic `CREATOR_OUTCOME_JOIN_V0` receipts from whatever 24h outcome evidence is already durable.

```bash
pnpm build
pnpm start:creator-outcome
```

## Evaluate creator signal

The evaluator compares the `$1` buy-every-complete-baseline control against one frozen retrospective rule: reject only when the creator already has at least one canonical adverse 24h creator outcome available at that launch's decision point. Missing evidence lowers coverage rather than becoming a clean result.

```bash
set -a && . ./.env && set +a
pnpm build
pnpm start:creator-signal
```

A favorable receipt is only `DESCRIPTIVE_WORTH_PROSPECTIVE_TEST`; the strategy label remains `EDGE_UNPROVEN` and no live integration is authorized.

See [`docs/SENTRY_TRUTH_R1.md`](docs/SENTRY_TRUTH_R1.md), [`docs/EXECUTABLE_BASELINE_R1.md`](docs/EXECUTABLE_BASELINE_R1.md), [`docs/PROVENANCE_FACTS_R1.md`](docs/PROVENANCE_FACTS_R1.md), [`docs/CREATOR_OUTCOME_JOIN_V0.md`](docs/CREATOR_OUTCOME_JOIN_V0.md), [`docs/FORWARD_OUTCOMES_R1.md`](docs/FORWARD_OUTCOMES_R1.md), and [`docs/CREATOR_SIGNAL_EVAL_V0.md`](docs/CREATOR_SIGNAL_EVAL_V0.md).
