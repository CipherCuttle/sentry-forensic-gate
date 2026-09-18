# Robinhood / Pons V2 — M2E Portable Baseline Composition

## Objective

M2E is the first end-to-end composition slice:

`M2A launch → M2B market state → M2D USD calibration → M2C entry/reverse quotes → portable baseline → frozen FAST_VET_R0 bridge`

Scientific state remains:

`EDGE_UNPROVEN`

No wallet, signer, approval, transaction construction, BUY/SELL, bridge, capital, strategy tuning, or database migration is introduced.

## Frozen strategy semantics

M2E deliberately reuses the existing prospective baseline constants:

- decision delay: **2 blocks**
- confirmations: **2 blocks**
- notionals:
  - $0.25
  - $0.50
  - $1.00
  - $2.00
  - $5.00
- baseline policy: `EXECUTABLE_BASELINE_R1`
- reverse semantics: `INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL`
- FAST_VET primary notional: **$1.00**

These are not configurable in the M2E composer. Multi-chain translation is not an excuse to tune the strategy.

## Composition law

For one normalized Pons launch:

1. require the launch to be mature through decision block + confirmations;
2. verify launch/factory authority;
3. freeze the decision-block hash;
4. resolve the M2B market;
5. for every frozen notional:
   - M2D converts nominal USDG output into required native ETH;
   - M2C quotes Pons entry using that ETH amount;
   - if entry is executable, M2C quotes an independent reverse using the token amount the entry would receive;
   - recovery bps uses **actual entry spend**, not the requested input, so Pons partial-fill refunds are handled correctly;
6. re-check launch/factory authority;
7. make the final chain-dependent read the decision-block hash;
8. content-address the complete portable baseline evidence.

## Fail-closed behavior

Only reviewed deterministic per-launch gaps become terminal `UNVERIFIED` evidence:

- Pons market not active;
- unsupported Pons pair token;
- unsupported USD-calibration base;
- deterministic calibration unavailable.

Authority drift, identity contradiction, reorgs, provider/RPC failures, malformed receipts, duplicated quote IDs, and all unclassified failures escape. They do **not** become strategy evidence and the launch remains retryable.

## FAST_VET bridge

M2E does not modify `src/evaluation/fastVet.ts`.

The byte-frozen evaluator still requires:

- complete baseline;
- executable $1 entry;
- executable $1 independent reverse;
- complete/no-history creator coverage;
- no known prior adverse creator outcomes.

The M2E regression proves:

- complete baseline + matching `NO_HISTORY` creator feature → `PASS`;
- non-executable $1 reverse → `REJECT`;
- deterministic `UNVERIFIED` baseline → `UNKNOWN`;
- missing creator feature → `UNKNOWN`.

A FAST_VET PASS remains only **shadow research eligibility**. It is not investment advice and does not grant execution/live-money authority.

## Evidence invariant

The portable authority digest excludes wall-clock observation timestamps but includes:

- launch/market identity;
- decision block/hash;
- frozen strategy constants;
- market authority;
- all calibration authority;
- entry/reverse quote outputs and source authority;
- actual-spend recovery diagnostics.

Changing economic evidence changes the digest. Merely observing the same evidence later does not.

## Next

After CI and the bounded hostile review:

1. run a prospective Pons shadow candidate through this composer;
2. add portable creator-history provenance for Pons if the real candidate has prior creator launches;
3. begin M3 Arc/par only after the Pons translation slice is closed cleanly.

No merge authority exists.
