# CREATOR_OUTCOME_JOIN_V0

## Objective

Test whether creator history contains useful adverse-selection signal before adding funding-wallet tracing or a scoring model.

This slice is a deterministic, read-only projection over already-authoritative data:

`baseline decision receipt + creator provenance facts + prior forward outcomes -> creator outcome feature receipt`

It introduces no new RPC source, wallet authority, transaction path, graph database, probability model, or outcome-acquisition worker.

## Point-in-time boundary

Every target launch is evaluated at the exact decision block already frozen by `EXECUTABLE_BASELINE_R1`. The creator join therefore uses the same information boundary as the executable baseline rather than inventing a second decision clock.

A creator launch is prior evidence only when its provenance fact sorts before the target fact by:

`(observedBlock, logIndex, factId)`

Same-block earlier logs count as prior evidence. Later logs and later blocks do not.

A prior launch's outcome is eligible only when:

- it belongs to the same creator and chain as the target;
- it is the frozen 24h horizon (`86_400_000 ms`);
- its `observedBlock <= target baseline decisionBlock`.

Future outcomes must never leak backward into an earlier target decision.

## Frozen V0 feature surface

The receipt exposes counts, not a risk score or probability:

- prior launch count;
- eligible 24h outcome receipt count;
- classified 24h outcome count;
- unresolved prior-launch count;
- unsellable 24h outcome count;
- `CATASTROPHIC_LOSS` count;
- `EXIT_FAILURE` count;
- `LIQUIDITY_COLLAPSE` count;
- `NORMAL_LOSS` count;
- `NORMAL_WIN` count;
- `FAT_TAIL_WIN` count.

No ratio is promoted to a calibrated probability in V0.

## Coverage semantics

Coverage is explicit:

- `NO_HISTORY` — the creator has no prior Sentry launch at the target decision point.
- `UNKNOWN` — prior launches exist but none has a classified eligible 24h outcome.
- `PARTIAL` — at least one, but not all, prior launches has a classified eligible 24h outcome.
- `COMPLETE` — every prior launch has a classified eligible 24h outcome.

Missing or immature evidence is never coerced to a clean/negative label.

## Receipt binding

Every feature receipt binds:

- `CREATOR_OUTCOME_JOIN_V0` derivation version;
- target baseline ID, authority digest, decision block/hash, and status;
- target provenance fact digest;
- ordered prior provenance fact digests;
- eligible outcome payloads;
- source fact IDs and outcome IDs;
- deterministic input, output, and evidence digests.

Reordering identical input sets must produce byte-equivalent receipts.

## Outcome authority repair

Because this slice begins consuming outcomes as evidence authority, outcome persistence is fail-closed:

- identical replay at the same identity is `DUPLICATE`;
- a different payload at the same `outcome_id`, or a different outcome at the same `(launch_id, horizon_ms)`, throws `OUTCOME_IDENTITY_CONFLICT`.

## Usage

```bash
pnpm test
pnpm build
pnpm start:creator-outcome
```

`start:creator-outcome` is read-only with respect to chain state. It reads the local SQLite ledger and prints deterministic feature receipts as JSON. It does not synthesize missing outcomes.

## Falsification path

This slice does not claim creator history works. It only creates a point-in-time feature surface that can be evaluated over the identical launch universe required by `EXPERIMENT_V0`.

The next evaluation must compare the executable baseline against creator-history variants using the existing catastrophic-loss, unsellable-position, tail-loss, fat-tail winner-capture, and winner-capture-ratio objectives. If creator history adds no robust out-of-sample value, simplify or stop before funding provenance.
