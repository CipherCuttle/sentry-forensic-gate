# PONS S1 paired collector V1 — bounded hostile **self-review** (INERT)

Scope: one draft stack (#79 → #80 → #81 → #82), no live RPC,
no source workflow dispatch, no immutable real S1 batch. Internal
adversarial review is NOT independent approval.

## Attack chain / finding disposition

| ID | Severity | Attack or latent debt | Disposition |
| --- | --- | --- | --- |
| H1 | HIGH | Previous V1 spec said only `QUALIFY_AND_FREEZE_BEFORE_ACTIVATION_OUTCOME_BLIND`. Portable C0 at launch+2 requires *two more block confirmations*. Synthetic inclusion at decision+2 would already be mined when C0 became observable. | FIXED in draft publisher and offline collector: require explicit future independent protocol approval of `OBSERVED_C0_COMPLETION_HEAD_PLUS_TWO_CANONICAL_BLOCKS_V1`; each C0 receipt freezes completed-at UTC millisecond time and observed head/hash; inclusion exactly observed head+2 and its timestamp cannot precede completed C0. The existing draft canonical protocol JSON is untouched; real activation fails closed until science review and explicit amendment. |
| H2 | HIGH | A four-event microbatch may land in a block containing a fifth eligible launch: a whole-block cursor would skip one or a naive replay would duplicate four. | FIXED in offline tests: stop at fourth consecutive WOULD_TRADE; cursor resumes at the next log index in the *same* block, then seal a new batch. Five-event two-batch synthetic fixture exercises continuity. |
| H3 | HIGH | A batch can report a matching identity digest while hiding nonnative events or full source fields. A self-supplied `sourceCaptureComplete:true` boolean cannot prove either provider was really consulted. | OPEN **activation blocking**: pure builder independently normalizes and compares complete arrays and rejects missing nonnative events; however immutable V1 batch seals **included identities only** and no independent raw RPC transcript, source-run identity or replay proof. Full transcript/source acquisition must be pinned in the exact immutable bytes and independently reverified before claiming source-qualified. |
| H4 | HIGH | Local `decisionReceipts` JSON can be forged after the first five-minute horizon with an old `decidedAtMs`. | OPEN **activation blocking**: pure builder rejects recorded post-outcome timestamps and binds decision block/hash, observed head/hash and completion time but cannot authenticate acquisition time. Add main-only pre-outcome capture artifact with independently verified GitHub timestamps; never backfill as prospective. |
| H5 | HIGH | Previous `independentLiveGitHubCheck:true` is a local boolean, not proof of prior release/lineage, so a forged prior could skip the whole denominator. | OPEN **activation blocking** for a real runner: require PR #81 independent live GitHub witness and verify every source artifact/release/cursor in main-only code. Synthetic prior objects have NO source authority. |
| H6 | HIGH | No full data for synthetic inclusion block after C0 observation: 12-confirmed launch/decision alone is insufficient and could accidentally admit a look-ahead C0. | FIXED: freeze validates actual inclusion block >= observed head+2 exactly, checks independent canonical hash/time and 12 extra blocks; rejects capture lacking 90-second pre-outcome publication budget. |
| H7 | HIGH | An eligible count of 199 with four later C0 decisions would exceed the predeclared cap 200. | FIXED: `selectedLimit=Math.min(4,200-priorCount)`; reject already complete studies and remaining overflow. No replacement if an enrolled entry is later unexecutable. |
| M1 | MEDIUM | Real factory may repeatedly emit a token across multiple batches. Immediate predecessor verification alone cannot prove historical global token uniqueness or all earlier gap-free factory events. | OPEN activation blocker if de-duplication is part of intended population definition; a complete replayable, witnessed denominator and scope-specific identity policy must be frozen before enrollment. |
| M2 | MEDIUM | Official/archive providers can share the same upstream or be spoofed by caller and clock may drift; name inequality is not source independence. | OPEN: approved RPC hostnames, canonical runtime/chain pins, archive-block availability, GitHub observed capture times and independently repeatable source provenance are not present in pure builder. |
| M3 | MEDIUM | A zero-event batch has no market outcome deadline; treating its 10-minute operational expiry as a 5m trade deadline would distort stop rules. | FIXED by existing publisher check; empty scans still advance exact cursor only after immutable witness. |
| O1 | OPEN | No full-Curve/V4 route/price/cost evidence, independent study-power review, proof of real inclusion or prospective 12-confirmations→publication timing. | NO ACTIVATION. An offline fixture pass is not a measurement of executable profitability. |

## Acceptance gates

- Exactly scoped code and independent V1 synthetic fixtures must pass
  at the exact draft head, including full repository `pnpm test`.
- One targeted source-level rereview after fixing failing fixture
  expectations; no self-review loop.
- No `workflow_dispatch`, schedule, live RPC operation, token action,
  signer, release-write permission, merge or model promotion authorized.
- The selected prereg JSON stays DRAFT and **cannot** satisfy the
  new inclusion rule until independent scientific approval.

**Internal engineering verdict (only once CI green): PURE BUILDER
QUALIFIED OFFLINE; SOURCE / SCIENCE / ACTIVATION NOT QUALIFIED.
EDGE_UNPROVEN.**
