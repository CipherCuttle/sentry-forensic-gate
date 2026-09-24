# Pons speed observer V0 — ONE bounded hostile review

Date: 2026-09-24 CEST.
Scope: read-only HTTP/RPC-WS factory event arrival telemetry, pure matching ledger, offline regression, explicit manual-only network probe and docs. This is not a security approval for money or an S1 scientific activation.

## Independent challenges applied to the code

- Observer identity must bind reviewed chain 4663, factory runtime and exact event; cloned token names and other factories excluded.
- Never equate coarse block timestamps with arrival latency, an event feed with the sequencer, a paired delivery event with canonical finality, or an early quote with transaction inclusion.
- All comparisons require a *single-process* monotonic clock and identical block-hash/tx-hash/log-index event identities; unknown/unmatched sources remain unresolved.
- Overlapping HTTP polls must dedupe and failed reads must preserve scan position; changes to block identity must not fabricate paired source winners.
- WebSocket failure must not silently be reported as a victorious HTTP measurement; transport URL credentials must not appear in output.
- Source cannot construct/sign/send transactions, import a wallet client, accept private keys or open live authority.
- Offline test coverage must include duplicate, missing feed, fork, removed log, incomplete log and cap; CI must not be interpreted as a scientific finding.

## Findings

**HIGH H1 / pending:** The optional existing-launch materialization sample was started by whichever feed reported a launch FIRST. A low-latency WS observation may arrive before the configured HTTP/archive provider can query that block, so an early but valid source can disproportionately produce failed verification samples. Conversely HTTP-first observations may start after the network has stabilized. This is an avoidable **source-conditioned selection bias** in the advertised downstream timing sample. Repair: start optional materialization only from the first **HTTP-observed** instance of an event; the WS-vs-HTTP delivery comparison remains independent. For launch verification, note it is an HTTP-confirmed candidate timing sample, not end-to-end opportunity detection or transaction preflight.

**MEDIUM M1 / repaired in earlier commit:** Initial CI assumed a `pnpm-lock.yaml` file, but this repository intentionally uses `pnpm install --no-frozen-lockfile --lockfile=false`. The public smoke job failed before code execution. Workflow updated to match canonical `ci.yml`. This does not invalidate the pure offline PASS.

**MEDIUM M2 / documented limit:** A paired, same-block-hash event might later be orphaned by a chain reorg if providers omit a removed-log notification. Ledger already flags seen hash conflicts and explicit removals; nevertheless its measurements are **provisional source-delivery telemetry**, not finalized canonical-launch counts. Later economic evaluation needs a separate confirmation/reorganization gate.

**MEDIUM M3 / documented limit:** Public HTTP may be rate limited and the optional probe is deliberately non-gating. Only the offline job passing may be described as verified if public RPC is unavailable. No WS performance comparison can exist without a supplied genuine RPC-WS endpoint. A Nitro sequencer feed is not an Ethereum `eth_subscribe` source.

**LOW:** No planned production activation, token-scoring/creator exemption logic, synthetic priority-fee bidding or widened slippage belongs in this PR.

Review scope initially **0 Critical / 1 High**. Fix the exact H1 issue, rerun focused offline and build qualification, perform ONE targeted rereview, and stop. No unlimited review loops.
