# PONS S1 paired publisher V1 — bounded hostile self-review

**Scope:** only the draft publisher core, inert script, synthetic fixtures,
and job-scoped GitHub workflow. PR #80 remains hard-disabled; this is a
**self-review**, NOT independent external scientific/security sign-off.

## Threat model

Hostile input is a forged frozen batch, forged prior release, altered GitHub
artifact, post-outcome inclusion evidence, wrong canonical commit, stale
census/cursor, duplicate tag, slow GitHub Actions scheduler or compromised
unreviewed checkout. No future collection permission can be inferred from
successful synthetic fixtures or from the 246-byte immutability dummy release.

## One hostile review: findings, dispositions

| ID | Severity | Attack / defect | Disposition |
| --- | --- | --- | --- |
| H1 | High | An inclusion block with timestamp later than captured batch would leak *future block hash and outcome-clock information* into pre-outcome evidence. Synthetic fixture accidentally modeled that chronology. | FIXED: inclusion timestamp must be <= capture time and inclusion block must have 12 confirmations. Fixture chronology repaired; explicit negative cases. |
| H2 | High | A same-block or partially scanned cursor could point backward into already processed blocks or resume without a final-block event, concealing missing/duplicate eligible launches. | FIXED: next cursor must equal scanned-through block with strictly later log index than its actual final event, or next block at index 0. Matching final-block event hash is required. Negative cases added. |
| H3 | Test | Synthetic captured-after-deadline fixture used a future capture time relative to test's injected clock and was rejected by the *wrong* guard; dedicated CI failed. | FIXED: fixture advances synthetic clock explicitly and targets the actual native deadline, preserving independent future-clock and late-capture guards. |
| H4 | High, repaired before initial PR | A zero-factory-event scan was originally not publishable; a collector could leap over empty blocks without an external denominator seal. | FIXED: publish empty/nonnative-only scan as an immutable cursor certificate with separately identified ten-minute operational expiry. New positive fixture. Source truth still requires independent archive/official proof. |
| H5 | Critical boundary, repaired before initial PR | Executing a caller-supplied commit checkout under a contents-write token would expose release rights to unreviewed code. | FIXED: checkout the invocation's actual canonical main SHA only. Job is doubly gated by exact main SHA equality and **unconditionally hard-disabled** pending separate approval. Review any future enabling diff as new authority. |
| H6 | High, repaired before initial PR | A prior immutable release could have been published only *after* the next batch was captured, allowing hindsight lineage. | FIXED: prior release must independently read back before the next captured-at time; exact old downloaded bytes and cursor digest required. |
| H7 | High activation blocker, not in disabled transport scope | Batch checksum, C0 evidence JSON and factory log digests are not independently sufficient to prove actual point-in-time factory census or non-anticipatory C0 semantics. | **OPEN / ACTIVATE-NO**: require separately approved source-qualified paired collector, unique immutable source-run artifact, official/archive block and event proof, and outcome-blind externally witnessed C0. |
| H8 | High activation blocker, not in disabled transport scope | Publisher's own REST readback cannot be the independent V1 witness; old V0 witness expects legacy batch format. | **OPEN / ACTIVATE-NO**: separate main-only read-only V1 witness and actual immutable V1 release rehearsal must be completed before scientific enrollment. |
| H9 | High operational blocker | Twelve confirmations, Actions startup, provider catch-up and release publishing might exceed five-minute inclusion-anchored outcome deadline, especially for bursts and empty-batch sealing. | **OPEN / ACTIVATE-NO**: controlled non-scientific latency rehearsals, fail-closed unsuccessful attempts; do not treat CI fixtures as timing evidence. |

Independent hostile design/power review, execution-cost evidence and the
distinct inherited V4 recovery-readiness checks remain outside this bounded
publisher self-review. Do not silently waive any of them.

## Targeted rereview of repaired disabled-source boundary

Recheck H1/H2: canonical native-row clock ordering, twelve confirmations at
both C0 and inclusion, same-block progression and event/block hash equality;
reject intentionally inconsistent fixtures. Recheck H3/H4: distinct
future-capture, late-capture and empty-batch branches. H5/H6 remain enforced
by hard-disabled job and independent prior GitHub REST readback path.

**Targeted code rereview: PASS for the proposed inert source surface.**
**Exact final-head automated qualification: PENDING until GitHub Actions
concludes on the repaired commit.** This is not external independent sign-off;
H7–H9 retain ACTIVATE-NO regardless of green offline CI.

**No merge, publication, activation, signing, transactions or promotion.**
