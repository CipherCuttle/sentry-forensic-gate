# FAST_VET_R0_AUTHORIZATION_R1

## Status

`PENDING HOSTILE REVIEW / FAST_VET SMOKE NOT AUTHORIZED / CANARY + LIVE AUTHORITY FALSE`

This phase decides only whether the pre-existing `FAST_VET_R0` smoke rule may be executed once against the closed historical replay. It does not execute FAST_VET, tune the rule, add OSINT, or authorize a canary.

## Closed predecessor

`HISTORICAL_FULL_REPLAY_R1` closed PASS on repaired/reviewed head `75588056de53b94f92b5cf3b40e89e2b5521031a`.

Pinned repaired replay evidence:

- Stage B run `35001582697`
- artifact `10410898359`
- GitHub artifact digest `sha256:ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a`
- aggregate receipt SHA-256 `916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825`
- 147/147 COMPLETE baselines
- 735/735 COMPLETE outcomes
- zero UNVERIFIED

The full-replay initial review found three P1s; the repaired full replay was regenerated and the single targeted review on the exact repair head reported no major issues.

## Frozen pre-existing FAST_VET rule

The smoke rule predates the full-cohort replay result and is frozen from PR #13 exact head `22fcce4c301e791a59c68b19b198bd1bea104138`, whose exact-head CI `34772418456` succeeded.

Pinned source objects:

- `docs/FAST_VET_R0.md` → `1ea7ac524803e621947d076e120860bade3df780`
- `src/evaluation/fastVet.ts` → `0ca384e142a8f1c898f7041fff87811e2f136225`
- `src/evaluation/fastVetShadow.ts` → `de2a993b93b9b60669acd09a60e1589cdc96e572`
- `scripts/fast-vet-check.mjs` → `2417b03a449bf305a89d0a7196b5db89ef4216bc`
- `src/forensic/creatorOutcome.ts` → `2d9b15481df64e69016c236a6374c96657d31cc0`
- `src/outcome/forwardTypes.ts` → `8c9682b671a7c185dbca416594c8eacd4b0c282e`

Normalized rule fixture: `fixtures/fast-vet-r0-authorization-r1.json`, Git blob SHA-1 `a3266ab0bc2e1e1aaec26fafda64ae6be164c494`.

Frozen semantics:

- primary notional exactly `$1` (`1_000_000` USD micros)
- decisions exactly `PASS / REJECT / UNKNOWN`
- `UNKNOWN -> SKIP`
- reject explicit non-executable `$1` entry
- reject non-executable same-state independent reverse/sellability diagnostic
- reject known prior creator `CATASTROPHIC_LOSS`, `EXIT_FAILURE`, or `LIQUIDITY_COLLAPSE`
- incomplete/missing evidence remains `UNKNOWN`
- PASS requires COMPLETE executable baseline and creator coverage `NO_HISTORY` or `COMPLETE` with no known prior adverse creator history
- no recovery-BPS threshold
- target horizon exactly 24h
- control denominator COMPLETE baselines only
- candidate exposure PASS only
- receipt `FAST_VET_SHADOW_R0`, status `SMOKE_ONLY`, strategy `EDGE_UNPROVEN`
- no sample-adequacy, probability, p-value, ML, tuned-threshold, or promotion claim

## P1 review repairs required by this authorization

Authorization must not trust packet constants authored in this PR. CI must independently prove both lineages:

1. Query GitHub Actions run `35001582697`; require successful completion on exact head `75588056de53b94f92b5cf3b40e89e2b5521031a`.
2. Query artifact `10410898359`; require it belongs to that run/head and has the pinned GitHub digest; download it; require it contains only `historical-full-replay-r1-live-receipt.json`; hash the receipt bytes to the pinned SHA-256; then validate the closed 147×5 accounting and policy identities.
3. Fetch exact PR #13 head `22fcce4c301e791a59c68b19b198bd1bea104138`; verify all six pinned direct/transitive source blobs; deterministically validate the normalized decision and shadow semantics against those source bytes and the existing regression test.
4. Prove this authorization branch contains no FAST_VET evaluator, shadow runner, or smoke-check implementation.

## Historical adapter boundary

The old PR #13 SQLite runner is not authority for this historical run. A later implementation successor, only after authorization closure, may consume only the repaired historical replay artifact and may adapt shape, not semantics.

It must preserve historical baseline/outcome policy identity, point-in-time creator history, classifications, executable values, `$1`, exact 24h target, `UNKNOWN -> SKIP`, and COMPLETE-baseline denominators. No post-decision information may enter creator history.

## Authority

Pending review, every authority bit is false, including `fast_vet_smoke`.

If this authorization later closes PASS, only `fast_vet_smoke` may become true. General FAST_VET, FAST_VET OSINT, canary, signing, transaction construction, transaction broadcast, live execution, and merge remain false.

No smoke result automatically authorizes any later capability.

## Prohibitions

- no FAST_VET execution in this PR
- no post-hoc rule or threshold tuning
- no new network or OSINT collectors
- no old SQLite runner as historical authority
- no current-R3/default behavior change
- no canary, signing, transaction construction, broadcast, or live execution
- no merge without explicit user authority

## Completion policy

`FREEZE RULE -> VERIFY REAL PREDECESSOR PROVENANCE + SOURCE PARITY -> ONE HOSTILE REVIEW -> FIX CRITICAL/HIGH -> ONE TARGETED RE-REVIEW ONLY IF NEEDED -> AUTHORIZE_SMOKE OR STOP`
