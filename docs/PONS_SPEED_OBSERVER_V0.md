# PONS speed observer V0 — read-only HTTP vs RPC WebSocket

**Status: bounded instrumentation only; NO LIVE MONEY, signing, broadcast, automatic launch decisions, launch purchases, model promotion, or merge authority.**

This change is stacked on S1 design PR #76, but it has its own scientific purpose. It must not mutate S0 evidence or silently activate the distinct S1 collection PRs (#73–#75). Those S1 drafts currently have incompatible denominators / start rules (96 first future launches per day versus 200 consecutive native-pair C0 decisions over at most seven days); reconcile under separate reviewed governance before activating either.

## Measurement contract

1. Bind chain 4663 and hash the reviewed Pons V2 factory runtime before observing; stop on identity mismatch.
2. Start a same-process, local-monotonic HTTP `eth_getLogs` poller at approximately the current head. An optional **RPC** WebSocket provider subscribes to the exact same factory `TokenLaunched` event via `eth_subscribe`. The official Nitro **sequencer feed is not an Ethereum JSON-RPC WebSocket** and is NOT consumed by this adapter.
3. Record local arrival of every structurally valid (block hash, tx hash, log index) event from each transport. Deduplicate overlapping polls, retain removed-log notifications and block-hash conflicts. HTTP scanning intentionally overlaps recent blocks to catch delayed indexing; failed reads do NOT advance its coverage cursor.
4. Compare arrival latency **only for the same complete log identity on the same host and monotonic clock**. Positive `wsLeadMs` means WebSocket arrived earlier than HTTP. Unpaired or fork-conflicted events provide no comparison. Source errors and a zero-paired sample are **INCONCLUSIVE**, not evidence one source wins.
5. Optionally time a limited number of calls to the existing read-only `ViemPonsV2LaunchAdapter.catchUp` as a *separate downstream materialization sample*. That is not full E0 entry planning or preflight. No private keys, wallet clients, signing, transaction construction, stateful recovery, or funding. No keys/endpoint URLs printed.
6. Block timestamps are coarse chain timestamps and **must not** be used as subsecond evidence of transport advantage or sequencer arrival. This benchmark does not establish buy priority, latency at the sequencer, actual fill quality, or expected return.

Robinhood documents a rate-limited public RPC and separate public sequencer feed; for useful transport comparisons obtain a separately provisioned production-grade RPC HTTP+WebSocket pair and run both from the **same host**. The program accepts endpoints only through the local environment, never Git or GitHub logs. Source docs:
- https://docs.robinhood.com/chain/connecting/
- https://docs.robinhood.com/chain/
- https://viem.sh/docs/contract/watchContractEvent

## Running locally (explicit manual action)

```sh
pnpm install --frozen-lockfile
pnpm build
# With public HTTP only, no HTTP/WS winner can be claimed:
PONS_SPEED_DURATION_SECONDS=45 node scripts/pons-speed-observer-v0.mjs

# For a paired comparison, supply privately issued HTTPS and WSS RPC credentials:
PONS_SPEED_HTTP_URL=https://YOUR_RPC_HOST/... \
PONS_SPEED_WS_URL=wss://YOUR_RPC_HOST/... \
PONS_SPEED_DURATION_SECONDS=60 \
PONS_SPEED_POLL_MS=1500 \
PONS_SPEED_VERIFY_SAMPLES=2 \
node scripts/pons-speed-observer-v0.mjs > speed-observation.jsonl
```

Never commit the resulting local JSONL if it contains sensitive business context. The runtime does not print configured URLs, but operator shell histories may contain embedded API tokens; use secure local environment injection. Both transport endpoints should be tested from the same physical execution host, repeatedly and across different launch periods.

## Qualification and acceptance

- Offline `node --check` for both scripts and `node scripts/pons-speed-observer-v0-check.mjs` pass on exact branch head, including duplicate, provider-only, fork/reorg, removal, capacity and read-only surface tests.
- Bounded manual HTTP run may use the official public RPC as an *availability smoke only*; if it is throttled or fails, retain its exact inconclusive status. GitHub Actions never receives credentials. No continuous or unsupervised collection in this PR.
- Review one report containing counts, pairing rate, signed WS-vs-HTTP lead distribution, missing feed observations, error counts, head coverage and verification-sample durations. A compelling speed improvement requires multiple paired observations, clock/source qualification, and a separate decision rule **frozen before any new scientific outcome**.
- Future independent lane: decode genuine `BroadcastFeedMessage` envelopes from Robinhood's sequencer feed, validate source/ordering and correlate by transaction receipt. Never attach the feed URL to `viem.webSocket()` and assume `eth_subscribe`.
- Future entry-timing study and full execution-cost/route qualification are separately approved stages; do not bundle them into this measurement-only PR.

**Explicitly not included:** sniper trading, higher slippage, fee bidding, mempool transaction previews, insider-list decoding, autonomous token selection, persistent WebSocket server, production deployment, cron or webhook activation. The existing single-token E4 canary authority stays one-shot and unchanged.
