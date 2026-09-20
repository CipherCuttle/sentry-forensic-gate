import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getAddress } from 'viem';
import {
  computePonsE4ExecutionSurfaceDigest
} from '../dist/canary/ponsE4OneShotGrant.js';

export const PONS_E4_REVIEWED_IMPLEMENTATION_HEAD =
  'f607a0a33d695ddd5a6ec872cce87e4efebd92a3';
export const PONS_E4_DEDICATED_WALLET =
  '0x9343835Fe138FFfF68293B361b3C69FEbd83C031';
export const PONS_E4_NOTIONAL_USD_MICROS = '1000000';

export function buildPonsE4GrantDocument(params) {
  const now = params.nowEpochS ?? Math.floor(Date.now() / 1000);
  const entryWindowS = requireBoundedInt(
    params.entryWindowS ?? 900,
    'PONS_E4_ENTRY_WINDOW_S',
    1,
    1800
  );
  const recoveryWindowS = requireBoundedInt(
    params.recoveryWindowS ?? 21600,
    'PONS_E4_RECOVERY_WINDOW_S',
    entryWindowS,
    86400
  );
  const slippageBps = requireBoundedInt(
    params.slippageBps ?? 500,
    'PONS_E4_SLIPPAGE_BPS',
    0,
    1000
  );
  const maxQuoteInWei = requirePositiveBigInt(
    params.maxQuoteInWei,
    'PONS_E4_MAX_QUOTE_IN_WEI'
  );
  if (maxQuoteInWei > 10_000_000_000_000_000n) {
    throw new Error('PONS_E4_MAX_QUOTE_IN_WEI_ABOVE_HARD_CEILING');
  }

  const token = getAddress(params.token);
  const wallet = getAddress(params.wallet ?? PONS_E4_DEDICATED_WALLET);
  if (wallet !== getAddress(PONS_E4_DEDICATED_WALLET)) {
    throw new Error('PONS_E4_GRANT_ISSUER_DEDICATED_WALLET_REQUIRED');
  }

  const repoRoot = path.resolve(params.repoRoot ?? process.cwd());
  const e0StatePath = path.resolve(params.e0StatePath);
  assertOutsideRepo(repoRoot, e0StatePath, 'PONS_E4_E0_STATE_PATH');

  const executionSurfaceDigestSha256 =
    params.executionSurfaceDigestSha256 ??
    computePonsE4ExecutionSurfaceDigest(repoRoot);

  if (!/^0x[0-9a-f]{64}$/.test(executionSurfaceDigestSha256)) {
    throw new Error('PONS_E4_EXECUTION_SURFACE_DIGEST_INVALID');
  }

  return {
    version: 'PONS_E4_ONE_SHOT_FAILOVER_CANARY_V1',
    purpose: 'PONS_E4_ONE_SHOT_FAILOVER_CANARY',
    grantId: params.grantId ?? `0x${randomBytes(32).toString('hex')}`,
    chainId: 4663,
    token,
    wallet,
    notionalUsdMicros: PONS_E4_NOTIONAL_USD_MICROS,
    slippageBps,
    maxQuoteInWei: maxQuoteInWei.toString(),
    issuedAtEpochS: now,
    entryNotAfterEpochS: now + entryWindowS,
    recoveryNotAfterEpochS: now + recoveryWindowS,
    codeHead: PONS_E4_REVIEWED_IMPLEMENTATION_HEAD,
    executionSurfaceDigestSha256,
    e0StatePath,
    permissions: [
      'E0_BUY',
      'E0_CURVE_EXIT',
      'E3B_CURVE_REVOKE',
      'E2_V4_RECOVERY'
    ]
  };
}

export function writePonsE4GrantOutsideRepo(params) {
  const repoRoot = path.resolve(params.repoRoot ?? process.cwd());
  const outputPath = path.resolve(params.outputPath);
  assertOutsideRepo(repoRoot, outputPath, 'PONS_E4_GRANT_OUTPUT');

  const grant = buildPonsE4GrantDocument({
    ...params,
    repoRoot
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  let fd = null;
  try {
    fd = fs.openSync(outputPath, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(grant, null, 2)}\n`);
    fs.fsyncSync(fd);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'EEXIST'
    ) {
      throw new Error('PONS_E4_GRANT_OUTPUT_ALREADY_EXISTS');
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  const dirFd = fs.openSync(path.dirname(outputPath), 'r');
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }

  return { grant, outputPath };
}

export function assertOutsideRepo(repoRoot, candidate, label) {
  const relative = path.relative(repoRoot, candidate);
  if (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  ) {
    throw new Error(`${label}_MUST_BE_OUTSIDE_REPOSITORY`);
  }
}

async function main() {
  if (process.env.PONS_E4_ISSUE_ENABLED !== 'true') {
    throw new Error('PONS_E4_GRANT_ISSUER_REQUIRES_EXPLICIT_ENABLE');
  }

  const token = process.env.PONS_E4_TOKEN;
  const outputPath = process.env.PONS_E4_GRANT_OUTPUT;
  const e0StatePath = process.env.PONS_E4_E0_STATE_PATH;
  const maxQuoteInWei = process.env.PONS_E4_MAX_QUOTE_IN_WEI;

  if (!token) throw new Error('PONS_E4_TOKEN_REQUIRED');
  if (!outputPath) throw new Error('PONS_E4_GRANT_OUTPUT_REQUIRED');
  if (!e0StatePath) throw new Error('PONS_E4_E0_STATE_PATH_REQUIRED');
  if (!maxQuoteInWei) throw new Error('PONS_E4_MAX_QUOTE_IN_WEI_REQUIRED');

  const { grant, outputPath: written } = writePonsE4GrantOutsideRepo({
    token,
    outputPath,
    e0StatePath,
    maxQuoteInWei,
    slippageBps: envOptionalInt('PONS_E4_SLIPPAGE_BPS'),
    entryWindowS: envOptionalInt('PONS_E4_ENTRY_WINDOW_S'),
    recoveryWindowS: envOptionalInt('PONS_E4_RECOVERY_WINDOW_S')
  });

  console.log(JSON.stringify({
    verdict: 'PONS_E4_ONE_SHOT_GRANT_ISSUED_LOCALLY',
    outputPath: written,
    grantId: grant.grantId,
    token: grant.token,
    wallet: grant.wallet,
    notionalUsdMicros: grant.notionalUsdMicros,
    maxQuoteInWei: grant.maxQuoteInWei,
    entryNotAfterEpochS: grant.entryNotAfterEpochS,
    recoveryNotAfterEpochS: grant.recoveryNotAfterEpochS,
    codeHead: grant.codeHead,
    executionSurfaceDigestSha256: grant.executionSurfaceDigestSha256,
    privateKeyUsed: false,
    signingAuthorityUsed: false,
    broadcastAuthorityUsed: false
  }, null, 2));
}

function requirePositiveBigInt(value, name) {
  if (typeof value === 'bigint') {
    if (value <= 0n) throw new Error(`${name}_INVALID`);
    return value;
  }
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new Error(`${name}_INVALID`);
  }
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error(`${name}_INVALID`);
  return parsed;
}

function requireBoundedInt(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

function envOptionalInt(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name}_INVALID`);
  }
  return value;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  await main();
}
