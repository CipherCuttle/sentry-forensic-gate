# PONS_E4_ONE_SHOT_FAILOVER_CANARY_V1

## Engineering closure

**Status: CLOSED / PASS — GRANT MACHINERY READY / NO LIVE GRANT ISSUED**

Frozen implementation head:

`f607a0a33d695ddd5a6ec872cce87e4efebd92a3`

The implementation is live-capable only when a separately issued E4 grant is
present. This closure itself grants no signing, broadcast, or live-money
authority.

## Objective

Turn the next Pons real-money canary from an environment-variable convention
into a consumable one-shot authority:

`one explicit token → exact $1 E0 entry → normal curve exit if active → if stranded by graduation, exact E3B old-curve cleanup → fresh proof → exact E2 V4 recovery → final zero authority → STOP`

No real E4 grant file is committed to the repository.

## Grant binding

A valid grant binds:

- Robinhood Chain ID `4663`;
- one exact token;
- dedicated wallet `0x9343835Fe138FFfF68293B361b3C69FEbd83C031`;
- exact notional `1000000` USD micros ($1.00);
- exact slippage;
- maximum native `quoteIn`;
- one exact E0 state path;
- reviewed implementation head as owner-visible provenance;
- SHA-256 digest of the exact compiled live execution surface;
- entry window no longer than 30 minutes;
- recovery window no longer than 24 hours;
- exact permissions:
  - `E0_BUY`
  - `E0_CURVE_EXIT`
  - `E3B_CURVE_REVOKE`
  - `E2_V4_RECOVERY`.

The hard implementation ceiling for `maxQuoteInWei` is `0.01 ETH`.
A one-dollar canary grant should use a materially lower cap derived from the
fresh entry plan.

## Compiled execution-surface binding

The initial design invoked local `git` through `node:child_process` to
check HEAD/worktree identity. Repo-wide research guardrails correctly rejected
that escape hatch.

The final design does not shell out and does not whitelist the violation.

Instead, runtime computes a canonical SHA-256 digest over the exact compiled
files that can route/sign/recover the canary plus the package manifest.
The protected set includes:

- E4 grant enforcement;
- E0 live CLI, intents, contracts and executor;
- E3B runtime/state/cleanup CLI and executor;
- E2 live recovery CLI, intents/state and executor;
- E1 V4 plan/verifier;
- reviewed Pons authority/contracts/template authority;
- `package.json`.

Entry and recovery both fail closed if the grant's
`executionSurfaceDigestSha256` differs from the runtime digest.

This protects the executable bytes directly rather than trusting a shell-based
Git cleanliness check.

## Atomic entry consumption

Before E0 may sign the first live transaction:

1. a fresh E0 plan already exists;
2. token/wallet/notional/slippage/state path match the grant;
3. `quoteIn` is positive and below the grant cap;
4. the compiled execution-surface digest matches;
5. the entry window is open;
6. no consumed receipt exists.

The consumed receipt is created with exclusive `wx` semantics.

Both the receipt file and containing directory are `fsync`'d before grant
consumption returns to E0.

A second entry attempt fails:

`PONS_E4_GRANT_ALREADY_CONSUMED`

If the grant is consumed but E0 stops before spending, entry authority remains
consumed; a new owner grant is required.

## Original-operation recovery binding

A consumed grant is not reusable generic recovery authority.

Recovery requires the exact E0 state path frozen in the grant and that state
must still be:

- `BUY_INCLUDED`, or
- `APPROVAL_INCLUDED`.

The state must bind:

- E4 grant ID;
- token;
- wallet;
- original BUY transaction hash;
- original `tokensOwned`;
- original curve.

If E0 reaches `COMPLETED`, recovery authority becomes unusable.

This prevents a consumed grant from being reused for a later position in the
same token.

## E3B cleanup authority

Live E3B old-curve cleanup requires:

- the same consumed E4 grant;
- `E3B_CURVE_REVOKE` permission;
- exact original E0 BUY hash;
- exact original token amount;
- exact token/wallet;
- E3B's existing curve/graduation/allowance proof.

The only cleanup is:

`approve(oldCurve, 0)`

It remains crash-fenced through SIGNED → SUBMITTED → INCLUDED and stops after
inclusion. It cannot auto-continue to V4.

## E2 V4 recovery authority

