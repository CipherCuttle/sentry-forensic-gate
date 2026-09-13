# sentry-forensic-gate

Point-in-time adverse-selection research for newly launched Sentry tokens on Ink.

**Current authority:** shadow/research only. No private keys, signing, approvals, swap construction, or transaction broadcast.

## Current slices

- **Scaffold / receipt spine:** immutable evidence contracts, hard-gate states, policy versioning.
- **SENTRY_TRUTH_R1:** confirmed-block Sentry deployment capture with deterministic identity, SQLite exactly-once persistence, bounded catch-up, restart checkpointing, and reorg rewind.
- Quote/executable baseline and forensic scoring remain intentionally unimplemented.

## Run Sentry truth

```bash
cp .env.example .env
# Set SENTRY_START_BLOCK deliberately.
set -a && . ./.env && set +a
pnpm install
pnpm test
pnpm start:truth -- --once
pnpm start:truth
```

The watcher defaults to Ink chain ID `57073`, `https://rpc-gel.inkonchain.com`, and the canonical Sentry Launch Factory `0xDc37e11B68052d1539fa23386eE58Ac444bf5BE1`.

See [`docs/SENTRY_TRUTH_R1.md`](docs/SENTRY_TRUTH_R1.md) for the authority snapshot and failure semantics.
