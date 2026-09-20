# PONS_E3B_RUNTIME_FAILOVER_WIRING_V1

## Closure

**Status: CLOSED / PASS — LIVE-DISABLED ENGINEERING**

E3B wires the closed E3 failover authority into the persisted E0 post-BUY
runtime boundary and adds the exact old-curve allowance cleanup execution
primitive required before a graduated V4 recovery can continue.

This stage grants **no live-money, signing, or broadcast authority**.

## Runtime law

The bounded post-BUY sequence is now:

`E0 BUY_INCLUDED / APPROVAL_INCLUDED → exact chain-state proof → active curve returns to E0 → graduation-pending STOP → graduated+dirty old-curve allowance → exact approve(oldCurve,0) cleanup → STOP → fresh E3B proof cycle → exact E1 proof → exact E2 V4 intents`

There is no implicit or guessed fallback.

## E0 handoff binding

E0 now persists the actual BUY transaction hash in handoffable post-BUY states.

E3B accepts only:

- `BUY_INCLUDED`
- `APPROVAL_INCLUDED`

The handoff is rebound to the actual E0 BUY transaction and receipt:

- successful receipt;
- exact sender wallet;
- exact target curve;
- decoded Pons `buy(...)`;
- exact recipient wallet;
- transaction value equals decoded `quoteIn`;
- exactly one matching `CurveBuy` event;
- positive `tokensOut`.

The current wallet token balance must equal persisted `tokensOwned` exactly.

## Curve / authority rebinding

Before routing, E3B re-proves:

- Robinhood chain ID;
- reviewed Pons factory runtime hash;
- curve factory == reviewed factory;
- curve token == persisted token;
- curve pair token == native ETH sentinel;
- exact token→curve allowance.

The E1 V4 proof curve must equal the exact curve persisted by E0.

Allowance observation and E1 proof remain block-hash bound.

## Route behavior

### Active curve

`!graduated && !readyToGraduate`

returns:

`CURVE_PATH_ACTIVE`

Normal E0 curve exit remains authoritative.

### Graduation pending

`!graduated && readyToGraduate`

fails closed:

`PONS_E3B_GRADUATION_PENDING_FAIL_CLOSED`

### Graduated + stale E0 curve authority

A nonzero token→old-curve allowance produces only:

`TOKEN_REVOKE_CURVE = approve(oldCurve, 0)`

It cannot produce V4 intents in the same decision.

### Graduated + clean old-curve authority

V4 handoff requires:

- old-curve allowance == 0;
- exact E1 recovery proof;
- exact curve identity;
- exact full token balance;
- zero pre-existing ERC20→Permit2 allowance;
- zero active Permit2→router amount;
- exact E2 approval and exit amounts.

Anything else stops.

## Crash-safe runtime state

E3B persists:

- `POST_BUY_CAPTURED`
- `CURVE_PATH_ACTIVE`
- `CURVE_REVOKE_REQUIRED`
- `CURVE_REVOKE_SIGNED`
- `CURVE_REVOKE_SUBMITTED`
- `CURVE_REVOKE_INCLUDED`
- `V4_HANDOFF_READY`
- `STOPPED`

Reservation uses exclusive create.

A pre-existing E3B state blocks blind restart and requires reconciliation.

A curve revoke cannot skip SIGNED or SUBMITTED.

`CURVE_REVOKE_INCLUDED` is terminal for that proof cycle. It cannot
transition directly to V4. The operator must start a **fresh E3B proof cycle
with a new state path**.

## Curve cleanup executor

`ViemPonsE3BCurveCleanupExecutor` is a separately bounded signer.

It signs only the exact zero-allowance old-curve revoke and re-proves:

- signer == persisted wallet;
- Robinhood chain ID;
- reviewed Pons factory runtime;
- exact curve factory/token/native pair;
- curve is graduated;
- old-curve allowance is currently nonzero;
- token contract code exists;
- gas and fee caps;
- exact signed target/calldata/value/fees/signer/chain.

