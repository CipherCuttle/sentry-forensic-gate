import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256 } from 'viem';

import { PONS_V2_MEME_HOOK } from '../dist/adapters/robinhood/ponsV2/forwardOutcomeAuthority.js';
import { buildPonsE1V4RecoveryPlan } from '../dist/canary/ponsE1V4ExitRecovery.js';
import {
  PONS_E2_SIGNED_V4_RECOVERY_V1,
  assertPonsE2RecoveryIntentCalldata,
  buildPonsE2RecoveryIntents
} from '../dist/canary/ponsE2V4RecoveryIntent.js';
import {
  assertPonsE2StateMayStart,
  readPonsE2RecoveryState,
  reservePonsE2RecoveryState,
  transitionPonsE2RecoveryState
} from '../dist/canary/ponsE2RecoveryState.js';
import {
  assertSignedPonsE2Transaction,
  hasActivePonsE2Permit2Allowance
} from '../dist/canary/viemPonsE2V4RecoveryExecutor.js';

const PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000001';
const account = privateKeyToAccount(PRIVATE_KEY);
const TOKEN = '0x1111111111111111111111111111111111111111';
const POOL_ID =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const plan = buildPonsE1V4RecoveryPlan({
  token: TOKEN,
  owner: account.address,
  poolKey: {
    currency0: '0x0000000000000000000000000000000000000000',
    currency1: TOKEN,
    fee: 0,
    tickSpacing: 200,
    hooks: PONS_V2_MEME_HOOK
  },
  tokenAmount: 123_456_789_000_000_000_000n,
  quotedNativeOut: 4_000_000_000_000_000n,
  slippageBps: 500,
  deadline: 2_000_000_000n,
  permit2Expiration: 2_000_000_300n
});

const intents = buildPonsE2RecoveryIntents({
  plan,
  poolId: POOL_ID
});

assert.equal(intents.tokenApproval.version, PONS_E2_SIGNED_V4_RECOVERY_V1);
assert.equal(intents.tokenApproval.amount, plan.tokenAmount);
assert.equal(intents.permit2Approval.amount, plan.tokenAmount);
assert.equal(intents.exit.tokenAmount, plan.tokenAmount);
assert.equal(intents.exit.minNativeOut, plan.minNativeOut);
assert.equal(intents.permit2Revoke.value, 0n);
assert.equal(intents.tokenRevoke.value, 0n);
assert.equal(hasActivePonsE2Permit2Allowance(1n), true);
assert.equal(hasActivePonsE2Permit2Allowance(0n), false);

for (const intent of Object.values(intents)) {
  assertPonsE2RecoveryIntentCalldata(intent);
}

const gas = 500_000n;
const maxFeePerGas = 1_000_000_000n;
const maxPriorityFeePerGas = 0n;
const serializedTransaction = await account.signTransaction({
  chainId: 4663,
  type: 'eip1559',
  nonce: 0,
  gas,
  maxFeePerGas,
  maxPriorityFeePerGas,
  to: intents.exit.target,
  value: 0n,
  data: intents.exit.calldata
});
const transactionHash = keccak256(serializedTransaction);

await assertSignedPonsE2Transaction(
  intents.exit,
  {
    kind: intents.exit.kind,
    nonce: 0,
    transactionHash,
    serializedTransaction,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas
  },
  account.address,
  {
    maxGas: 1_500_000n,
    maxFeePerGas: 20_000_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n
  }
);

