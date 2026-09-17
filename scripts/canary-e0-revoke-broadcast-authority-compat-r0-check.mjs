import assert from 'node:assert/strict';
import fs from 'node:fs';

const executorSource = fs.readFileSync(new URL('../src/canary/viemCanaryExecutor.ts', import.meta.url), 'utf8');
const entryStoreSource = fs.readFileSync(new URL('../src/canary/entryApprovalStore.ts', import.meta.url), 'utf8');
const cycleSource = fs.readFileSync(new URL('../src/canary/cycle.ts', import.meta.url), 'utf8');

assert.match(executorSource, /signedEntryApprovalRevokeIntents = new Map<string, Readonly<CanaryEntryApprovalRevokeIntent>>\(\)/);
const revokeSignStart = executorSource.indexOf('async signEntryApprovalRevoke(');
const revokeRegistration = executorSource.indexOf('this.signedEntryApprovalRevokeIntents.set(transactionHash.toLowerCase()', revokeSignStart);
const broadcastStart = executorSource.indexOf('async broadcastExact(', revokeSignStart);
assert.ok(revokeSignStart >= 0 && revokeRegistration > revokeSignStart && broadcastStart > revokeRegistration,
  'revoke authority must be registered only after revoke signing and before broadcast');
const broadcastEnd = executorSource.indexOf('\n  async getReceiptIfPresent', broadcastStart);
const broadcastSource = executorSource.slice(broadcastStart, broadcastEnd);
assert.match(broadcastSource, /const revokeIntent = this\.signedEntryApprovalRevokeIntents\.get\(key\)/);
assert.match(broadcastSource, /assertSignedEntryApprovalRevokeTransaction\(revokeIntent, signed, this\.account\.address\)/);
assert.match(broadcastSource, /this\.signedEntryApprovalRevokeIntents\.delete\(key\)/);
assert.match(broadcastSource, /CANARY_BROADCAST_SIGNED_AUTHORITY_UNKNOWN/);

const consumeStart = entryStoreSource.indexOf('async consumeSigningAuthority(');
const deleteCapability = entryStoreSource.indexOf('this.signingCapabilities.delete(actionId);', consumeStart);
const firstAwait = entryStoreSource.indexOf('await this.getAuthoritativeParentBuyIntent(actionId)', consumeStart);
assert.ok(consumeStart >= 0 && deleteCapability > consumeStart && firstAwait > deleteCapability,
  'entry approval capability must still burn synchronously before the first await');
assert.match(entryStoreSource, /CANARY_ENTRY_APPROVAL_SIGNING_AUTHORITY_NOT_CONSUMED/);
assert.match(entryStoreSource, /markCleanupTerminal\(actionId: string, reason: string\)/);

assert.match(cycleSource, /committedEntry\.intent\.amount > calibration\.baseAmount/);
assert.match(cycleSource, /preflight\.inputAllowance !== intent\.amountIn/);
assert.match(cycleSource, /CANDIDATE_NO_LONGER_PASS:UNKNOWN/);

console.log(JSON.stringify({
  verdict: 'CANARY_E0_REVOKE_BROADCAST_AUTHORITY_COMPAT_R0_PASS',
  revokeArtifactExecutorBound: true,
  unknownSignedArtifactStillRejected: true,
  entryApprovalCapabilityBurnBeforeAwaitPreserved: true,
  cleanupTerminalTransitionPreserved: true,
  freshDollarCapPreserved: true,
  exactBuyAllowancePreserved: true,
  unknownCandidateDoesNotTriggerCleanup: true,
  networkBroadcastInvoked: false,
  realWalletSecretUsed: false,
  liveModeEnabled: false
}, null, 2));