`broadcastExact()` is disabled by default.

The live cleanup CLI additionally requires all of:

- `PONS_E3B_ENABLED=true`
- `PONS_E3B_LIVE=true`
- `PONS_E3B_BROADCAST_AUTHORITY=true`
- a local `PONS_E3B_PRIVATE_KEY`

It binds the current token balance to the frozen state before signing,
persists SIGNED before broadcast and SUBMITTED after broadcast, waits without
automatic retry, then proves:

- token balance is unchanged;
- old-curve allowance == 0.

Only then is `CURVE_REVOKE_INCLUDED` persisted.

It explicitly outputs:

`START_FRESH_E3B_PROOF_CYCLE_WITH_NEW_STATE_PATH`

and:

`autoContinueToV4: false`

## Historical replay capability

The public Robinhood RPC serves the actual E0 transaction and receipt but did
not retain the historical contract state required for the E0 inclusion-block
`eth_call` replay.

Historical state replay is therefore explicit:

- `PONS_E3B_OBSERVATION_BLOCK` requires
  `PONS_E3B_ARCHIVE_RPC_URL`;
- absence of an archive RPC fails closed with
  `PONS_E3B_HISTORICAL_REPLAY_REQUIRES_ARCHIVE_RPC`.

The readiness gate instead proves the actual E0 BUY transaction/receipt
identity directly and uses the offline E3B route/state regression plus the
existing real-chain E3 graduated-V4 dry verification.

## Verification

Implementation head:

`f227756ae6f37418b00700d2a4c2c2c54bf77ed1`

Key exact-head runs:

- E3B runtime failover readiness #35530629300: **PASS**
- normal CI #35530629259: **PASS**
- E0 readiness #35530629291: **PASS**
- E1 V4 recovery readiness #35530629293: **PASS**
- E2 V4 recovery readiness #35530629255: **PASS**
- E3 failover readiness #35530629258: **PASS**
- canary-sniper boundary #35530629279: **PASS**

E3B readiness proves:

- TypeScript build;
- E3B offline route/state regression;
- E0/E1/E2/E3 offline regression chain;
- narrow signer boundary;
- actual prior E0 BUY receipt and handoff identity;
- explicit archive requirement for historical replay;
- no live/signing/broadcast authority in CI.

## Hostile review

One bounded hostile review found one High:

> The curve-cleanup executor existed, but the runtime did not drive
> `CURVE_REVOKE_REQUIRED → SIGNED → SUBMITTED → INCLUDED`.

Repair:

- added the dedicated live-gated E3B cleanup CLI;
- bound it to the exact persisted state/wallet/token balance;
- persisted all broadcast-sensitive transitions;
- proved zero allowance + unchanged token balance after inclusion;
- kept post-cleanup V4 continuation forbidden until a fresh proof cycle.

Targeted rereview: **PASS**.

Remaining:

- Critical: **0**
- High: **0**

No further review loop was opened.

## Authority

**LIVE-MONEY AUTHORITY: NONE**

**SIGNING AUTHORITY: NONE**

**BROADCAST AUTHORITY: NONE**

No new Pons BUY, approval, SELL, curve revoke, Permit2 approval, V4 exit, or
other real-money transaction is authorized by this closure.

## Next stage

The next stage is a fresh explicitly authorized one-shot integration canary:

`PONS_E4_ONE_SHOT_FAILOVER_CANARY`

The smallest sensible grant remains one bounded E0-sized entry with:

- one explicit token;
- one state path;
- no retry after ambiguous broadcast;
- normal curve exit when active;
- E3B cleanup only if graduation leaves old-curve authority;
- fresh proof after cleanup;
- E2 V4 recovery only when exact E1 proof passes;
- final token balance zero;
- final old-curve allowance zero;
- final ERC20→Permit2 allowance zero;
- final Permit2→router amount zero;
- STOP after the one operation.

Any E4 broadcast requires fresh explicit owner authority.
