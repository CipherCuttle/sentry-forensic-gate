# PONS_E4_ONE_SHOT_FAILOVER_CANARY_V1

## Engineering closure

**Status: CLOSED / PASS — GRANT MACHINERY READY / NO LIVE GRANT ISSUED**

Frozen implementation head:

`2038294805a2dc8f0ec4e9c01b93a68c38b3cea8`

This head contains the live-capable grant enforcement that must be checked out
exactly for an E4 canary. Any later code change requires a new review and a new
grant.

## Objective

Turn the next Pons real-money canary from an environment-variable convention
into a consumable, code-pinned one-shot authority.

The grant authorizes one bounded operation:

`one explicit token → exact $1 E0 entry → normal curve exit if active → if stranded by graduation, E3B exact old-curve cleanup → fresh proof → E2 V4 recovery → final zero authority → STOP`

No grant file exists in the repository.

## Grant binding

A valid E4 grant binds:

- chain ID 4663;
- one exact token;
- the dedicated wallet;
- exact notional `1000000` USD micros ($1.00);
- exact slippage setting;
- a maximum native `quoteIn` cap;
- one exact E0 state path;
- one exact Git commit;
- a clean Git worktree;
- a maximum 30-minute entry window;
- a maximum 24-hour recovery window;
- the exact permission set:
  - `E0_BUY`
  - `E0_CURVE_EXIT`
  - `E3B_CURVE_REVOKE`
  - `E2_V4_RECOVERY`

The implementation also has an absolute hard ceiling of
`0.01 ETH` for the grant's `maxQuoteInWei`; an issued canary grant should
use a substantially smaller cap.

## Atomic entry consumption

Before E0 can sign its first live transaction:

1. the fresh E0 plan must already exist;
2. token/wallet/notional/slippage/state path must match the grant;
3. quote input must be positive and below the grant cap;
4. current Git HEAD must equal the grant's `codeHead`;
5. the worktree must be clean;
6. the entry window must be open;
7. the consumed receipt must not already exist.

The consumed receipt is then created with exclusive `wx` semantics.

The receipt file and containing directory are `fsync`'d before the entry
grant returns to E0.

Only after that durable one-shot consumption may E0 proceed toward signing.

A second entry attempt returns:

`PONS_E4_GRANT_ALREADY_CONSUMED`

If consumption succeeds but E0 stops before spending, the authority is still
consumed. A fresh owner grant is required.

## Original-operation recovery binding

A consumed grant is not generic recovery authority for the same token.

Recovery requires the exact original E0 state file to remain in:

- `BUY_INCLUDED`, or
- `APPROVAL_INCLUDED`.

The E0 state must match:

- E4 grant ID;
- token;
- wallet;
- original BUY transaction hash;
- original `tokensOwned`;
- original curve.

If E0 reaches `COMPLETED`, the recovery grant becomes unusable for that
operation.

This prevents a consumed canary grant from being reused for a later position
of the same token.

## E3B cleanup authority

E3B live old-curve cleanup requires:

- the same consumed E4 grant;
- permission `E3B_CURVE_REVOKE`;
- exact original E0 BUY hash;
- exact original token amount;
- exact token/wallet;
- E3B's existing curve/graduation/allowance proof.

The cleanup remains exactly:

`approve(oldCurve, 0)`

and still stops after inclusion. It cannot auto-continue to V4.

## E2 V4 recovery authority

E2 live V4 recovery requires:

- the same consumed E4 grant;
- permission `E2_V4_RECOVERY`;
- exact original E0 token amount;
- exact original E0 curve;
- exact E1 V4 recovery proof.

E2 independently reads the old E0 curve allowance at the E1 verification
block and re-reads that block hash.

V4 recovery is forbidden unless:

- old-curve allowance == 0;
- allowance-read block hash == E1 verification block hash.

Therefore an operator cannot bypass E3B cleanup by directly invoking E2 from
an `APPROVAL_INCLUDED` state with stale old-curve authority.

## Recovery lifetime

The short entry window applies only before the one-shot BUY authority is
consumed.

Once an E0 operation is consumed and has a genuine handoffable post-BUY state,
the same grant may authorize risk-reducing cleanup/recovery until its bounded
recovery deadline.

This avoids trapping an already-open canary simply because the entry window
expired.

After the recovery deadline, fresh owner authority is required.

## Verification

Implementation head:

`2038294805a2dc8f0ec4e9c01b93a68c38b3cea8`

Dedicated E4 readiness:

- workflow run: `35531514002`
- conclusion: **PASS**

That gate proves:

- TypeScript build;
- E4 grant regression;
- exact $1 notional binding;
- token/wallet/state-path/code-head binding;
- clean-worktree requirement;
- quote-input cap;
- bounded entry/recovery windows;
- atomic one-shot consumption;
- repeat-entry rejection;
- post-consumption grant tamper detection;
- recovery binding to original E0 operation;
- `COMPLETED` E0 state revokes recovery authority;
- V4 old-curve allowance must be zero;
- V4 old-curve read shares the E1 block hash;
- E0/E1/E2/E3/E3B regression chain;
- narrow canary signer boundary;
- E0/E3B/E2 live surfaces all require E4 grant;
- CI has no live/signing/broadcast authority.

## Hostile review

The bounded hostile review found two High findings.

### High 1 — same-token later-position reuse

Initial recovery authority was bound to token/wallet but not strongly enough to
the original E0 position.

Repair:

- recovery reads the exact E0 state path frozen in the grant;
- state must remain handoffable;
- E4 grant ID, BUY hash, curve and `tokensOwned` are bound;
- E2 requires current recovery balance and curve to equal the original E0
  operation;
- `COMPLETED` E0 state blocks recovery use.

### High 2 — direct E2 stale-curve bypass

Initial E4 wiring could allow an operator to invoke E2 directly while the old
E0 curve allowance was still nonzero.

Repair:

- E2 independently reads old-curve allowance at the E1 verification block;
- block hash is rebound to E1 proof;
- nonzero old-curve allowance fails closed.

Additional hardening:

- consumed grant file and parent directory are fsync-durable before signing.

Targeted rereview: **PASS**.

Remaining:

- Critical: **0**
- High: **0**

No further review loop was opened.

## Authority

**LIVE-MONEY AUTHORITY: NONE**

**SIGNING AUTHORITY: NONE**

**BROADCAST AUTHORITY: NONE**

This engineering closure does not itself create or issue an E4 grant.

## Live authorization boundary

A real canary may begin only after a fresh owner message explicitly authorizes
a concrete grant containing:

- token address;
- wallet `0x9343835Fe138FFfF68293B361b3C69FEbd83C031`;
- exact $1 notional;
- slippage;
- native quote cap;
- entry/recovery expiry;
- E0 state path;
- implementation head
  `2038294805a2dc8f0ec4e9c01b93a68c38b3cea8`.

The grant must be stored outside the Git repository and the live run must use a
clean worktree at that exact implementation head.
