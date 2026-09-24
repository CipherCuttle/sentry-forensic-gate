# PONS S1 C0 source observer V1 — candidate, not active

Status: **INERT PR-ONLY ENGINEERING QUALIFICATION. EDGE_UNPROVEN.**
Stacked on draft #82. No authority to merge, activate a prospective cohort,
run the observer on live event streams, write a release, spend, sign or broadcast.

## Provenance and causality

The frozen portable baseline reads the launch+2 decision block only after
two more canonical blocks are observable. The old draft's launch+2 simulated
entry was not causally admissible. This candidate therefore:

1. Requires two independent RPCs on chain 4663, matching factory runtime
   bytecode hash, complete full launch-block factory logs (native *and*
   non-native), and launch/decision block hashes. A different URL hostname
   is only a weak independence heuristic, **not** provider qualification.
2. Identifies the native launch event against both raw log sets. The existing
   read-only viem adapters build the frozen five-notional baseline at
   launch+2 and derive the unchanged buy-every-executable C0 control.
3. Re-reads both canonical heads **after** all quotes and the C0 decision;
   takes the minimum head, independently checks that head's block hash, and
   checks launch/decision hashes again to detect a read-time reorg. Captures
   the C0 wall clock then, not at runner start. An inclusion candidate can
   only be that **completion head + 2 canonical blocks**, not launch+2.
4. Rechecks the canonical launch timestamp and enforces 90 seconds of
   remaining time before launch+5m to permit a future immutable source
   seal. It NEVER treats a local wall clock as independently attested.
5. Produces a deterministic, replayable complete launch-block source
   observation and C0 decision receipt with matching SHA256 content digest.
   The standalone binder replays all stored C0 sources, requires complete
   native-event coverage, and cross-binds factory logs and canonical block
   points before handing receipts to the still-inert #82 builder. Pure
   replay verifies consistency, **not original acquisition time or RPC
   authenticity**. A future independent witness must fetch the original
   provider proofs and verify their GitHub publication timestamp.

The unchanged V1 batch still seals only factory event **identities**; the
complete full-field dual-source sidecar digest is not committed by the
current V1 immutable publisher or independent release witness. Do not call
this source-qualified or activate until a reviewed versioned protocol/schema
and independently timestamped original source artifact bind these bytes
to the cohort. Do not silently change the canonical V1 publisher to
reinterpret its old digest.

## Boundaries

- `scripts/pons-s1-c0-observer-core-v1.mjs`: pure source/evidence builder
  and deterministic replay; local receipts are untrusted pending independent
  GitHub source-artifact witness.
- `scripts/pons-s1-c0-source-bind-v1.mjs`: pure full-denominator sidecar
  binder. It demands all native events in the supplied scanned window, so
  partial-cursor batches require a separately reviewed producer plan.
- `scripts/pons-s1-c0-observer-v1.mjs`: candidate actual read-only
  runner. Requires `GITHUB_REF=refs/heads/main`, pinned repository,
  `PONS_S1_READ_ONLY_OBSERVER=EXPLICIT_CANONICAL_READ_ONLY`, a
  separately approved frozen protocol with the revised inclusion rule,
  separately approved authority file (currently absent), official RPC,
  and separately provisioned independent archive RPC. There is no
  workflow_dispatch, schedule or main acquisition workflow in this PR.
  This runner must not be executed for an S1 cohort from a draft.
- `.github/workflows/pons-s1-c0-observer-v1.yml`: PR-only,
  `contents:read`, synthetic offline qualification. No secrets or
  networking in the qualifier, no deployment, no release or collection.
- No outcome adapters, live wallet, signer, trade or model promotion.

## Open scientific/activation blockers

1. A separately reviewed **prospective** inclusion rule and preregistration
   amendment; synthetic inclusion is never a real fill.
2. Pre-outcome **external immutable source-artifact timestamp** that
   independently attests complete full-factory transcripts, original
   acquisition timestamps, full C0 quote evidence, and C0 completion head;
   separately replayable witness before any release promotion.
3. Independently qualified RPC providers, ideally independent C0 quote
   verification or a documented asymmetry/error taxonomy.
4. Typed pre-outcome UNKNOWN receipts when archive/quote/metadata RPC fails.
   Candidate runner currently fails closed rather than fabricating a
   decision; such a failure would invalidate a complete denominator
   unless a reviewed retry/UNKNOWN policy is implemented.
5. Observed real chain timing proving that 2 C0 confirmations, post-C0
   inclusion+2, **12 inclusion confirmations**, external release and
   independent witness all happen *before* the earliest launch+5m outcome.
   If not, stop and revise prospectively while outcome-blind.
6. An approved cursor/sidecar manifest that covers all source bytes and
   handles selected-cap partial blocks without incomplete native census;
   an explicit activation/merge authorization. Existing #82 publication
   authority remains hard-disabled.
7. Full route/cost/quote feasibility, risk-adjusted power review and
   independently assessed scientific merits before any shadow operation;
   positive results would not authorize money.

## Offline acceptance

`node --check` each changed script and
`node scripts/pons-s1-c0-observer-check-v1.mjs` exercise synthetic
native C0, REJECT, UNKNOWN, deterministic replay/binding and hostile
tamper/census/timing tests. No real prospective sample is observed.

## Typed UNKNOWN addendum (draft PR #85)

After full dual-provider native-event identity and pinned factory runtime have
been verified, a launch normalization, quote/USD baseline or control failure
produces a versioned `UNKNOWN_PREOUTCOME_C0` source observation. Finite
stage/code enums, exact full dual logs and rechecked canonical completion
head are retained. No quotes, hypothetical entry or eligibility are invented.
The unchanged binder requires a record for every native event in its window.
Raw adapter exception strings and private RPC URLs are never serialized.

Failures *before* the full dual-source factory identity is established,
canonical head disagreement, runtime mismatch, reorg or failure to acquire
the fresh completion head remain fatal. They cannot be quietly converted
into UNKNOWN or treated as a complete census. Local typed receipts remain
untrusted until independently timestamped original evidence is acquired.
This addendum grants no cohort, source-release or money authority.
