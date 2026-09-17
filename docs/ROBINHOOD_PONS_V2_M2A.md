# Robinhood / Pons V2 — M2A Launch Ingestion

## Objective

Add the first Robinhood/Pons implementation behind the M1 multi-chain research boundary without granting any Robinhood live-money authority.

M2A deliberately implements **prospective launch ingestion only**. Market resolution, USD calibration, executable baseline quoting, forward outcomes, and the complete M2 shadow worker remain later slices.

Scientific state remains:

`EDGE_UNPROVEN`

## Robinhood Chain authority

Current Robinhood Chain documentation identifies mainnet as:

- chain ID `4663`;
- native gas asset `ETH`;
- public RPC `https://rpc.mainnet.chain.robinhood.com`;
- explorer `https://robinhoodchain.blockscout.com`.

The adapter may use another RPC through dependency injection, but it always verifies chain ID `4663`.

## Pons V2 source semantics

Pons V2 is not modeled as an Ink/Tsunami V3 pool.

The current Pons V2 source defines `TokenLaunched` with:

- token;
- bonding curve;
- deployer;
- pair token;
- launch config ID;
- graduation threshold.

The launch record is queryable through `getLaunchedToken(token)`.

Pons V2 launches begin on a constant-product bonding curve. Graduation later moves reserves into a Uniswap V4 pool. The pair asset may be native ETH or an approved ERC-20. Later M2 quoting must therefore resolve the launch phase at the decision block instead of assuming a single pool venue.

## Canonical Pons V2 factory authority

The reviewed current factory epoch is pinned to:

- factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`;
- deployment block `26,841,846`;
- deployment transaction `0x3817f297aa7c2ef78789bffac57491ceedc218fef962d47ed36c272699deddeb`;
- deployed runtime bytecode length `24,177` bytes;
- runtime-code hash `0x89a27da6f703e0a7cdd4f233e7cb57604ff75b164530962d3ff7cf8483a67d84`;
- authority ID `ROBINHOOD_PONS_V2_FACTORY_2026_08_03_R1`.

Current Pons source/docs, Bitquery's Pons V2 reference, and Blockscout's verified deployment metadata converge on this factory. Blockscout identifies the exact creation transaction and reports unchanged deployed bytecode.

`CURRENT_PONS_V2_AUTHORITY` is the reviewed production-shadow read authority. Every authority check still verifies the chain ID, epoch boundary, factory bytecode presence, and exact runtime-code hash at the requested block. No floating or automatically discovered "latest" factory is accepted.

## Launch normalization

For every `TokenLaunched` log the adapter:

1. verifies the authority at the log block;
2. re-reads the canonical block hash;
3. reads `getLaunchedToken(token)` at that block;
4. cross-checks stable token/curve/deployer/pair-token/graduation-threshold fields;
5. requires token and curve bytecode;
6. reads token name and symbol;
7. derives deterministic launch/event IDs;
8. emits a `NormalizedLaunchCandidate` with the original Pons evidence retained in `sourceAuthority`.

The launch-record read occurs at block-end state. Mutable record fields such as graduation phase, swept amounts, creator-fee recipient, or buyback state are therefore **not** promoted into launch-event authority.

## Safety boundary

M2A adds no:

- wallet;
- signer;
- approval;
- transaction construction;
- broadcast;
- BUY/SELL;
- bridge;
- Robinhood live-money environment flag;
- strategy tuning;
- sentiment/LLM signal.

The existing Ink `$1` canary is untouched.

## Next M2 slices

With the factory epoch now pinned:

1. activate prospective Pons launch observation from a reviewed start block;
2. implement decision-block market resolution with explicit `CURVE` / `SWEPT` / `V4_POOL` / terminal handling;
3. implement USD calibration per actual pair asset;
4. implement the frozen `$0.25 / $0.50 / $1 / $2 / $5` baseline;
5. feed the unchanged byte-frozen `FAST_VET_R0` through the M1 compatibility bridge;
6. collect prospective forward outcomes.

No live-money path is part of M2.
