# Robinhood / Pons V2 — M2F Real Shadow Smoke

## Objective

Run the concrete M2A–M2E stack against one real, canonical Pons V2 launch on Robinhood Chain.

This is deliberately **not** a broad scanner and **not** live trading.

## Frozen candidate

Blockscout observed this native-pair `TokenLaunched` event from the reviewed Pons V2 factory:

- launch block: `65,808,784`
- token: `0x633d3b4CCe2E3cD2e6D7588186cEEd26a634147D`
- curve: `0xb4785613F0796F0dd2964cC1C65375d2602D129E`
- deployer: `0x09EE8fD79Fb4a780a01038a88cedbca6d68B3Fe4`
- pair token: native ETH sentinel
- launch tx: `0x35d24b7caec574318bcee747de8bc6c2bce09f4c2de5134e8e8e3189a6650e1f`

M2F does **not** trust those copied fields as execution evidence. The real script asks the concrete launch adapter to rescan exactly block `65,808,784`, rematerialize the event from Robinhood RPC, verify the factory/runtime/record/metadata/block hashes, and select the expected token.

## Real path

The workflow executes:

`ViemPonsV2LaunchAdapter`
→ `ViemPonsV2MarketStateResolver`
→ `ViemRobinhoodUsdCalibrationAdapter`
→ `ViemPonsV2CurveQuoteAdapter`
→ `buildPortableBaselineBatch()`
→ `evaluatePortableFastVet()`

The decision block is not manually overridden. M2E derives it from the frozen two-block decision delay.

## Expected FAST_VET result

Creator-history translation is not yet implemented for Pons.

Therefore M2F explicitly passes `creatorFeature: null` and asserts that FAST_VET cannot become `PASS`.

If the baseline is complete, expected decision:

`UNKNOWN / CREATOR_FEATURE_MISSING`

If the market/calibration is deterministically unavailable:

`UNKNOWN / BASELINE_UNVERIFIED`

Anything else fails the smoke.

## Permanent boundaries

The workflow has:

- no wallet;
- no private key;
- no signer;
- no approvals;
- no transaction construction;
- no broadcast;
- no capital;
- no strategy tuning;
- no invented creator history.

`EDGE_UNPROVEN` remains explicit.


## Archive transport requirement

The first real smoke reached Robinhood's official public RPC and failed on the first historical `eth_getCode` at launch block `65,808,784` with:

`historical state ... is not available`

That is a provider-capability failure, not a strategy result. Robinhood's developer documentation explicitly says historical reads/indexing require an archive endpoint.

M2F therefore requires `ROBINHOOD_ARCHIVE_RPC_URL` and refuses to silently fall back to the pruned public RPC. The smoke workflow currently uses the keyless BlockReq Robinhood archive route.

The archive provider is **transport, not authority**. Every concrete adapter still verifies chain ID, pinned runtime code hashes, source records, decision-block hashes, USDG implementation authority, and market identity. Changing the RPC provider does not change frozen strategy semantics.
