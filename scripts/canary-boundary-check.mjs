import fs from 'node:fs';
import path from 'node:path';

const allowedWalletAuthorityFiles = new Set([
  path.normalize('src/canary/viemCanaryExecutor.ts'),
  path.normalize('src/canary/viemPonsE0CanaryExecutor.ts'),
  path.normalize('src/canary/viemPonsE2V4RecoveryExecutor.ts'),
  path.normalize('src/canary/viemPonsE3BCurveCleanupExecutor.ts')
]);
const allowedIdentifiers = new Set(['createWalletClient', 'privateKeyToAccount', 'sendRawTransaction', 'signTransaction']);
const forbiddenIdentifiers = new Set([
  'createWalletClient', 'privateKeyToAccount', 'mnemonicToAccount', 'hdKeyToAccount',
  'writeContract', 'sendTransaction', 'sendRawTransaction', 'sendCalls', 'deployContract',
  'signTransaction', 'signMessage', 'signTypedData', 'signAuthorization'
]);
const canaryDir = path.normalize('src/canary');

const files = walk('src').filter((file) => /\.(?:ts|tsx)$/.test(file));
const findings = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const normalized = path.normalize(file);
  if (!allowedWalletAuthorityFiles.has(normalized) && source.includes('executor.account')) {
    findings.push(`raw-local-account-exposure:${file}`);
  }
  for (const identifier of forbiddenIdentifiers) {
    const regex = new RegExp(`\\b${identifier}\\b`, 'g');
    if (!regex.test(source)) continue;
    if (!normalized.startsWith(`${canaryDir}${path.sep}`)) {
      findings.push(`${identifier}:outside-canary:${file}`);
      continue;
    }
    if (!allowedWalletAuthorityFiles.has(normalized) || !allowedIdentifiers.has(identifier)) {
      findings.push(`${identifier}:not-allowed-here:${file}`);
    }
  }
}

const executor = fs.readFileSync(path.normalize('src/canary/viemCanaryExecutor.ts'), 'utf8');
for (const required of [
  'readonly walletAddress: Address',
  'private readonly account: LocalAccount',
  'CANARY_PRIVATE_KEY_FORMAT_INVALID',
  'CANARY_ROUTER_MISMATCH',
  'CANARY_CHAIN_ID_MISMATCH',
  'CANARY_INPUT_ALLOWANCE_INSUFFICIENT',
  'CANARY_QUOTE_STALE',
  'CANARY_QUOTE_BLOCK_REORG',
  'CANARY_DEADLINE_EXCEEDS_MAX',
  'CANARY_GAS_CAP_EXCEEDED',
  'CANARY_BROADCAST_HASH_MISMATCH',
  'CANARY_BROADCAST_SIGNED_IDENTITY_MISMATCH',
  'CANARY_BROADCAST_CHAIN_ID_MISMATCH',
  'CANARY_BROADCAST_SIGNER_MISMATCH',
  'CANARY_APPROVAL_OWNER_MUST_EQUAL_WALLET',
  'CANARY_APPROVAL_SPENDER_MISMATCH',
  'CANARY_APPROVAL_DIRTY_ALLOWANCE',
  'CANARY_APPROVAL_TOKEN_CODE_MISSING',
  'CANARY_APPROVAL_SIMULATION_RESULT_MISSING',
  'CANARY_APPROVAL_SIMULATION_FALSE',
  'CANARY_APPROVAL_ALLOWANCE_CHANGED',
  'CANARY_APPROVAL_PREFLIGHT_ACTION_ID_MISMATCH'
]) {
  if (!executor.includes(required)) findings.push(`missing-fail-closed-guard:${required}`);
}

