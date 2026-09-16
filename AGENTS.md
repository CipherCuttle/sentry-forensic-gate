# Sentry Forensic Gate — agent entrypoint

Read `README.md`, `docs/SENTRY_TRUTH_R1.md`, and `docs/EXECUTABLE_BASELINE_R1.md` before planning or changing the repository.

This repository is point-in-time adverse-selection research for newly launched Sentry tokens on Ink. Preserve the current shadow/research boundary unless a later canonical document explicitly changes it.

Use `PLAN -> CHANGESET -> VERIFY -> VERDICT`. Prefer the smallest coherent diff. Rehydrate from the exact Git state and relevant PR stack rather than chat memory.

Universal Dev Spine entrypoint: run `mise run context` first when `mise` is available. The machine-readable active state packet is `docs/agent-packets/FAST_VET_R0_HISTORICAL_SMOKE_R1.json`. The predecessor authorization is closed on exact head `eedd320c7745c855d5830133d4686f65b47e57a2`. Only one research-only historical FAST_VET_R0 smoke execution is authorized, using the pinned repaired replay artifact and byte-frozen PR #13 rule materialized from the exact source head by the dedicated workflow. General FAST_VET, OSINT, canary, signing, transaction construction, transaction broadcast, live execution, and merge remain unauthorized. Use `mise run pack` only from a clean worktree.

Reuse first. Do not create a second evaluator, replay pipeline, persistence layer, or policy authority when an existing reviewed implementation owns the semantics. This phase may adapt historical artifact shape only. Source policy identity, point-in-time history, classifications, executable values, `$1`, exact 24h, UNKNOWN->SKIP, and COMPLETE-baseline denominators are frozen.

For remote GitHub work, group related multi-file edits into one coherent commit when possible, keep unrelated work unchanged, and record the exact commit SHA plus verification result in the PR.

Run the repository-native checks (`pnpm test` plus the phase-specific frozen FAST_VET regression and dedicated historical-smoke workflow). Missing capability is a limitation, not a PASS. Do not weaken existing tests or evidence rules to make a change land.

Follow the bounded completion policy: implement -> test -> one independent hostile review -> fix Critical/High findings -> one targeted re-review only if those fixes were needed -> merge only when authorized -> move forward. The predecessor authorization review loop is closed; this implementation gets one new bounded hostile review because it introduces the historical shape adapter. Do not create review loops.
