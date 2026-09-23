# PONS S1 — disabled prospective collector V0

## Contract

This is a **manual, read-only implementation on a stacked draft branch**.
It does **not** activate a prospective campaign, schedule collection, issue
authority, sign, broadcast, merge, promote a model or move funds. The canonical
activation file `authority/pons-s1-activation-v0.json` intentionally does
not exist and the S1 prereg remains `DRAFT_REVIEW_ONLY_NOT_ACTIVE`.
Both must change through a separately reviewed future canonical activation;
CLI flags alone cannot activate this version.

The sole primary outcome remains the preregistered **launch + five-minute
full-balance hypothetical exit**. The already-inspected S0 96-launch cohort
is historical context and is forbidden as S1 prospective validation.

## Code ownership / reuse

- `scripts/pons-s1-collector-core.mjs`: deterministic, dependency-light
  canonical batch selection, 12-confirmation and reorg guards, chained cursor,
  strict origin proof, chronology and outcome-availability seal gates.
- `scripts/pons-s1-prospective-collector.mjs`: a read-only viem public client
  and the existing reviewed Pons launch, USD, baseline and forward-outcome
  adapters. Its only write is a new exclusive/fsynced local JSON file.
- `scripts/pons-s1-collector-check.mjs`: fixture-only negative-path
  regressions. It uses no provider and makes no network call.
- `.github/workflows/pons-s1-prospective-collector-v0.yml`: PR qualification
  only, `contents: read`, no schedule and no manual collection.
- `scripts/pons-s0-cohort-lib.mjs` and the superseded single-process historical
  materializer replace process spawning with an exact detached Git HEAD read;
  they still require the original PR-A source SHA. This unblocks CI without
  suppressing ast-grep or modifying the immutable historical 2026-09-22
  evidence commit. **Do not rerun S0 and call its new script hashes the
  original archived identity.**

## Why selection must be incremental

The frozen pilot enrolls the earliest 96 native-pair Pons launches or those
within the first 24h. If all 96 are selected only at the end, the earliest
five-minute outcomes may already be known. The collector therefore selects at
most **four native launches per batch**, scanning no more than **16 confirmed
blocks per invocation**. Each scan emits its event order, a digest of the complete factory event set (including non-native pairs), cursor (including log index if interrupted in a block), block hashes,
predecessor digest and a pending batch digest. Both the pinned official Robinhood log source and an independent archive-state provider must agree on **every factory event** and the canonical end-block hash, with an explicit factory-runtime check; missing or disagreed logs fail closed. It refuses stale selections
where the earliest new primary outcomes already exist. Every batch, including
an empty checkpoint, must be externally sealed before the next invocation.

Raw event selection happens before any baseline, exit quote or outcome read.
Never backfill a late missed batch, skip an unverified baseline, reinterpret
a rejected launch as out of sample or widen the denominator. If upstream
provider timeouts or missing RPC data make a run late, **safe stop**.

## Two distinct CLI operations after future activation

`enroll` uses only pinned factory events and canonical timestamps. It
requires 12-block-confirmed head state and revalidates the exact factory
runtime via the reviewed launch adapter. Output is a fresh immutable-intended,
local-only `PENDING_EXTERNAL_IMMUTABLE_SEAL` JSON document. No outcome RPC
operation is called in this mode.

A separately authorized **canonical** release publisher must anchor
the exact canonical batch bytes in an immutable GitHub release before any of
that batch's primary outcomes mature. Every later batch must include the prior
canonical release asset and an independently fetched exact release/asset
attestation. **This PR intentionally provides no release publisher or
scheduled operation.** The offline core rejects a missing/mutable/late seal,
but self-reported JSON metadata alone is **not independent external
attestation**; an activation workflow must verify against GitHub's API. A
GitHub-hosted PR workflow must not carry release-write permissions.

`measure` is also behind the missing activation file. It requires a batch
and seal, re-proves block hashes, materializes the reviewed Pons launch,
reconstructs the launch+2 baseline on the exact historical block, applies
frozen C0/C1 deterministic comparators with missing creator history explicit,
and obtains the existing fixed five-minute Pons forward executable outcome.
It does **not** claim a model prediction was produced at entry time:
baseline measurements are later historical reconstructions. It does **not**
rewrite a C0 minimum-$0.25 acceptance into guaranteed $1 execution; a
separate exact $1 entry and independent reverse must also be executable,
otherwise the record is a documented non-entry.

It reports all selected events in the batch, including missing baselines,
non-entry and pending outcomes. Reconstructed full execution costs,
sequential buy/sell price impact, live-wallet persona parity and
quote-to-inclusion latency remain **UNVERIFIED** unless separately evidenced.
No economic winner, profitable-strategy or model artifact is produced.
`measure` marks its own seal verification as non-independent until a later
canonical read-only GitHub API witness verifies it.

## Future activation preflight — NOT DONE in this PR

1. Independently review this exact collector SHA and the frozen S1 contract.
2. On a separately authorized canonical activation commit, install a
   content-addressed activation receipt identifying the exact source,
   collector file SHA-256, merged-at UTC time and origin `merge + 6h`.
3. Independently revalidate the canonical checkout, reviewed source code
   subtree, pinned Pons factory, archive RPC capability, immutable release
   storage and no-backfill polling reliability **before** activation.
4. Use a controlled external append-only release writer and an independently
   verified release witness between `enroll` and `measure`. Do not place
   GitHub release write permission in the draft PR workflow.
5. The pilot remains exploratory until its predeclared full denominator,
   cost and exit-feasibility gates close. The live execution grant, autonomous
   activation and any strategy promotion remain separately prohibited.

## Verification

`node scripts/pons-s1-collector-check.mjs` is fixture-only; then
`pnpm test` on the exact PR head. One bounded hostile review should focus on
the activation receipt's trust root, immutable publication race, intra-block
cursor continuity, archived point-in-time state, missing-data denominators,
and synthetic/real sequential execution divergence.

**Current verdict: IMPLEMENTATION IN REVIEW; no actual prospective
enrollment or economic verdict.**

## Bounded adversarial self-review — implementation, not independent sign-off

Reviewed the current draft against direct/indirect network access, one-provider
log omission, cross-provider block disagreement, duplicate native launches,
intra-block cursor continuation, reorgs, late selection, late or forged seal,
missing entry and cost evidence, and accidental signer/wallet authority.

The independent provider-log agreement, exact canonical factory code proof,
strict token uniqueness and partial-block cursor revalidation were implemented
and added to the fixture suite. The inherited historical process escape was
removed without granting generic rule exceptions; archival evidence remains
referenced by its original reviewed commit. This is a **self-review**, not
an independent external security review.

**Activation-blocking work outside this draft remains:** canonical externally
attested activation identity and source-tree ancestry; an actual append-only
immutable release publisher and separate GitHub API asset verifier; verified
prospective polling/catch-up reliability under the five-minute deadline;
proven archive-state availability; and a conservative complete-path cost
model. Until those gates pass, every measurement has no promotion authority,
and unattended spending is forbidden. A separate independent hostile review
of the exact implementation is still required.
