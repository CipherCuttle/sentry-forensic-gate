# Robinhood / Pons V2 — M2C Curve Quote Authority

## Status

M2C is a **provisional stacked research slice** because parent PR #44 still lacks an independent hostile review. The parent is tested; the external GitHub code-review request was blocked by account review quota. Nothing in M2C upgrades that gate.

Scientific state remains:

`EDGE_UNPROVEN`

No wallet, signer, approval, transaction construction, BUY/SELL, bridge, live-money flag, strategy tuning, or FAST_VET change is introduced.

## Reviewed curve-template epoch

M2C separates factory authority from curve-template authority.

Reviewed launch deployer:

- address: `0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42`
- deployment block: `26,841,846`
- deployment transaction: `0x849d092ee4ed37d8138636839c28aabd2878e445cb68ba99c4cdafa11a778b2e`
- deployed runtime bytes: `20,906`
- runtime-code hash: `0xeade22566c766377f6adfb99534f2772251efad9568642c0704a7051418e624c`
- constructor-bound factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`

The verified deployer source uses `type(PonsV2BondingCurve).creationCode` in its CREATE2 curve deployment path. The factory source wires `launchDeployer` only once. Therefore the quote adapter verifies at the decision block that:

1. the reviewed factory runtime is still authoritative;
2. `factory.launchDeployer()` equals the reviewed deployer;
3. the deployer's runtime hash is exact;
4. `launchDeployer.factory()` points back to the reviewed factory.

This pins the deployed curve template without incorrectly requiring every curve's constructor-specific immutable runtime bytes to have one universal hash.

## Deployed quote semantics

Verified deployed Pons V2 curve source includes launch-window anti-snipe semantics that were absent from the initially inspected repository source.

For a buy:

- fee, creator tax, and recipient-specific snipe tax come off the quote leg before constant-product pricing;
- non-zero snipe tax is clamped so at least 1% of gross input remains;
- a buy that exceeds the remaining sellable allocation is partially filled and the unused gross input is refunded;
- evidence therefore records both the requested input and the **actual spent input**.

For an independent reverse sell:

- the same frozen pre-trade reserves are used;
- no snipe tax applies to sells;
- fee + creator tax come off gross quote output;
- if physical `trackedQuote` cannot fund the output, the reverse is recorded non-executable.

The reverse remains diagnostic only:

`INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL`

It is not paper PnL.

## Deliberate limits

### Native pair only

M2C supports only Pons V2 launches whose `pairToken == address(0)`.

ERC-20 quote assets remain unsupported because the deployed curve credits the **observed transfer delta**, so fee-on-transfer/blocklist/rebase behavior cannot be inferred safely from reserve math alone.

### Synthetic shadow recipient

Entry snipe tax is recipient-specific. M2C freezes one deterministic synthetic recipient:

`0xa2bb223b536714b33a045012d22af674232d61d9`

It is derived from `sha256("SENTRY_PONS_SHADOW_QUOTE_RECIPIENT_V1")` and is not a wallet or live execution identity.

At the decision block the adapter requires:

- no code at that address;
- the Pons curve does **not** mark it snipe-tax-exempt;
- `currentSnipeTaxBps(recipient)` is read directly from the deployed curve.

That models an ordinary non-exempt buyer without borrowing a creator/bundle exemption or requiring a private key.

## Evidence boundary

Every quote rebinds:

- M2B market authority;
- factory runtime authority;
- launch-deployer/template authority;
- canonical factory launch record;
- curve factory/token/pair identity;
- active phase;
- reserves, tracked quote, sellable allocation, fee terms, and snipe-tax terms;
- decision-block hash before and after all chain-dependent reads.

No chain-dependent read occurs after the final hash fence.

## Next

After this provisional slice passes tests and the parent independent-review gate is resolved:

1. run one external hostile review on M2C;
2. add USD calibration for native ETH at the decision block;
3. build the first complete portable Pons baseline across the frozen `$0.25/$0.50/$1/$2/$5` ladder;
4. keep V4 post-graduation quoting as a separate authority surface.
