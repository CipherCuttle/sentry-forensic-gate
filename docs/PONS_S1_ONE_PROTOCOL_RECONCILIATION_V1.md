# PONS S1 — one protocol, one economic question (reconciliation candidate)

**Status: DRAFT DESIGN RECONCILIATION. NOT CANONICAL OR ACTIVE. NO COLLECTION, MONEY, MERGE, SIGNING OR MODEL PROMOTION.**
Machine-readable non-operative decision: docs/experiments/pons-s1-single-protocol-decision-v1.json.
The S0 96-launch historical data and all existing WIP remain immutable. This is a **new** exploratory hypothesis motivated by S0's negative 24h result, not independent confirmation of S0.

## PLAN — resolve the contradictory S1 drafts

Choose PR #76's **paired five-minute versus 24-hour economic question** for the next prospective protocol. It supersedes the *proposed experiment design*, NOT the source code or immutable historical evidence, of PRs #73–#75:

| Field | Earlier draft #73–#75 | Selected candidate #76 |
| --- | --- | --- |
| Sampling | First 96 native launches, or 24h | First 200 consecutive C0 WOULD_TRADE decisions, or seven days |
| C0 rejects | In raw factory denominator, not enrolled as trades | Same: full census, explicit reasons, not quietly discarded |
| Exit clock | Launch timestamp + 5m | Same frozen synthetic inclusion block timestamp + 5m **and** +24h |
| Question | Short-exit mechanical feasibility; C1 side comparator | Paired economic difference plus **absolute** net profitability after complete costs |
| Status | Draft, collection disabled | Draft, collection disabled |

**Never** relabel the existing launch+5m data collector or release witness as implementing the new paired protocol. A version string or CLI flag is insufficient: sampling, decision timing, inclusion anchor, batch content, target availability, and both outcomes must be requalified. Do not merge both incompatible experiment specs as if they were one study. Leave PR #77's WebSocket-vs-HTTP timing work read-only and scientifically separate; arrival telemetry is not inclusion or execution evidence.

## CHANGESET — the single S1 experiment

1. **Census and enrollment.** After a separately reviewed canonical activation, observe every reviewed Pons V2 factory launch and preserve native/non-native source counts, exact chain block/hash, transaction/log identity and reasons for exclusion or incomplete baseline. Freeze each launch+2 C0 decision using only point-in-time information. Enroll *consecutive* C0 WOULD_TRADE decisions before either target outcome. The immutable batch must bind each **actual C0 eligibility decision plus its point-in-time evidence** before the earliest selected five-minute outcome, not merely the factory event ID. If C0 cannot be established and sealed in time, retain an UNKNOWN_PREOUTCOME_C0 row in the raw census, **never** treat it as a reject or silently backfill it. Unknown eligibility invalidates a claim that the consecutive-eligible denominator is complete. Stop at 200 decisions or seven days, whichever first; never replace a failed/missing entry or extend because of results. Confirm eventual canonical state with at least 12 blocks. A missing or late census is not a smaller cherry-picked cohort.

2. **Exactly one entry / two arms.** Identical $1 native-ETH hypothetical entry, execution persona and predetermined synthetic inclusion block for both arms. Fix the quote-to-inclusion latency mapping **before** collection, from independent transaction/arrival evidence; validate entry executability at the mapped block. A synthetic inclusion block is not a real fill. Failed/late entries remain in the denominator for both arms. Evaluate one full-balance exit at the first canonical block at or after inclusion timestamp +300,000 ms, and one at +86,400,000 ms. No reactive stops, retried entry until favorable, post-hoc horizon search or repaired sample.

3. **Prove the actual exit path.** At both horizons export exact source-authenticated observed phase, curve versus verified V4 route/hook, quote block/hash, executable amount, reason, first-crossing block, and any halted/pending/graduation/recovery state. A failed curve quote does NOT mean no V4 route exists; an unverified V4 route is NOT a successful rescue. Preserve failed and unavailable exits explicitly.

