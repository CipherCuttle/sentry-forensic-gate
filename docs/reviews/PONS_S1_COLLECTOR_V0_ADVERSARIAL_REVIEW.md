# PONS S1 collector V0 — bounded adversarial self-review

**Review class:** internal adversarial review (NOT independent external sign-off).
**Scope:** disabled prospective collector code, pure fixture suite, historical
guard repair; no active scientific campaign, no money, no merge.

## Review findings and disposition

1. **High — single provider may silently omit factory events. FIXED.**
   Require exact event-by-event agreement across official Robinhood RPC and an
   independent archive-state host, plus end-block hash and factory runtime
   agreement. Refuse same hostname even with different URL paths. Provider
   errors stop collection; never treat them as no-launch intervals.
2. **High — selection across batches may skip or duplicate intra-block
   events. FIXED.** The cursor includes block, log index and event key;
   resuming requires seeing that exact cursor event again in the canonical log
   stream. Each native launch token and event key is unique across the full
   chained cohort; each batch commits to all observed factory events.
3. **High — earliest five-minute outcomes mature before 96 launches are
   gathered. CONTAINED, ACTIVATION GATE OPEN.** Cap each batch at four native
   launches / 16 confirmed blocks, require independent immutable release
   publication per batch, and reject late enrollment. Real polling reliability
   is unproven; the collector is disabled rather than backfilling missed
   five-minute outcomes.
4. **High — a self-supplied seal JSON is not independent immutability proof.
   ACTIVATION GATE OPEN.** Local checks require an exact batch digest and
   pre-outcome publication timestamp but cannot independently confirm
   GitHub release and asset identity. Standalone measurements are labeled
   \`scientificAuthority: NONE\`; a future canonical workflow must verify
   immutable release metadata and asset bytes via an independent GitHub API
   read before outcomes can become scientific evidence. No release-write
   workflow is included in this PR.
5. **High — archived 24-hour S0 scripts violated the repo guard and could
   tempt a broad exemption. FIXED WITHOUT EXEMPTION.** Their two exact
   process-escape source reads now use fail-closed detached HEAD checks.
   Old S0 evidence remains pinned to its previous immutable source/tool SHA.
6. **High — retrospective baseline reconstruction must not impersonate
   pre-outcome model inference, and same-state quotes must not claim sequential
   execution or positive net P&L. CONTAINED.** The collector does not fit a
   model or promote a strategy. It explicitly distinguishes archived
   launch+2 baseline reconstruction, C0 minimum probe from separate actual
   $1 admissibility, and unverified full costs, latency and wallet parity.

## Targeted post-repair checklist

Fixture tests include: early draft activation refusal; first-block origin
and predecessor; 12 confirmations; factory-log parity divergence; same-block
cursor resumption; replay cursor omission; unique launch tokens; duplicate
events; hash/reorg mismatch; pre-five-minute enrollment and seal; tamper and
mutable-seal rejection. The dedicated PR-only qualification workflow uses
read-only GitHub permissions and has no cron, signer or live transaction code.

**Disposition:** research-only draft; activation BLOCKED pending the
open prerequisites above and one genuine independent hostile review. No
Critical/High open issue is authorized to be waived for active collection.
