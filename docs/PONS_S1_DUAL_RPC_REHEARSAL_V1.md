# PONS S1: real dual-RPC engineering rehearsal (non-enrolling PR-only)

Status: PR-ONLY CANDIDATE. NO MERGE, PROSPECTIVE S1 OBSERVATIONS,
ACTIVATION, IMMUTABLE RELEASE, SIGNING, WALLET USE OR MONEY.

## PLAN
Robinhood's official pinned public mainnet RPC (chain ID 4663) and the
independently hosted **candidate** BlockReq public endpoint are used
without keys or repository secrets. Source: Robinhood developer connection
docs and BlockReq's Robinhood Chain service documentation. BlockReq
advertises archive RPC; neither backend independence nor historical eth_call
availability is established by hostname, marketing copy, or a green job.
Robinhood recommends a keyed Alchemy endpoint for developers, but no
non-public credentials are used in this untrusted pull-request context.

## CHANGESET
One automatic PR-only job on the exact approved #85 draft branch:
1. Read two chain IDs, bound head lag to 128 blocks and verify the pinned
   Pons V2 factory runtime bytecode plus canonical scan-through block hash
   at both endpoints. Refuse source drift.
2. Scan exactly 12 recent already-observed blocks on *both* providers;
   compare EVERY normalized factory event, including non-native pairs.
   Never choose only events with favorable later outcomes. Inspect at
   most one latest native event in this bounded engineering diagnostic;
   if none exists, report NO_NATIVE_IN_BOUNDED_WINDOW.
3. Use the repository's same read-only launch, curve quote and USD
   calibration adapters to obtain the genuine frozen five-notional
   launch+2 C0 baseline independently from each provider, after required
   maturity. Compare decision block/hash, all five input/output amounts
   and executable flags plus the frozen C0 action. UNVERIFIED baselines
   never pass quote parity. This is a **technical latency exercise**,
   not an S1 eligibility decision or synthetic fill.
4. At quote completion read both fresh canonical heads, require
   inclusion = minimum completion head+2, independently observe +12
   confirmation blocks, and recheck launch hash. A 150-second run
   budget, exactly one fixed scan and no retries bound the experiment.
5. Save one sanitized GitHub Actions artifact. Output excludes token
   addresses, full market values, raw RPC errors, private URLs and
   outcomes; the digest is a diagnostic local full-factory digest only.

The PR workflow never calls the active main-only observer, never
enrolls a launch, never creates a GitHub release and never touches
the S1 preregistration or wallet. Any provider failure yields
PROVIDER_FAIL with stage and finite category, no fake UNKNOWN
prospective census row. A successful fixed-block technical measurement
is never scientifically admissible and cannot count as independent
original source attestation.

## VERIFY
Offline adversarial tests cover wrong endpoints, head lag, complete
census parity, frozen quote mismatch and all unauthorized promotion
flags. Full pnpm test and the repository research-only AST/network
guards must pass. For real Actions, check the **artifact's verdict**,
not just the job color. NO_NATIVE_IN_BOUNDED_WINDOW is inconclusive,
not proof that the full native denominator was captured.

## REMAINING GATES
A separately vetted non-public archive provider, original full
pre-outcome source Actions timestamp and immutable release, actual
full-source-sidecar-bound cohort batch and independent witness,
real fee/approval/Curve-to-V4 costs and a genuine independent
joint-power analysis. This PR cannot satisfy the entire <5m
publication and witness critical path. EDGE_UNPROVEN, NO MONEY.
