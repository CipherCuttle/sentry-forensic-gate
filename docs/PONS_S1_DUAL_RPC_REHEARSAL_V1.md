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
