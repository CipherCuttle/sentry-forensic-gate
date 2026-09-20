import assert from 'node:assert/strict';

import { PONS_V2_MEME_HOOK } from '../dist/adapters/robinhood/ponsV2/forwardOutcomeAuthority.js';
import { buildPonsE1V4RecoveryPlan } from '../dist/canary/ponsE1V4ExitRecovery.js';
import {
  PONS_E3_E0_TO_E2_FAILOVER_V1,
  decidePonsE3PostBuyExit
} from '../dist/canary/ponsE3Failover.js';

const TOKEN = '0x1111111111111111111111111111111111111111';
const OWNER = '0x2222222222222222222222222222222222222222';
const CURVE = '0x3333333333333333333333333333333333333333';
const POOL_ID =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
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

const cleanV4Proof = {
  verdict: 'PONS_E1_V4_EXIT_RECOVERY_DRY_READY',
  token: TOKEN,
  owner: OWNER,
  tokenBalance: TOKEN_AMOUNT,
  poolId: POOL_ID,
  currentTokenAllowanceToPermit2: 0n,
  currentPermit2AllowanceToRouter: 0n,
  plan
};

const curve = decidePonsE3PostBuyExit({
  token: TOKEN,
  owner: OWNER,
  postBuyTokenBalance: TOKEN_AMOUNT,
  curveExit: {
    status: 'EXECUTABLE',
    curve: CURVE,
    tokensIn: TOKEN_AMOUNT,
    quotedNativeOut: 1_000_000n,
    minNativeOut: 950_000n
  },
  v4Recovery: cleanV4Proof
});
assert.equal(curve.version, PONS_E3_E0_TO_E2_FAILOVER_V1);
assert.equal(curve.route, 'CURVE_EXIT');
assert.equal(curve.tokenAmount, TOKEN_AMOUNT);

const v4 = decidePonsE3PostBuyExit({
  token: TOKEN,
  owner: OWNER,
  postBuyTokenBalance: TOKEN_AMOUNT,
  curveExit: {
    status: 'CURVE_INACTIVE',
    reason: 'graduated after BUY'
  },
  v4Recovery: cleanV4Proof
});
assert.equal(v4.route, 'V4_RECOVERY');
assert.equal(v4.tokenAmount, TOKEN_AMOUNT);
assert.equal(v4.intents.tokenApproval.amount, TOKEN_AMOUNT);
assert.equal(v4.intents.permit2Approval.amount, TOKEN_AMOUNT);
assert.equal(v4.intents.exit.tokenAmount, TOKEN_AMOUNT);

const missingProof = decidePonsE3PostBuyExit({
  token: TOKEN,
  owner: OWNER,
  postBuyTokenBalance: TOKEN_AMOUNT,
  curveExit: {
    status: 'NOT_EXECUTABLE',
    reason: 'reverse quote unavailable'
  }
});
assert.equal(missingProof.route, 'STOP');
assert.equal(missingProof.reason, 'PONS_E3_V4_RECOVERY_PROOF_MISSING');

const arbitraryError = decidePonsE3PostBuyExit({
  token: TOKEN,
  owner: OWNER,
  postBuyTokenBalance: TOKEN_AMOUNT,
  curveExit: {
    status: 'ERROR',
    reason: 'rpc timeout'
  },
  v4Recovery: cleanV4Proof
});
assert.equal(arbitraryError.route, 'STOP');
assert.match(arbitraryError.reason, /PONS_E3_CURVE_EXIT_ERROR_FAIL_CLOSED/);

const balanceDrift = decidePonsE3PostBuyExit({
  token: TOKEN,
  owner: OWNER,
  postBuyTokenBalance: TOKEN_AMOUNT + 1n,
  curveExit: {
    status: 'CURVE_INACTIVE',
    reason: 'graduated'
  },
  v4Recovery: cleanV4Proof
});
assert.equal(balanceDrift.route, 'STOP');
assert.equal(balanceDrift.reason, 'PONS_E3_V4_RECOVERY_BALANCE_DRIFT');

const dirtyAuthority = decidePonsE3PostBuyExit({
  token: TOKEN,
  owner: OWNER,
  postBuyTokenBalance: TOKEN_AMOUNT,
  curveExit: {
    status: 'CURVE_INACTIVE',
    reason: 'graduated'
  },
  v4Recovery: {
    ...cleanV4Proof,
    currentPermit2AllowanceToRouter: 1n
  }
});
assert.equal(dirtyAuthority.route, 'STOP');
assert.equal(
  dirtyAuthority.reason,
  'PONS_E3_V4_RECOVERY_DIRTY_PREEXISTING_AUTHORITY'
);

const partialCurve = decidePonsE3PostBuyExit({
  token: TOKEN,
  owner: OWNER,
  postBuyTokenBalance: TOKEN_AMOUNT,
  curveExit: {
    status: 'EXECUTABLE',
    curve: CURVE,
    tokensIn: TOKEN_AMOUNT - 1n,
    quotedNativeOut: 1_000_000n,
    minNativeOut: 950_000n
  }
});
assert.equal(partialCurve.route, 'STOP');
assert.equal(partialCurve.reason, 'PONS_E3_CURVE_EXIT_NOT_FULL_BALANCE');

const zeroBalance = decidePonsE3PostBuyExit({
  token: TOKEN,
  owner: OWNER,
  postBuyTokenBalance: 0n,
  curveExit: {
    status: 'CURVE_INACTIVE',
    reason: 'graduated'
  },
  v4Recovery: cleanV4Proof
});
assert.equal(zeroBalance.route, 'STOP');
assert.equal(zeroBalance.reason, 'PONS_E3_POST_BUY_TOKEN_BALANCE_NOT_POSITIVE');

console.log(JSON.stringify({
  verdict: 'PONS_E3_FAILOVER_OFFLINE_PASS',
  curveExitPreferredWhenExecutable: true,
  v4RequiresExactE1Proof: true,
  v4RequiresExactPostBuyBalance: true,
  v4RequiresCleanRecoveryAuthority: true,
  arbitraryCurveErrorsFailClosed: true,
  partialCurveExitForbidden: true,
  liveMoneyAuthority: false,
  signingAuthority: false,
  broadcastAuthority: false
}, null, 2));
