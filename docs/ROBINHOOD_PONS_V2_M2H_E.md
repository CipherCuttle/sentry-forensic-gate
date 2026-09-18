# Robinhood / Pons V2 — M2H-E Real 24h Policy Comparison

## Objective

Use the first archive transport that passed the frozen M2H-A capability gate to
reconstruct a real matured Pons creator-history outcome and feed that evidence
into the already-preregistered R0 / R1 / buy-every-executable comparison.

This is an empirical shadow experiment, not a live-trading authorization.

## Archive transport

Corrected M2H-D run `35387747266` proved that:

`https://rpc.nodeflare.app/robinhood/public`

can serve the frozen historical Pons state contract at decision block
`64,935,684`:

- chain ID 4663;
- historical block header;
- historical Pons factory bytecode;
- historical target curve bytecode;
- successful historical `getReserves()` call.

The endpoint remains transport only. Runtime hashes, factory identity, curve
template authority, V4 authority, USDG identity and block hashes remain the
research authority.

## No future-information rule

The prior creator launch is reconstructed at block `64,935,682`.

Its 24h outcome is allowed to search only up to the frozen HMN decision block:

`65,808,786`.

This guarantees the creator feature presented to HMN's policy comparison
contains no state later than HMN's own decision time.

## Execution

The runner:

1. reloads the checked-in immutable HMN M2F baseline receipt;
2. rematerializes the prior same-creator Pons launch from canonical chain state;
3. rebuilds its frozen five-rung decision baseline at block `64,935,684`;
4. reconstructs the first canonical block at or after the 24h horizon;
5. executes the observed Pons curve/V4 exit reconstruction;
6. values executable ETH through the observed-block ETH/USDG authority;
7. rescans HMN creator provenance through the full reviewed Pons factory epoch;
8. joins the prior 24h outcome through `CREATOR_OUTCOME_JOIN_V0`;
9. emits content-addressed R0 / R1 / buy-every-executable receipts from the
   immutable HMN baseline.

If the prior outcome is unverified, creator coverage remains incomplete. No
missing evidence is converted into a loss.

## Boundaries

- SHADOW_ONLY;
- EDGE_UNPROVEN;
- no wallet;
- no signer;
- no approval;
- no transaction construction;
- no broadcast;
- no capital;
- no change to FAST_VET_R0;
- no Robinhood live authority;
- no Arc live authority;
- existing Ink exact-$1 authority unchanged.
