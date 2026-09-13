# EXECUTABLE_INFRA_AUTHORITY_R3

Status: **AUTHORIZED FOR RESEARCH RUNTIME / SHADOW EXECUTABLE RECONSTRUCTION ONLY**

This manifest authorizes the current executable-infrastructure tuple only after the final observed Sentry `NPMUpdated` transition.

## Frozen boundary

- Sentry NPM activation block: `52269352`
- Conservative executable start: `52269353`
- Activation transaction: `0xc24618fc2b3c15ddc49272fea90589564ea17052ab459886be4bfcf305ad8755`
- Same-block policy: exclude the NPM update block.

## Authorized tuple

- NPM: `0xC0836E5B058BBE22ae2266e1AC488A1A0fD8DCE8`
- Factory: `0x640887A9ba3A9C53Ed27D0F7e8246A4F933f3424`
- QuoterV2: `0x96b572D2d880cf2Fa2563651BD23ADE6f5516652`
- WETH: `0x4200000000000000000000000000000000000006`

## Evidence

PR #12 `EXECUTABLE_INFRA_DISCOVERY_R2` scanned the already-authorized Sentry implementation epoch and produced a PASS receipt with one `NPMUpdated` event at block `52269352`. The transaction was independently checked on Ink Blockscout and showed the same old/new NPM pair.

## Runtime rule

The combined research runtime must refuse `SENTRY_START_BLOCK < 52269353`. Existing ledgers containing launches or checkpoints before this boundary must not be reused by the combined executable runtime.

The truth collector retains its separate Sentry implementation authority. This executable authority does not retroactively authorize intermediate infrastructure and does not authorize private keys, signing, approvals, swaps, transaction broadcast, or live trading.
