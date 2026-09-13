# EXECUTABLE_BASELINE_R1

## Objective

Freeze a replayable, read-only executable baseline for every canonical Sentry launch at a deterministic decision point.

For V1 the decision block is:

`launch_block + BASELINE_DECISION_DELAY_BLOCKS`

Default delay: **2 blocks**.

The baseline measures five target notionals: `$0.25`, `$0.50`, `$1`, `$2`, `$5`.

## Market discovery

Do not infer the base token from launch type.

The runtime reads the Sentry-held Tsunami position NFT (`positions(tokenId)`) at the launch block, requires the launched token to be exactly one of `token0/token1`, treats the other token as the base, verifies that base against Sentry's historical supported-base list, resolves the pool through the Tsunami factory using the NFT's actual fee tier, then checks the pool's own `token0/token1/fee` identity.

## Frozen infrastructure

Current pinned addresses are taken from the maintained Ink MCP configuration:

- Tsunami V3 Factory: `0xD8B0826150B7686D1F56d6F10E31E58e1BCF1193`
- Tsunami Position Manager: `0x98b6267DA27c5A21Bd6e3edfBC2DA6b0428Fa9F7`
- Tsunami Quoter V2: `0x547D43a6F83A28720908537Aa25179ff8c6A6411`
- WETH9: `0x4200000000000000000000000000000000000006`
- USDT0: `0x0200c29006150606b650577bbe7b6248f58470c1`

At the decision block the worker fails closed unless:

- chain ID is Ink `57073`;
- the frozen Sentry ERC-1967 implementation still matches;
- Sentry's `npm()` equals the pinned Tsunami position manager;
- position-manager and quoter `factory()` both equal the pinned Tsunami factory;
- position-manager and quoter `WETH9()` both equal pinned WETH9;
- all authority contracts have bytecode.

## USD notional convention

USDT0 bases use `USDT0_NOMINAL_PEG_V0`: `$1` is represented as one USDT0 according to the token's on-chain decimals. This is a sizing convention, not a claim that USDT0 can never depeg.

WETH bases use `WETH_USDT0_EXACT_OUTPUT_V0`: for each target USD notional, the worker asks the Tsunami quoter how much WETH is required to obtain the corresponding nominal USDT0 amount at that exact decision block. It tries fee tiers `500`, `3000`, and `10000` and retains the lowest executable WETH input. The calibration quote itself is persisted.

Other base assets are `UNVERIFIED` until an explicit calibration contract is added.

## Quote semantics

Entry is an exact-input read-only quote:

`base -> launched token`

Immediate reverse diagnostics use exactly the token amount returned by the entry quote:

`entry.amountOut launched token -> base`

**Important:** the reverse quote reads the same pre-trade historical pool state. The quoter does not persist the hypothetical entry's state transition. Therefore `independentReverseRecoveryBps` is a sellability/recovery diagnostic only and MUST NOT be called sequential paper PnL or realized return.

This limitation is explicit in every batch as:

`INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL`

A later phase may add a true sequential state-transition simulator. V1 must not fake that precision.

## Reorg semantics

Baseline batches are keyed to their own decision block/hash. The block hash is checked before and after all reads. A moving decision block aborts without persistence.

Database rewind also deletes evidence according to **its own observation block**, not only when its parent launch is deleted. This fixes the case where a launch at block N survives while its baseline at block N+2 is reorged away.

## Persistence

A baseline batch and all quote rows are written in one SQLite transaction. `launch_id` is unique in `baseline_batches`; replays with the same authority digest are idempotent, while contradictory replay data throws `BASELINE_IDENTITY_CONFLICT`.

EVM quote reverts are stored as non-executable economic evidence. Structural/provider evidence gaps become terminal `UNVERIFIED` for that frozen decision point. Authority drift and reorg ambiguity halt instead of being downgraded to ordinary missing evidence.

## Safety boundary

Read-only only. No wallet, approval, swap construction, signing, private keys, broadcast, or transaction execution is introduced by this slice.
