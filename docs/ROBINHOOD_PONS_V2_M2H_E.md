# Robinhood / Pons V2 — M2H-E Real Prior Outcome

## Objective

Use the now-proven keyless NodeFlare Robinhood archive transport to resolve the
single matured creator prior that blocks HMN creator-history classification.

This is a one-shot shadow evidence run, not a scanner and not a trading runtime.

## Frozen inputs

HMN target authority remains the immutable M2F receipt:

`evidence/robinhood/pons/m2f-hmn-fast-vet-baseline.json`

The one known prior creator launch is frozen at:

- launch block `64,935,682`;
- expected curve `0x918cc3734621d966995d2663dcf587ce0d4768fc`;
- horizon `86,400,000 ms` (+24h).

M2H-E does not tune any threshold after seeing the outcome.

## Execution

The workflow uses the public NodeFlare Robinhood endpoint that passed the frozen
M2H-A gate on run `35387747266`.

The run:

1. rescans exactly the prior launch block through the reviewed Pons factory;
2. requires exactly one launch by the HMN creator with the frozen prior curve;
3. reconstructs the prior's own +2-block five-rung baseline;
4. reconstructs the first canonical block at or after +24h;
5. resolves the observed Pons venue (curve / transition / V4 / rescue);
6. quotes the frozen $1 entry token amount back to ETH;
7. values executable ETH through observed-block ETH/USDG;
8. projects the portable result into the frozen creator-outcome join;
9. recomputes HMN creator history;
10. emits content-addressed R0/R1/buy-every-executable comparison receipts.

## Portable outcome compatibility

Portable outcome receipts keep policy identity
`PORTABLE_FORWARD_OUTCOMES_R1`.

The frozen creator join recognizes both the original `FORWARD_OUTCOMES_R1`
and the portable policy family as eligible 24h evidence. It does not relabel a
portable receipt as the old Ink policy.

Conflicting duplicate 24h receipts remain fail-closed.

## Authority boundaries

- `SHADOW_ONLY`;
- no wallet;
- no signer;
- no approval;
- no transaction construction;
- no broadcast;
- no live money;
- Robinhood live authority: none;
- Arc live authority: none;
- existing Ink exact-$1 authority unchanged;
- `FAST_VET_R0` unchanged;
- `EDGE_UNPROVEN`.

## Record/replay acquisition boundary

M2H-E does not allow research JavaScript to call NodeFlare directly.

The workflow now uses a two-pass boundary:

1. a workflow-only localhost acquisition proxy forwards exact JSON-RPC requests
   with `curl`, records each raw upstream response, and caches by
   `sha256(method + canonical params)`;
2. the acquisition driver is explicitly non-authoritative and exists only to
   enumerate the deterministic request set required by the reviewed adapters;
3. upstream access is stopped;
4. a replay-only localhost server serves only the immutable recorded response
   set and fails closed on any cache miss;
5. the same evaluator runs twice against replay; byte-identical outputs are
   required;
6. the RPC cache digest must remain unchanged across replay.

Only the replay result is accepted as M2H-E research evidence.

This restores the repository's acquisition/evaluation boundary while avoiding
the previous one-request-per-second repeated-read path that exhausted the
35-minute workflow timeout.
