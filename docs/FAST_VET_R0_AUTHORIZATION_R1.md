# FAST_VET_R0_AUTHORIZATION_R1

## Status

`PENDING HOSTILE REVIEW / FAST_VET SMOKE NOT AUTHORIZED / CANARY + LIVE AUTHORITY FALSE`

This phase decides only whether the pre-existing `FAST_VET_R0` smoke rule may be executed once against the closed historical replay. It does not execute the smoke, tune the rule, add OSINT, or authorize a canary.

## Predecessor closure

`HISTORICAL_FULL_REPLAY_R1` is closed PASS on exact repaired/reviewed head:

`75588056de53b94f92b5cf3b40e89e2b5521031a`

Exact-head verification is 7/7 green:

- CI `35001582681`
- Stage A authority map `35001582737`
- historical baseline `35001582904`
- historical outcome `35001582683`
- all-horizon compatibility `35001582992`
- 147-launch scope/authorization `35001582695`
- repaired Stage B replay `35001582697`

The repaired Stage B artifact is `10410898359`, GitHub digest
`sha256:ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a`.
The aggregate receipt SHA-256 is
`916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825`.

It accounts for exactly 147 launches and 735 horizon cells, with 147 COMPLETE baselines, 735 COMPLETE outcomes, and zero UNVERIFIED results.

The initial full-replay hostile review found three P1 findings. They were repaired atomically in the exact closure head, the full replay was regenerated, and the single targeted Codex re-review on `75588056de` reported no major issues. No further review loop is open.

## Frozen FAST_VET source

The candidate smoke rule already existed before the full-cohort replay result in PR #13:

- PR: `#13 FAST_VET_R0: compressed existing-evidence smoke filter`
- exact source head: `22fcce4c301e791a59c68b19b198bd1bea104138`
- exact-head CI: `34772418456` SUCCESS

Frozen source blobs:

- `docs/FAST_VET_R0.md` → `1ea7ac524803e621947d076e120860bade3df780`
- `src/evaluation/fastVet.ts` → `0ca384e142a8f1c898f7041fff87811e2f136225`
- `src/evaluation/fastVetShadow.ts` → `de2a993b93b9b60669acd09a60e1589cdc96e572`
- `scripts/fast-vet-check.mjs` → `2417b03a449bf305a89d0a7196b5db89ef4216bc`

The normalized frozen rule is committed as
`fixtures/fast-vet-r0-authorization-r1.json`
with SHA-256:

`48704fd4692016a7fae73bcd63841686788f837d3001d43c9cf5cb3841172665`

## Frozen decision semantics

Primary notional is exactly `$1` (`1_000_000` USD micros).

The decision is exactly `PASS / REJECT / UNKNOWN`.

`UNKNOWN -> SKIP`.

`REJECT` when the primary `$1` entry is explicitly non-executable, the primary same-state independent reverse/sellability diagnostic is non-executable, or point-in-time creator history already contains a canonical prior `CATASTROPHIC_LOSS`, `EXIT_FAILURE`, or `LIQUIDITY_COLLAPSE`.

`UNKNOWN` covers missing/unverified baseline or primary evidence, missing creator evidence, and incomplete creator history without already-known adverse history.

`PASS` requires a COMPLETE baseline, executable `$1` entry, executable `$1` independent reverse, creator coverage `NO_HISTORY` or `COMPLETE`, and no known prior adverse creator history.

The independent reverse remains a same-state sellability diagnostic. It is not sequential PnL. There is no recovery-BPS threshold.

## Frozen shadow semantics

The smoke remains:

- receipt: `FAST_VET_SHADOW_R0`
- status: `SMOKE_ONLY`
- strategy label: `EDGE_UNPROVEN`
- target horizon: exactly 24h
- control cohort: COMPLETE baselines only
- candidate exposure: PASS only

Metrics remain trade retention, outcome coverage, adverse-exposure reduction, ordinary-win retention, and positive executable-upside capture.

There is no sample-adequacy claim, probability, p-value, confidence interval, ML model, tuned threshold, or promotion decision.

## Historical adapter boundary

The old PR #13 runner reads an old local SQLite ledger and is **not** authority for this run.

A later implementation successor, only if this authorization closes, may consume only the repaired `HISTORICAL_FULL_REPLAY_R1` aggregate artifact pinned above.

The adapter may adapt shape, not semantics. It must:

- preserve the historical source policy identities;
- use the historical baseline `HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1`;
- use the historical outcome `HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1`;
- use only the exact 24h target cell;
- preserve outcome classification and executable value;
- reconstruct creator history point-in-time only;
- exclude information observed after the target launch's decision block;
- preserve `$1`, `UNKNOWN -> SKIP`, and COMPLETE-baseline denominators.

Changing the source-policy binding from the old local-ledger runner to the reviewed historical replay artifact is an adapter requirement, not permission to change the smoke rule.

## Authorization state

Every authority bit is currently false, including `fast_vet_smoke`.

The one independent hostile review must close before `fast_vet_smoke=true` can be considered.

Even after a successful authorization review:

- general `fast_vet` stays false;
- `fast_vet_osint` stays false;
- canary stays false;
- signing stays false;
- transaction construction stays false;
- transaction broadcast stays false;
- live execution stays false;
- merge stays false.

A smoke result does not automatically authorize any of those capabilities.

## Prohibitions

- do not execute FAST_VET smoke in this PR;
- do not tune or remove the frozen independent-reverse criterion;
- do not tune the creator-history criterion;
- do not change the `$1` primary notional;
- do not change the 24h target;
- do not change `UNKNOWN -> SKIP`;
- do not add new RPC/HTTP/social/domain/Telegram/X/GitHub/funding/identity/RekTrace collectors;
- do not revive the old SQLite runner as authority for this historical run;
- do not authorize canary, signing, transaction construction, transaction broadcast, live execution, or merge;
- do not change current R3/default behavior;
- do not merge without explicit user authority.

## Completion policy

`FREEZE PRE-EXISTING RULE -> VERIFY SOURCE IDENTITY -> ONE HOSTILE REVIEW -> FIX CRITICAL/HIGH -> ONE TARGETED RE-REVIEW ONLY IF NEEDED -> AUTHORIZE_SMOKE OR STOP`

No smoke execution occurs inside this authorization phase.
