# Sentry Forensic Gate — agent entrypoint

Read `README.md`, `docs/SENTRY_TRUTH_R1.md`, and `docs/EXECUTABLE_BASELINE_R1.md` before planning or changing the repository.

This repository is point-in-time adverse-selection research for newly launched Sentry tokens on Ink. Preserve the current shadow/research boundary unless a later canonical document explicitly changes it.

Use `PLAN -> CHANGESET -> VERIFY -> VERDICT`. Prefer the smallest coherent diff. Rehydrate from the exact Git state and relevant PR stack rather than chat memory.

Universal Dev Spine entrypoint: run `mise run context` first when `mise` is available. The machine-readable active state packet is `docs/agent-packets/FAST_VET_R0_AUTHORIZATION_R1.json`. Historical replay is closed PASS and the bounded authorization review is closed PASS. Only `fast_vet_smoke` is authorized, solely to open a separate research-only historical FAST_VET_R0 smoke implementation using the frozen rule and repaired replay artifact. General FAST_VET, OSINT, canary, signing, transaction construction, transaction broadcast, live execution, and merge remain unauthorized. Use `mise run pack` only from a clean worktree.

For remote GitHub work, group related multi-file edits into one coherent commit when possible, keep unrelated work unchanged, and record the exact commit SHA plus verification result in the PR.

Run the repository-native checks (`pnpm test` plus any phase-specific checks named by the active docs). Missing capability is a limitation, not a PASS. Do not weaken existing tests or evidence rules to make a change land.

Follow the bounded completion policy: implement -> test -> one independent hostile review -> fix Critical/High findings -> one targeted re-review only if those fixes were needed -> merge only when authorized -> move forward. The authorization phase has exhausted its review loop; do not request another authorization review.