const ponsExecutor = fs.readFileSync(path.normalize('src/canary/viemPonsE0CanaryExecutor.ts'), 'utf8');
for (const required of [
  'readonly walletAddress: Address',
  'private readonly account: LocalAccount',
  'PONS_E0_PRIVATE_KEY_FORMAT_INVALID',
  'PONS_E0_CHAIN_ID_MISMATCH',
  'PONS_E0_CURVE_FACTORY_MISMATCH',
  'PONS_E0_CURVE_TOKEN_MISMATCH',
  'PONS_E0_NATIVE_PAIR_REQUIRED',
  'PONS_E0_CURVE_NOT_ACTIVE',
  'PONS_E0_SNIPE_TAX_MUST_BE_ZERO',
  'PONS_E0_NATIVE_VALUE_CAP_EXCEEDED',
  'PONS_E0_EXACT_BUY_VALUE_NOT_AUTHORIZED',
  'PONS_E0_APPROVAL_REQUIRES_ZERO_ALLOWANCE',
  'PONS_E0_SELL_ALLOWANCE_NOT_EXACT',
  'PONS_E0_BROADCAST_SIGNED_AUTHORITY_UNKNOWN',
  'PONS_E0_BROADCAST_HASH_MISMATCH',
  'PONS_E0_SIGNED_SIGNER_MISMATCH',
  'PONS_E0_SIGNED_CHAIN_ID_MISMATCH',
  'PONS_E0_SIGNED_TARGET_MISMATCH',
  'PONS_E0_SIGNED_CALLDATA_MISMATCH'
]) {
  if (!ponsExecutor.includes(required)) findings.push(`missing-pons-e0-fail-closed-guard:${required}`);
}
const ponsE2Executor = fs.readFileSync(
  path.normalize('src/canary/viemPonsE2V4RecoveryExecutor.ts'),
  'utf8'
);
for (const required of [
  'readonly walletAddress: Address',
  'private readonly account: LocalAccount',
  'PONS_E2_PRIVATE_KEY_FORMAT_INVALID',
  'PONS_E2_BROADCAST_AUTHORITY_DISABLED',
  'PONS_E2_INTENT_OWNER_MUST_EQUAL_WALLET',
  'PONS_E2_FULL_BALANCE_DRIFT',
  'PONS_E2_TOKEN_APPROVAL_REQUIRES_ZERO_ALLOWANCE',
  'PONS_E2_PERMIT2_APPROVAL_REQUIRES_ZERO_ALLOWANCE',
  'PONS_E2_EXIT_FRESH_QUOTE_BELOW_FROZEN_MIN',
  'PONS_E2_EXIT_TOKEN_ALLOWANCE_NOT_EXACT',
  'PONS_E2_EXIT_PERMIT2_ALLOWANCE_NOT_EXACT',
  'PONS_E2_BROADCAST_SIGNED_AUTHORITY_UNKNOWN',
  'PONS_E2_SIGNED_SIGNER_MISMATCH',
  'PONS_E2_SIGNED_CHAIN_ID_MISMATCH',
  'PONS_E2_SIGNED_TARGET_MISMATCH',
  'PONS_E2_SIGNED_CALLDATA_MISMATCH'
]) {
  if (!ponsE2Executor.includes(required)) {
    findings.push(`missing-pons-e2-fail-closed-guard:${required}`);
  }
}

const ponsE3BExecutor = fs.readFileSync(
  path.normalize('src/canary/viemPonsE3BCurveCleanupExecutor.ts'),
  'utf8'
);
for (const required of [
  'readonly walletAddress: Address',
  'private readonly account: LocalAccount',
  'PONS_E3B_PRIVATE_KEY_FORMAT_INVALID',
  'PONS_E3B_BROADCAST_AUTHORITY_DISABLED',
  'PONS_E3B_INTENT_OWNER_MUST_EQUAL_WALLET',
  'PONS_E3B_FACTORY_RUNTIME_DRIFT',
  'PONS_E3B_CURVE_FACTORY_MISMATCH',
  'PONS_E3B_CURVE_TOKEN_MISMATCH',
  'PONS_E3B_CURVE_PAIR_TOKEN_MISMATCH',
  'PONS_E3B_CURVE_REVOKE_REQUIRES_GRADUATED_CURVE',
  'PONS_E3B_CURVE_REVOKE_NOT_REQUIRED',
  'PONS_E3B_BROADCAST_SIGNED_AUTHORITY_UNKNOWN',
  'PONS_E3B_SIGNED_SIGNER_MISMATCH',
  'PONS_E3B_SIGNED_CHAIN_ID_MISMATCH',
  'PONS_E3B_SIGNED_TARGET_MISMATCH',
  'PONS_E3B_SIGNED_CALLDATA_MISMATCH'
]) {
  if (!ponsE3BExecutor.includes(required)) {
    findings.push(`missing-pons-e3b-fail-closed-guard:${required}`);
  }
}

const ponsE2Check = fs.readFileSync(
  path.normalize('scripts/pons-e2-v4-recovery-check.mjs'),
  'utf8'
);
for (const required of [
  '0000000000000000000000000000000000000000000000000000000000000001',
  'broadcastPerformed: false',
  'liveMoneyAuthority: false',
  'reconcilerNeverAutoRetries: true'
]) {
  if (!ponsE2Check.includes(required)) {
    findings.push(`pons-e2-check-missing-boundary-proof:${required}`);
  }
}
for (const forbidden of [
  '.broadcastExact(',
  'PONS_E2_BROADCAST_AUTHORITY=true',
  'PONS_E2_LIVE=true'
]) {
  if (ponsE2Check.includes(forbidden)) {
    findings.push(`pons-e2-check-live-behavior-forbidden:${forbidden}`);
  }
}

const ponsE3BCheck = fs.readFileSync(
  path.normalize('scripts/pons-e3b-runtime-failover-check.mjs'),
  'utf8'
);
for (const required of [
  '0000000000000000000000000000000000000000000000000000000000000001',
  'signedCleanupIdentityFence: true',
  'zeroPriorityFeeNormalization: true',
  'broadcastPerformed: false',
  'liveMoneyAuthority: false'
]) {
  if (!ponsE3BCheck.includes(required)) {
    findings.push(`pons-e3b-check-missing-boundary-proof:${required}`);
  }
}
for (const forbidden of [
  '.broadcastExact(',
  'PONS_E3B_BROADCAST_AUTHORITY=true',
  'PONS_E3B_LIVE=true'
]) {
  if (ponsE3BCheck.includes(forbidden)) {
    findings.push(`pons-e3b-check-live-behavior-forbidden:${forbidden}`);
  }
}

if (findings.length) throw new Error(`CANARY_BOUNDARY_VIOLATION\n${findings.join('\n')}`);
console.log('canary-boundary-check: PASS');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
