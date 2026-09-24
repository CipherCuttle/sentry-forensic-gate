# PONS S1 V1 independent witness — bounded hostile self-review

**Scope:** PR #81's inert V1 read-only witness, synthetic checks and
main-only `contents:read/actions:read` workflow. This is an **internal
adversarial self-review**, not independent scientific or security approval.
Only the separate, immutable-release V1 batch transport from draft PR #80
is considered; the older 96-launch/24h V0 protocol must not be accepted.

## Attack and failure review

| ID | Severity | Failure route | Resolution |
| --- | --- | --- | --- |
| H1 | High | Claim that a successful source run contains the exact bytes later uploaded when GitHub asset checksum alone only validates the *release*, not the origin run. | FIXED: independently download the exact named, single source-run artifact, compare its raw `batch.json` with the immutable release, and enforce identical bytes again in the pure validator. Pin source-run SHA, main branch, exact reviewed workflow path, successful conclusion, artifact ID and creation timestamp strictly before outcome. |
| H2 | High | Treat a caller-supplied prior `independentLiveGitHubCheck:true` boolean as full lineage proof, or silently accept a gap between consecutive batches. | FIXED for immediate predecessor: fetch prior immutable release, tag, asset and raw bytes independently, verify digest, batch schema, prior publication before current capture and exact cursor/count pointer. ADMITTED LIMIT: not full ancestry proof for older batches or independently source-attested denominator completeness. |
| H3 | High | GitHub run metadata could describe an artifact created before an authorized merge while a commit's self-asserted committer date looks plausible. | FIXED: require source run's GitHub `created_at` at or after independent reviewed PR `merged_at`; parent identity and main ancestry still mandatory. Git author/committer timestamps are not independently reliable creation time. |
| H4 | High | Treat an incomplete first page of Actions artifacts as unique when a duplicate exists outside the first page. | FIXED: fail closed unless `total_count` equals the bounded acquired list (max 100); exactly one correct artifact name and original run binding required. |
| H5 | High | Accept a late release because GitHub `published_at` has one-second precision and appears equal to the pre-outcome boundary at :00. | FIXED: reuse publisher's strict timestamp upper bound and enforce asset/source-artifact timestamps before the earliest native five-minute outcome. Empty scans use operational expiry; no fake price deadline. |
| H6 | High test coverage | A synthetic positive genesis receipt never exercises immediate predecessor verification, so broken ancestry code can be merged unobserved. | FIXED: a second distinct synthetic batch with real copied previous-release bytes, release metadata and exact cursor pointer now passes; bad prior published time and tag target fail closed. |
| M1 | Medium | Local invocation of the pure validator can be given copied JSON that appears internally consistent but was never acquired from GitHub. | Deliberately not elevated: output labels direct local validation as payload-only. Only separately trusted main-only workflow fetches external REST objects. This does not turn local replay into independent attestation. |
| OPEN-A | Activation-blocking | The future source collector does not yet exist; JSON C0 evidence can be self-consistent but not point-in-time true or complete across dual RPC providers. | Do not activate. Implement source-qualified C0 producer, independent denominator/cursor proof and admissibility rules before accepting scientific data. |
| OPEN-B | Activation-blocking | No real paired V1 immutable release or capture→12-confirmations→publish→witness latency test exists. GitHub Actions runner queue and release-write operation can consume the entire horizon. | Controlled non-scientific rehearsal with explicit separately authorized harmless test publication; missed/late runs fail closed. No real study activation. |
| OPEN-C | Activation-blocking | One-hop predecessor verification cannot attest every earlier batch when full denominator or historical predecessor receipts are missing. | Before real S1 collection, bind an independently witnessed monotonically advancing lineage with replayable source receipts (or independently verify full chain). Never equate a local boolean or isolated batch with full series completeness. |

## Targeted rereview — disabled source only

The repaired source verifies exact raw source/release byte equality, GitHub
source-run provenance, conservative release/source-artifact timestamp
ordering, one-hop previous release and cursor continuity. A synthetic
two-batch positive and hostile rejection fixtures exercise those boundaries.
These source-level checks are distinct from independently authenticated
GitHub network acquisition and real timing.

**No independent hostile signoff has occurred.** The second synthetic
batch and targeted clock tests must pass at the exact final GitHub head
before labeling even the offline V1 witness qualified. Merge, prospective
collection, real scientific batch publication, unattended operation,
trading, signing and model promotion remain unauthorized.

**Scientific status: EDGE_UNPROVEN.**
