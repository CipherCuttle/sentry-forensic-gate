import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  assertCanaryE0LiveAuthorization,
  CANARY_E0_LIVE_AUTHORIZATION_R0
} from '../dist/canary/liveAuthorization.js';
import { CANARY_PRIMARY_NOTIONAL_USD_MICROS } from '../dist/canary/swapIntent.js';

const FULL_STACK = {
  live: true,
  entryApprovalEnabled: true,
  entryApprovalRevokeEnabled: true,
  roundTripEnabled: true
};

// Dry mode never grants live authority and remains compatible with partial qualification surfaces.
for (const flags of [
  { entryApprovalEnabled: false, entryApprovalRevokeEnabled: false, roundTripEnabled: false },
  { entryApprovalEnabled: true, entryApprovalRevokeEnabled: false, roundTripEnabled: false },
  { entryApprovalEnabled: true, entryApprovalRevokeEnabled: true, roundTripEnabled: false },
  { entryApprovalEnabled: false, entryApprovalRevokeEnabled: false, roundTripEnabled: true }
]) {
  assert.doesNotThrow(() => assertCanaryE0LiveAuthorization({
    live: false,
    ...flags,
    authorization: undefined,
    maxNotionalUsdMicros: undefined
  }));
}

// Existing BUY-only live behavior is outside this child-stack authorization gate and is unchanged.
assert.doesNotThrow(() => assertCanaryE0LiveAuthorization({
  live: true,
  entryApprovalEnabled: false,
  entryApprovalRevokeEnabled: false,
  roundTripEnabled: false,
  authorization: undefined,
  maxNotionalUsdMicros: undefined
}));

// Any live child surface requires the whole cleanup/round-trip stack; partial authority fails closed.
for (const flags of [
  { entryApprovalEnabled: true, entryApprovalRevokeEnabled: false, roundTripEnabled: false },
  { entryApprovalEnabled: true, entryApprovalRevokeEnabled: true, roundTripEnabled: false },
  { entryApprovalEnabled: false, entryApprovalRevokeEnabled: false, roundTripEnabled: true },
  { entryApprovalEnabled: true, entryApprovalRevokeEnabled: false, roundTripEnabled: true }
]) {
  assert.throws(() => assertCanaryE0LiveAuthorization({
    live: true,
    ...flags,
    authorization: CANARY_E0_LIVE_AUTHORIZATION_R0,
    maxNotionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS.toString()
  }), /CANARY_E0_LIVE_AUTHORIZATION_STACK_INCOMPLETE/);
}

assert.throws(() => assertCanaryE0LiveAuthorization({
  ...FULL_STACK,
  authorization: undefined,
  maxNotionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS.toString()
}), /CANARY_E0_LIVE_AUTHORIZATION_REQUIRED/);

assert.throws(() => assertCanaryE0LiveAuthorization({
  ...FULL_STACK,
  authorization: 'CANARY_E0_LIVE_AUTHORIZATION_R999',
  maxNotionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS.toString()
}), /CANARY_E0_LIVE_AUTHORIZATION_REQUIRED/);

for (const maxNotionalUsdMicros of [undefined, '', 'nope', '0', '999999', '1000001']) {
  assert.throws(() => assertCanaryE0LiveAuthorization({
    ...FULL_STACK,
    authorization: CANARY_E0_LIVE_AUTHORIZATION_R0,
    maxNotionalUsdMicros
  }), /CANARY_E0_LIVE_MAX_NOTIONAL/);
}

assert.equal(CANARY_PRIMARY_NOTIONAL_USD_MICROS, 1_000_000n);
assert.doesNotThrow(() => assertCanaryE0LiveAuthorization({
  ...FULL_STACK,
  authorization: CANARY_E0_LIVE_AUTHORIZATION_R0,
  maxNotionalUsdMicros: '1000000'
}));

const cliSource = fs.readFileSync(new URL('../src/canarySniperCli.ts', import.meta.url), 'utf8');
const guardStart = cliSource.indexOf('assertCanaryE0LiveAuthorization({');
const startBlockRead = cliSource.indexOf('const startBlockRaw');
const dbSetup = cliSource.indexOf('const dbPath');
const privateKeyRead = cliSource.indexOf('const privateKey');
const executorSetup = cliSource.indexOf('new ViemCanaryExecutor');
assert.ok(guardStart >= 0, 'live authorization guard must be wired into CLI');
assert.ok(guardStart < startBlockRead, 'authorization must fail before start-block/runtime authority setup');
assert.ok(guardStart < dbSetup, 'authorization must fail before DB setup');
assert.ok(guardStart < privateKeyRead, 'authorization must fail before private-key read');
assert.ok(guardStart < executorSetup, 'authorization must fail before executor/network setup');
assert.ok(!cliSource.includes('CANARY_E0_ENTRY_APPROVAL_LIVE_NOT_AUTHORIZED'));
assert.ok(!cliSource.includes('CANARY_E0_ENTRY_APPROVAL_REVOKE_LIVE_NOT_AUTHORIZED'));
assert.ok(!cliSource.includes('CANARY_E0_ROUNDTRIP_LIVE_NOT_AUTHORIZED'));
assert.match(cliSource, /buyLimit: 1/);
assert.match(cliSource, /CANARY_E0_LIVE_AUTHORIZATION/);
assert.match(cliSource, /CANARY_E0_LIVE_MAX_NOTIONAL_USD_MICROS/);

const guardSource = fs.readFileSync(new URL('../src/canary/liveAuthorization.ts', import.meta.url), 'utf8');
assert.ok(!guardSource.includes('CANARY_PRIVATE_KEY'));
assert.ok(!guardSource.includes('ViemCanaryExecutor'));
const rawTransactionMethod = ['send', 'Raw', 'Transaction'].join('');
assert.ok(!guardSource.includes(rawTransactionMethod));

console.log(JSON.stringify({
  verdict: 'CANARY_E0_LIVE_AUTHORIZATION_READINESS_R0_PASS',
  authorizationVersion: CANARY_E0_LIVE_AUTHORIZATION_R0,
  exactPrimaryNotionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS.toString(),
  exactPrimaryNotionalUsd: '1.00',
  fullChildStackRequiredForLive: true,
  partialLiveStackFailsClosed: true,
  missingAuthorizationFailsClosed: true,
  wrongAuthorizationFailsClosed: true,
  exactDollarCapRequired: true,
  guardBeforeStartBlock: true,
  guardBeforeDatabase: true,
  guardBeforePrivateKey: true,
  guardBeforeExecutorNetwork: true,
  existingBuyOnlyLivePathChanged: false,
  walletFundingAuthorized: false,
  privateKeyUsed: false,
  networkBroadcastInvoked: false,
  liveTransactionInvoked: false,
  mergeAuthority: false
}, null, 2));
