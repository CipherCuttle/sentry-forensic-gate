# PONS S1 prereg + frozen measurement — one hostile review

Date: 2026-09-24 CEST
Reviewed candidate: `9bb069295e5a50e353f790bdd95dcdec4e071219`.
Scope: new S0 closure roadmap, S1 exit-research preregistration, read-only frozen-origin measurement audit and CI; not a live execution system.
Prior evidence source remains frozen at `493c85b8d84565cedf6e936063549edfa02edf3a`, origin digest `31dd06dca9555954c2ca4546c8e75a9f3a2e9db33062c56076928b16919761ce`.

## Adversarial checks

Origin/content spoofing, missingness selection, misleading population scope, unobserved migration routes, incomplete cost attribution, impossible shadow inclusion assumptions, lookahead, post-outcome enrollment, strategy/data feedback, latent money authority, excessive PR scope, and false inferential promotion.

The read-only auditor uses only committed S0 artifacts, checks stream checksums and the exact origin/launch-index digests, joins feature/outcome identities, does not import an ML runtime, and does not write, call RPC, or access wallets. The workflow has contents:read, validates expected descriptive counts, and rejects a deliberately corrupted frozen input; exact-head GitHub Actions `35941943400` passed.

## Initial findings — TWO HIGH, zero Critical

**H1 — impossible hypothetical inclusion attestation:** The original S1 prereg called the entry anchor a *verified hypothetical inclusion timestamp*. A read-only shadow trade never has an inclusion receipt. Without explicit synthetic-inclusion semantics an implementer could select a favorable effective entry block or treat a historical block timestamp as proof of fill. Fix: preregister and provenance-bind a deterministic **modeled** inclusion block from a separately qualified latency envelope, read its real hash/timestamp, and state that this is **not** evidence a transaction was actually included. If the model/quote cannot establish admissibility, stop the candidate without retrospective substitution.

**H2 — favorable post-decision enrollment:** The original sample stop said first 200 C0-executable *entries*. That could be misconstrued as 200 successful modeled fills, silently replacing eligible decisions whose inclusion was delayed or failed. Fix: enroll exactly the first 200 *C0 WOULD_TRADE decisions*, at decision time, independent of subsequent inclusion outcomes; report entry failures, abstentions and missed quotes for those same frozen identities without replacement.

## Nonblocking, explicit scientific debts

- All 39 S0 unverified baselines were unsupported base-currency calibration, not evidence of failed exits. S1 intentionally restricts its primary economic population to supported native pair and must publish the excluded-pair census.
- All 57 completed S0 outcome packets have missing full execution-cost evidence; S1 cannot declare a net-performance result until a separate source-bound cost path exists.
- S0 forward adapter supports curve and V4 branches, but the S0 export omits per-outcome phase/route. Do not confuse missing provenance with absent V4 runtime or infer that all 27 insufficient-curve-quote observations were migrations.
- Before prospective activation, separately qualify latency, cost/route coverage, practical sample size and quantitative uncertainty controls. This candidate doc grants no activation or promotion authority.
- A zero new-class count in S0 precludes supervised modeling and cannot be remedied by post-hoc horizon/threshold resampling of the 96 inspected observations.

**Verdict before fixes:** BLOCKED_ON_H1_H2. Apply these two precise specification repairs; then at most one targeted rereview. No further iterative review loop.
