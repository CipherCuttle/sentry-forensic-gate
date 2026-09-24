# PONS S0 closure → S1 bounded roadmap (2026-09-24)

## Authority and status

**S0 24-hour model lane: TERMINAL RESEARCH STOP; no eligible strategy artifact.**
This closes *the registered S0 24h experiment*, not all Pons research or the independently proven one-shot execution plumbing.
**S1 design: preregistration candidate only.** No collection, frozen-policy activation, model promotion, merge, wallet access, live money, signing, or broadcast authority is granted here.

### Immutable S0 evidence

- Source: `493c85b8d84565cedf6e936063549edfa02edf3a`.
- Target-blind cohort evidence commit: `d711943a25693baee504d2bfe89ae398b75a690a`; origin digest: `31dd06dca9555954c2ca4546c8e75a9f3a2e9db33062c56076928b16919761ce`.
- One hostile integrity review: `docs/reviews/pons-s0-real-cohort-v1-target-blind.md`.
- QntyLab real screen: https://github.com/CipherCuttle/QntyLab/actions/runs/35796026329; recorded verdict https://github.com/CipherCuttle/QntyLab/blob/3c412971e79a6d075b6e84532a1dc59853f9d8a4/experiments/research/pons_s0_real_screen_v1/scientific-verdict.md .
- 96 systematic mature mixed-pair launches; 57 complete 24h native-ETH curve-baseline outcomes and 39 unsupported-quote-asset baselines. Of 57, 29 catastrophic losses, 24 exit failures, 3 liquidity collapses, 1 ordinary loss, zero normal wins. Among 48 resolved mechanically admissible cases, C0 and C1 each retain all 48; no positive class, no embargoed fold. These are **conditional sample counts**, not rates for all 564,865 mature launches.
- 57/57 resolved outcomes lack *verified full execution costs*; S0 has no supportable net-profit claim.

Do not relabel the 39 unresolved rows as losses, alter the 96-member denominator, retune S0's frozen 24h threshold, or unlock its disabled automation scaffold. The existing S0 preregistration remains immutable as historical governance, not a currently viable deployment plan.

## Next two bounded changes (this PR only)

1. **S1 short-exit preregistration:** `docs/PONS_S1_SHORT_EXIT_PREREG_V1.md`. One prospectively testable, fixed five-minute exit hypothesis against a *new-cohort* 24-hour reference, not a sweep over the already inspected S0 cohort. Reuse existing C0 entry and SENTRY's portable baseline/forward outcome/curve and V4 read-only adapters. No model or wallet runtime in this PR.
2. **Offline measurement qualification:** `scripts/pons-s1-measurement-audit.mjs` reads the frozen S0 artifacts and prints a digest-bound diagnostic receipt. It proves why baselines were unverified, distinguishes 24h exit failure from data gaps, and explicitly records what the S0 export **cannot** tell us: per-outcome exit route, full costs, sequential-capital capacity, or funded-wallet parity. No RPC reads, new labels, recomputation of returns, or writes to frozen files.

The current forward adapter already contains a V4 exit path; the S0 exported packet contains only an outcome authority *digest*, not the underlying route/phase. Missing route detail is an attribution/evidence gap, **not proof that V4 exits were never implemented or that any given failed curve exit was a V4 failure**.

## Next implementation gate (separately authorized)

Only after one hostile review of this design and the offline qualification:
- Add source-bound per-outcome **phase and exit venue** evidence to a new, versioned research receipt (CURVE_ACTIVE, HALTED, PENDING_V4, V4_POOL_ACTIVE, RESCUED_TERMINAL), preserving old S0 bytes.
- Supply real gas/approval/exit/recovery cost evidence and USD conversion at each relevant block; if unavailable, report net P&L UNVERIFIED rather than treating costs as zero.
- Bind entry/exit quote, inclusion delay, wallet-specific taxes/recipient class, and actual **sequential** capital semantics; same-state reverse capacity is not sizing authority.
- Verify unsupported assets are explicitly out of S1's *native-pair* primary population and remain observable in discovery totals; any wider pair-asset hypothesis is a separate future study.
- Do one fixed, pre-outcome feasibility/power check and one hostile design review before activating a **new** target-blind prospective cohort.

## Future gates and exits

`S1-PREREG → MEASUREMENT/ROUTE/COST QUALIFICATION → FROZEN PROSPECTIVE SHADOW WITNESS → ECONOMIC VERDICT → (IF EARNED) ONE EXPLICITLY AUTHORIZED MICRO-CANARY → (LATER) FINITE-CAPITAL/RELIABILITY`

If S1 is negative, underpowered, inadequately covered, or costs are unresolved, stop and record the failure; do not optimize horizons on its confirmation data. Do not create SENTRY prospective inference PR-C for the failed S0 models. Keep `agent/pons-s0-autonomy-disabled-scaffold-v1` separate and disabled. No model/economic/merge authority is inherited from E4C's successful $1 plumbing roundtrip.
