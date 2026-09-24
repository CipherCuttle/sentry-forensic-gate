# PONS S1 — fixed five-minute exit hypothesis, preregistration candidate V1

Status: **DESIGN / OUTCOME-UNSEEN FOR S1**. Created after seeing the negative S0 24h result, so S1 is a **new hypothesis**, not a vindication of S0. All S0 data is development context only; it cannot enter the future S1 confirmatory witness.
No prospective collection or money authorization is created by this document.

## 1. One question, two registered arms

On the same newly observed native-ETH Pons V2 launches satisfying the existing frozen **C0 mechanical entry** at decision block launch+2, does a *fixed five-minute* executable exit improve **verified net $1 terminal capital** relative to an otherwise identical fixed 24-hour executable exit **while also producing positive absolute net capital after costs**?

- **A / S1_5M_R1**: hypothetical $1 native-ETH entry on the exact C0 mechanically admissible decision; plan an all-token exit at the first valid block at or after five minutes **from the verified hypothetical entry inclusion timestamp**, subject to the same preregistered inclusion-delay bound as B. No reactive profit-taking, stop-loss, graduation trigger, retries until profitable, or later opportunistic horizon selection.
- **B / CONTROL_24H_R1**: identical hypothetical entry and token quantity with an all-token exit at the first valid block at or after 24 hours from that same entry inclusion timestamp. This is a **new paired prospective control**, not a rerun or resampling of S0's launch-anchored historical 24h outcomes.
- Exactly one primary horizon hypothesis (five minutes) and one registered control (24h); no 1m/30m/2h contest, adaptive timing, threshold or feature search. Any future alternatives require a **new preregistration and new outcome-unseen data**.

Both arms observe the same prospective launch, baseline, entry quote, decision point, execution persona, and hypothetical capital. Each exit uses the correct **observed chain phase** and the source-verified curve or successor V4 path when available. A failed curve quote is not silently repaired with an invented V4 exit. A genuinely inaccessible supported venue is an execution gap and cannot be imputed as a realized return.

## 2. Origin, enrollment and fixed stopping rule

- Chain: Robinhood Chain 4663, the reviewed Pons V2 factory and authority epoch. Maintain frozen launch block/hash and two-block baseline decision/confirmation discipline; collect ≥12 confirmations for immutable final evaluation evidence.
- Primary population: **native-ETH paired launches only**. Keep *all* observed factory launches in the discovery census, including non-native assets, unsupported calibration, failed mechanical entries and no-market outcomes, with explicit reason counts. Do not condition enrollment on an observed 5m/24h outcome, creator outcome, chart, or price.
- Enrollment must start **strictly after** a separately approved, immutable on-chain activation block+hash and server-observed activation receipt; no backfill before activation. This draft authorizes neither activation nor live collectors.
- Fixed collection stop: first **200 consecutive C0-executable native-pair entries** after activation, or seven days after activation, whichever happens first. Retain and disclose the entire discovery/enrollment denominator and all misses. If fewer than 200 executable entries are collected within seven days, report `INSUFFICIENT_PROSPECTIVE_COHORT`, do not extend the window, and do not claim a confirmatory result. Each enrolled entry gets both future outcomes or an explicit unresolved status; 24h follow-up plus finality must close before release.
- The sample count is an operational fixed boundary, **not a claim of adequate statistical power**. Before activation, a separate outcome-unseen feasibility/power review must qualify sensitivity to expected effect size, dependency/clustering, tail uncertainty and feasible RPC costs. If inadequate, close this draft and issue a new version *before* any activation or outcome access.

## 3. Pre-outcome evidence and inclusion semantics

- Record launch, quote, decision, exact block/hash, entry simulated inclusion and exit scheduled/included block+hash and observed timestamp separately. Never use `Date.now` during historical decision reconstruction or label availability.
- Before activation, freeze one executable quote-to-inclusion latency envelope from independent network/transaction receipts or realistic stateful shadow replay. Until that evidence exists, **NO_VALID_S1_ENTRY** rather than a zero-latency assumption.
- Entry uses the same exact reviewed C0 notional, mechanical constraints, recipient class, wallet-specific tax/exemption and independent quote evidence. Route estimation must separately prove post-entry *sequential* sell capacity; never consume `INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL` for live sizing.
- Label availability: neither arm's outcome is visible to any decision on the same launch; any subsequent model study must embargo a training outcome until `observedBlock < firstTestDecisionBlock`. S1 itself uses **no learned model**.

## 4. Exit truth and cost law

- At each scheduled exit read Pons factory phase and curve status; if V4_ACTIVE, use verified V4 pool/hook identity, exact full-balance quote and route; if HALTED or PENDING_V4, mark terminal execution gap/recovery path explicitly. Do not force all such states into `LIQUIDITY_COLLAPSE`.
- Attribute every gross outcome to an immutable source receipt containing `phase`, `exitVenue`, `quoteBlock/hash`, `exitExecutable`, `reason` and the verified predecessor/first-crossing boundary. This is a **new versioned research export**; S0 hashes and evidence must remain untouched.
- Full net cost evidence is mandatory for an economic conclusion: entry gas, conditional approval/Permit2 gas, exit gas, any recovery/cleanup gas, gas price, on-chain fees already embedded in quotes, quote-to-inclusion adverse movement, and USD calibration at the corresponding block. No double-counting of fees already in quotes. No assumption that gas, approvals or recovery are zero when missing.
- Revenue/return is terminal *realizable* USD proceeds after the above costs, for the frozen $1 stake, with explicit zero only if a supported venue is authoritatively proven insolvent/unexecutable under the frozen loss convention. Unavailable archive reads, unknown successor routes, stale quotes and missing cost evidence remain `UNVERIFIED`; report both worst-case and complete-case bounds without silently selecting one.

## 5. Frozen diagnostics, failure and authority

Primary paired economic diagnostic: `sum(netTerminalUsd_5m - netTerminalUsd_24h)` on same admissible launches **only where both full-cost outcomes are validated**, accompanied by full-cohort unresolved bounds and time-clustered uncertainty. An advantage versus a negative 24h control alone is insufficient: `sum(netTerminalUsd_5m - $1)` after verified complete execution costs must also be positive on the declared population with no unacceptable unresolved-outcome exposure.

Mandatory secondary diagnostics: 5m and 24h participation/coverage; entry and exit executability; CURVE/V4/halted/pending phase mix; zero/failed exits; catastrophic and left-tail loss rates; median and lower-tail net returns; positive-tail capture sacrificed by early exit; inclusion latency; wallet-persona parity; gas/fee/slippage; intervals by time block, not IID row bootstrap; cost and unresolved-data bounds; finite-capital occupancy as **diagnostic only**, never live capacity authority.

A claim of strategy edge is **blocked** unless both complete cost/route coverage and pre-registered error controls pass, prospective witness has adequate class/interval power, absolute positive net economics and paired control comparison survive uncertainty, and an independent hostile review passes. Failure outcomes are preserved, not rerun, optimized or pooled with S0 as independent observations.

Next code step after approval is **measurement source + execution-cost/route qualification only**. No new ML platform, no new separate database, no TradingAgents/LLMs in decision or transaction paths, no wallet access, no autonomous policy freeze, no live strategy canary, no merges in this branch.
