# Pons opening allocation V0 — bounded hostile self-review

Scope: direct factory launch + verified factory forwarder launchAndBuy decoding, recorded launch-time snipe-tax exemptions, same-transaction canonical CurveBuy receipts, read-only scout and fixtures. NO trading.

## H1 (High): caller-supplied decoded event can differ from the actual receipt

The first pure attestor trusted `launchLog.args` from the caller and checked only matching tx/block/log-index/address, not the **byte-level topics and data** of that receipt log. A developer integrating an incorrectly decoded or manipulated event could report a different token/curve/initiator under the same receipt identity. The current CLI decoded actual logs itself, but a reusable evidence function cannot make that assumption.

**Required fix:** parse and decode the factory's exact `TokenLaunched` ABI **inside the pure attestor** from the matching receipt log; use those decoded fields as the authority. Reject differing supplied topics/data/args, and extend offline fixtures to cover tampered call-supplied args or log bytes. This does not require network or wallet operations.

## Additional reviewed boundaries

- Unknown transaction targets, function selectors, token or curve code identity, factory record mismatch, reverted tx, stale/historical RPC reads and block-hash drift must fail closed.
- Same-tx CurveBuy records count actual token allocations to exact recipient addresses only; they must **not** imply real beneficial ownership or a full first-block census.
- Verified launchAndBuy recipient gets automatic exemption per official Pons V2 docs; extra exemption list still capped; direct factory launch has launcher and fee recipient exemptions. No proxy score.
- No private keys, send/write APIs, recurring collection, freeze change, slippage change, model promotion, merge or live execution.
- Offline fixture-only PASS cannot be described as a live-chain ABI witness. Separately qualify against a real, recent Pons transaction and the canonical historical archive RPC.

Initial hostile self-review: **0 Critical, 1 High**. Repair H1, rerun dedicated read-only CI and one targeted rereview. No repeated review loops.
