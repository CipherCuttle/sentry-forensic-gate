# SENTRY_TRUTH_R1

## Objective

Capture every confirmed Sentry deployment exactly once into a replayable local ledger without trusting an indexer.

## Authority snapshot

Frozen for R1 on 2026-09-13:

- Ink chain ID: `57073`.
- Primary public RPC: `https://rpc-gel.inkonchain.com`.
- Sentry Launch Factory proxy: `0xDc37e11B68052d1539fa23386eE58Ac444bf5BE1`.
- Frozen expected proxy implementation: `0xd5bceD4c43eef627eE0524368cABAfcb9f29CfF0` (latest published Sentry tooling/changelog at the frozen authority source).
- ERC-1967 implementation slot is pinned in code as `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`.
- ABI/config source: `mavrkofficial/inkonchain-mcp` commit `23261b59e1257bb3527dafaa1e689c6e6953dba0`.
- Deployment events ingested: `TokenDeployed`, `KrakenVerifiedTokenDeployed`, `GoPumpMeTokenDeployed`.

The runtime does not assume specialized launches also emit `TokenDeployed`. All three event families are read and collapsed by `(chain, factory, txHash, token)` into one canonical launch.

## Exactly-once semantics

`launch_id = sha256(SENTRY_LAUNCH_V1, chainId, factory, txHash, token)`.

`event_id = sha256(SENTRY_EVENT_V1, chainId, factory, txHash, logIndex)` preserves source-log provenance.

SQLite additionally enforces `UNIQUE(chain_id, tx_hash, token)`. A repeated identity is only idempotent when all chain-authoritative launch fields agree; conflicting duplicates fail with `LAUNCH_IDENTITY_CONFLICT`. Observation wall-clock time is deliberately excluded from that equality check.

## Checkpoint / restart

The store persists `(chain_id, block_number, block_hash)` only after every launch in that batch has been inserted. A crash before checkpoint commit is safe: restart replays the range and launch insertion is idempotent.

## Reorg handling

Before advancing, the runtime re-reads the persisted checkpoint block hash. Each checkpoint also persists a guard block/hash one configured reorg horizon behind it. On mismatch, the runtime only rewinds when that guard still matches canonical chain truth. If the guard also changed—or a legacy checkpoint has no guard—it halts with `REORG_DEPTH_EXCEEDED` / `REORG_DEPTH_UNVERIFIABLE` instead of speculatively rewriting history.

Each launch block hash is also re-read after `eth_getLogs`; a mismatch fails the sync before checkpoint advancement (`REORG_DURING_SYNC`). The batch boundary hash is checked before the read, after the read, and immediately before checkpoint commit. If it moves after launch rows were written, the uncommitted batch is rewound and the sync fails (`REORG_DURING_COMMIT`).

## Deliberate fail-closed choices

- `SENTRY_START_BLOCK` is required; the CLI refuses to invent historical authority.
- The canonical factory address, Ink chain ID, ERC-1967 implementation address, proxy code, and implementation code are checked at the confirmed target block and at both endpoints of every historical catch-up batch. Catch-up therefore cannot silently cross an unreviewed implementation epoch. Any implementation drift halts before checkpoint advancement.
- Incomplete confirmed logs throw.
- Contradictory duplicate deployment events throw.
- Mutually inconsistent Sentry launch-type flags throw.
- No wallet, signer, approval, transaction construction, or broadcast code exists.

## Acceptance gate

- deterministic/case-normalized launch identity;
- event-variant collapse without double counting;
- bounded catch-up;
- restart resumes after checkpoint;
- duplicate launch insertion is idempotent only for matching authority data; contradictory duplicates fail closed;
- checkpoint hash mismatch rewinds only while the persisted guard proves the reorg is within the configured horizon; deeper/unverifiable reorgs halt;
- proxy implementation drift at the target or either historical batch endpoint halts without advancing ingestion state;
- commit-window reorg removes the just-written uncheckpointed batch;
- SQLite persistence passes exactly-once/rewind smoke test;
- CI build + selfcheck + truthcheck green.