4. **Full-cost envelope.** Account for gas on entry, conditional approval/Permit2, exit, required recovery/cleanup, contemporaneous gas prices, USD conversion, recipient-specific tax, quote-to-inclusion adverse movement and realistic slippage. Fees already embedded in quoted proceeds must not be counted twice. Where a component is unverified, report unknown/bounded model exposure, NOT zero costs or a verified net return. Prove sequential post-buy sell capacity separately; unperturbed same-state reverse quotes are not inventory-exit receipts.

5. **Independent pre-outcome witness.** Bind the contract digest and actual approved activation commit to the observed factory census and a small immutable pre-outcome selection batch. That batch must include point-in-time C0 decisions, exact decision block/hash and evidence bytes for **every scanned native launch**, including unknown C0 states; a pre-outcome event-only seal followed by later C0 reconstruction is insufficient for the #76 eligibility denominator. The external release publisher and independent API witness must prove exact bytes and publication before the *earliest* selected five-minute target becomes knowable. Verify with two independent provider sources and 12-confirmed final evidence. If confirmations, polling, catch-up, provider throttling or release publication cannot meet the pre-outcome deadline, **SAFE STOP**; never backfill or claim prospective evidence.

6. **Interpret honestly.** The primary economic report uses the *same executable entries* and full-cost evidence for paired five-minute versus 24-hour comparison, AND independently tests absolute five-minute net proceeds versus the $1 stake. Disclose all excluded events, entry failures, partial/unknown route and cost outcomes, full-denominator unresolved bounds, left-tail losses and time-clustered uncertainty. Under-powered or insufficiently covered findings are INCONCLUSIVE, not a promotion opportunity.

## Verify before enabling a single prospective observation

- **Gate A — design/power:** independent hostile review; frozen rule for cohort, timing, stage-ordered sampling and outcome-blind pre-activation sample-size/power assessment. The cap of 200 is an operational limit, not an assertion that 200 provides adequate power. If inadequate, do not activate this version; publish a **new** pre-outcome spec instead. A full seven days yielding fewer than 200 eligible decisions must report INSUFFICIENT_PROSPECTIVE_COHORT under the current draft.
- **Gate B — read-only code:** adapt only PR #74's factory-census, dual-RPC, cursor and small-batch code, and PR #75's independent immutable release witness. Replace their 96/24h membership, launch-anchored horizon, old activation/spec identities and single-target packet semantics. Fail closed if any old producer emits a packet for the new study. Build one new paired, versioned evidence export; retain frozen S0 bytes.
- **Gate C — timing + routes/costs:** qualify launch+2 capture, a realistic independently frozen inclusion rule, pre-five-minute release publication, 12-confirmation timing, complete curve/V4 attribution, wallet persona, sequential $1 entry/exit feasibility and conservative costs. The one-event PR #77 speed observation cannot itself satisfy inclusion or power.
- **Gate D — canonical authority:** separate approval, reviewed implementation hash, canonical merge and later activation receipt with independently established parent/merge timestamp and origin block/hash; release immutability proven; independent witness and source reliability qualified. The docs and CI cannot silently activate a collector.
- **Gate E — prospective verdict:** only after the predefined seven-day/200-decision stop and the 24h follow-up/finality tail, one complete, independently reviewed economic report. Positive modeled economics can justify a new validation request, never a claim of realized returns or automatic capital authority.

**Kill / rollback:** If Gate A–D fails, stop without activating, preserve all earlier drafts and evidence. If a valid prospective experiment is negative, fails to show a meaningful paired difference, lacks absolute positive net, has excessive unresolved exposure or is underpowered, record the corresponding failed or inconclusive result without changing the horizon on these data. Before any active campaign, rollback is simply declining to canonicalize this proposal. During collection, fail closed and preserve the existing immutable census.

## Fastest safe implementation after this protocol candidate

One bounded implementation changeset, not a PR for every checklist item: port the existing #74/#75 read-only primitives to #76's paired contract, qualify *only* source/phase/cost/timing and independent immutable pre-outcome witness, run fixture tests and one hostile review, then seek a separately authorized canonical activation. No wallet, signer, transactions, live canary, AutoML, shared DB or infrastructure redesign.

**Current verdict: ONE_PROTOCOL_PROPOSED / SOURCE_REUSE_IDENTIFIED / PROSPECTIVE_DATA_NOT_COLLECTED / EDGE_UNPROVEN / NO_MONEY.**
