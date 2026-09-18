# Robinhood / Pons V2 — M2D USD Calibration

## Objective

Convert the frozen USD notional ladder into native ETH at the same Robinhood decision block using executable on-chain evidence.

Scientific state remains:

`EDGE_UNPROVEN`

M2D is calibration-only, read-only, and shadow-only.

## Why not a floating price oracle?

Robinhood documents Chainlink Data Streams as pull-based signed reports. That is useful for real-time applications but does not by itself give this research pipeline a simple, historically replayable on-chain ETH/USD round at every frozen decision block.

M2D therefore mirrors the existing Ink baseline pattern:

**stablecoin nominal USD convention + executable exact-output DEX quote.**

Robinhood's official ecosystem documentation identifies Paxos USDG as its stablecoin integration.

## Calibration market

The reviewed Uniswap V4 pool key is:

- currency0: native ETH sentinel `0x0000000000000000000000000000000000000000`
- currency1: USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- fee: `500` (0.05%)
- tick spacing: `10`
- hooks: zero address

Its derived PoolId is:

`0x387bf619da4d3fb62bb276482693dba1b9b3520f573cabdfe033384a24125982`

Independent chain indexing records that pool as initialized at block `169,464`; M2D refuses earlier blocks.

## Pinned runtime authority

At every calibration block M2D verifies exact runtime hashes for:

- PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`
  - `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626`
- StateView `0xF3334192D15450CdD385c8B70e03f9A6bD9E673b`
  - `0x7d9c591e0956fd89d98feb4ffcfe8bf1f7a62bd485edd979fa21d104b49878a6`
- V4Quoter `0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94`
  - `0xd707b1da8cb165e5ea35a3b4450d971eb562ec171e23492aa117036b78a868f6`
- USDG proxy `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
  - `0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6`
- USDG implementation `0x68184C449E1a8f34fa18d289737129FD27B66f8F`
  - `0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf`

The USDG EIP-1967 implementation slot is checked at the historical decision block. A future proxy upgrade therefore does not silently rewrite earlier authority.

Uniswap's current SDK source independently publishes the same Robinhood PoolManager, StateView, and V4Quoter addresses.

## USD convention

USDG is required at the decision block to report:

- name `Global Dollar`
- symbol `USDG`
- decimals `6`

The calibration convention is:

`USDG_NOMINAL_USD_PEG_V0`

Thus the raw exact USDG output is numerically equal to USD micros:

- $0.25 → 250,000 raw USDG
- $0.50 → 500,000
- $1.00 → 1,000,000
- $2.00 → 2,000,000
- $5.00 → 5,000,000

M2D asks the reviewed V4Quoter for the exact native ETH input required to receive that USDG output at the frozen decision block.

This is executable market calibration, not a claim that USDG can never deviate from one dollar. The nominal-peg assumption is explicit in the evidence.

## Fail-closed rules

Calibration throws on:

- wrong chain;
- block before the reviewed pool epoch;
- any runtime-code drift;
- USDG proxy implementation drift;
- USDG identity/decimal drift;
- quoter → PoolManager drift;
- missing/uninitialized pool;
- zero liquidity;
- pool-fee mismatch;
- quote revert/zero input;
- non-native Pons base asset;
- decision-block hash movement;
- pool state movement across the quote read.

No provider/transport error is converted into economic evidence.

## Next

Once M2C and M2D have clean verification, the next bounded slice is the first complete portable Pons baseline:

`M2B market state + M2D USD calibration + M2C entry/reverse quotes → $0.25/$0.50/$1/$2/$5 → portable baseline → frozen FAST_VET bridge`

No strategy tuning is allowed during that composition.
