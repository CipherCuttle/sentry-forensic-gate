# PONS S1 — five-minute exit feasibility pilot V0

**Status: DRAFT PR / SPECIFICATION ONLY / NO COLLECTION OR LIVE AUTHORITY.**

This is a **new hypothesis formulated after** the S0 24-hour historical results were inspected. It is not a rescue of the failed S0 model screen, and the original 96 launches must never be represented as unseen S1 validation.

Canonical machine-readable proposal: `docs/experiments/pons-s1-five-minute-feasibility-v0.json`. The proposal is inert until an explicit reviewed activation separately freezes the future origin. Existing S0 branches, immutable evidence and scientific verdict remain untouched.

## PLAN — what we now know

- S0 selected 96 outcome-blind Pons launches. Only 57 had complete 24-hour baseline and outcome evidence; 39 baselines remain unverified.
- Of the resolved 57, 29 were classified `CATASTROPHIC_LOSS`, 24 `EXIT_FAILURE`, three `LIQUIDITY_COLLAPSE`, one `NORMAL_LOSS`, and **zero** `NORMAL_WIN`. Thirty exits were executable at 24 hours; 27 were not. These are *historical classifications for the resolved sample*, not population probabilities.
- Every 24-hour outcome lacks verified full-execution-cost evidence. QntyLab found 48 C0-admissible resolved launches, all also admitted by C1, zero positive labels, and no valid embargoed training fold. No learned policy was trained or compared and no strategy earned promotion. [Recorded exact screen](https://github.com/CipherCuttle/QntyLab/blob/agent/pons-s0-real-screen-v1/experiments/research/pons_s0_real_screen_v1/scientific-verdict.md).
- The existing portable forward-outcome contract supports arbitrary positive horizons, and the common frozen horizon registry includes 1m, 5m, 30m, 2h and 24h. This is code reuse, **not proof** that Pons can be exited at any particular horizon.
- S0's fixed 24-hour endpoint cannot answer an early-exit question. Selecting a shorter horizon after observing S0 is exploratory; it becomes interpretable only on a **separate future cohort**.

Read-only evidence audit: `node scripts/pons-s1-feasibility-check.mjs`. It verifies the frozen source-file hashes and descriptive counts locally; it cannot approve S1, sign, spend or infer profitability.

## One experiment — no ML sprint

**Question:** On a newly enrolled Pons V2 native-ETH launch with the frozen C0 mechanical entry gate, is a full-balance **launch + five-minute** hypothetical exit mechanically feasible and sufficiently economical to justify a *separate* larger prospective test?

This tests *execution-horizon feasibility*, not superiority of creator-history signals, predictive alpha, or portfolio-level profitability. Exactly one primary candidate horizon: five minutes. One minute, 30 minutes, two hours and 24 hours are **descriptive diagnostics only**, never post-hoc replacements for the primary horizon. C1 FAST_VET R1 is a paired policy comparator on the same five-minute endpoint. If C0 and C1 still make identical decisions, record `NO_DISCRIMINATORY_COMPARISON`; do not invent an uplift.

### Future cohort / denominator

Only after a separate reviewed activation: resolve the first canonical, confirmed block no earlier than the canonical activation merge's UTC time + six hours. Starting there, enroll **the first 96 unique** native-pair Pons V2 factory `TokenLaunched` events by block/log order, or every such event in the next 24 hours if fewer. Pin block hashes and the reviewed factory/implementation authority. Reject duplicate event identities, and fail closed if the source cannot produce the full eligible launch index. Collect baseline and outcomes for *every* selected launch, including non-executable entries and policy rejects.

The source denominator is all selected factory-native launches. Never silently replace a launch with an unverified baseline, a failed exit, missing 24-hour evidence or a provider timeout. If fewer than 96 enroll in 24 hours, the study closes with the observed denominator; it does not widen after inspecting outcomes. No S0 observation may enter the S1 prospective witness.

### Entry, exit and timing

Reuse the already reviewed launch adapter, portable launch+2-block bidirectional baseline, USD calibration, Pons forward-outcome adapter, point-in-time research export and SHA-bound receipts. One simulated $1 C0 entry at the frozen baseline decision block; no entry if the exact bidirectional mechanical gate fails. Never treat its independent same-block reverse quote as sequential post-buy capacity.

The primary outcome is the **first canonical block at or after launch timestamp + 300,000 ms**, as the existing portable outcome contract defines it. Do not silently reinterpret it as five minutes after entry or inclusion. Record decision/quote timestamps and a separately bounded, conservatively modeled quote-to-inclusion lag. If a feasible real inclusion would occur after the target block, mark timing feasibility **UNVERIFIED**, not executable. This initial adapter measures an unperturbed historical curve after hypothetical entry; it does not prove that the hypothetical BUY leaves reserves unchanged or that a live wallet receives identical tax treatment.

One full-balance exit quote at the horizon, with phase transitions respected: active curve, halted/graduating, graduated V4 or unverified if the pinned recovery path cannot be proved. Ambiguous/unknown failures remain unverified; non-executable exits remain explicit observations, never zero-cost successful sells. E2/E3B recovery routes are not presumed completed merely because they exist in reviewed code.

### Cost evidence / feasibility gate

A shadow quote alone never proves net P&L. Build a separately versioned **conservative modeled full-execution-cost envelope**, using real E0 receipt gas usage as a documented lower evidentiary anchor, contemporaneous gas prices, an approval when needed, exit and recovery/cleanup when required, slippage/latency sensitivity and an explicit safety margin. A gas estimate is `MODELED`, not a verified counterfactual receipt. If coverage or upper bounds cannot be established, the net result is **UNKNOWN**, never positive by default. Realized profitability requires a separately authorized real execution experiment.

Preregistered pilot feasibility gates (not statistical edge/promotion thresholds):
- At least 80% of the full raw-launch denominator must have a complete primary-horizon mechanical outcome **or explicit non-entry** with an independently recorded reason; also report completeness among C0-admissible entries.
- At least 80% of **all mechanically C0-admissible entries**, including entries with missing primary outcomes or failed exits, must have a complete conservative full-path cost envelope appropriate to their actual quoted/unknown path. Missing costs are `UNKNOWN` and remain in the denominator.
- The **conservative lower bound** on exit reliability must reach 90%: proved full exits (or separately validated complete recovery paths) divided by **all mechanically C0-admissible entries**, including those with missing exit evidence. Unknown/unverified exits remain in the denominator, count as not proved and cannot inflate observed-only success. An unavailable V4 proof does not count as an exit.
- If no observed C0 entry survives the conservative modeled net-cost bound, record `FEASIBILITY_NOT_DEMONSTRATED` for this pilot. If some do, that earns only a request to preregister a larger untouched prospective trial, **not** model selection, strategy promotion or live deployment. If denominator, exit or cost coverage is insufficient, stop with `INSUFFICIENT_EVIDENCE`, not a positive/negative economic result.

Report paired gross exit return, conservative modeled net return, executable-exit rate, unavailable outcomes, exact classification breakdown, quote-to-inclusion sensitivity and earliest mechanically reachable exit. Also report any conflict between the C0 fixed-entry contract and the real E0 wallet-tax/entry-impact evidence. No numeric gate may be relaxed after viewing S1 outcomes.

## CHANGESET boundary

This PR adds only this design and the read-only S0 source-audit command with the inert JSON contract. It intentionally does **not** add a collector, cron, wallet, signing path, strategy model, permissions, merge authority or a production pipeline. The next implementation, if approved after this review, is **one** minimal read-only prospective collector reusing the existing S0 materializer/forward-outcome adapter and emitting immutable pre-outcome selection before querying any prospective target outcome. No new training framework or shared database.

## VERIFY

1. `pnpm test` and `pnpm ponss1check` must pass on the exact proposed branch SHA.
2. A single hostile review must check lookahead, missingness, historical-reuse leakage, target-time versus inclusion-time feasibility, phase migration, independent-versus-sequential capacity, modeled-versus-realized P&L and accidental authority expansion.
3. Later activation is separately authorized and must freeze the exact reviewed collector implementation, contract digest and origin before observing any S1 target outcomes.

**VERDICT NOW: S1_DESIGN_DRAFT / S0_IMMUTABLE / EDGE_UNPROVEN / MONEY_NONE / MERGE_NONE.**
