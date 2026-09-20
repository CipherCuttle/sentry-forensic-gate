import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PONS_V2_MEME_HOOK } from '../dist/adapters/robinhood/ponsV2/forwardOutcomeAuthority.js';
import { buildPonsE1V4RecoveryPlan } from '../dist/canary/ponsE1V4ExitRecovery.js';
import {
  PONS_E3B_RUNTIME_FAILOVER_V1,
  assertPonsE3BCurveRevokeIntent,
  decidePonsE3BRuntimeFailover
} from '../dist/canary/ponsE3BRuntimeFailover.js';
import {
  assertPonsE3BStateMayStart,
  readPonsE3BRuntimeState,
  reservePonsE3BRuntimeState,
  transitionPonsE3BRuntimeState
} from '../dist/canary/ponsE3BRuntimeState.js';

const TOKEN = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const CURVE = '0x3333333333333333333333333333333333333333';
const OTHER_CURVE = '0x4444444444444444444444444444444444444444';
const POOL_ID =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BLOCK_HASH =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TX_HASH =
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const TOKEN_AMOUNT = 123_456_789n;

const plan = buildPonsE1V4RecoveryPlan({
  token: TOKEN,
  owner: OWNER,
  poolKey: {
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: TOKEN,
    fee: 0,
    tickSpacing: 200,
    hooks: PONS_V2_MEME_HOOK
  },
  tokenAmount: TOKEN_AMOUNT,
  quotedNativeOut: 4_000_000_000_000_000n,
  slippageBps: 500,
  deadline: 2_000_000_000n,
  permit2Expiration: 2_000_000_300n
});

const v4Proof = {
  verdict: 'PONS_E1_V4_EXIT_RECOVERY_DRY_READY',
  token: TOKEN,
  owner: OWNER,
  tokenBalance: TOKEN_AMOUNT,
  blockNumber: 123n,
  blockHash: BLOCK_HASH,
  curveAllowanceBlockHash: BLOCK_HASH,
  poolId: POOL_ID,
  currentTokenAllowanceToPermit2: 0n,
  currentPermit2AllowanceToRouter: 0n,
  plan
};

const active = decidePonsE3BRuntimeFailover({
  token: TOKEN,
  owner: OWNER,
  curve: CURVE,
  postBuyTokenBalance: TOKEN_AMOUNT,
  e0Status: 'BUY_INCLUDED',
  curveGraduated: false,
  curveReadyToGraduate: false,
  currentCurveAllowance: 0n
});
assert.equal(active.route, 'CURVE_PATH_ACTIVE');

const pending = decidePonsE3BRuntimeFailover({
  token: TOKEN,
  owner: OWNER,
  curve: CURVE,
  postBuyTokenBalance: TOKEN_AMOUNT,
  e0Status: 'BUY_INCLUDED',
  curveGraduated: false,
  curveReadyToGraduate: true,
  currentCurveAllowance: 0n
});
assert.equal(pending.route, 'STOP');
assert.equal(pending.reason, 'PONS_E3B_GRADUATION_PENDING_FAIL_CLOSED');

const dirty = decidePonsE3BRuntimeFailover({
  token: TOKEN,
  owner: OWNER,
  curve: CURVE,
  postBuyTokenBalance: TOKEN_AMOUNT,
  e0Status: 'APPROVAL_INCLUDED',
  curveGraduated: true,
  curveReadyToGraduate: false,
  currentCurveAllowance: TOKEN_AMOUNT
});
assert.equal(dirty.version, PONS_E3B_RUNTIME_FAILOVER_V1);
assert.equal(dirty.route, 'CURVE_REVOKE_REQUIRED');
assert.equal(dirty.cleanup.kind, 'TOKEN_REVOKE_CURVE');
assert.equal(dirty.cleanup.value, 0n);
assertPonsE3BCurveRevokeIntent(dirty.cleanup);
assert.equal(dirty.nextAction, 'REVERIFY_FROM_CHAIN_AFTER_REVOKE');

const clean = decidePonsE3BRuntimeFailover({
  token: TOKEN,
  owner: OWNER,
  curve: CURVE,
  postBuyTokenBalance: TOKEN_AMOUNT,
  e0Status: 'APPROVAL_INCLUDED',
  curveGraduated: true,
  curveReadyToGraduate: false,
  currentCurveAllowance: 0n,
  allowanceBlockHash: BLOCK_HASH,
  v4RecoveryCurve: CURVE,
  v4Recovery: v4Proof
});
assert.equal(clean.route, 'V4_HANDOFF_READY');
assert.equal(clean.e2Intents.tokenApproval.amount, TOKEN_AMOUNT);
assert.equal(clean.e2Intents.permit2Approval.amount, TOKEN_AMOUNT);
assert.equal(clean.e2Intents.exit.tokenAmount, TOKEN_AMOUNT);

