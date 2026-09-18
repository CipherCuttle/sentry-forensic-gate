import fs from 'node:fs';
import path from 'node:path';

const allowedWalletAuthorityFiles = new Set([\n  path.normalize('src/canary/viemCanaryExecutor.ts'),\n  path.normalize('src/canary/viemPonsE0CanaryExecutor.ts')\n]);
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
