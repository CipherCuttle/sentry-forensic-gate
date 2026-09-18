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


## Credentialed continuation

The keyless probe on run `35378025533` found no endpoint that could satisfy
the full historical-state contract:

- Robinhood public: block header available, historical state pruned;
- BlockReq public: only recent 32,768 blocks;
- PublicNode: archive requests require a personal token;
- Alchemy docs demo: request origin is not whitelisted;
- Triport public: returned HTTP 401 from GitHub Actions.

The workflow now also probes an optional repository secret:

`ROBINHOOD_ARCHIVE_RPC_URL`

If present, it is injected only as an environment variable. The URL is not
checked into source. GitHub masks matching secret values in logs.

The configured endpoint must pass the exact same real historical gate:
factory code, curve code, and `getReserves()` at block `64,935,684`.
A credential alone grants no research authority.

Robinhood's official docs recommend an archive provider such as Alchemy for
historical reads. PublicNode also explicitly reports that its archive surface
requires a personal token.


## Acquisition / evaluation boundary

The repository's research guardrail correctly rejects direct network calls in
research JavaScript/TypeScript. M2H-A therefore follows the same boundary as
M2G:

1. workflow shell performs read-only JSON-RPC acquisition with `curl`;
2. raw response envelopes are stored under `artifacts/pons-v2-archive-probe/`;
3. the JavaScript probe only reads local files, decodes `getReserves()`, and
   evaluates the frozen capability contract.

The optional `ROBINHOOD_ARCHIVE_RPC_URL` secret is used only by the workflow
acquisition step. It is never emitted into the manifest or evaluator output.
