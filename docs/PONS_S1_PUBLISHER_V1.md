# PONS S1 V1 — paired-protocol publisher transport, hard-disabled draft

**Status: DRAFT / DISABLED / synthetic-only qualification. No merge, real-batch
publication, collection, unattended execution, wallet, transaction or model authority.**

## Why not reuse the V0 publisher directly?

The latest [single-protocol candidate](../docs/PONS_S1_ONE_PROTOCOL_RECONCILIATION_V1.md)
(PR #79) chooses the inclusion-anchored paired 5m/24h hypothetical $1 design:
first 200 consecutive point-in-time C0 WOULD_TRADE decisions or seven days.
Old PRs #73–#75 use first 96 native launches/24h and launch+5m.
Their immutable-release mechanism is instructive; their batch structure,
selection law, outcome clock and verifier must **not** be silently reused.
This draft copies **none** of the old research enrollment artifacts.

## Bounded transport scope

- V1 typed exact canonical asset bytes; strict schema, protocol digest,
  separately authorized activation commit and reviewed merge identity,
  full factory census including nonnative and unknown C0, point-in-time C0
  decisions/evidence digests, planned inclusion anchor, 12 confirmations after
  launch+2, continuous block/log cursor and previous immutable batch pointer.
- At most 16 scanned blocks and four newly selected C0 decisions per release.
  Even a zero-event scan must be externally sealed before its cursor advances.
  A matching checksum is not independently authenticated chain evidence:
  collector/RPC completeness and C0 point-in-time truth remain separate gates.
- The exact frozen `batch.json` is an output from a **future** independently
  qualified main-only collector workflow, never generated or amended by this
  publisher. Synthetic fixtures are explicitly non-scientific.
- The manual publisher job is **hard disabled with `&& false`** and runs no
  release-write operation in this draft. Once separately approved/reviewed,
  its own isolated job, not the general scheduled collector, would have scoped
  `contents: write`; ordinary CI and the manual independent witness retain
  `contents: read`.
- The future job can operate only when a canonical, independently approved
  manifest exists on main, the selected `activation_sha` equals the current
  main checkout SHA, GitHub REST confirms that this commit descends from
  the reviewed main merge, and the source run is the approved successful
  main-only collector at the exact activation SHA. Its artifact name is
  `pons-s1-frozen-batch-<sha256>`. None of these future files/run surfaces
  exists in this draft. A user-supplied SHA must never be executed under the
  release-write token.
- First fetch old release/asset/tag/bytes independently for non-genesis
  publication. Validate its exact downloaded bytes and singleton immutable
  release, cumulative selection and exact cursor before accepting the next
  batch. The prior release must predate the current captured batch.
- Require at least 90 seconds between preflight and earliest possible
  selected five-minute outcome; every native C0 decision, including UNKNOWN,
  contributes a launch-based deadline. Selected WOULD_TRADE additionally
  contributes its predetermined inclusion-based deadline. For empty/nonnative
  scans, use a distinct 10-minute *operational* expiry, not a price outcome.
  The final GitHub `published_at` timestamp is checked against the deadline
  using an upper bound for whole-second precision.
- One deterministic tag `pons-s1-paired-v1-batch-<batchDigest>` pinned to the
  activation commit, one draft prerelease with one asset, then publication.
  Existing tag/release or partial attempt always fails closed. Never delete,
  overwrite, re-sign, reinterpret or automatically retry a partial release.
- Reacquire release, asset and tag through REST, download the published asset
  and compare raw bytes. Publisher self-readback is a diagnostic **only**; an
  adapted independent *V1* main-only, read-only witness must separately verify
  the resulting IDs and immutable state before scientific admission.

## Failures and authority boundary

There is **no** approved `authority/pons-s1-publish-v1.json`,
`.github/workflows/pons-s1-prospective-collector-v1.yml`,
qualified live V1 batch, immutable V1 external witness, or canonical activation
receipt. A manual dispatch cannot unlock this draft. CI runs offline fixtures
only; it does not use chain RPC or release-write credentials.

Partial publication (tag exists, draft exists, late release, failed source
check, failed 12-confirmation gate) remains **NOT ADMISSIBLE**. Preserve the
attempt artifact and stop. The immutable evidence of a failed attempt is
not a successful batch and no denominator may be shortened afterward.

## Required before any future enablement

1. Independent hostile review of canonical S1 protocol, pre-activation
   sample power, exact producer/witness implementation and activation lineage.
2. A source-authenticated paired C0 producer proving complete factory
   denominator, official/archive hash+log agreement, first eligible decisions,
   exclusion/unknown C0 and genuinely point-in-time baseline evidence. Raw
   count/digest assertions alone are not source authentication.
3. Separate **read-only V1 witness** verifying independent external metadata
   and exact downloaded bytes against the V1 protocol and frozen activation;
   prove that source/canonical batch ancestry cannot be forged.
4. Controlled non-scientific **real chain/RPC** rehearsal measuring 12
   confirmations, C0 preparation, Actions start latency and draft/upload/
   publish/REST witness under the true five-minute envelope; no future
   outcome access, no strategies or money. Failed or late attempts count.
5. Exact curve/V4 phase and recipient-aware tax/cost evidence, frozen
   inclusion-latency rule, sequential $1 capacity and eventual 24h maturity.
6. A **new explicit user approval** for reviewed merges, canonical activation
   and real S1 evidence publication. Distinct approvals for unattended
   operation or live money. Keep old V4 recovery readiness failures visible.

The prior harmless [one-shot release smoke](https://github.com/CipherCuttle/sentry-forensic-gate/actions/runs/35946232150)
proves the repository's immutable-release setting, not this publisher's
prospective timing or independent V1 proof.

**Verdict until those gates close: SOURCE_REUSE_PUBLISHER_DRAFT / EDGE_UNPROVEN.**
