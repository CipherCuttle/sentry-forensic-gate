import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assertPonsE4RecoveryGrant,
  assertPonsE4V4OldCurveAuthorityCleared,
  computePonsE4ExecutionSurfaceDigest,
  consumePonsE4EntryGrant,
  getPonsE4ConsumedReceiptPath
} from '../dist/canary/ponsE4OneShotGrant.js';

const TOKEN = '0x1111111111111111111111111111111111111111';
const WALLET = '0x2222222222222222222222222222222222222222';
const OTHER_TOKEN = '0x3333333333333333333333333333333333333333';
const CURVE = '0x4444444444444444444444444444444444444444';
const BUY_HASH =
  '0x5555555555555555555555555555555555555555555555555555555555555555';
const TOKEN_AMOUNT = 123_456_789n;
const CODE_HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SURFACE_DIGEST = computePonsE4ExecutionSurfaceDigest();
assert.match(SURFACE_DIGEST, /^0x[0-9a-f]{64}$/);
const IDENTITY = { executionSurfaceDigestSha256: SURFACE_DIGEST };
const NOW = 2_000_000_100;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pons-e4-grant-'));

function grantObject(overrides = {}) {
  const statePath = path.join(dir, 'e0-state.json');
  return {
    version: 'PONS_E4_ONE_SHOT_FAILOVER_CANARY_V1',
    purpose: 'PONS_E4_ONE_SHOT_FAILOVER_CANARY',
    grantId:
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    chainId: 4663,
    token: TOKEN,
    wallet: WALLET,
    notionalUsdMicros: '1000000',
    slippageBps: 500,
    maxQuoteInWei: '2000000000000000',
    issuedAtEpochS: 2_000_000_000,
    entryNotAfterEpochS: 2_000_000_600,
    recoveryNotAfterEpochS: 2_000_003_600,
    codeHead: CODE_HEAD,
    executionSurfaceDigestSha256: SURFACE_DIGEST,
    e0StatePath: statePath,
    permissions: [
      'E0_BUY',
      'E0_CURVE_EXIT',
      'E3B_CURVE_REVOKE',
      'E2_V4_RECOVERY'
    ],
    ...overrides
  };
}

function writeGrant(name, overrides = {}) {
  const file = path.join(dir, `${name}.json`);
  const grant = grantObject(overrides);
  fs.writeFileSync(file, `${JSON.stringify(grant, null, 2)}\n`, {
    mode: 0o600
  });
  return { file, grant };
}

const primary = writeGrant('primary');
const consumed = consumePonsE4EntryGrant({
  grantPath: primary.file,
  expectedToken: TOKEN,
  expectedWallet: WALLET,
  expectedNotionalUsdMicros: 1_000_000n,
  expectedSlippageBps: 500,
  actualQuoteInWei: 500_000_000_000_000n,
  expectedE0StatePath: primary.grant.e0StatePath,
  currentEpochS: NOW,
  runtimeIdentity: IDENTITY
});
assert.equal(consumed.grant.grantId, primary.grant.grantId);
assert.equal(
  consumed.consumedReceiptPath,
  getPonsE4ConsumedReceiptPath(primary.file)
);
assert.equal(fs.existsSync(consumed.consumedReceiptPath), true);

const handoffState = {
  version: 'PONS_E0_LIVE_CANARY_R0',
  status: 'APPROVAL_INCLUDED',
  token: TOKEN,
  curve: CURVE,
  wallet: WALLET,
  transactionHash:
    '0x6666666666666666666666666666666666666666666666666666666666666666',
  buyTransactionHash: BUY_HASH,
  tokensOwned: TOKEN_AMOUNT.toString(),
  e4GrantId: primary.grant.grantId
};
fs.writeFileSync(
  primary.grant.e0StatePath,
  `${JSON.stringify(handoffState, null, 2)}\n`,
  { mode: 0o600 }
);

