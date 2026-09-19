# PONS_E2_SIGNED_V4_RECOVERY_V1

## Objective

Add the bounded signed-executor layer for recovering a wallet from a Pons V2
graduated native-ETH launch through the exact V4 path proven in E1.

Frozen sequence:

`fresh phase-2 proof → exact ERC20 approval → exact Permit2 allowance → full-balance V4 exit → verify zero token balance → revoke residual approvals → stop`

E2 is **engineering-complete but not live-authorized**. No real private key,
signature, or broadcast was used to close this stage.

## Execution authority

The executor only accepts intents built from the E1 recovery plan and rechecks
current chain authority before preflight and again before signing.

The write surface is limited to:

1. token `approve(Permit2, exactFullBalance)`;
2. Permit2 `approve(token, pinnedRouter, exactFullBalance, boundedExpiration)`;
3. pinned Universal Router v2.1.1 full-balance V4 exit;
4. Permit2 amount-zero revoke if residual authority remains;
5. token `approve(Permit2, 0)` if residual ERC20 allowance remains.

Every transaction has native value zero.

The signed-transaction fence re-parses the serialized EIP-1559 transaction and
requires the exact:

- signer;
- Robinhood chain id 4663;
- target;
- calldata;
- zero native value;
- gas;
- max fee;
- priority fee;
- transaction hash.

Broadcast is a separate executor capability and fails closed unless explicitly
enabled. The current stage grants **no broadcast authority**.

## Freshness before signing

For the two approvals and V4 exit, the executor reruns the E1 live verifier.
Among other checks this requires:

- the exact Pons factory / launch-deployer / hook dependency graph;
- exact reviewed PoolManager / StateView / Quoter runtimes;
- exact Robinhood Permit2 runtime;
- exact pinned Universal Router v2.1.1 runtime;
- phase 2;
- graduated curve;
- exact reconstructed pool and PoolId;
- non-zero V4 liquidity;
- current full wallet token balance;
- current full-balance V4 quote.

The exit additionally requires:

- current full token balance equals the frozen amount;
- ERC20→Permit2 allowance equals the frozen amount;
- Permit2→router amount equals the frozen amount;
- Permit2 expiration covers the frozen router deadline;
- fresh native-output quote is still at least the frozen minimum;
- router calldata still targets the exact pool and full token balance.

## Crash-safe state

State is reserved atomically before any signing.

Main path:

`ARMED`
→ `TOKEN_APPROVAL_SIGNED`
→ `TOKEN_APPROVAL_SUBMITTED`
→ `TOKEN_APPROVAL_INCLUDED`
→ `PERMIT2_APPROVAL_SIGNED`
→ `PERMIT2_APPROVAL_SUBMITTED`
→ `PERMIT2_APPROVAL_INCLUDED`
→ `EXIT_SIGNED`
→ `EXIT_SUBMITTED`
→ `EXIT_INCLUDED`
→ optional cleanup
→ `COMPLETED`

Signed transaction hashes are persisted **before** broadcast. Submitted hashes
are persisted before receipt waiting.

Any restart from a nonterminal state is rejected with manual-reconciliation
semantics. E2 never automatically resends a transaction after an ambiguous
broadcast or restart.

A read-only reconciler reports:

- state status;
- latest transaction hash;
- receipt success / revert / pending / not observed;
- current token balance;
- ERC20→Permit2 allowance;
- Permit2→router amount, expiration, and nonce.

It always returns `autoRetryAllowed: false`.

## Safe pre-exit abort

Hostile review identified that an approval could otherwise remain live if the
next step failed before the V4 exit was signed.

E2 therefore performs bounded cleanup only while it is provably safe:

- after token approval is included, if Permit2 approval fails **before it is
  signed**, revoke the token allowance;
- after Permit2 approval is included, if exit preflight/signing fails **before
  EXIT_SIGNED**, revoke Permit2 authority and then ERC20 allowance;
- persist terminal state `ABORTED_CLEAN`.

Once state reaches `EXIT_SIGNED`, E2 does **not** automatically revoke, resend,
or reinterpret anything. A signed or possibly submitted exit requires read-only
reconciliation first.

## Permit2 revoke semantics

Permit2's `approve(token, spender, 0, 0)` does not store expiration zero.
Permit2 converts input expiration zero to the current block timestamp.

Therefore E2 defines active Permit2 spend authority by:

`amount != 0`

A successful revoke requires amount zero. Stored expiration remains evidence and
is not incorrectly required to equal zero.

## Verification

Offline regression covers:

- exact E2 intent decoding;
- dummy-key EIP-1559 signing only;
- signed-byte identity checks;
- zero-priority-fee parser normalization;
- atomic state reservation;
- invalid state-transition rejection;
- immutable plan fields;
- nonterminal restart fail-closed behavior;
- `ABORTED_CLEAN` state;
- Permit2 amount-zero revoke semantics;
- read-only reconciliation with both NOT_OBSERVED and RECEIPT_SUCCESS cases;
- no auto retry.

Real-chain dry verification uses the same current graduated Pons launch used by
E1:

- token: `0x8ECD7b553E36248164616c271B4B3C171bC8226b`;
- pool id:
  `0x07ec2169905bb540d5cb43c03160269628d8791ba6746108333a20609204ddf4`;
- public read-only EOA context:
  `0xE152cd6ab035c0a8b7D8147373dd201579873a41`;
- full token balance: `3975359897761331367429707` raw units;
- observed full-balance quote at verification:
  `4046035129791204` wei ETH;
- 5% frozen minimum:
  `3843733373301643` wei.

The address is used only as public balance and `eth_call` simulation context.
No key or authorization from it is used.

## Repository boundary integration

The repository's global research-only rules continue to forbid wallet/signing
authority outside `src/canary`.

E2 extends the existing canary authority list with only:

`src/canary/viemPonsE2V4RecoveryExecutor.ts`

The dummy-key signer regression is the only JavaScript rule exception:

`scripts/pons-e2-v4-recovery-check.mjs`

That exception is itself checked by `scripts/canary-boundary-check.mjs`, which
requires the fixed dummy key and dry-only evidence and rejects any
`.broadcastExact(...)`, `PONS_E2_LIVE=true`, or
`PONS_E2_BROADCAST_AUTHORITY=true` behavior in the test script.

The global research-only TypeScript boundary is unchanged.

## Review closure

One hostile review found:

- Critical: 0
- High: 2

High 1: incorrect assumption that a Permit2 amount-zero revoke would store
expiration zero.

High 2: pre-exit approval failure could leave authority live rather than cleanly
aborting.

Both were repaired. One targeted rereview passed with no remaining
Critical/High findings.

Canonical receipt:

`docs/evidence/PONS_E2_SIGNED_V4_RECOVERY_DRY_CLOSURE_2026-09-19.json`

## Authority boundary

**LIVE-MONEY AUTHORITY: NONE**

**BROADCAST AUTHORITY: NONE**

**MERGE AUTHORITY: NONE**

The next useful engineering stage is to integrate E0 and E2 into one bounded
failover path:

`curve BUY → curve exit while active → if phase transitions to 2, V4 recovery → stop`

That integration can be implemented and tested without granting live-money
authority.
