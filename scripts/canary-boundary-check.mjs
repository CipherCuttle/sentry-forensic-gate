import fs from 'node:fs';
import path from 'node:path';

const allowedWalletAuthorityFile = path.normalize('src/canary/viemCanaryExecutor.ts');
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
  for (const identifier of forbiddenIdentifiers) {
    const regex = new RegExp(`\\b${identifier}\\b`, 'g');
    if (!regex.test(source)) continue;
    const normalized = path.normalize(file);
    if (!normalized.startsWith(`${canaryDir}${path.sep}`)) {
      findings.push(`${identifier}:outside-canary:${file}`);
      continue;
    }
    if (normalized !== allowedWalletAuthorityFile || !allowedIdentifiers.has(identifier)) {
      findings.push(`${identifier}:not-allowed-here:${file}`);
    }
  }
}

const executor = fs.readFileSync(allowedWalletAuthorityFile, 'utf8');
for (const required of [
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
  'CANARY_APPROVAL_PREFLIGHT_ACTION_ID_MISMATCH',
  'CANARY_APPROVAL_SIGNED_WALLET_MISMATCH'
]) {
  if (!executor.includes(required)) findings.push(`missing-fail-closed-guard:${required}`);
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
