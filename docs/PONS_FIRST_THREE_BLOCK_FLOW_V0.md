# PONS V2 — First three canonical blocks: source-bound trade flow (V0)

**DESIGN / READ-ONLY, no live money, signing, broadcast, trading decisions, scientific activation or merge.** Stacked on opening-allocation draft PR #78, which is stacked on speed-observer PR #77. Frozen S0 and inactive S1 are untouched.

## Objective

Separate *what we can actually observe* about a Pons launch's first three blocks from speculation about beneficial owners, future liquidity or a profitable snipe. This stage reconstructs the exact transaction's known exemption list and buys via the upstream attestor, then gathers confirmed curve `CurveBuy` / `CurveSell` and token ERC-20 `Transfer` logs in the launch block plus its **next two** canonical blocks. This is an after-the-fact evidence tool, **not** a two-block live decision engine.

Official Pons event signatures and `fee`/creator-`tax` semantics: https://docs.ponsfamily.com/v2 . CurveBuy's `fee` includes the base fee and any snipe tax; we cannot separate those from this event. A `CurveBuyRefunded` event can accompany a clamped final buy. The existing CurveBuy event reports actual spent quote, not the originally requested spend.

## Evidence gates

- Manual operator supplies the exact reviewed factory launch transaction hash and optionally exact token. Source is chain ID 4663, pinned factory **historical runtime code hash** and the attested exact launch transaction from PR #78. Unknown forwarders, multiple ambiguous launch events, missing historical state, incorrect block/receipt hash or unsupported calldata fail closed.
- Require a recent-enough head to provide **at least 12 later blocks after the end** of the three-block window. Read launch block, block+1, block+2, one canonical hash apiece; re-read each after every historical RPC query. No orphaned chain branch or skipped height may be silently counted.
- Request exactly the canonical curve's **CurveBuy / CurveSell** logs and launch token's ERC-20 **Transfer** logs, scoped to the same three-block interval, then check log-address, block hash/height, tx hash and log index. Suppress duplicate logs and require complete original launch-transaction buy reconciliation with the independently decoded opening receipt.
- Accumulate gross trade flow by distinct buyer, recipient and seller; retain the explicit buyer–recipient distinction. Flag *known declared/automatic tax-exempt recipients* only, with the exact provenance of the exemption from the opening receipt. Do not assert that any other address is independent, and do not infer who controls multiple wallets.
- Calculate gross `tokensOut`, `tokensIn`, quote flow and fees using exact BigInts. Compare the gross purchase quantity to **launch-block** `totalSupply()` solely as **gross turnover**. A token bought, sold and bought again can produce gross turnover **greater than 100% of supply**; this is not a holder balance or evidence of minting.
- ERC-20 Transfer covers mint, burn and transfers, many of which correspond to the **same** curve trades. Transfer and trade totals must not be added. There is **no** final balance, realized profit, actionable insider estimate or preemptive transaction claim.
- We only request the two documented curve trade events and ERC-20 Transfer logs. Missing other events (e.g., refunded buys, graduation, other contracts' swaps) must not be interpreted as their absence. An untrusted or incomplete RPC may omit later trades without an internal checksum; before scientific enrollment, qualify complete block receipts or independently reconcile two providers.
- A token paired with a non-native ERC-20 can prove event decoding, but is **not** an eligible native-ETH strategy observation. Output states pairing explicitly.

## Manual exact-source command

```sh
corepack enable
pnpm install --no-frozen-lockfile --lockfile=false
pnpm build
# Example exact published direct-launch transaction already independently attested upstream:
PONS_FIRST_FLOW_TX_HASH=0xbd52317c84d90ba8912646563117fba9617056ce27cb5105b918c68367161a86 \
PONS_FIRST_FLOW_TOKEN=0x80a7e83f329be7f7ac65cef5992d0794d34491a6 \
node scripts/pons-first-three-block-flow-scout-v0.mjs

# If official public RPC has pruned the exact launch block, inject a secure
# historical HTTPS RPC endpoint locally. Never commit credential-bearing URLs.
PONS_FIRST_FLOW_RPC_URL=https://YOUR_PRIVATE_ARCHIVE_RPC \
PONS_FIRST_FLOW_TX_HASH=0x... \
node scripts/pons-first-three-block-flow-scout-v0.mjs
```

## Acceptance

1. Exact-head offline test: opening receipt reconciliation (including positive atomic fixture), valid buyer–recipient distinction, sell event, mint/transfer treatment, **>100% gross turnover**, duplicate log, block gap, altered canonical hash, false opening receipt, invalid supply, and static no-write boundary all pass.
2. A dedicated zero-secret CI job builds the upstream shared adapters and runs syntax plus offline fixtures. Optional bounded public historical same-transaction smoke on branch pushes may return `UNVERIFIED` due to RPC limits; optional smoke success is not assumed from offline tests.
3. ONE hostile self-review, fix Critical/High and ONE targeted rereview if necessary. No production collector or transaction permissions.
4. Next conditional stage after qualified real first-three-block samples: independently reconcile early buyer–recipient activity and executable **sequential** sell economics. A separate S1 entry-timing preregistration must be frozen before viewing new outcome labels.

**No merge authority. No production collection activation. EDGE UNPROVEN.**