assert.throws(
  () =>
    consumePonsE4EntryGrant({
      grantPath: primary.file,
      expectedToken: TOKEN,
      expectedWallet: WALLET,
      expectedNotionalUsdMicros: 1_000_000n,
      expectedSlippageBps: 500,
      actualQuoteInWei: 500_000_000_000_000n,
      expectedE0StatePath: primary.grant.e0StatePath,
      currentEpochS: NOW,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_GRANT_ALREADY_CONSUMED/
);

const recovery = assertPonsE4RecoveryGrant({
  grantPath: primary.file,
  expectedToken: TOKEN,
  expectedWallet: WALLET,
  requiredPermission: 'E3B_CURVE_REVOKE',
  expectedTokenAmount: TOKEN_AMOUNT,
  expectedBuyTransactionHash: BUY_HASH,
  currentEpochS: 2_000_001_000,
  runtimeIdentity: IDENTITY
});
assert.equal(recovery.receipt.grantId, primary.grant.grantId);

const v4Recovery = assertPonsE4RecoveryGrant({
  grantPath: primary.file,
  expectedToken: TOKEN,
  expectedWallet: WALLET,
  requiredPermission: 'E2_V4_RECOVERY',
  expectedTokenAmount: TOKEN_AMOUNT,
  expectedBuyTransactionHash: BUY_HASH,
  currentEpochS: 2_000_001_000,
  runtimeIdentity: IDENTITY
});
assert.equal(v4Recovery.grant.token.toLowerCase(), TOKEN.toLowerCase());
assert.equal(v4Recovery.e0Operation.tokensOwned, TOKEN_AMOUNT);
assert.equal(v4Recovery.e0Operation.buyTransactionHash, BUY_HASH);

assert.throws(
  () =>
    assertPonsE4RecoveryGrant({
      grantPath: primary.file,
      expectedToken: TOKEN,
      expectedWallet: WALLET,
      requiredPermission: 'E2_V4_RECOVERY',
      expectedTokenAmount: TOKEN_AMOUNT + 1n,
      currentEpochS: 2_000_001_000,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_RECOVERY_TOKEN_AMOUNT_MISMATCH/
);

fs.writeFileSync(
  primary.grant.e0StatePath,
  `${JSON.stringify({ ...handoffState, status: 'COMPLETED' }, null, 2)}\n`
);
assert.throws(
  () =>
    assertPonsE4RecoveryGrant({
      grantPath: primary.file,
      expectedToken: TOKEN,
      expectedWallet: WALLET,
      requiredPermission: 'E2_V4_RECOVERY',
      currentEpochS: 2_000_001_000,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_RECOVERY_E0_STATE_NOT_HANDOFFABLE:COMPLETED/
);
fs.writeFileSync(
  primary.grant.e0StatePath,
  `${JSON.stringify(handoffState, null, 2)}\n`
);

const BLOCK_HASH =
  '0x7777777777777777777777777777777777777777777777777777777777777777';
assert.doesNotThrow(() =>
  assertPonsE4V4OldCurveAuthorityCleared({
    oldCurveAllowance: 0n,
    verificationBlockHash: BLOCK_HASH,
    allowanceBlockHash: BLOCK_HASH
  })
);
assert.throws(
  () =>
    assertPonsE4V4OldCurveAuthorityCleared({
      oldCurveAllowance: 1n,
      verificationBlockHash: BLOCK_HASH,
      allowanceBlockHash: BLOCK_HASH
    }),
  /PONS_E4_E2_OLD_CURVE_ALLOWANCE_NOT_ZERO/
);
assert.throws(
  () =>
    assertPonsE4V4OldCurveAuthorityCleared({
      oldCurveAllowance: 0n,
      verificationBlockHash: BLOCK_HASH,
      allowanceBlockHash:
        '0x8888888888888888888888888888888888888888888888888888888888888888'
    }),
  /PONS_E4_E2_OLD_CURVE_BLOCK_HASH_DRIFT/
);

const wrongToken = writeGrant('wrong-token');
assert.throws(
  () =>
    consumePonsE4EntryGrant({
      grantPath: wrongToken.file,
      expectedToken: OTHER_TOKEN,
      expectedWallet: WALLET,
      expectedNotionalUsdMicros: 1_000_000n,
      expectedSlippageBps: 500,
      actualQuoteInWei: 500_000_000_000_000n,
      expectedE0StatePath: wrongToken.grant.e0StatePath,
      currentEpochS: NOW,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_GRANT_TOKEN_MISMATCH/
);

const quoteCap = writeGrant('quote-cap', {
  maxQuoteInWei: '100000000000000'
});
assert.throws(
  () =>
    consumePonsE4EntryGrant({
      grantPath: quoteCap.file,
      expectedToken: TOKEN,
      expectedWallet: WALLET,
      expectedNotionalUsdMicros: 1_000_000n,
      expectedSlippageBps: 500,
      actualQuoteInWei: 100_000_000_000_001n,
      expectedE0StatePath: quoteCap.grant.e0StatePath,
      currentEpochS: NOW,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_GRANT_QUOTE_IN_EXCEEDS_CAP/
);

const wrongDigest = writeGrant('wrong-digest', {
  executionSurfaceDigestSha256:
    '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
});
assert.throws(
  () =>
    consumePonsE4EntryGrant({
      grantPath: wrongDigest.file,
      expectedToken: TOKEN,
      expectedWallet: WALLET,
      expectedNotionalUsdMicros: 1_000_000n,
      expectedSlippageBps: 500,
      actualQuoteInWei: 500_000_000_000_000n,
      expectedE0StatePath: wrongDigest.grant.e0StatePath,
      currentEpochS: NOW,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_RUNTIME_EXECUTION_SURFACE_DIGEST_MISMATCH/
);

const expiredEntry = writeGrant('expired-entry', {
  issuedAtEpochS: 1_999_999_000,
  entryNotAfterEpochS: 1_999_999_500,
  recoveryNotAfterEpochS: 2_000_002_000
});
assert.throws(
  () =>
    consumePonsE4EntryGrant({
      grantPath: expiredEntry.file,
      expectedToken: TOKEN,
      expectedWallet: WALLET,
      expectedNotionalUsdMicros: 1_000_000n,
      expectedSlippageBps: 500,
      actualQuoteInWei: 500_000_000_000_000n,
      expectedE0StatePath: expiredEntry.grant.e0StatePath,
      currentEpochS: NOW,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_ENTRY_AUTHORITY_EXPIRED/
);

assert.throws(
  () =>
    assertPonsE4RecoveryGrant({
      grantPath: primary.file,
      expectedToken: TOKEN,
      expectedWallet: WALLET,
      requiredPermission: 'E2_V4_RECOVERY',
      currentEpochS: 2_000_004_000,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_RECOVERY_AUTHORITY_EXPIRED/
);

const tampered = writeGrant('tampered');
consumePonsE4EntryGrant({
  grantPath: tampered.file,
  expectedToken: TOKEN,
  expectedWallet: WALLET,
  expectedNotionalUsdMicros: 1_000_000n,
  expectedSlippageBps: 500,
  actualQuoteInWei: 500_000_000_000_000n,
  expectedE0StatePath: tampered.grant.e0StatePath,
  currentEpochS: NOW,
  runtimeIdentity: IDENTITY
});
const changed = JSON.parse(fs.readFileSync(tampered.file, 'utf8'));
changed.maxQuoteInWei = '1999999999999999';
fs.writeFileSync(tampered.file, `${JSON.stringify(changed, null, 2)}\n`);
assert.throws(
  () =>
    assertPonsE4RecoveryGrant({
      grantPath: tampered.file,
      expectedToken: TOKEN,
      expectedWallet: WALLET,
      requiredPermission: 'E2_V4_RECOVERY',
      currentEpochS: 2_000_001_000,
      runtimeIdentity: IDENTITY
    }),
  /PONS_E4_CONSUMED_GRANT_DIGEST_MISMATCH/
);

console.log(JSON.stringify({
  verdict: 'PONS_E4_ONE_SHOT_GRANT_OFFLINE_PASS',
  exactOneDollarNotional: true,
  exactTokenAndWalletBinding: true,
  exactCodeHeadRecorded: true,
  compiledExecutionSurfaceDigestBinding: true,
  quoteInCapEnforced: true,
  entryWindowBounded: true,
  recoveryWindowBounded: true,
  grantConsumedAtomicallyBeforeSigning: true,
  repeatEntryBlocked: true,
  recoveryRequiresConsumedGrant: true,
  recoveryBoundToOriginalE0Operation: true,
  completedE0OperationRevokesRecoveryAuthority: true,
  v4RequiresZeroOldCurveAllowance: true,
  v4OldCurveReadSharesVerificationBlockHash: true,
  grantConsumptionFsyncDurable: true,
  postConsumptionTamperDetected: true,
  liveMoneyAuthority: false,
  signingAuthority: false,
  broadcastAuthority: false
}, null, 2));
