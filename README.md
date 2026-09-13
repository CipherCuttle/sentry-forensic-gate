# sentry-forensic-gate

Point-in-time adverse-selection research for newly launched Sentry tokens on Ink.

**Current authority:** shadow/research only. No private keys, signing, approvals, swap construction, transaction broadcast, or execution authority.

## Current slices

- **Receipt spine:** immutable/versioned evidence contracts and fail-closed gate states.
- **SENTRY_TRUTH_R1:** confirmed-block Sentry deployment capture with deterministic identity, SQLite exactly-once persistence, guarded reorg recovery, and pinned proxy implementation authority.
- **EXECUTABLE_BASELINE_R1:** deterministic point-in-time Tsunami market resolution plus read-only multi-notional entry/reverse diagnostics and atomic baseline receipts.
- Creator/provenance and higher forensic scoring remain intentionally unimplemented.

## Install and test

```bash
corepack enable
pnpm install
pnpm test
```

`pnpm test` runs the scaffold self-check, Sentry truth/reorg checks, executable-baseline behavioral checks, and SQLite baseline persistence/rewind checks.

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

The baseline reads canonical launches already stored in the shared SQLite database. It evaluates each launch at a fixed point in time (`launch block + BASELINE_DECISION_DELAY_BLOCKS`, default `2`) and records `$0.25 / $0.50 / $1 / $2 / $5` read-only quote evidence.

```bash
set -a && . ./.env && set +a
pnpm build
pnpm start:baseline -- --once
pnpm start:baseline
```

Important: the immediate reverse quote is an **independent quote against the same pre-trade historical state**. It is a sellability/recovery diagnostic, not sequential paper PnL. The receipt explicitly records `INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL` so later analysis cannot silently reinterpret it.

See [`docs/SENTRY_TRUTH_R1.md`](docs/SENTRY_TRUTH_R1.md) and [`docs/EXECUTABLE_BASELINE_R1.md`](docs/EXECUTABLE_BASELINE_R1.md).
