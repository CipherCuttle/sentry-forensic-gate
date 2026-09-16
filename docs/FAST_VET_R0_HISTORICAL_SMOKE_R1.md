# FAST_VET_R0_HISTORICAL_SMOKE_R1

Status: IMPLEMENTATION — research-only smoke.

This successor executes the already-authorized frozen `FAST_VET_R0` rule exactly once against the repaired `HISTORICAL_FULL_REPLAY_R1` aggregate. It is deliberately descriptive and may not tune the rule, add OSINT, promote the strategy, or widen canary/live authority.

## Frozen inputs

- authorization closure head: `eedd320c7745c855d5830133d4686f65b47e57a2`
- frozen FAST_VET source head: `22fcce4c301e791a59c68b19b198bd1bea104138`
- repaired replay artifact: `10410898359`
- repaired replay receipt SHA-256: `916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825`
- baseline source policy: `HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1`
- outcome source policy: `HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1`

`src/evaluation/fastVet.ts`, `src/evaluation/fastVetShadow.ts`, and `scripts/fast-vet-check.mjs` are copied by exact Git blob identity from the frozen source head. The historical adapter does not use the old SQLite runner. It consumes only the repaired aggregate and reconstructs creator history from earlier canonical rows whose 24h outcome was observable at the target decision block.

## Semantics that must not change

- primary notional `$1`;
- `PASS / REJECT / UNKNOWN` and `UNKNOWN -> SKIP`;
- explicit non-executable entry/reverse rejection;
- known prior creator catastrophic/exit/liquidity-collapse rejection;
- incomplete point-in-time creator history remains UNKNOWN;
- exact 24h target;
- COMPLETE-baseline control denominator;
- candidate exposure is PASS only;
- same-state reverse remains a sellability diagnostic, not PnL;
- no recovery-BPS threshold;
- no threshold tuning, p-value, ML, probability, sample-adequacy, or promotion claim.

## Authority

This implementation does **not** authorize canary execution, signing, transaction construction, transaction broadcast, live execution, or merge. Its only output is a `SMOKE_ONLY / EDGE_UNPROVEN` receipt.
