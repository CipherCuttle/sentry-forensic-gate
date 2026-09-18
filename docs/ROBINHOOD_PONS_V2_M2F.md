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