await assert.rejects(
  () => assertSignedPonsE2Transaction(
    intents.exit,
    {
      kind: intents.exit.kind,
      nonce: 0,
      transactionHash,
      serializedTransaction,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas: 1n
    },
    account.address,
    {
      maxGas: 1_500_000n,
      maxFeePerGas: 20_000_000_000n,
      maxPriorityFeePerGas: 2_000_000_000n
    }
  ),
  /PONS_E2_SIGNED_PRIORITY_FEE_MISMATCH/
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pons-e2-state-'));
const statePath = path.join(dir, 'state.json');
let state = reservePonsE2RecoveryState(statePath, {
  token: TOKEN,
  wallet: account.address,
  poolId: POOL_ID,
  tokenAmount: plan.tokenAmount.toString(),
  minNativeOut: plan.minNativeOut.toString(),
  deadline: plan.deadline.toString(),
  permit2Expiration: plan.permit2Expiration.toString()
});
assert.equal(state.status, 'ARMED');
assert.throws(
  () => reservePonsE2RecoveryState(statePath, {
    token: TOKEN,
    wallet: account.address,
    poolId: POOL_ID,
    tokenAmount: plan.tokenAmount.toString(),
    minNativeOut: plan.minNativeOut.toString(),
    deadline: plan.deadline.toString(),
    permit2Expiration: plan.permit2Expiration.toString()
  }),
  /PONS_E2_STATE_RESERVATION_EXISTS/
);
assert.throws(
  () => transitionPonsE2RecoveryState(statePath, state, 'EXIT_SIGNED'),
  /PONS_E2_STATE_TRANSITION_INVALID/
);

const h1 =
  '0x1111111111111111111111111111111111111111111111111111111111111111';
const h2 =
  '0x2222222222222222222222222222222222222222222222222222222222222222';
const h3 =
  '0x3333333333333333333333333333333333333333333333333333333333333333';

state = transitionPonsE2RecoveryState(
  statePath,
  state,
  'TOKEN_APPROVAL_SIGNED',
  { latestTransactionHash: h1, tokenApprovalTransactionHash: h1 }
);
state = transitionPonsE2RecoveryState(
  statePath,
  state,
  'TOKEN_APPROVAL_SUBMITTED'
);
state = transitionPonsE2RecoveryState(
  statePath,
  state,
  'TOKEN_APPROVAL_INCLUDED'
);
state = transitionPonsE2RecoveryState(
  statePath,
  state,
  'PERMIT2_APPROVAL_SIGNED',
  { latestTransactionHash: h2, permit2ApprovalTransactionHash: h2 }
);
state = transitionPonsE2RecoveryState(
  statePath,
  state,
  'PERMIT2_APPROVAL_SUBMITTED'
);
state = transitionPonsE2RecoveryState(
  statePath,
  state,
  'PERMIT2_APPROVAL_INCLUDED'
);
state = transitionPonsE2RecoveryState(
  statePath,
  state,
  'EXIT_SIGNED',
  { latestTransactionHash: h3, exitTransactionHash: h3 }
);
state = transitionPonsE2RecoveryState(statePath, state, 'EXIT_SUBMITTED');
state = transitionPonsE2RecoveryState(statePath, state, 'EXIT_INCLUDED');
state = transitionPonsE2RecoveryState(statePath, state, 'COMPLETED');

assert.equal(readPonsE2RecoveryState(statePath)?.status, 'COMPLETED');
assert.throws(
  () => assertPonsE2StateMayStart(state),
  /PONS_E2_TERMINAL_STATE_USE_NEW_STATE_PATH:COMPLETED/
);

const statePath2 = path.join(dir, 'nonterminal.json');
const nonterminal = reservePonsE2RecoveryState(statePath2, {
  token: TOKEN,
  wallet: account.address,
  poolId: POOL_ID,
  tokenAmount: plan.tokenAmount.toString(),
  minNativeOut: plan.minNativeOut.toString(),
  deadline: plan.deadline.toString(),
  permit2Expiration: plan.permit2Expiration.toString()
});
assert.throws(
  () => assertPonsE2StateMayStart(nonterminal),
  /PONS_E2_NONTERMINAL_STATE_REQUIRES_MANUAL_RECONCILIATION/
);
assert.throws(
  () => transitionPonsE2RecoveryState(
    statePath2,
    nonterminal,
    'TOKEN_APPROVAL_SIGNED',
    { tokenAmount: '1' }
  ),
  /PONS_E2_STATE_IMMUTABLE_FIELD_DRIFT/
);


const statePath3 = path.join(dir, 'abort-clean.json');
let abortState = reservePonsE2RecoveryState(statePath3, {
  token: TOKEN,
  wallet: account.address,
  poolId: POOL_ID,
  tokenAmount: plan.tokenAmount.toString(),
  minNativeOut: plan.minNativeOut.toString(),
  deadline: plan.deadline.toString(),
  permit2Expiration: plan.permit2Expiration.toString()
});
abortState = transitionPonsE2RecoveryState(
  statePath3,
  abortState,
  'TOKEN_APPROVAL_SIGNED',
  { latestTransactionHash: h1, tokenApprovalTransactionHash: h1 }
);
abortState = transitionPonsE2RecoveryState(
  statePath3,
  abortState,
  'TOKEN_APPROVAL_SUBMITTED'
);
abortState = transitionPonsE2RecoveryState(
  statePath3,
  abortState,
  'TOKEN_APPROVAL_INCLUDED'
);
abortState = transitionPonsE2RecoveryState(
  statePath3,
  abortState,
  'TOKEN_REVOKE_SIGNED',
  { latestTransactionHash: h2, tokenRevokeTransactionHash: h2 }
);
abortState = transitionPonsE2RecoveryState(
  statePath3,
  abortState,
  'TOKEN_REVOKE_SUBMITTED'
);
abortState = transitionPonsE2RecoveryState(
  statePath3,
  abortState,
  'TOKEN_REVOKE_INCLUDED'
);
abortState = transitionPonsE2RecoveryState(
  statePath3,
  abortState,
  'ABORTED_CLEAN'
);
assert.equal(abortState.status, 'ABORTED_CLEAN');
assert.throws(
  () => assertPonsE2StateMayStart(abortState),
  /PONS_E2_TERMINAL_STATE_USE_NEW_STATE_PATH:ABORTED_CLEAN/
);

console.log(JSON.stringify({
  verdict: 'PONS_E2_V4_RECOVERY_OFFLINE_PASS',
  exactTokenApproval: true,
  exactPermit2Allowance: true,
  exactFullBalanceExit: true,
  signedTransactionIdentityFence: true,
  zeroPriorityFeeNormalization: true,
  crashSafeAtomicReservation: true,
  nonterminalRestartFailsClosed: true,
  safePreExitAbortCleanupState: true,
  immutablePlanFields: true,
  cleanupIntentsPresent: true,
  permit2AmountZeroMeansRevoked: true,
  broadcastPerformed: false,
  liveMoneyAuthority: false
}, null, 2));
