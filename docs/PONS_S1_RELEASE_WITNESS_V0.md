# PONS S1 — immutable release witness V0 (inert)

The selected S1 batch must be published **before any selected five-minute
primary target outcome becomes knowable**. Trust is never inferred from the
batch's own `seal` object, a local filesystem timestamp or a GitHub Actions
artifact. The independently fetched, immutable GitHub release is the external
timestamp and asset commitment.

## Exact witness requirements

1. A repository maintainer must explicitly enable release immutability in
   `CipherCuttle/sentry-forensic-gate` **before** publishing any S1 batch.
   Repository administration access is not present here, so this status is
   unverified and activation remains blocked.
2. A separate, future explicitly authorized publisher creates a **draft**
   release with tag `pons-s1-batch-<batchDigest>`, attaches **exactly one**
   asset named `pons-s1-batch-<batchDigest>.json`, whose raw UTF-8 bytes
   exactly equal `JSON.stringify(canonical(batch)) + "\n"`, and publishes
   that release before the earliest selected launch's five-minute target.
   The lightweight Git tag must point to the independent canonical
   activation **commit SHA**, not a movable branch.
3. The read-only manual workflow fetches `GET /releases/{release_id}`,
   `GET /releases/assets/{asset_id}`, `GET /git/ref/tags/{tag}` and the
   exact uploaded asset bytes from fixed GitHub endpoints. It checks
   `release.immutable === true`, `draft === false`, exact tag and
   repository identity, singleton uploaded asset, SHA-256 returned by
   GitHub's asset API, matching metadata at both endpoints, the pinned
   activation tag target, asset timestamps at or before publication, and
   GitHub's `published_at` **strictly before** the first target outcome.
   All values must pass; unknown data fail closed.
4. The verifier emits a read-only witness receipt, the exact batch and
   an externally corroborated seal. Local replays of copied API JSON
   pass payload validation but are **not** independent network provenance.
   A trusted GitHub Actions `workflow_dispatch` run (main only, contents:
   read) is the specified independent API acquisition environment. It has
   no release-write permission, no schedule, no wallet, no signer and no
   transaction broadcast. It cannot publish an asset or start S1.

GitHub documentation:
- https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases
- https://docs.github.com/en/rest/releases/releases
- https://docs.github.com/en/rest/releases/assets

The guardrail intentionally does not trust GitHub release *title*, mutable
release notes, a screenshot of an immutable badge, a local hand-authored
seal or the asset's GitHub Actions artifact retention period. Genuine
immutable releases lock the asset and tag; the generated GitHub release
attestation is additional independent provenance if separately verified.

## Remaining explicit activation blocks

This PR does NOT create the publisher, enable repository immutability,
run a real release witness or issue a canonical activation receipt.
There is currently no S1 prospective data collection or realized
profitability. The original S0 scientific result remains `EDGE_UNPROVEN`.
The verifier proves exact pre-outcome bytes and GitHub publication timing;
it **does not** prove full raw Pons factory denominator completeness, real
quote-to-inclusion feasibility, conservative net trade costs, execution-wallet
parity or model edge. These require separate evidence and review.

Run fixture tests with
`node scripts/pons-s1-release-witness-check.mjs`.
The manual read-only witness workflow is available only after a separately
authorized merge to `main`, and even then requires an existing immutable
release and its exact IDs. An independent hostile review of the combined
S1 activation + witness boundary is still required.

## Activation commit circularity resolved in the contract

The old activation check mistakenly required its checkout commit to equal a
SHA named inside the activation file in that same commit. That is impossible.
The updated contract requires a distinct post-merge activation commit. The
receipt records its **parent reviewed merge SHA**; a separately obtained
GitHub REST proof must establish the detached activation checkout SHA, its
parent and the externally verified merge timestamp. A local JSON proof alone
is not independent verification; the canonical acquisition workflow is still
an activation-blocking deliverable. There is no activation receipt in this
branch and the frozen S1 spec remains `DRAFT_REVIEW_ONLY_NOT_ACTIVE`.
