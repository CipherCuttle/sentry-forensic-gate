# Robinhood / Pons V2 — M2I X17Z Real Policy Outcome

## Objective

Produce the first real, content-addressable policy/outcome comparison for the
aggressive-capacity experiment without changing live authority or tuning policy
after seeing the result.

The frozen launch is the prior launch from the same creator used by M2H-A:

- launch block: `64,935,682`;
- creator: `0x09EE8fD79Fb4a780a01038a88cedbca6d68B3Fe4`;
- bonding curve: `0x918cc3734621d966995d2663dcf587ce0d4768fc`;
- horizon: 24 hours.

The exact `TokenLaunched` event is acquired from Robinhood Blockscout at that
single block and creator. The event is decoded locally. The launch token, tx,
log index and launch config are not copied from a third-party market label.

## Authority flow

1. Blockscout supplies the exact indexed factory event only.
2. NodeFlare public RPC supplies canonical historical block/state transport.
3. `ViemPonsV2LaunchAdapter` rematerializes and verifies the launch record,
   metadata, bytecode and block hash from the reviewed Pons authority.
4. The frozen M2E portable baseline is rebuilt at launch+2 blocks across the
   exact `$0.25/$0.50/$1/$2/$5` ladder.
5. R0, R1 capacity gate and buy-every-executable control decisions are emitted
   **before** the 24h outcome call.
6. M2H-C finds the first canonical block at/after launch+24h, reconstructs the
   observed Pons venue, quotes the executable `$1` exit, and values native ETH
   into USDG at the same historical block.

## Preregistered comparison

With creator evidence deliberately omitted for this first real policy test:

- frozen `FAST_VET_R0` must skip rather than invent creator evidence;
- `FAST_VET_R1_CAPACITY_GATE` may trade if the minimum bidirectional execution
  gate passes;
- `BUY_EVERY_EXECUTABLE_CONTROL_R1` may trade on the same execution condition.

Those actions are asserted before the forward outcome is constructed.

No classification or return threshold is changed based on X17Z.

## Accounting

The portable outcome reports executable USD value of the frozen `$1` primary
probe before gas. This is counterfactual shadow evidence, not realized PnL and
not a live transaction receipt.

The five-rung ladder remains capacity evidence. M2I does not pretend the `$5`
capacity estimate is the same thing as a realized `$5` forward trade.

## Transport

M2H-D proved the keyless NodeFlare endpoint can serve the exact historical
Pons state required by the frozen archive capability gate after deterministic
backoff. M2I uses the same endpoint with a serialized `2.2s` minimum request
start interval plus transport retries.

Transport is not authority. Runtime hashes, factory records, block hashes,
market identity, hook registration, V4 state and USDG authority remain checked
by the concrete adapters.

## Boundaries

- no wallet;
- no signer;
- no approvals;
- no transaction construction;
- no broadcast;
- no Robinhood live-money authority;
- no Arc live-money authority;
- existing Ink live authority unchanged;
- no policy tuning after the outcome;
- `EDGE_UNPROVEN`.
