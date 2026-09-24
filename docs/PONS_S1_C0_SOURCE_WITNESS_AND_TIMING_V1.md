# PONS S1 C0 external source witness + real-chain timing (INERT)

Date: 2026-09-24. Stack: draft PR #83. Scientific verdict: EDGE_UNPROVEN.
No merge, real S1 collection, signing, trading, immutable release write,
spend or model promotion authorized.

## What this changes

The existing #81 immutable V1 batch witness proves batch-release bytes but
does NOT establish that the original C0 full-source transcript existed before
the launch's five-minute outcome. The #83 observer produces replayable local
evidence, not externally authenticated timestamps.

The candidate C0 external source verifier independently checks **both**:
(a) the exact original artifact from the reviewed main-only collector run,
uploaded before launch+5m according to conservative GitHub artifact.created_at,
and (b) an existing, separately authorized **immutable singleton source
release**, with the *same exact bytes* and matching GitHub SHA256 metadata,
published before launch+5m. It checks the immutable lightweight tag pinned
to approved activation, the activation parent and reviewed merge PR, main
ancestry, canonical protocol/authority digest, source run's reviewed path and
exact SHA/first attempt, original artifact identity and expiration, complete
single-launch-block dual-provider event transcripts, unchanged five-notional
C0 replay, completion head and local timing consistency. A one-second GitHub
timestamp is interpreted by its **end**, never its start.

The candidate future main-only read-only GitHub witness workflow CANNOT run
successfully on this draft: the canonical authority file and active amended
protocol are absent, as are the original S1 source run and immutable source
release. It does not create or authorize a release. Offline tests use invented
GitHub API metadata and must not be called actual independent attestation.

The separate **one-shot PR-only real timing diagnostic** uses the pinned
Robinhood Chain official public RPC and only eth_chainId, eth_blockNumber
and eth_getBlockByNumber, capped at 180 JSON-RPC requests and 180 seconds of
polling. It selects a **block proxy, not a token**; observes block +2
decision, +2 maturity, a fresh **no-quote** completion head, inclusion
candidate head+2 and inclusion+12 confirmations; checks block hashes again.
A second read-only Actions job independently fetches the first job's
rehearsal artifact plus GitHub-created timestamp and records the remaining
five-minute budget and frozen 90-second reserve.

This real-chain timing measurement **does not** test actual C0 quotes,
independent archive RPC, event discovery, source/publisher releases, GitHub
queue latency, the final independent release witness, full Curve/V4 routes
or real gas/slippage. The PR's GitHub timestamp is a non-scientific diagnostic.
Even a green real-chain test proves neither production feasibility nor edge.

GitHub Actions source artifacts are only immutable **within retention** and
can be deleted/expired. Permanent source evidence needs an immutable release,
versioned V2 sidecar commitment from the frozen batch, independent cross-run
witness and preserved full lineage. V1 batch only commits event identities;
this PR intentionally does NOT retrofit its schema. Source witness output
must still set sourceQualified=false and scientificallyAdmissible=false.

## Remaining blockers

- Separately reviewed prospective entry/inclusion protocol and power review.
- Approved scalable pre-outcome source seal, batching, GitHub rate and
  queue limits. A release per C0 event is proof-of-concept, NOT endorsed for
  200 eligible events, bursts or fast-moving launch conditions.
- Independent provider/quote authenticity, typed pre-outcome UNKNOWN on
  failure, complete full factory census across partial cursors and bursts.
- Real dual-RPC C0+quote, inclusion+12, original artifact upload, pre-outcome
  durable release, final batch freeze/release, external witness and clock-skew
  rehearsal. If any misses the earliest five-minute deadline, STOP and
  prospectively revise outcome-blind before enrollment.
- Accurate entry+exit, approval/Permit2, Curve-to-V4 route, gas and slippage
  costs and independent economic analysis. No trading authorization.

Acceptance is exact-head offline tests + repository CI, plus a separately
reported real public-chain timing diagnostic. Never present a synthetic
fixture or PR rehearsal artifact as a real prospective S1 cohort.
