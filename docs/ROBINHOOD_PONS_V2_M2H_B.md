# M2H-B Portable Forward Outcomes + Shadow Policy Receipts

## Objective

Make the next Robinhood/Pons research step independent of provider selection.

M2H-A proved that current keyless Robinhood transports cannot serve the frozen
historical state required by the matured creator-history candidate. M2H-B does
not weaken that evidence contract. Instead it implements the portable
reconstruction and decision-receipt logic underneath the transport boundary.

This slice remains:

- `SHADOW_ONLY`
- no wallet
- no signing
- no transaction construction or broadcast
- no Robinhood live authority
- no Arc live authority
- existing Ink exact-$1 authority unchanged
- `EDGE_UNPROVEN`

## Portable forward outcome

`buildPortableForwardOutcome()` consumes:

1. a normalized launch;
2. its frozen portable baseline;
3. a `ForwardOutcomeAdapter`;
4. a horizon;
5. a confirmed chain point.

It then:

- rebinds launch and decision block hashes;
- finds the first canonical block at or after the target timestamp;
- proves the predecessor is before the horizon;
- reads liquidity and exit evidence at the same observed block;
- values a successful exit in USD;
- rechecks all boundary hashes after evidence collection;
- produces a content-addressed portable outcome.

The classification thresholds are the existing frozen
`FORWARD_OUTCOMES_R1` thresholds. No new outcome thresholds are introduced.

## Venue migration rule

Pons can graduate from its bonding curve to Uniswap V4.

M2H-B therefore **must not** label an unsupported successor venue as an exit
failure.

If the adapter reports:

- liquidity `COLLAPSED` + no exit -> `LIQUIDITY_COLLAPSE`;
- liquidity `SURVIVED` + no exit -> `EXIT_FAILURE`;
- liquidity `UNKNOWN` + no exit -> `UNVERIFIED`.

That last case is the deliberate migration boundary. Until a reviewed V4
forward-outcome adapter exists, inability to quote the successor venue is an
evidence gap, not proof of loss.

## Shadow policy decision receipts

`buildShadowPolicyComparisonReceipt()` emits three deterministic,
content-addressed receipts from the same baseline/creator evidence:

- `FAST_VET_R0`;
- `FAST_VET_R1_CAPACITY_GATE`;
- `BUY_EVERY_EXECUTABLE_CONTROL_R1`.

Each receipt binds:

- launch ID;
- baseline ID and decision block when present;
- policy digest;
- input digest;
- output digest;
- evidence digest;
- exact decision/action/reasons;
- R1/control capacity where applicable;
- `SHADOW_ONLY`;
- `liveMoneyAuthority: false`;
- `EDGE_UNPROVEN`.

The receipt contract is portable and does not reuse the old Ink/Sentry-specific
SQLite `launches` / `decisions` schema.

## Why no new multi-chain SQL table yet

The existing repository store is structurally Ink/Sentry-specific. Forcing
Robinhood/Pons receipts into it would reintroduce the coupling removed by M1.

This slice freezes the portable receipt contract first. A later persistence
slice may add an append-only multi-chain receipt store after the receipt shape
survives real Pons evidence.

## Remaining empirical blocker

The existing matured Pons prior still requires a credentialed Robinhood archive
transport before its real 24h outcome can be reconstructed.

Once one endpoint passes M2H-A, the next execution step is:

```text
archive state
  -> Pons ForwardOutcomeAdapter
  -> portable 24h outcome
  -> creator feature completion
  -> R0 / R1 / control content-addressed receipts
  -> prospective comparison
```

No strategy promotion follows from one reconstructed candidate.
