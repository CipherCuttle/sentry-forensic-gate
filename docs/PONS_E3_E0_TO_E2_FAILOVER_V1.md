# PONS_E3_E0_TO_E2_FAILOVER_V1

## Objective

Add the smallest dry authority layer that decides how a wallet exits after an
E0 BUY without granting new signing or broadcast authority.

Frozen route law:

`exact post-BUY balance → curve exit if executable → otherwise exact E1 phase-2 proof → exact E2 V4 recovery intents → STOP`

This stage is deliberately a **dry integration boundary**, not a live E0/E2
orchestrator.

## Route authority

E3 can return only:

- `CURVE_EXIT`
- `V4_RECOVERY`
- `STOP`

### CURVE_EXIT

Curve exit has priority when the caller provides an executable full-balance
curve observation.

Requirements:

- post-BUY token balance > 0;
- `tokensIn` equals the exact post-BUY balance;
- quoted native output > 0;
- minimum native output > 0;
- minimum output cannot exceed the quote.

Partial curve exits are rejected.

### V4_RECOVERY

V4 is not a generic fallback for arbitrary curve errors.

It is selectable only after the curve path is explicitly
`NOT_EXECUTABLE` or `CURVE_INACTIVE` and an exact E1 dry verification
passes.

The E1 proof must bind:

- token;
- owner;
- exact full post-BUY balance;
- phase-2 graduated Pons launch;
- exact reconstructed V4 pool;
- current full-balance quote;
- exact reviewed Permit2/router/runtime graph.

E3 additionally requires:

- E0 token→curve allowance == 0;
- ERC20→Permit2 allowance == 0;
- Permit2→router amount == 0;
- E1 verification block hash equals the block hash re-read after the
  token→curve allowance observation;
- E2 token approval amount == exact post-BUY balance;
- E2 Permit2 approval amount == exact post-BUY balance;
- E2 V4 exit amount == exact post-BUY balance.

Only then are the existing E2 recovery intents exposed.

### STOP

E3 fails closed for:

- zero/non-positive post-BUY balance;
- partial curve exit;
- invalid curve quote;
- arbitrary curve/RPC error;
- missing E1 proof;
- token/owner/balance drift;
- block-hash drift;
- residual E0 curve allowance;
- pre-existing Permit2-side authority;
- E2 intent amount drift.

## Residual E0 curve authority

Hostile review found a High integration hazard:

If E0 had already approved the curve and the launch graduated before SELL, a
V4 recovery could remove the token balance while leaving token→curve allowance
behind.

E3 therefore does **not** silently reinterpret that state. It reads the current
token→curve allowance and requires it to be exactly zero before V4 can be
selected.

A non-zero curve allowance returns:

`PONS_E3_RESIDUAL_CURVE_ALLOWANCE_REQUIRES_CLEANUP`

A later runtime-wiring stage may add a separately reviewed exact revoke path.

## Reorg binding

The curve-allowance repair introduced an adjacent consistency requirement:
reading allowance by block number alone is insufficient if that block is
reorganized after E1 verification.

E3 therefore re-reads the verification block after the allowance observation
and requires its hash to equal E1's frozen block hash.

Mismatch returns:

`PONS_E3_V4_RECOVERY_BLOCK_HASH_DRIFT`

## Dry CLI

`src/canary/ponsE3FailoverCli.ts` is read-only.

It rejects any non-empty:

- `PONS_E0_LIVE`
- `PONS_E0_PRIVATE_KEY`
- `PONS_E2_LIVE`
- `PONS_E2_PRIVATE_KEY`
- `PONS_E2_BROADCAST_AUTHORITY`
- `PONS_E3_LIVE`
- `PONS_E3_PRIVATE_KEY`
- `PONS_E3_BROADCAST_AUTHORITY`

No wallet client, private-key derivation, signing, or raw broadcast surface is
added by E3.

## Verification

Offline regression proves:

- curve route priority when exact/full and executable;
- exact E1 proof required for V4;
- exact post-BUY balance binding;
- E1 proof and curve-allowance read share one block hash;
- residual E0 curve allowance blocks V4;
- dirty Permit2-side authority blocks V4;
- arbitrary curve errors fail closed;
- partial curve exits are forbidden.

Real-chain dry verification reused the current graduated Pons context:

- token: `0x8ECD7b553E36248164616c271B4B3C171bC8226b`
- owner context: `0xE152cd6ab035c0a8b7D8147373dd201579873a41`
- exact token balance: `3975359897761331367429707`
- pool id: `0x07ec2169905bb540d5cb43c03160269628d8791ba6746108333a20609204ddf4`
- route: `V4_RECOVERY`
- 5% minimum native output observed by the E2 intent:
  `3831337779631528` wei

No signer or broadcast authority was available.

Readiness workflow:

- run: `35513119960`
- conclusion: PASS
- build: PASS
- offline failover regression: PASS
- real graduated-token dry V4 route: PASS
- no-live-authority boundary: PASS

E1, E2 and canary-sniper regressions also passed on the same implementation
head.

## Review closure

One bounded hostile-review cycle found the residual E0 curve-allowance hazard.

The targeted repair review additionally required block-hash rebinding around
the new allowance read. Both are repaired and covered by regression evidence.

No further review loop was opened.

## Authority

**LIVE-MONEY AUTHORITY: NONE**

**SIGNING AUTHORITY: NONE**

**BROADCAST AUTHORITY: NONE**

E3 does not authorize another E0 BUY, another Pons canary, or any E2 recovery
broadcast.

## Scope boundary / next stage

E3 closes the **decision + proof composition layer** only.

It does not yet splice this decision into the live-capable E0 post-BUY state
machine. The next smallest stage is runtime wiring that:

1. obtains a real E0 full-balance curve-exit observation;
2. invokes this E3 authority decision;
3. preserves crash-safe state across the E0→E2 handoff;
4. adds an exact old-curve allowance revoke path if that authority is present;
5. remains live-disabled until separately authorized.
