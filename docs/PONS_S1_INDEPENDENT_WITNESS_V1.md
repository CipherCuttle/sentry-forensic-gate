# PONS S1 — independent read-only V1 paired-batch witness (INERT DRAFT)

**Stack:** this change targets draft PR #80, which itself targets the newer
paired V1 protocol in PR #79. This is NOT the first-96/24h V0 release
witness in incompatible PR #75.

## Contract

The pure `scripts/pons-s1-independent-witness-core-v1.mjs` validates a
previously frozen `PONS_S1_PAIRED_PREOUTCOME_DECISION_BATCH_V1` without
reading any market outcomes. Only a **separate main-only GitHub Actions job**
may label its inputs independently acquired. Local JSON replays prove
payload consistency, not independently authenticated GitHub provenance.

The main-only witness, when separately merged and when a real approved
activation/source-run exists, retrieves independently through GitHub:

- Published release **by fixed numeric ID**, separate asset metadata,
  exact lightweight tag and the **actual asset bytes**. Require
  `immutable: true`, `draft: false`, exactly one asset, matching
  `sha256:` digest and raw canonical bytes, exact reviewed activation
  tag SHA and consistent release/asset metadata.
- Verified merge PR, exact post-merge activation commit and its **single
  parent**, ancestor comparison to canonical `main`, reviewed protocol
  digest, and an existing canonical authorization manifest. The witness
  **does not manufacture** any authority or activation receipt.
- An exact successful **main-only source collector run** at the approved
  activation SHA. Its sole expected Actions artifact must be
  `pons-s1-frozen-batch-<batchDigest>`, created before the earliest
  five-minute target and before release asset creation. The raw
  `source/batch.json` from that run is compared **byte-for-byte** with
  the immutable release asset. An unavailable, expired, ambiguous,
  post-outcome or wrong-run artifact fails closed.
- For batch N>0, reacquire the immediately preceding release, asset,
  tag and raw bytes, and validate its exact batch digest, previous
  publication timestamp, exact cursor, cumulative eligible count and
  activation ancestry. A copied self-asserted seal is never accepted.
  This is **one-hop verified lineage**, not a proof that arbitrarily
  long earlier chains of batches were themselves ever complete.

GitHub timestamps are interpreted conservatively: a whole-second
`published_at` is treated as the full second, not an idealized millisecond
at its start. Publication must finish strictly before the earliest
pre-outcome native launch or predetermined inclusion + five-minute
deadline. Empty/non-native-only batches have a distinct ten-minute
**operational expiry**, not an invented hypothetical trade deadline.

The witness only emits an evidence-integrity receipt. It explicitly sets
`sourceQualified:false`, `scientificAdmissibility:BLOCKED_PENDING_SOURCE_ATTESTATION`,
`fullHistoricalLineageAttested:false`, and zero trading, model, merge or
collection authority. An independently downloaded GitHub artifact is still
not proof that its producer actually scanned **all** eligible factory
events, obtained honest point-in-time C0 decisions, modeled realistic
synthetic inclusion, or had complete Curve/V4 route/cost information.

## Why this workflow cannot be used yet

The currently selected S1 protocol still has
`DRAFT_RECONCILED_NOT_ACTIVE`. The future file
`authority/pons-s1-publish-v1.json` and its reviewed,
main-only `pons-s1-prospective-collector-v1.yml` **do not exist** in
the draft stack. There is no authorized source run or immutable V1
scientific release. PR CI only runs synthetic positive/negative tests,
with no network or release-write authority. The manual main-only witness
has only `contents:read` and `actions:read` and must fail closed if
canonical inputs are missing.

## Next actual feasibility gate

Adapt and independently qualify #74's dual-source factory census/cursor
logic for PR #79's paired protocol, including **pre-outcome C0 decisions
and evidence**, unknowns, 12 confirmations at C0 and the frozen
synthetic inclusion block. Then do one bounded, **non-scientific**
real-chain/RPC timing rehearsal. Measure the full
factory discovery -> launch+2 C0 -> inclusion -> 12-confirmations ->
freeze -> runner queue -> draft/upload/publish -> independent witness
time budget; record missed deadlines and bursts, not just successes.
A second harmless test release requires separate explicit publication
authorization; the prior single dummy smoke was not blanket permission.

An independent hostile protocol/power review and full route/cost
evidence are additional activation blockers. Do not merge, enable
real prospective enrollment, publish real S1 data or move money
without new scope-specific authority.

**Current status: INERT / NO SCIENTIFIC COHORT / EDGE_UNPROVEN.**
