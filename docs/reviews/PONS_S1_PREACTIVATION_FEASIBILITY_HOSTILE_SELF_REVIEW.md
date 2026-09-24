# PONS S1 preactivation feasibility — one bounded hostile self-review

Scope: this PR-only outcome-blind timing/power audit, not the scientific
design, genuine external acquisition, or an independent security review.

## Findings

- **High found and fixed**: the first pure timing gate considered only
  source and batch release publication timestamps. A forged or delayed
  asset upload could make the claimed evidence appear to exist before
  upload. The targeted fix requires conservative GitHub source/batch asset
  created-at upper bounds before immutable publication, and requires
  the cohort asset after observed inclusion+12 confirmation. New adversarial
  tests reject missing source asset, upload after publication and batch
  upload before confirmed inclusion. One targeted rereview of the modified
  chronology and fixtures is required after exact-head CI.
- **Medium open, intentional**: actual observations and reviewable GitHub
  provenance are still uncollected. The pure gate cannot authenticate a
  caller-supplied timeline, and explicitly NEVER returns READY/ADMISSIBLE.
- **Medium open, intentional**: the three equal-time-cluster ICC scenarios
  are hypothetical and do not estimate prospective eligible-launch arrival,
  two-endpoint joint power, net-USD variance or heavy-tail uncertainty.
- **Unchanged blocker**: real dual-provider quote timing, complete
  cursor census, original pre-outcome immutable full-source release/batch
  and independent witness, full Curve/V4 routes/costs and independent
  preactivation scientific review do not yet exist.

NO MERGE, ACTIVATION, LIVE MONEY, SIGNING, BROADCAST OR BACKFILL.
Verdict: engineering audit candidate only; EDGE_UNPROVEN.