const wrongCurve = decidePonsE3BRuntimeFailover({
  token: TOKEN,
  owner: OWNER,
  curve: CURVE,
  postBuyTokenBalance: TOKEN_AMOUNT,
  e0Status: 'BUY_INCLUDED',
  curveGraduated: true,
  curveReadyToGraduate: false,
  currentCurveAllowance: 0n,
  allowanceBlockHash: BLOCK_HASH,
  v4RecoveryCurve: OTHER_CURVE,
  v4Recovery: v4Proof
});
assert.equal(wrongCurve.route, 'STOP');
assert.equal(wrongCurve.reason, 'PONS_E3B_V4_RECOVERY_CURVE_MISMATCH');

const reorg = decidePonsE3BRuntimeFailover({
  token: TOKEN,
  owner: OWNER,
  curve: CURVE,
  postBuyTokenBalance: TOKEN_AMOUNT,
  e0Status: 'BUY_INCLUDED',
  curveGraduated: true,
  curveReadyToGraduate: false,
  currentCurveAllowance: 0n,
  allowanceBlockHash:
    '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  v4RecoveryCurve: CURVE,
  v4Recovery: v4Proof
});
assert.equal(reorg.route, 'STOP');
assert.match(reorg.reason, /PONS_E3B_E3_HANDOFF_REJECTED:PONS_E3_V4_RECOVERY_BLOCK_HASH_DRIFT/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pons-e3b-'));
const statePath = path.join(dir, 'state.json');
let state = reservePonsE3BRuntimeState(statePath, {
  token: TOKEN,
  wallet: OWNER,
  curve: CURVE,
  tokenAmount: TOKEN_AMOUNT.toString(),
  e0Status: 'APPROVAL_INCLUDED',
  e0TransactionHash: TX_HASH
});
assert.equal(state.status, 'POST_BUY_CAPTURED');
assert.throws(
  () => reservePonsE3BRuntimeState(statePath, {
    token: TOKEN,
    wallet: OWNER,
    curve: CURVE,
    tokenAmount: TOKEN_AMOUNT.toString(),
    e0Status: 'APPROVAL_INCLUDED',
    e0TransactionHash: TX_HASH
  }),
  /PONS_E3B_STATE_RESERVATION_EXISTS/
);
assert.throws(
  () => assertPonsE3BStateMayStart(readPonsE3BRuntimeState(statePath)),
  /PONS_E3B_EXISTING_STATE_REQUIRES_MANUAL_RECONCILIATION/
);

state = transitionPonsE3BRuntimeState(
  statePath,
  state,
  'CURVE_REVOKE_REQUIRED'
);
assert.equal(state.status, 'CURVE_REVOKE_REQUIRED');
state = transitionPonsE3BRuntimeState(
  statePath,
  state,
  'CURVE_REVOKE_SIGNED',
  {
    latestTransactionHash: TX_HASH,
    curveRevokeTransactionHash: TX_HASH
  }
);
assert.equal(state.status, 'CURVE_REVOKE_SIGNED');
assert.throws(
  () => transitionPonsE3BRuntimeState(statePath, state, 'V4_HANDOFF_READY'),
  /PONS_E3B_STATE_TRANSITION_INVALID/
);
state = transitionPonsE3BRuntimeState(
  statePath,
  state,
  'CURVE_REVOKE_SUBMITTED',
  { latestTransactionHash: TX_HASH }
);
state = transitionPonsE3BRuntimeState(
  statePath,
  state,
  'CURVE_REVOKE_INCLUDED',
  { latestTransactionHash: TX_HASH }
);
assert.throws(
  () => transitionPonsE3BRuntimeState(statePath, state, 'V4_HANDOFF_READY'),
  /PONS_E3B_STATE_TRANSITION_INVALID/
);

console.log(JSON.stringify({
  verdict: 'PONS_E3B_RUNTIME_FAILOVER_OFFLINE_PASS',
  activeCurveReturnsToE0: true,
  graduationPendingFailsClosed: true,
  staleCurveAllowanceProducesZeroApprovalOnly: true,
  cleanupRequiresFreshReverification: true,
  v4HandoffRequiresExactCurveIdentity: true,
  v4HandoffRequiresSharedBlockHash: true,
  stateReservationIsExclusive: true,
  signedCleanupCannotSkipSubmissionAndInclusion: true,
  includedCleanupRequiresNewProofCycle: true,
  autoRetryAllowed: false,
  liveMoneyAuthority: false,
  signingAuthority: false,
  broadcastAuthority: false
}, null, 2));
