# PONS S1 C0 candidate — bounded hostile self-review

Scope: draft read-only source observer, JSON proof replay and binder.
This is a **self-review**, not an independent scientific/security audit.

| Finding | Severity | Action |
|---|---|---|
| H1. Pre-quote observed head can make the simulated entry predate slow C0 completion. | High | Fixed: new dual-provider completion head read AFTER baseline and control, frozen completion clock, requires launch+5m budget. |
| H2. Selected-event-only source logs permit omissions of other factory events and denominator abuse. | High | Fixed locally: full dual-provider launch-block transcripts, singleton matching event, full native-event replay/binding against whole scanned window. External attestations still required. |
| H3. Complete baseline control action/capacity is caller-supplied and could disagree with frozen quote ladder. | High | Fixed: check exact five notional ladder, minimum bidirectional execution, control eligibility and largest contiguous executable capacity; typed UNVERIFIED must remain NO_DECISION. |
| H4. Hostname-different archive RPC may be correlated/forged; local timestamps and `sourceCapturedBeforeOutcome` are caller-supplied. | **Open activation-blocking** | Independent provider review + immutable independent source-capture workflow and external pre-outcome timestamp, absent. Local JSON replay is not proof of actual pre-outcome acquisition. |
| H5. Quote evidence comes from archive adapter, not independently compared to official quote; metadata/quote RPC failures can prevent UNKNOWN receipts and leave denominator holes. | **Open activation-blocking** | Documented stop. Repeated read-only historical/timing rehearsal and typed failure recorder need separate review before activation. |
| H6. Current batch V1 does not bind complete source sidecar. The current external witness only checks V1 release+source batch bytes. | **Open activation-blocking** | Versioned V2 sidecar commitment, independent cross-run binding and witness required; no silent V1 schema promotion. |
| H7. 12 finality blocks plus launch+2 baseline and post-C0 inclusion+2 may miss the earliest five-minute outcome. | **Open scientific blocker** | Timestamped feasibility rehearsal with genuine independent provider and immutable pre-outcome seal; do not relax gates retrospectively. |
| H8. C0 observation binder currently requires all native events in the requested scan even beyond partial selected limit. | **Open engineering blocker** | Production full-range/partial-cursor coverage plan must be specified before collection. Current fail-closed behavior is deliberate. |

No live RPC was used to make a prospective S1 observation in this PR.
No real source sample, audited timestamps or economic edge established.
Close this engineering changeset on its exact-head CI only; **do not**
reinterpret passing synthetic tests as scientific activation authority.
