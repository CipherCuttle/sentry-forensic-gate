# FORWARD_OUTCOMES_R1

## Objective

Collect deterministic forward executable outcomes for the already-frozen `$1` `EXECUTABLE_BASELINE_R1` shadow position at:

- 1 minute;
- 5 minutes;
- 30 minutes;
- 2 hours;
- 24 hours.

This slice remains **shadow / research only**. It reads historical chain state and Tsunami quote state. It does not hold keys, approve tokens, construct swaps, sign, broadcast, or execute transactions.

## Position authority

R1 does not invent a new entry.

For each launch it consumes the persisted `EXECUTABLE_BASELINE_R1` batch and the exact launched-token amount returned by the `$1` entry quote at the frozen baseline decision block. The forward question is therefore:

> At the canonical horizon block, what could the token amount that the baseline said we acquired be sold for?

A baseline with no COMPLETE market or no canonical `$1` leg is not silently reconstructed under different assumptions.

## Horizon clock

The horizon target is anchored to canonical launch-block time:

`target_timestamp = launch_block_timestamp + horizon_ms`

The observation block is the earliest confirmed canonical block whose timestamp is at or after that target **and** which is not before the baseline decision block.

This prevents a slow-block edge case from valuing a position before the frozen baseline entry existed.

Default durability is two confirmations:

`OUTCOME_CONFIRMATIONS=2`

Confirmations delay collection. They do not move the target timestamp.

Every receipt records both `targetTimestampMs` and the actual canonical `observedTimestampMs` / block hash.

## Executable valuation

At the horizon block R1:

1. verifies Ink chain and pinned Tsunami quoter/factory/pool identity;
2. reads active pool liquidity;
3. quotes the entire persisted `$1` entry token amount back into its canonical base using Tsunami Quoter V2 at the exact horizon block;
4. values the returned base at that same horizon block.

For USDT0 base, R1 uses the same nominal-peg unit convention as the baseline.

For WETH base, R1 quotes the returned WETH into USDT0 across Tsunami fee tiers `500 / 3000 / 10000` at the horizon block and uses the greatest executable USDT0 output.

Provider/transport failures are not economic evidence and escape for retry. EVM quote reverts are executable-market evidence.

## Classification

The existing candidate catastrophic threshold is frozen before forward data is collected:

`executable_value <= 20% of the $1 entry notional`

R1 classification precedence is:

1. `LIQUIDITY_COLLAPSE` — active pool liquidity is deterministically zero;
2. `EXIT_FAILURE` — the persisted token amount cannot produce a positive executable base output;
3. `CATASTROPHIC_LOSS` — executable USD recovery is `<= 2,000 bps` of entry;
4. `NORMAL_LOSS` — executable recovery is `> 2,000 bps` and `< 10,000 bps`;
5. `NORMAL_WIN` — executable recovery is `>= 10,000 bps`.

`FAT_TAIL_WIN` is deliberately **not emitted by R1**. A tail threshold must be preregistered in the later evaluation slice rather than chosen after seeing outcomes.

## UNKNOWN / UNVERIFIED semantics

If the baseline `$1` entry was not executable, or the token can be sold into base but the base cannot be valued under the frozen USD convention, R1 persists `status=UNVERIFIED` without fabricating a loss or win classification.

An unclassified UNVERIFIED receipt does not count as an unsellable classified outcome in `CREATOR_OUTCOME_JOIN_V0`.

## Reorg and replay semantics

Before persistence R1 rechecks:

- launch block hash against the canonical launch receipt;
- baseline decision block hash against the persisted baseline receipt;
- horizon observation block hash after all reads.

Any movement fails the sync before persistence.

Outcome evidence is already rewound by its **own observation block** in the shared store. Therefore a launch and baseline can survive while a later reorged horizon receipt is deleted and rebuilt.

Outcome identity is deterministic from:

`FORWARD_OUTCOMES_R1 + launch_id + baseline_id + horizon_ms`

The full receipt is evidence-digested. Identical replay is idempotent; contradictory replay at the same `(launch, horizon)` fails with `OUTCOME_IDENTITY_CONFLICT`.

## Raw evidence retained

Each R1 receipt binds at least:

- policy version and status;
- launch / baseline / horizon identity;
- target timestamp;
- observation block / hash / timestamp;
- `$1` entry token amount;
- canonical market pool / fee / base;
- horizon active-liquidity scalar;
- executable base amount out;
- executable USD value when available;
- executable recovery bps when available;
- classification when resolved;
- evidence digest.

The Uniswap-V3-style liquidity scalar is retained raw as `poolActiveLiquidity`. R1 does **not** mislabel that scalar as USD liquidity.

## CLI

```bash
set -a && . ./.env && set +a
pnpm build
pnpm start:outcomes -- --once
pnpm start:outcomes
```

Environment variables:

- `OUTCOME_CONFIRMATIONS=2`
- `OUTCOME_MAX_PER_SYNC=100`
- `OUTCOME_POLL_INTERVAL_MS=1500`

## Acceptance gate

- all five frozen horizons are supported;
- horizon selection uses canonical block timestamps, never wall-clock observation time;
- no observation occurs before the persisted baseline decision block;
- the persisted `$1` token amount is used unchanged;
- provider failure leaves the horizon pending;
- quote revert / zero liquidity are economic evidence;
- USD valuation gaps are UNVERIFIED rather than coerced into loss;
- launch, baseline, and outcome blocks are hash-checked before persistence;
- restart is idempotent;
- own-block rewind removes horizon evidence without requiring launch deletion;
- memory and SQLite behavior agree;
- research-only CI guardrails remain green.
