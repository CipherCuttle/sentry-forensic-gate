# Robinhood / Pons V2 — M2H-A Archive Capability Gate

## Objective

Before implementing portable 24h outcome reconstruction, prove that at least one
read-only Robinhood provider can serve the historical state required by the
already-mature prior creator launch.

Frozen prior launch:

- launch block: `64,935,682`
- baseline decision block: `64,935,684`
- curve: `0x918cc3734621d966995d2663dcf587ce0d4768fc`
- launch timestamp: `2026-09-17T00:25:10Z`
- 24h horizon matured: `2026-09-18T00:25:10Z`

The probe does not ask whether a provider can return an old block header only.
It requires, at the real decision block:

1. chain ID 4663;
2. historical block header;
3. Pons factory runtime bytecode;
4. prior curve runtime bytecode;
5. successful historical `eth_call` to `getReserves()`.

A provider passing this gate is only transport. Pons/Uniswap/runtime hashes and
the frozen research contracts remain authority.

## Endpoints probed

Keyless/read-only candidates:

- Robinhood official public RPC;
- BlockReq public;
- Triport public;
- PublicNode;
- Alchemy documentation demo endpoint.

No API key, wallet, signer, transaction construction, broadcast, or live money
is involved.

## Next

If at least one endpoint passes, M2H-B may implement the portable
`FORWARD_OUTCOMES_R1` equivalent using that provider and the frozen outcome
classification thresholds.

If none passes, M2H remains blocked on a real archive credential rather than
weakening the historical evidence contract.

`EDGE_UNPROVEN` remains explicit.
