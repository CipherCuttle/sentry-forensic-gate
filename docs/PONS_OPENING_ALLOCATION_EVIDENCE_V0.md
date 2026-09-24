# Pons V2 opening-allocation evidence V0

**Status: isolated manual read-only scout. Not a risk score, not a sniper, not a strategy promotion, not autonomous prospectively collected data.**

## Why this exists

In the opening five seconds, a public trader may face a steep sniper tax while the launcher, creator-fee recipient, additional specified addresses and the recipient of an atomic launch-and-buy can be exempt. At launch these privileged wallets may acquire a substantial allocation without a contemporaneous public trading opportunity. A fast buyer should observe these receipts before treating early upward price changes or the first buys as independent demand.

This is a narrowly scoped evidence source, not a heuristic classification of a person or a guarantee a token is safe. It is developed **independently of PR #77's pending HTTP/WS latency results** and cannot alter immutable S0 observations or the planned S1 sample.

## Source-qualified receipt

The operator supplies the **exact launch transaction hash**. The tool then, with no signer or writable wallet:

1. Retrieves transaction, receipt and launch block via read-only Robinhood Chain RPC (4663). Pins the reviewed factory's **launch-block runtime code hash** to the existing authority epoch, aborting on missing or pruned history.
2. Decodes **exactly one** factory `TokenLaunched` event in that receipt. If a transaction contains more than one launch, requires an explicit token address to resolve the ambiguity. Rechecks its event/receipt/transaction/block identity and reads the immutable factory launch record on the launch block.
3. Reads `launchForwarder()` from that historical factory state and only accepts a direct `launchToken(TokenParams,...)` call to the reviewed factory or `launchAndBuy(...)` to that exact forwarder. Unknown, upgraded, proxy or differently shaped routes are **UNSUPPORTED**, not assigned zero creator holdings.
4. Decodes the initiating launcher, fee recipient, explicit launch-time snipe-tax exemptions (up to 32), and the additional atomic launch-and-buy recipient. Verifies fee recipient, pairing token and launch configuration against the factory event and record.
5. Counts verified `CurveBuy` events emitted by the canonical curve **in the same launch transaction**, at the same recorded block hash. Measures the bought tokens as a share of the launch-block `totalSupply()`, aggregating exact token recipients.
6. Re-reads the canonical block hash after historical reads and fails closed on reorganization or unsupported provider history. Prints a single structured local JSON receipt and no RPC endpoint, key or raw provider exception.

**Important exclusions:** This does NOT count all insider wallets, later-block buys, hidden common ownership or off-chain agreements. An empty same-transaction buy list is only evidence that none was observed **in this exact transaction**. It is not a low rug-risk signal. The router recipient's automatic exemption is only accepted on the verified forwarder path. Exemptions in the factory's private mapping cannot be generically enumerated; this is a declared-calldata plus automatic-protocol view for the supported launch paths.

Source API and ABI signatures: [Pons v2 first-party docs](https://docs.ponsfamily.com/v2). This is not the older Pons v1 pool protocol. Shared reviewed source: `src/adapters/robinhood/ponsV2/authority.ts`, `contracts.ts`.

## Operator invocation

```sh
pnpm install --no-frozen-lockfile --lockfile=false
pnpm build
PONS_OPENING_TX_HASH=0xYOUR_EXACT_LAUNCH_TRANSACTION_HASH \
  node scripts/pons-opening-allocation-scout-v0.mjs
# Optional if the same transaction emitted more than one TokenLaunched event:
PONS_OPENING_TX_HASH=0x... PONS_OPENING_TOKEN=0x... \
  node scripts/pons-opening-allocation-scout-v0.mjs
# Historic/pruned provider: inject your private HTTPS archive RPC locally:
PONS_OPENING_RPC_URL=https://YOUR_PRIVATE_ARCHIVE_RPC \
  PONS_OPENING_TX_HASH=0x... node scripts/pons-opening-allocation-scout-v0.mjs
```

No private key or live transaction authority is required. Do not paste credentialed URLs into Git, Actions workflows, PR comments or issue descriptions.

## Acceptance and limitations

- Pure offline tests cover direct launch with/without explicit exemption array, verified atomic forwarder buy, receiver exemption, launch block/receipt/record bindings, mismatched route and malformed calldata, wrong factory curve, reverted transaction, 33-address overlimit and allocation exceeding supply.
- A read-only CI workflow builds shared reviewed adapters, syntax-checks all scripts and runs deterministic offline tests. It contains no live chain calls, secret references or event collector.
- A separate *manual exact recent transaction* and proof-sufficiency review is required before calling a real launch decoded. No unsupported historical RPC is replaced with `latest` data.
- The next stage may join this single-transaction evidence with a separately authenticated first-N-block transfer and buyer census; no proxy signal for real beneficial ownership should be invented.
- After source qualification, any move into a trading decision requires a separately preregistered observational rule and new outcome-unseen data.

**LIVE MONEY NONE · SIGNING NONE · BROADCAST NONE · MERGE NONE · PROSPECTIVE ACTIVATION NONE · EDGE UNPROVEN.**
