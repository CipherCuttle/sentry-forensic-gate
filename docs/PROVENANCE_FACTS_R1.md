# PROVENANCE_FACTS_R1

## Objective

Add the smallest point-in-time creator-lineage evidence spine without creating a second chain authority or a generic graph platform.

Canonical flow:

`Sentry launch observation -> immutable provenance fact -> deterministic edge projection`

Sentry launch observations remain upstream chain truth. Provenance facts are immutable receipts derived from those observations. Provenance edges are rebuildable projections and may be deleted/recomputed without changing chain truth.

## V1 evidence

Fact:
- `LAUNCH_DEPLOYED_BY_CREATOR`

Edges:
- `DEPLOYED_BY` — direct on-chain evidence.
- `PREVIOUS_LAUNCH` — deterministic join from a launch to the immediately preceding Sentry launch by the same creator on the same chain.

`PREVIOUS_LAUNCH` is ordered point-in-time by `(observedBlock, logIndex, factId)`. Same-block earlier logs are prior evidence. Later observations cannot leak backward.

## Evidence classes

- `DIRECT_ONCHAIN`
- `DERIVED_JOIN`

There is intentionally no floating confidence score and no probability claim. Calibration belongs to later prospective outcome work.

Every fact/edge carries an evidence digest. Every edge also records its source fact IDs and `PROVENANCE_FACTS_R1` derivation version.

## Persistence and replay

`provenance_facts` are durable receipts. One launch has one deployment fact.

`provenance_edges` are a derived read model. The projector replaces the chain's edge projection from the currently durable facts. Replaying the same facts must yield byte-equivalent edge payloads/digests.

Reorg rewind deletes provenance observations at or after the rewind block before launch deletion. A retry regenerates facts and the complete projection from canonical launch history.

## Authority boundary

This slice adds no RPC source, indexer, signer, wallet client, transaction construction, or transaction broadcast path. It only transforms already-canonical Sentry launch observations.

Explicitly deferred:
- `FUNDED_BY`
- `SHARED_INITIAL_FUNDER`
- external labels
- holder/sniper/flow evidence
- scoring or probabilities
- generic graph databases

## Falsification path

The next slice may join prior creator launches to forward outcomes. If creator lineage does not improve catastrophic-loss or exit-failure discrimination without destroying winner capture, do not escalate to a funding graph merely because the graph is interesting.
