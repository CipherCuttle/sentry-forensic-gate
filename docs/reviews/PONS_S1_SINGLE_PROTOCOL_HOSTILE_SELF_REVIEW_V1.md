# PONS S1 — one bounded adversarial self-review (PR #79)

**Scope:** design-only selection of PR #76 over incompatible PRs #73–#75; exact source candidate branch agent/pons-s1-single-protocol-v1. This is a **self-review**, NOT independent scientific/security sign-off. Nothing in this review authorizes prospective enrollment, release publication, merge, real-money trading or promotion.

## Hostile first pass

- **Critical: 0.**
- **High H1 — event-only seal followed by retrospective C0 filtering (FIXED).** The old #74 collector seals factory event IDs then computes C0 inside a later measurement step. Applying that path unchanged to #76's first-200 *C0 WOULD_TRADE* population would let later price/outcome knowledge affect who counts as eligible, even when raw events are immutable. Contract repair: each launch+2 C0 decision **and its pre-outcome evidence** must be committed in the external immutable batch strictly before the earliest relevant 5m outcome. Missing/late C0 stays UNKNOWN_PREOUTCOME_C0 in the raw native launch census; it is neither a reject nor replaced by a later event. A complete consecutive-eligible denominator cannot be claimed if eligibility is unknown. Four new offline negative cases catch event-only sealing, unknown omission, silently complete denominator and post-outcome reconstruction.
- **High H2 — inherited CI guard cannot accept existing immutable S0 evidence / subprocess escape (FIXED).** This stacked branch inherits #76's historical guard mismatches, independent of this design diff. The supported-surface allowlist and the two historical materializer checkout guards were replaced **byte for byte** with the already-reviewed exact #75 copies. Only three exact S0 evidence filenames and the exact read-only archive proxy are newly allowed; no generic .jsonl, .py or .sh permission and no process spawn. The original 2026-09-22 evidence files and their recorded production hashes were not edited. New script hashes must not be represented as the originally archived materializer.
- **Medium M1 — sample-size false confidence (GATED).** First 200 or seven days is an *operational stop*, not evidence of a powered economic test. Before activation, predeclare effect, dependence, missingness and power; if insufficient, stop this protocol before observations. Once active, fewer than 200 at seven days yields INSUFFICIENT_PROSPECTIVE_COHORT.
- **Medium M2 — apparent alpha from a mediocre 24h control (GATED).** Require both absolute modeled net return above $1 and a paired 5m-over-24h difference, with unresolved full-denominator bounds. Neither is a verified realized trade return. Time-clustered uncertainty and finite-capital occupancy remain mandatory report diagnostics.
- **Medium M3 — inclusion and release-publication race (ACTIVATION BLOCKER).** A 12-confirmed event can be discovered too late to calculate/externally seal launch+2 C0 before inclusion-anchored 5m target, particularly during burst traffic or provider throttling. Before activation prove bounded end-to-end timing and a real immutable GitHub publisher/witness; otherwise SAFE STOP, no backfill or event-only witness.
- **Medium M4 — phase and costs (ACTIVATION BLOCKER).** Active curve, halted/pending and verified successor V4 states require correct route attribution. No same-state reverse as sequential post-buy capacity, no default-zero gas/approval/taxes and no assumption that a synthetic inclusion receipt is real. Source, persona, route and conservative cost qualification remain next engineering work.

## Targeted rereview of repaired H1/H2 only

The inert manifest independently enforces the selected 200/7d paired inclusion-anchored rule, pre-outcome C0 decision sealing and denial of all authority bits. The read-only fixture guard checks 21 mutations. The three inherited S0 guard repairs are byte-identical to the known #75 reviewed blobs, without extra allowlist classes. **H1/H2 targeted self-rereview: PASS for scope; independent sign-off remains outstanding.**

## Verification boundaries

- Dedicated no-provider protocol CI at candidate 470114dead721de02b74bcf233d153af2895ed42: https://github.com/CipherCuttle/sentry-forensic-gate/actions/runs/35947661140 — PASS. It tests contract sanity, 21 hostile mutation cases and no authority.
- Full repository CI: https://github.com/CipherCuttle/sentry-forensic-gate/actions/runs/35947661231. The inherited support-surface, test research guard and enforcement research guard steps have each passed on the exact candidate; do not claim full-suite success until this exact run finishes.
- Independent review before canonical activation must separately inspect producer, publisher, API witness, source route/cost completeness, latency law and sample-size adequacy. A green *design* workflow has no scientific, collection or live authority.

**Verdict: INERT_PROTOCOL_CANDIDATE_QUALIFIED_OFFLINE; EDGE_UNPROVEN; NO PROSPECTIVE DATA; NO MONEY.**
