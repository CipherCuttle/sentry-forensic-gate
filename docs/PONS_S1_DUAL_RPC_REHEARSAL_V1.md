# PONS S1 — non-enrolling real dual-RPC engineering rehearsal

Status: PR-ONLY, READ-ONLY. NO MERGE, ACTIVATION, WALLET OR SCIENTIFIC RELEASE.

## PLAN and provider authority
The official Robinhood Chain public RPC is paired with BlockReq's separately
hosted PUBLIC CANDIDATE endpoint. Robinhood's docs alternatively recommend
keyed Alchemy. A different hostname plus one matching historic state sample
do NOT independently qualify backend diversity, archive SLA or source
timestamp authenticity. No secrets are used in this PR workflow.

## CHANGESET
1. Verify chain ID 4663, head lag <=128 blocks, canonical scan boundary and
   pinned Pons V2 factory runtime on both public endpoints.
2. Independently check one HISTORIC pinned factory block, bytecode and
   historical `memeHook` eth_call on BOTH providers. This proves only
   sampled availability, not unbounded archive coverage or provider autonomy.
3. Scan 256 CONTIGUOUS recent, already-observed factory blocks using 16
   individual 16-block queries per provider. Prove complete normalized
   log agreement for every chunk and entire range, including non-native
   tokens and non-native factory events. Pick ONE most recent native event
   without consulting target outcomes. A zero-event batch is inconclusive.
4. Build the fixed launch+2 five-notional C0 baseline through the EXISTING
   read-only Pons launch, curve quote and USD calibration adapters
   independently at both endpoints, after its two extra maturity blocks.
   Require exact ordered $0.25/$0.50/$1/$2/$5 amounts, executable flags,
   USD base amounts, quotes and C0 control parity. Missing/unsupported
   quotes are UNVERIFIED, never successful C0 selection.
5. Reacquire independent fresh completion heads, check inclusion+2 and
   +12 confirmations and recheck BOTH launch and decision hashes.
   Output only a sanitized diagnostic Actions artifact retained 14 days.

One 256-block scan, ONE native event max, no provider retries, a
150-second cooperative budget with per-RPC 12-second timeouts and
six-minute Actions job outer timeout. The pipeline might fail if the
candidate public provider rate-limits or lacks historical eth_call;
report exact sanitized failure stage and do not claim qualification.
No active census, S1 enrollment, future outcomes, source publisher,
trading, wallet or on-chain write calls.

## VERIFY and verdict law
Run the offline guard test, full pnpm test and research-only ast-grep CI,
then inspect the ACTUAL PR network job JSON verdict. Job green is NOT
scientific readiness: all real networking remains candidate engineering
diagnostics. One bounded hostile self-review and targeted rereview of
material fixes are recorded separately.

Full provider independence, original pre-outcome GitHub artifact plus
immutable source AND paired batch release/witness timing, complete Curve/V4
route/gas costs, independent joint power and reviewed S1 canonical
activation remain open. EDGE_UNPROVEN. NO COLLECTION/MONEY/MERGE.

## Targeted diagnostic after first expanded run

The initial 256-block workflow stopped at an undifferentiated historical
state request (PROVIDER_FAIL). The final diagnostic now checks historical
block, code and `memeHook` on each provider separately; finite stage/category
receipts identify which failed. It may continue a bounded recent native C0
technical probe even if historical archive is unavailable, but labels any
subsequent recent-only success `RECENT_C0_ARCHIVE_UNVERIFIED`. Only both
historical responses matching can produce the stronger sampled technical
rehearsal verdict. Neither permits scientific S1 activation.


## 2026-09-27 staged diagnosis — stacked diagnostic-only follow-up

The preceding real PR run 36070443854 scanned exactly 256 contiguous
blocks with matching factory transcripts: two factory events, one native.
The OFFICIAL endpoint could not return the sampled historic factory CODE;
the BlockReq PUBLIC CANDIDATE could not return the sampled historic BLOCK.
The native C0 pair failed under an undifferentiated adapter-invariant code.
None of this establishes either public provider's permanent inability to
serve archive requests.

This child draft adds **per-provider stage-only C0 diagnostics** while
keeping the same frozen observer, factory scan, adapter semantics, five
notionals, safety caps and absence of wallet/collection authority. Each
provider independently reports whether its failure occurred during:
launch normalization/binding, baseline head/authority/hash, market state,
USD calibration, entry quote, reverse quote or C0 control. Only a finite
failure class, static stage, fixed notional and completion stage are
persisted; raw RPC exceptions, endpoint URLs, addresses and credentials
are never serialized. One failing provider never masquerades as a
successful dual-source C0. Failures remain CI-red with an uploaded
sanitized artifact; an explicit UNVERIFIED baseline remains UNVERIFIED.

**No real network job is permitted from the new child PR branch.** The
existing keyless public-network job is exact-head-branch-gated to its
reviewed parent and is not broadened. This change is only offline
instrumentation, tests and documentation.

NEXT independently authorized *non-enrolling* gate:
1. Acquire a genuinely independent Robinhood 4663 archive-capable RPC.
   Robinhood currently documents Alchemy as a supported archive option;
   the provider's archive capability and independence still require
   concrete challenge responses, not assumptions or hostname diversity.
2. Place any provider URL/key only in a protected repository environment.
   Use an independently reviewed, pinned, main-only or isolated authorized
   read-only workflow. Never expose keys to pull_request code, commit them,
   or reuse the Pons live-wallet secrets.
3. First probe historical block, factory code, fixed eth_call and complete
   launch-block transcripts at both endpoints. Stop on historical
   disagreement. Only then run one bounded native C0 quote probe with
   both providers and inspect the finite stage reports.
4. If the real C0 and inclusion+12 gate succeed, run a **separate** original
   artifact -> immutable source release -> batch/witness timing rehearsal.
   Keep existing prospective enrollment, scientific promotion and money
   authority all disabled.

Do not broaden retries, chase arbitrary historic windows, silently swap
providers or mark S1 ready because synthetic tests pass.
