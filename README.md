# Sentry Forensic Gate

Point-in-time adverse-selection research for new Sentry launches on Ink.

**Current authority:** shadow/research only. No private keys, approvals, signing, transaction construction, or broadcast.

The core loop is:

`OBSERVE -> VERIFY -> QUOTE -> DECIDE -> SHADOW -> OUTCOME -> EVALUATE`

The first bootstrap intentionally keeps RPC/database drivers behind ports. Domain semantics compile without network access, and `src/db/schema.sql` freezes the durable model before an implementation is chosen.

## Commands

```bash
corepack enable
pnpm install
pnpm build
pnpm selfcheck
```

See `docs/PRD.md`, `docs/FORENSIC_GATE_V0.md`, and `docs/EXPERIMENT_V0.md`.
