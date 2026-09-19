# PONS_E1_V4_EXIT_RECOVERY_V1

## Closure

**Status: CLOSED / PASS (DRY-ONLY)**

The E1 recovery plan was verified against a real current Robinhood Pons
phase-2/native launch without using a private key, signer, or broadcast path.

Live read-only evidence:

- token: `0x8ECD7b553E36248164616c271B4B3C171bC8226b`;
- phase: 2;
- pool id:
  `0x07ec2169905bb540d5cb43c03160269628d8791ba6746108333a20609204ddf4`;
- read-only EOA balance context:
  `3975359897761331367429707` raw token units;
- full-balance V4 quote:
  `4044979660458957` wei native ETH;
- 5% minimum-output fence:
  `3842730677436009` wei;
- existing ERC20→Permit2 allowance: zero;
- existing Permit2→router allowance: zero.

The EOA was public chain state used only for read-only balance and simulation
context. No key, signature, authorization, or transaction from that address was
requested or used.

Hostile review found one High: the initial verifier did not bind the factory's
external launch-deployer/template dependency graph. The repair pins the
launch-deployer runtime and verifies:

- factory ↔ launchDeployer ↔ factory;
- factory ↔ meme hook;
- factory/hook/router/quoter ↔ the same reviewed PoolManager.

The one targeted rereview passed with no remaining Critical/High findings.

Canonical closure receipt:

`docs/evidence/PONS_E1_V4_EXIT_RECOVERY_DRY_CLOSURE_2026-09-19.json`

E1 grants no live-money, signing, broadcast, recurring, autonomous, or merge
authority.

The next stage may add a bounded signed V4 recovery executor only with fresh
explicit owner authority and crash-safe approval/transaction reconciliation.

## Objective

Build the smallest fail-closed recovery path for a Pons V2 token that can no
longer exit through the bonding curve because it has graduated into its
registered Uniswap V4 pool.

Frozen path:

`phase-2 Pons launch → prove exact V4 pool → quote full owner balance → exact ERC20→Permit2 approval → exact Permit2→router allowance → one V4 exact-input token→native exit plan`

E1 is **read-only / dry-run only**. It has no signer and no broadcast path.

## Authority

Pinned Robinhood Chain execution surface:

- chain ID: 4663
- Pons V2 factory: reviewed current factory authority
- Pons V2 meme hook: reviewed current hook authority
- Uniswap V4 PoolManager / StateView / Quoter: reviewed current USD/V4 authority
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`, runtime hash pinned
- Universal Router: **v2.1.1 only**
  `0x8876789976dEcBfCbBbe364623C63652db8C0904`, runtime hash pinned

The later Robinhood Universal Router generations are intentionally not selected
by "latest" semantics. Changing router generation requires a new reviewed
authority epoch.

## Recovery eligibility

The verifier requires all of the following at one pinned block:

- reviewed factory/runtime identities still match;
- launch record exists for the exact token;
- launch pair is native ETH;
- launch phase is exactly 2;
- curve reports graduated;
- swept transitional fields are cleared;
- reconstructed V4 pool key is
  `native ETH / token / launch poolFee / launch tickSpacing / Pons meme hook`;
- derived PoolId is initialized in StateView;
- V4 liquidity is non-zero;
- active LP fee matches the frozen launch record;
- Pons hook has the PoolId registered;
- hook registration identifies the same memecoin and native quote currency;
- owner token balance is positive and fits uint128;
- full-balance exact-input V4 quote is executable and positive;
- exact ERC20 approval call and exact Permit2 allowance call both simulate from
  the owner.

A block hash is re-read before returning READY so a reorg invalidates the
verification.

## Transaction plan

The dry plan contains exactly three calls:

1. token `approve(Permit2, fullBalance)`;
2. Permit2 `approve(token, UniversalRouter, fullBalance, expiration)`;
3. Universal Router v2.1.1 `execute(...)`.

The V4 command is exactly `V4_SWAP (0x10)`.

Its V4 action sequence is exactly:

`SWAP_EXACT_IN_SINGLE (0x06) → SETTLE_ALL (0x0c) → TAKE_ALL (0x0f)`

For native Pons pools:

- `zeroForOne = false` (token/currency1 → native/currency0);
- `amountIn = full owner token balance`;
- `amountOutMinimum = quotedNativeOut × (1 - slippage)`;
- `minHopPriceX36 = 0`;
- `hookData = 0x`;
- `SETTLE_ALL(token, fullBalance)` caps token debt at the exact full balance;
- `TAKE_ALL(native, amountOutMinimum)` independently enforces the minimum
  native output.

Maximum configured slippage is 10%; default is 5%.

## Deliberate exclusions

E1 does not:

- accept a private key;
- construct a wallet client;
- sign transactions;
- broadcast transactions;
- support arbitrary V4 pools;
- support ERC20 quote-pair Pons launches;
- select a Universal Router by "latest";
- permit partial-balance recovery;
- use unlimited ERC20 or Permit2 approvals;
- authorize recurring/autonomous operation.

## Next gate

Only after E1 dry verification, one hostile review, and explicit owner authority
may a later stage add a bounded signed recovery executor.

No merge authority and no live-money authority are implied by this stage.
