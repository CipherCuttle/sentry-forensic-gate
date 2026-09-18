# PONS_E0_LIVE_CANARY_R0

## Objective

Prove the Robinhood/Pons write path with the smallest bounded real-money experiment:

`one explicit recent token → one $1 curve buy → exact sell approval → immediate full curve exit → stop`

This is an execution canary, not strategy promotion and not an autonomous sniper.

## Frozen E0 boundaries

- Robinhood Chain only, chain ID 4663.
- Reviewed Pons V2 factory only.
- Native-ETH Pons launches only.
- Explicit token address supplied by the operator.
- Launch must be discoverable in the preceding 30,000 blocks.
- Curve must still be active before every signed action.
- Nominal entry is exactly **$1.00** using the reviewed ETH/USDG calibration.
- Actual wallet `currentSnipeTaxBps(wallet)` must be exactly zero.
- Shadow quote tax must also be zero.
- Partial-fill entry quotes are forbidden.
- Quoted entry may consume at most **1%** of remaining sellable curve inventory.
- Slippage ceiling is **10%**; default is 5%.
- Wallet must begin with zero balance of the target token.
- Sell approval is exact, never unlimited.
- Entire acquired token balance is sold.
- Token balance and curve allowance must both be zero after a successful roundtrip.
- One state file can complete only one roundtrip.
- There is no automatic retry after an ambiguous broadcast or process restart.

## Graduation boundary

E0 is deliberately curve-only.

If the token graduates or becomes ready to graduate before the exit is signed, E0 fails closed and leaves its last persisted transaction state for manual reconciliation. It does not guess UniversalRouter/Permit2 recovery calldata.

A reviewed V4 live-exit recovery path is required before increasing size or authorizing repeated autonomous entries.

## State and crash behavior

The local state file is written before and after every broadcast-sensitive transition.

Any pre-existing nonterminal state blocks a new run. The operator must reconcile the recorded transaction hash and wallet state rather than re-send.

## Running safely

Never put a private key in Git, GitHub Actions, chat, or a committed env file.

Dry run requires only the wallet address:

```bash
PONS_E0_CANARY_ENABLED=true \
PONS_E0_WALLET=0x... \
PONS_E0_TOKEN=0x... \
pnpm start:pons-e0
```

A live run additionally requires explicit local live mode and a locally supplied private key:

```bash
PONS_E0_CANARY_ENABLED=true \
PONS_E0_LIVE=true \
PONS_E0_TOKEN=0x... \
PONS_E0_PRIVATE_KEY=0x... \
pnpm start:pons-e0
```

The readiness workflow never receives a key and asserts that live mode is disabled.

## Authority

This branch implements the capability but does not itself authorize a broadcast.

No merge authority is implied. No Robinhood recurring-live authority is implied. E0 is bounded to one operator-authorized roundtrip.
