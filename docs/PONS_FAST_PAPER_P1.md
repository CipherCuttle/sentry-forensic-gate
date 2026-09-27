# PONS Fast Track P1 — real-launch paper bot

Status: DRAFT / PAPER ONLY. This is an operational experiment,
NOT the separately gated S1 prospective scientific collector, a vetted
strategy or a live canary.

## Objective

Run one persistent, restartable paper process that uses real canonical
Robinhood Chain 4663 Pons V2 launch events and reuses the existing
reviewed adapters. No new archive qualification, extra PR stack,
wallet permission or live-money grant is required to build/test this.

## Quick start

Use Node >=20 and the repository pnpm toolchain.

1. Run `pnpm install`, `pnpm build`, `pnpm ponsfastpapercheck`.
2. For a bounded one-cycle smoke: `pnpm ponsfastpaperonce`.
3. To keep observing: `node scripts/pons-fast-paper-v1.mjs --loop` on a machine/container
   with a **durable mounted directory**. Default data directory:
   `.runtime/pons-paper/` (ignored by Git). Set
   `PONS_PAPER_DATA_DIR=/persistent/pons-paper` if deployed.
4. Optional: `PONS_PAPER_RPC_URL` is a read-only HTTPS RPC URL.
   Defaults to Robinhood official public RPC; it may prune historical
   state or rate-limit multi-leg quotes. A private, recent-state-capable
   provider is more useful operationally but is never committed or logged.
   `PONS_PAPER_POLL_MS` default 15000 (10s–120s accepted);
   `PONS_PAPER_RPC_MIN_INTERVAL_MS` default 150 (75–2000 accepted).
   Never put an RPC secret in an Actions PR or a committed file.
5. Read local `state.json` and append-only `events.jsonl`.
   Only one runner may use a directory. A surviving `runner.lock`
   after forced termination needs operator review before removal.
   No cloud hosting, service or repository merge occurs in this PR.

## What it does

- On cold start samples the newest 16 safe blocks, then polls an
  eight-block range at a time to head minus four blocks. A stale process
  explicitly journals SCAN_GAP; it does NOT claim an exhaustive census.
  One native launch block can hold at most eight processed factory events
  per cycle. Oversized/broken blocks receive explicit skip receipts.
- Verifies the pinned Pons factory and the real launch on the existing
  launch adapter. Requires its existing complete five-notional baseline
  at launch block +2 (with two extra maturity blocks); the primary paper
  entry is exactly $1, with an executable **independent same-state**
  entry/reverse. Records whether the $5 leg is also executable.
  Entry observation must finish before launch +4 minutes. Otherwise SKIP.
- This is the permissive **BUY_EVERY_EXECUTABLE_CONTROL** in paper mode,
  not FAST_VET PASS. Existing FAST_VET is evaluated with *missing*
  creator history and normally yields UNKNOWN. The unknown is recorded;
  no creator reputation or anti-rug guarantee is fabricated.
- When the canonical chain timestamp crosses launch +5 minutes and
  +24 hours, attempts each exact full-balance reverse quote at a
  near-current anchored block, then recalibrates the returned ETH into
  approximate USD. Rechecks the exit block hash. The result is a
  GROSS_QUOTE_ONLY receipt; fees not modeled by the quote, gas, slippage,
  actual inclusion, execution latency and trading P&L remain UNKNOWN.
  Unsupported graduated V4 routes, missing historic state, stale
  observation windows and RPC failures produce UNVERIFIED, never
  fake profits. Horizons are terminal after one quote attempt to keep
  data semantics obvious.
- State is an atomic snapshot written with exclusive lock. Entries and
  both horizon results survive ordinary restarts **on the same volume**.
  This is not distributed HA; SIGKILL can leave a stale lock, and
  ephemeral CI runner storage is not durable.

## Acceptance / stop conditions

`pnpm ponsfastpapercheck` and the full CI suite must pass.
One hostile pass and a targeted fix for Critical/High only.
Evidence must clearly distinguish the real observed events, hypothetical
same-state quotes, missed windows and actual fills (=none).
Public-RPC rate limits, provider failures and missing exit quotes may
mean a real one-cycle smoke records no paper entry. Do not hide that.

## Deliberately NOT in P1

No account or wallet, signer, transaction construction or broadcast;
no spend cap/grant needed because spending is impossible.
No automated deployment or Actions schedule before the operator
selects a durable runtime. No live 24/7 service is claimed by this PR.
No V4 graduation execution, no sequential simulated fills, no exact
net gas/slippage P&L, no positive edge claim, and no changes to S1
cohort or immutable proof publication. Live experimentation remains
a separately explicit capped authorization after P1 live observation.
