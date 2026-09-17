# MULTICHAIN SHADOW TRANSLATION — M1

## Objective

Establish the smallest chain-neutral research boundary needed to run the same frozen shadow strategy across:

- Ink / Sentry;
- Robinhood Chain / Pons;
- Arc / par.

M1 is a transport/refactoring slice only. It does not implement Robinhood or Arc ingestion, alter Ink execution, or claim cross-chain edge.

## Authority

`SHADOW_RESEARCH_ONLY_EDGE_UNPROVEN`

The existing Ink live canary and its exact `$1` authorization are outside this slice and remain unchanged. M1 grants no live-money authority, signing path, wallet path, bridge authority, or transaction-broadcast authority to Robinhood or Arc.

Scientific verdict remains:

`EDGE_UNPROVEN`

## Boundary

The portable layer introduces four explicit read-only adapter contracts:

- `ChainLaunchAdapter`;
- `MarketQuoteAdapter`;
- `UsdCalibrationAdapter`;
- `ForwardOutcomeAdapter`.

Adapters identify their chain, ecosystem, launch protocol, and `SHADOW_ONLY` mode. A composed adapter fails closed if those identities disagree.

The normalized launch contract retains generic chain/event identity while carrying protocol-specific authority in `sourceAuthority`. Normalization therefore does not erase source semantics merely to make ecosystems look alike.

Market evidence is deliberately not normalized into Ink/Tsunami V3 fields. Pool, curve, router, orderbook, or protocol-specific state belongs in each adapter's source-authority envelope until a genuinely shared semantic is demonstrated.

## Ink compatibility

`normalizeInkSentryLaunch()` is a pure projection of the existing `LaunchObserved` contract. It does not replace Sentry identity, ingestion, SQLite persistence, reorg handling, or authority checks.

Its source-authority envelope preserves every field currently used by Sentry launch-authority equality:

- launch/event IDs;
- chain and block identity;
- factory, transaction and log identity;
- token and creator;
- Sentry `tokenId`;
- name/symbol;
- launch type;
- source event.

Wall-clock `observedAtMs` remains outside source authority, matching existing replay semantics.

## Frozen strategy semantics

`FAST_VET_R0` decision logic and configuration are unchanged. Its TypeScript input is narrowed to an explicit chain-neutral baseline-evidence interface while retaining mandatory provenance fields: authority digest, decision block/hash, policy version, and `INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL` reverse semantics.

The initial baseline ladder remains exactly:

`$0.25 / $0.50 / $1 / $2 / $5`

The primary FAST_VET notional remains exactly `$1`.

`independentReverseRecoveryBps` remains an independent same-state sellability/recovery diagnostic. It is not sequential paper PnL and must not be used as prospective return evidence.

## Deliberate non-changes

M1 does not:

- change `src/canary/**`;
- change the existing Ink live authorization;
- migrate the SQLite schema;
- alter Sentry launch identity or ingestion;
- alter Tsunami market resolution or quote execution;
- alter forward-outcome runtime semantics;
- add Robinhood/Arc RPCs, wallets, signing, or trading;
- tune FAST_VET per chain;
- add a generic arbitrary-chain execution abstraction.

Persistence remains Ink-shaped for M1 on purpose. The first concrete Pons adapter should prove its evidence shape before a separately reviewed persistence migration is designed.

## Next

M2 implements the Robinhood/Pons adapter prospectively and shadow-only against these contracts. Arc/par follows only after the Robinhood translation is producing auditable baseline and forward-outcome evidence. Ghost capital routing remains later and must consume comparable prospective evidence rather than retrospective optimization.
