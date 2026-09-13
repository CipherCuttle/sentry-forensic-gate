# PROVIDER_CAPABILITY_R1

This gate answers one operational question before persistent deployment: can the configured Ink RPC serve the historical state required by the currently authorized Sentry epoch?

Run:

```sh
pnpm build
pnpm start:provider-capability
```

Optional:

```sh
PROVIDER_PROBE_BLOCK=52267792 pnpm start:provider-capability
```

The probe uses the same reviewed viem sources as the runtime. It fails closed if the provider cannot supply any required call.

Required PASS capabilities:

- historical block header/hash at the probe block;
- ERC-1967 implementation storage at that block;
- proxy and implementation bytecode;
- Sentry and Tsunami authority reads used by the executable baseline;
- historical Sentry deployment-log query;
- the same authority reads at a recent confirmed block.

The receipt records only the RPC origin/host, never the path/query, so API-key-bearing provider URLs are not leaked to logs.

A real historical executable quote is not fabricated for this probe. It is the next canary gate after at least one canonical launch is ingested from the authorized epoch.

Failure means provider capability is unresolved; it does not authorize weakening historical semantics or substituting current state for historical state.
