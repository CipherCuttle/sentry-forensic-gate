# CREATOR_SIGNAL_EVAL_V0

## Objective

Test one deliberately simple creator-lineage hypothesis against the same mature Sentry launch universe used by the executable baseline:

> Does rejecting a launch when its creator already has at least one **canonical prior adverse 24h outcome** reduce severe executable exposure without reducing aggregate `$1-per-launch` terminal capital?

This is **retrospective descriptive falsification**, not confirmatory evidence and not execution authority.

The strategy label is frozen as:

`EDGE_UNPROVEN`

A favorable V0 result may justify a later prospective preregistration. It may not authorize live gating, signing, approvals, swaps, transaction broadcast, or claims of profitability.

## Frozen candidate rule

Control:

`BUY_EVERY_COMPLETE_BASELINE`

Candidate:

`REJECT_IF_ANY_PRIOR_CANONICAL_ADVERSE_CREATOR_OUTCOME`

The prior adverse classes are exactly:

- `CATASTROPHIC_LOSS`
- `EXIT_FAILURE`
- `LIQUIDITY_COLLAPSE`

The creator-history receipt is evaluated at the launch's existing executable-baseline decision block. Future target outcomes cannot enter that feature.

`NO_HISTORY`, `UNKNOWN`, and creator histories with no observed adverse event **PASS**. Missing evidence is not interpreted as safety; V0 simply refuses to reject without direct prior adverse evidence.

Only `FORWARD_OUTCOMES_R1` 24h receipts have outcome authority in this evaluator. Legacy fixture receipts are ignored.

## Mature cohort

Evaluation uses a canonical chain snapshot with two confirmations.

A provenance launch is mature when:

`launch_block_timestamp + 24h <= confirmed_as_of_timestamp`

The evaluator:

1. reads the confirmed as-of block;
2. hash-validates every provenance fact used to determine maturity;
3. hash-validates baseline decision blocks in the mature universe;
4. recomputes creator-history features from canonical R1 outcomes only;
5. hash-validates every R1 outcome that can affect a target or creator-history feature;
6. rereads the confirmed as-of block **last** and fails if its hash changed.

This is read-only evidence validation. It does not query present-day web metadata or enrich historical decisions with future information.

## Coverage semantics

Every mature provenance launch remains visible in the receipt.

A missing baseline receipt lowers baseline-receipt coverage.

A mature `COMPLETE` baseline with a missing or `UNVERIFIED` 24h R1 outcome remains unresolved and lowers outcome coverage. It is not dropped and is not coerced to a win or loss.

An `UNVERIFIED` baseline is retained in mature-universe accounting but is not a comparable control trade.

This intentionally makes missing evidence hurt sample adequacy rather than silently improving the result.

## Frozen sample-adequacy gate

These are operational evidence floors, **not p-values** and not a statistical proof of edge:

- at least `30` mature launches;
- baseline receipt coverage at least `9000 bps` (`90%`);
- at least `30` mature `COMPLETE` baselines;
- at least `30` resolved 24h targets;
- target outcome coverage at least `9000 bps` (`90%`) across complete baselines;
- at least `10` complete-baseline decisions with some prior creator history;
- at least `10` adverse control outcomes.

If any floor fails, status is:

`INSUFFICIENT_SAMPLE`

and `verdict = null`.

This follows the Frontier discipline that inadequate evidence is an epistemic state, not a failed or successful hypothesis.

## Economic comparison

Every resolved control opportunity receives exactly `$1` of hypothetical capital.

Control terminal capital:

`actual executable 24h value of every resolved complete-baseline launch`

Candidate terminal capital:

- candidate `PASS`: same executable 24h value as control;
- candidate `REJECT`: retain the original `$1` as cash.

There is no claim that rejected capital was reinvested elsewhere.

The paired capital delta is therefore entirely attributable to the frozen accept/reject rule on the same launch cohort.

## Adverse exposure

Control adverse count is the number of resolved targets classified as:

- `CATASTROPHIC_LOSS`
- `EXIT_FAILURE`
- `LIQUIDITY_COLLAPSE`

Candidate adverse count includes only adverse launches the candidate would have passed.

The receipt reports:

- adverse outcomes avoided;
- adverse exposure reduction;
- rejected non-adverse launches;
- adverse precision of resolved rejections;
- candidate trade retention.

## Positive-tail capture

V0 does **not** invent a `5x`, `10x`, or other fat-tail threshold after observing results.

For each resolved launch:

`upside_excess = max(executable_value - $1, 0)`

Winner capture is:

`candidate passed upside excess / control upside excess`

This is a continuous diagnostic. It is not itself a promotion threshold in V0.

`FAT_TAIL_WIN` remains forbidden as a `FORWARD_OUTCOMES_R1` target label; encountering it fails closed because R1 deliberately did not define such a threshold.

## Verdict semantics

A verdict is emitted only after all sample-adequacy floors pass.

`DESCRIPTIVE_WORTH_PROSPECTIVE_TEST`

requires both:

1. at least one adverse control outcome was avoided; and
2. candidate aggregate terminal capital is greater than or equal to control aggregate terminal capital.

Otherwise:

`DESCRIPTIVE_NOT_SUPPORTED`

Both verdicts remain:

`EDGE_UNPROVEN`

V0 deliberately does not attach a confidence interval or significance claim. The candidate and control are paired/nested decisions on the same launches, so Frontier's independent-arm Newcombe interval is **not** copied blindly. Any later confirmatory statistic must be separately preregistered for this paired design.

## Receipt authority

The evaluation receipt binds:

- `CREATOR_SIGNAL_EVAL_V0` configuration digest;
- canonical as-of block/hash/timestamp;
- confirmations;
- every mature launch fact/evidence digest;
- mature baseline identities, authority digests, and status;
- each creator-history feature receipt/evidence digest;
- each target R1 outcome/evidence digest;
- full coverage and economic metrics;
- status/verdict;
- deterministic input/output/evidence digests.

Reordering the same inputs must reproduce the same receipt.

## CLI

```bash
pnpm build
pnpm start:creator-signal
```

The CLI reads the existing SQLite ledger and historical Ink block headers. It does not collect new outcomes or mutate trading state.

## Acceptance gate

- candidate rule is frozen before using V0 as evidence;
- only point-in-time creator history can affect the candidate decision;
- only canonical `FORWARD_OUTCOMES_R1` 24h outcomes can resolve targets;
- missing/UNVERIFIED targets remain unresolved;
- all mature launches remain visible in coverage accounting;
- canonical evidence hashes are revalidated against one stable as-of anchor;
- rejected positions retain `$1` cash rather than becoming zero-value trades;
- positive-tail capture uses continuous excess above `$1`, not a tuned winner threshold;
- inadequate samples cannot produce a verdict;
- favorable output remains `EDGE_UNPROVEN` and cannot authorize live integration.
