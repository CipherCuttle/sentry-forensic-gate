# SENTRY_AUTHORITY_EPOCHS_R1

Status: research-only authority contract for runtime activation.

## Decision

The Sentry Launch Factory is an EIP-1967 proxy. Historical research must not apply one mutable/current implementation address to blocks that belonged to a different implementation epoch.

This phase authorizes exactly one contiguous epoch for runtime activation:

- chain: Ink (`57073`)
- proxy: `0xDc37e11B68052d1539fa23386eE58Ac444bf5BE1`
- from block: `52267792` (`0x31d8b10`)
- implementation: `0x94b22ce6A3dB42e09685D12c3D4330296dc4cE73`
- implementation deployment tx: `0x430a1e2083d098e6b763808ce6958cd9701e5cf0d7467678673bad7f9f7ee79f`
- ProxyAdmin upgrade tx: `0x4fd4bb9f9c8db9beaddd7aa6cbf2aaa0cb872587ce2d7b20313b3828f4fbb693`

In block `52267792`, the implementation deployment is transaction position 3 and the ProxyAdmin upgrade is position 4. No Sentry token-launch transaction occurs in that block. Because block-state RPC reads resolve end-of-block state, block `52267792` is a clean first block for the reviewed current epoch.

## Compatibility evidence

The verified current implementation retains the collector/baseline surfaces required by the frozen pipeline:

- `TokenDeployed`
- `KrakenVerifiedTokenDeployed`
- `GoPumpMeTokenDeployed`
- `isAgentPosition(uint256)`
- `isKrakenVerifiedPosition(uint256)`
- `isGoPumpMePosition(uint256)`
- `npm()`
- `getSupportedBaseTokens()`

Existing runtime authority checks continue to verify the ERC-1967 implementation slot, proxy and implementation bytecode, Sentry NPM, Tsunami factory, quoter, and WETH relationships. A future proxy upgrade therefore fails closed until this authority contract is explicitly reviewed and updated.

## Earlier epochs

`authority/ink-57073-sentry-v1.json` records the observed proxy upgrade history. Those records are evidence only. Earlier epochs are **not authorized** for baseline/outcome backfill in R1 because semantic compatibility has not been reviewed across every implementation.

Discovery never self-authorizes an implementation.

## Runtime gate

`start:runtime` must reject any `SENTRY_START_BLOCK < 52267792`. This prevents the current implementation pin from being applied retrospectively to unreviewed blocks.

## Provider capability gate

`pnpm start:provider-capability` probes the configured RPC at the authorized epoch start and a confirmed recent block through the same reviewed viem adapters used by production research runtime. It must demonstrate historical block/header access, ERC-1967 storage, proxy/implementation bytecode, Sentry/Tsunami authority reads, and historical Sentry log access.

The executable historical quote probe is deliberately deferred to the first real launch canary because a quote requires a canonical launch market and token amount. No synthetic market is introduced merely to make the provider test pass.

## Extension rule

An older epoch may be added only after independently reviewing its required ABI/read surfaces and proving the chosen provider can serve the historical state required by the frozen truth/baseline/outcome semantics. An upgrade discovered on-chain remains unauthorized until committed and reviewed in Git.
