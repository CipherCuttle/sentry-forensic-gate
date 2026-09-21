# PONS S0 Historical Cohort V1

## Status

**READ-ONLY HISTORICAL MATERIALIZATION / SHADOW_ONLY / EDGE_UNPROVEN**

This is the bounded data bridge between SENTRY PR-A packets and the QntyLab S0B
model screen.

It does not train a model, choose a winner, construct a transaction, sign,
broadcast, or grant live-money authority.

## Frozen selection rule

The historical cohort is selected without reading target outcomes.

- chain: Robinhood / 4663
- protocol: Pons V2
- block window: `63,500,000 <= block < 67,500,000`
- bucket width: `50,000` blocks
- bucket count: `80`
- candidate: first native-pair `TokenLaunched` event in each bucket
- ordering: block ascending, then log index ascending
- log acquisition chunk: `5,000` blocks
- target horizon: canonical `24h / 86,400,000 ms`

The block window and bucket rule are source constants. There is no environment
override for range, bucket size, ordering, or target horizon.

Changing any of them creates a new cohort version.

## Why a sparse multi-day sample

A dense launch window would violate the research question even if the row count
looked large.

QntyLab S0B requires training labels to have existed before later test decisions:

`training outcome observedBlock < first test decisionBlock`

Pons launches occur much faster than the 24h outcome horizon. Sampling across a
multi-day block range gives the expanding chronological screen a chance to
accumulate genuinely available 24h labels rather than leaking future outcomes.

## Historical evidence semantics

For each selected event:

1. materialize the exact Pons launch at its launch block;
2. normalize launch observation time to the canonical launch-block timestamp;
3. reconstruct the frozen portable baseline at `launch block + 2`;
4. normalize baseline/quote observation time to the canonical decision-block
   timestamp;
5. emit `PONS_S0_FEATURE_PACKET_V1`;
6. reconstruct the canonical 24h portable forward outcome when the baseline is
   complete;
7. emit `PONS_S0_OUTCOME_PACKET_V1`;
8. build the content-addressed `PONS_S0_EXPORT_MANIFEST_V1`.

No present-day token metadata, social data, wallet state or chart-price marking
is used.

## Creator-history boundary

V1 deliberately exports:

`creatorFeature = null`

for every selected launch.

This is preferable to reconstructing creator history from only the selected
cohort and accidentally treating pre-window creator launches as nonexistent.

QntyLab already models creator-history missingness explicitly.

A later creator-lineage cohort revision must perform a separately bounded
historical pre-window backfill and cannot silently mutate V1.

## Selection receipt

`selection.json` is written before baseline/outcome materialization.

It binds:

- exact SENTRY source commit;
- frozen selection rule + digest;
- every bucket;
- empty buckets;
- exact selected raw event block/log/token;
- no target outcome.

This makes the outcome-independent denominator inspectable.

## Origin receipt

`origin.json` binds:

- source repository and exact 40-character commit;
- chain and provider class;
- confirmed acquisition head;
- selection receipt/rule digests;
- export manifest identity/digest;
- feature/outcome stream hashes;
- selected launch/baseline/outcome identities;
- explicit limitations and authority boundaries.

The default historical provider is the previously qualified free archive:

`https://rpc.nodeflare.app/robinhood/public`

The materializer records it as `NODEFLARE_PUBLIC_ARCHIVE`.

A custom RPC may be supplied operationally, but its URL is not copied into the
origin receipt, to avoid credential leakage.

## Reproducibility

SENTRY's launch/quote adapters normally record wall-clock capture timestamps.
Historical replay overrides those timestamps with the canonical launch and
decision block timestamps before PR-A packet generation.

Therefore repeated materialization of the same reviewed source commit, chain
history and fixed selection rule should produce the same S0 feature/outcome
packet bytes.

The acquisition confirmed-head fields in `origin.json` may differ between
runs; those fields are provenance, not model input.

## Cost semantics

The historical cohort does not invent full execution costs.

PR-A outcome packets therefore remain
`UNVERIFIED_EXECUTION_COST` unless independently bound full-path cost evidence
already exists.

QntyLab may report gross executable economics and cost coverage, but missing
costs may not become zero cost.

## Outputs

The workflow artifact contains:

- `selection.json`
- `manifest.json`
- `features.jsonl`
- `outcomes.jsonl`
- `origin.json`
- `materializer-output.json`

No generated cohort is committed to Git.

## Authority

- wallet authority: **none**
- signer authority: **none**
- approvals: **none**
- transaction construction: **none**
- broadcast authority: **none**
- live-money authority: **none**
- model promotion authority: **none**
- merge authority: **none**

Scientific state remains `EDGE_UNPROVEN`.

## Verification

Offline contract:

```bash
pnpm build
pnpm ponss0cohortcheck
```

Real materialization requires the exact source identity:

```bash
SENTRY_SOURCE_COMMIT="$(git rev-parse HEAD)" \
PONS_S0_COHORT_OUTPUT_DIR=/tmp/pons-s0-cohort \
node scripts/pons-s0-historical-cohort.mjs
```

The focused GitHub workflow runs the same fixed cohort against the free Nodeflare
archive and uploads the result as a build artifact.
