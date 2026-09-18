# FAST_VET_R1 Capacity Gate — Shadow Preregistration

## Objective

FAST_VET_R1 is a shadow-only experiment that asks a different question from
FAST_VET_R0.

R0 asks whether the reviewed evidence is complete enough to authorize a
research BUY_ELIGIBLE decision.

R1 asks:

> Is there already strong mechanical or creator evidence that this candidate
> should be vetoed? If not, what is the largest demonstrated executable
> capacity on the frozen baseline ladder?

The research objective is:

`MAXIMIZE_COVERAGE_SUBJECT_TO_CATASTROPHE_VETOES`

This does **not** grant live-money authority. `EDGE_UNPROVEN` remains explicit.

## Frozen initial R1 semantics

The baseline ladder remains exactly:

- $0.25 = `250_000` USD micros
- $0.50 = `500_000` USD micros
- $1 = `1_000_000` USD micros
- $2 = `2_000_000` USD micros
- $5 = `5_000_000` USD micros

A `COMPLETE` portable baseline must contain exactly those five rungs, in that
order. R1 fails closed on malformed COMPLETE evidence.

### Evidence failure is not token failure

- baseline missing -> `NO_DECISION`
- baseline unverified -> `NO_DECISION`
- authority/policy/reverse-semantics mismatch -> throw/fail closed

Those states are research-observation failures, not evidence that a token is
bad.

### Hard vetoes in R1 v1

R1 rejects only when current evidence supplies one of these registered vetoes:

1. the minimum $0.25 entry probe is not executable;
2. the minimum $0.25 independent reverse probe is not executable;
3. canonical creator-outcome evidence contains at least one prior
   `CATASTROPHIC_LOSS`, `EXIT_FAILURE`, or `LIQUIDITY_COLLAPSE`.

No website, social, narrative, volume, holder-count, or aesthetic signal is
part of this policy.

Missing creator evidence is allowed with uncertainty.
PARTIAL/UNKNOWN creator history with no observed adverse event is allowed with
uncertainty.
NO_HISTORY is allowed.

### Capacity, not all-rungs approval

Capacity is the largest **contiguous** prefix of the frozen ladder for which
both entry and independent reverse are executable.

Example:

```text
$0.25 entry+reverse PASS
$0.50 entry+reverse PASS
$1.00 entry+reverse PASS
$2.00 reverse FAIL
$5.00 entry+reverse PASS
```

R1 capacity is `$1`, not `$5`.

A later working rung cannot jump over a failed smaller rung.

### No recovery threshold in R1 v1

`independentReverseRecoveryBps` remains diagnostic-only same-state
sellability/recovery evidence.

R1 v1 deliberately does **not** convert it into a PnL estimate and does not
invent a minimum acceptable recovery percentage. A threshold may only be added
as a separately preregistered policy revision after prospective evidence.

## Prospective comparison

Every candidate should eventually receive three immutable hypothetical
decisions from the same evidence:

1. `FAST_VET_R0` — existing frozen conservative lane;
2. `FAST_VET_R1_CAPACITY_GATE` — catastrophe-veto + capacity lane;
3. `BUY_EVERY_EXECUTABLE_CONTROL_R1` — naive control that ignores creator
   history and participates whenever the minimum bidirectional probe works.

The control is intentionally unsophisticated. It is a measurement baseline, not
a live strategy.

Outcome collection must include rejected candidates too, otherwise false
rejections and missed fat-tail winners cannot be measured.

## Evaluation targets

Once portable forward outcomes are available, compare at least:

- coverage / hypothetical participation rate;
- exit-failure rate among accepted candidates;
- catastrophic-loss rate among accepted candidates;
- liquidity-collapse rate among accepted candidates;
- executable lower-tail outcome / CVaR-style summaries;
- median executable outcome;
- fat-tail winner capture;
- upside lost through false rejection;
- capital utilization by demonstrated capacity;
- gas/slippage-adjusted result.

No policy promotion may be inferred from a single token or from marked chart
price without executable exit evidence.

## Authority boundaries

- mode: `SHADOW_ONLY`
- live-money authority: **false**
- existing Ink exact-$1 authorization: unchanged
- Robinhood live authority: **none**
- Arc live authority: **none**
- no signing
- no transaction construction/broadcast
- no wallet funding
- no change to `FAST_VET_R0`
- no change to baseline quote semantics
- no strategy promotion

`EDGE_UNPROVEN`