Live E2 recovery requires:

- the same consumed E4 grant;
- `E2_V4_RECOVERY` permission;
- current recovery balance == original E0 `tokensOwned`;
- current recovered curve == original E0 curve;
- exact E1 V4 proof.

E2 independently reads the old E0 curve allowance at the E1 verification
block and re-reads that block hash.

V4 recovery is forbidden unless:

- old-curve allowance == 0;
- allowance-read block hash == E1 verification block hash.

Direct invocation of E2 therefore cannot bypass required E3B cleanup.

## Recovery lifetime

The short entry deadline controls only opening the position.

After a genuine handoffable post-BUY state exists, the consumed grant may
authorize risk-reducing cleanup/recovery until its bounded recovery deadline.

This avoids trapping an already-open one-dollar canary because its entry window
expired.

## Verification

Frozen implementation head:

`f607a0a33d695ddd5a6ec872cce87e4efebd92a3`

Exact-head runs:

- E4 one-shot grant readiness `35534086777`: **PASS**
- E3B runtime failover readiness `35534086752`: **PASS**
- E3 E0→E2 failover readiness `35534086751`: **PASS**
- E2 V4 recovery readiness `35534086766`: **PASS**
- E1 V4 recovery readiness `35534086770`: **PASS**
- E0 live-canary readiness `35534086779`: **PASS**
- canary-sniper boundary `35534086771`: **PASS**
- normal CI `35534086773`: **PASS**
- executable-infra discovery `35534086776`: **PASS**

The E4 gate proves:

- TypeScript build;
- one-shot grant regression;
- exact $1/token/wallet/state-path binding;
- native quote cap;
- bounded entry/recovery windows;
- durable one-shot consumption;
- repeat-entry rejection;
- post-consumption grant tamper detection;
- original E0-operation recovery binding;
- `COMPLETED` E0 state revokes recovery authority;
- V4 requires zero old-curve allowance on the E1 block hash;
- compiled execution-surface digest binding;
- E0→E3B regression chain;
- narrow signer boundary;
- all live surfaces require E4 grant;
- CI contains no live/signing/broadcast authority.

Normal CI and E0 readiness independently prove the repo-wide research-only AST
guardrails pass with no `child_process` exception.

E3 readiness also re-proves the current real graduated Pons V4 dry path without
a signer.

## Hostile review

The bounded hostile review / targeted repair cycle found three High findings.

### High 1 — later-position grant reuse

Recovery was initially token/wallet-bound but not strongly enough bound to the
specific E0 position.

Repair:

- exact E0 state path;
- grant ID;
- BUY hash;
- curve;
- original `tokensOwned`;
- handoff status;
- `COMPLETED` blocks recovery.

### High 2 — direct E2 stale-curve bypass

E2 could initially be invoked without independently proving the old E0 curve
allowance had been cleared.

Repair:

- E2 reads old-curve allowance at the E1 verification block;
- block hash is rebound to E1;
- nonzero old-curve allowance fails closed.

### High 3 — shell escape in runtime identity proof

The first code-identity repair used `node:child_process` to invoke Git,
violating the repository's research-only escape-hatch boundary.

Repair:

- removed `child_process`;
- no guardrail whitelist added;
- replaced with direct SHA-256 binding of the compiled execution surface;
- exact-head E0 readiness and normal CI now pass the research guardrails.

Remaining:

- Critical: **0**
- High: **0**

No additional hostile-review loop was opened; closure verification used the
exact-head automated gates above.

## Authority

**LIVE-MONEY AUTHORITY: NONE**

**SIGNING AUTHORITY: NONE**

**BROADCAST AUTHORITY: NONE**

No E4 grant has been issued or consumed.

## Live authorization boundary

The next real-money action requires a fresh explicit owner authorization for a
concrete one-shot grant containing at minimum:

- exact token address;
- wallet `0x9343835Fe138FFfF68293B361b3C69FEbd83C031`;
- exact $1 notional;
- slippage;
- native quote cap;
- entry/recovery expiry;
- E0 state path;
- implementation provenance head
  `f607a0a33d695ddd5a6ec872cce87e4efebd92a3`;
- compiled `executionSurfaceDigestSha256`.

The real grant must remain outside Git and no private key belongs in GitHub,
chat, CI, or a committed env file.
