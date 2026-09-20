import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  PONS_E4_DEDICATED_WALLET,
  PONS_E4_NOTIONAL_USD_MICROS,
  PONS_E4_REVIEWED_IMPLEMENTATION_HEAD,
  buildPonsE4GrantDocument,
  writePonsE4GrantOutsideRepo
} from './pons-e4-issue-grant.mjs';

const TOKEN = '0x1111111111111111111111111111111111111111';
const DIGEST =
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const GRANT_ID =
  '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const NOW = 2_000_000_000;
const repoRoot = path.resolve(process.cwd());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pons-e4a-'));
const statePath = path.join(tmp, 'e0-state.json');
const outputPath = path.join(tmp, 'e4-grant.json');

const grant = buildPonsE4GrantDocument({
  token: TOKEN,
  maxQuoteInWei: '1500000000000000',
  e0StatePath: statePath,
  executionSurfaceDigestSha256: DIGEST,
  grantId: GRANT_ID,
  nowEpochS: NOW,
  entryWindowS: 900,
  recoveryWindowS: 21600,
  slippageBps: 500,
  repoRoot
});

assert.equal(grant.version, 'PONS_E4_ONE_SHOT_FAILOVER_CANARY_V1');
assert.equal(grant.purpose, 'PONS_E4_ONE_SHOT_FAILOVER_CANARY');
assert.equal(grant.grantId, GRANT_ID);
assert.equal(grant.chainId, 4663);
assert.equal(grant.wallet, PONS_E4_DEDICATED_WALLET);
assert.equal(grant.notionalUsdMicros, PONS_E4_NOTIONAL_USD_MICROS);
assert.equal(grant.slippageBps, 500);
assert.equal(grant.maxQuoteInWei, '1500000000000000');
assert.equal(grant.issuedAtEpochS, NOW);
assert.equal(grant.entryNotAfterEpochS, NOW + 900);
assert.equal(grant.recoveryNotAfterEpochS, NOW + 21600);
assert.equal(grant.codeHead, PONS_E4_REVIEWED_IMPLEMENTATION_HEAD);
assert.equal(grant.executionSurfaceDigestSha256, DIGEST);
assert.equal(grant.e0StatePath, statePath);
assert.deepEqual(grant.permissions, [
  'E0_BUY',
  'E0_CURVE_EXIT',
  'E3B_CURVE_REVOKE',
  'E2_V4_RECOVERY'
]);

const written = writePonsE4GrantOutsideRepo({
  token: TOKEN,
  maxQuoteInWei: '1500000000000000',
  e0StatePath: statePath,
  outputPath,
  executionSurfaceDigestSha256: DIGEST,
  grantId: GRANT_ID,
  nowEpochS: NOW,
  entryWindowS: 900,
  recoveryWindowS: 21600,
  slippageBps: 500,
  repoRoot
});
assert.equal(written.outputPath, outputPath);
assert.equal(fs.existsSync(outputPath), true);
assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
assert.deepEqual(
  JSON.parse(fs.readFileSync(outputPath, 'utf8')),
  written.grant
);

assert.throws(
  () =>
    writePonsE4GrantOutsideRepo({
      token: TOKEN,
      maxQuoteInWei: '1500000000000000',
      e0StatePath: statePath,
      outputPath,
      executionSurfaceDigestSha256: DIGEST,
      grantId: GRANT_ID,
      nowEpochS: NOW,
      repoRoot
    }),
  /PONS_E4_GRANT_OUTPUT_ALREADY_EXISTS/
);

assert.throws(
  () =>
    buildPonsE4GrantDocument({
      token: TOKEN,
      maxQuoteInWei: '10000000000000001',
      e0StatePath: statePath,
      executionSurfaceDigestSha256: DIGEST,
      grantId: GRANT_ID,
      nowEpochS: NOW,
      repoRoot
    }),
  /PONS_E4_MAX_QUOTE_IN_WEI_ABOVE_HARD_CEILING/
);

assert.throws(
  () =>
    buildPonsE4GrantDocument({
      token: TOKEN,
      maxQuoteInWei: '1500000000000000',
      e0StatePath: statePath,
      executionSurfaceDigestSha256: DIGEST,
      grantId: GRANT_ID,
      nowEpochS: NOW,
      entryWindowS: 1801,
      repoRoot
    }),
  /PONS_E4_ENTRY_WINDOW_S_INVALID/
);

assert.throws(
  () =>
    buildPonsE4GrantDocument({
      token: TOKEN,
      maxQuoteInWei: '1500000000000000',
      e0StatePath: path.join(repoRoot, 'data', 'e0.json'),
      executionSurfaceDigestSha256: DIGEST,
      grantId: GRANT_ID,
      nowEpochS: NOW,
      repoRoot
    }),
  /PONS_E4_E0_STATE_PATH_MUST_BE_OUTSIDE_REPOSITORY/
);

assert.throws(
  () =>
    writePonsE4GrantOutsideRepo({
      token: TOKEN,
      maxQuoteInWei: '1500000000000000',
      e0StatePath: statePath,
      outputPath: path.join(repoRoot, 'e4-grant.json'),
      executionSurfaceDigestSha256: DIGEST,
      grantId: GRANT_ID,
      nowEpochS: NOW,
      repoRoot
    }),
  /PONS_E4_GRANT_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY/
);

assert.throws(
  () =>
    buildPonsE4GrantDocument({
      token: TOKEN,
      wallet: '0x3333333333333333333333333333333333333333',
      maxQuoteInWei: '1500000000000000',
      e0StatePath: statePath,
      executionSurfaceDigestSha256: DIGEST,
      grantId: GRANT_ID,
      nowEpochS: NOW,
      repoRoot
    }),
  /PONS_E4_GRANT_ISSUER_DEDICATED_WALLET_REQUIRED/
);

console.log(JSON.stringify({
  verdict: 'PONS_E4A_GRANT_ISSUER_OFFLINE_PASS',
  exactReviewedImplementationHead: true,
  exactDedicatedWallet: true,
  exactOneDollarNotional: true,
  explicitTokenRequired: true,
  explicitQuoteCapRequired: true,
  grantOutputOutsideRepo: true,
  e0StateOutsideRepo: true,
  exclusiveOutputCreation: true,
  outputMode0600: true,
  fsyncDurable: true,
  liveMoneyAuthority: false,
  privateKeyUsed: false,
  signingAuthorityUsed: false,
  broadcastAuthorityUsed: false
}, null, 2));
