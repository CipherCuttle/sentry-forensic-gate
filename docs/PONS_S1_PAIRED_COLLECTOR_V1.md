# PONS S1 — paired point-in-time C0 collector V1 (INERT DRAFT)

**Stack:** PR #79 paired-protocol draft → #80 disabled immutable publisher →
#81 independent read-only immutable witness → this prospective collector
changeset. No earlier V0 96-launch/24h producer can emit V1 scientific
observations. Scientific status **EDGE_UNPROVEN**.

## Scientific timing correction — independent review required

The existing reviewed portable baseline observes the launch+2 decision
state **only when decision block +2 has become available**; see
`PORTABLE_BASELINE_CONFIRMATIONS=2n` and `matureAt=decisionBlock+2`.
Therefore **entry in the same block as C0 maturity is not causally
defensible**. The selected V1 prereg JSON currently says only
`QUALIFY_AND_FREEZE_BEFORE_ACTIVATION_OUTCOME_BLIND` and does **not**
specify its exact synthetic inclusion rule. This collector fails closed
until a new, separately reviewed protocol pins
`timing.syntheticInclusionRule =
OBSERVED_C0_COMPLETION_HEAD_PLUS_TWO_CANONICAL_BLOCKS_V1`.
No canonical protocol or authority file has been silently activated.

For each native factory event: observe the frozen launch+2 C0
block, require the baseline's two confirmation blocks, record the
**actual head block and hash at completion** and the completed C0
wall-clock timestamp, then predeclare inclusion at the canonical
**head+2** block. The same exact inclusion block and timestamp anchor
both five-minute and 24-hour hypothetical exits; neither is a real
fill. This rule still needs an external independent scientific review
of clock latency, actual block creation, selection and execution
realism before it becomes authoritative.

## Deterministic offline builder

`scripts/pons-s1-paired-collector-core-v1.mjs` is a pure builder for
`PONS_S1_PAIRED_PREOUTCOME_DECISION_BATCH_V1` exact bytes.
It accepts dual-source factory event and canonical block transcripts
and point-in-time, source-provided C0 receipts; no provider and no
signer are exposed in this module.

- Read every factory `TokenLaunched` log, not just native pairs.
  Normalize original token, curve, deployer, pair, launch configuration
  and threshold. Require two independently named qualified sources,
  equal entire normalized event arrays and canonical block hashes.
  Reject removed/reorged events, duplicate event IDs and inconsistent
  source factory runtime hashes; require 12 block confirmations.
- At most 16 scanned blocks, four **consecutive WOULD_TRADE**
  decisions (or remainder of 200), complete non-native, rejected and
  unknown C0 rows, no substitution for failed modeled entries.
  Strict block/log cursor; a partial block resumes at the next log
  index. An empty factory range produces a real zero-event batch.
  The exact approved activation-origin block hash must match both
  captured provider block hashes. Even a zero-event/non-native scan
  cannot backfill blocks over five minutes old or restart after the
  seven-day prospective window has expired.
- Include C0 action, hash of source evidence, observed head/hash and
  actual observation-completion timestamp. Missing C0 cannot be
  reconstructed after the first five-minute outcome; if captured
  before the outcome but mechanically unresolved, record explicit
  UNKNOWN with reason. Require 12 confirmations on each
  inclusion block before batching and at least 90 seconds of
  remaining publication budget.
- Use the same public V1 publisher schema and `validateBatch`
  to construct exactly the byte sequence future independent witnesses
  will receive. No local observer can assert its own immutable
  GitHub release. The synthetic tests deliberately *inject* a
  nonexistent active protocol and authority in memory; neither exists
  in the repository.

## Explicit blockers — no scientific data yet

**Only the pure builder and synthetic event/receipt fixtures are
qualified by this draft. There is no connected live dual-RPC C0
observation runner, reviewed main-only source-run artifact, genuine
point-in-time C0 timestamp proof, actual real Pons chain rehearsal,
or released V1 scientific cohort.** The local source-transcript
diagnostic is intentionally **unsealed**; the exact V1 immutable
batch currently hashes its included event identity rows but does
not bind the complete full-field dual-source RPC transcript in
an independently replayable artifact. This is an activation-blocking
source-admissibility gap, not something a `sourceCaptureComplete=true`
fixture or an opaque local evidence JSON can fix.

A separate bounded follow-up must supply an early read-only
observer that captures C0 **when it is actually observed**, a
time-attested external source artifact, full factory transcript
hash and replayable dual-RPC census/decision-source attestation
independent of the collector. The source workflow here is
**PR-only** and has `contents:read`; it has no manual
`workflow_dispatch`, schedule or release-write permission.
The publisher's hard-disabled manual job remains inert.

The study also still requires a separate independent pre-outcome
power/protocol hostile review, canonical merge and activation,
end-to-end 12-confirmation/publisher/witness real latency rehearsal,
all Curve/V4 route and full execution cost proofs, and explicit
authority before collection or publication. No merge, real batch
publication, spending, signing, broadcasts, unattended strategies
or model promotion are authorized.

## Test gates

`node scripts/pons-s1-paired-collector-check-v1.mjs` exercises native
and non-native census, fully empty scans, UNKNOWN C0, exactly four
eligible events in a partial block and continuation after the
independently attested immediate predecessor, exact source parity,
reorg/hash mismatch, absent/late C0 and causally invalid inclusion.
Run full `pnpm test` plus dedicated read-only PR workflow at
the final proposed commit. Internal hostile self-review must be
documented separately; it is not an external independent audit.

**VERDICT: PURE COLLECTOR OFFLINE ONLY / REAL SOURCE NOT QUALIFIED /
NOT ACTIVE / EDGE_UNPROVEN.**
