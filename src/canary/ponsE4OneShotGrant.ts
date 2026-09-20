import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getAddress, type Address } from 'viem';
import { ROBINHOOD_CHAIN_ID } from '../adapters/robinhood/ponsV2/contracts.js';

export const PONS_E4_GRANT_VERSION =
  'PONS_E4_ONE_SHOT_FAILOVER_CANARY_V1' as const;
export const PONS_E4_GRANT_PURPOSE =
  'PONS_E4_ONE_SHOT_FAILOVER_CANARY' as const;

export type PonsE4Permission =
  | 'E0_BUY'
  | 'E0_CURVE_EXIT'
  | 'E3B_CURVE_REVOKE'
  | 'E2_V4_RECOVERY';

const REQUIRED_PERMISSIONS: readonly PonsE4Permission[] = Object.freeze([
  'E0_BUY',
  'E0_CURVE_EXIT',
  'E3B_CURVE_REVOKE',
  'E2_V4_RECOVERY'
]);

const MAX_ENTRY_WINDOW_S = 30 * 60;
const MAX_RECOVERY_WINDOW_S = 24 * 60 * 60;
const ABSOLUTE_MAX_QUOTE_IN_WEI = 10_000_000_000_000_000n;

export interface PonsE4Grant {
  version: typeof PONS_E4_GRANT_VERSION;
  purpose: typeof PONS_E4_GRANT_PURPOSE;
  grantId: string;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  token: Address;
  wallet: Address;
  notionalUsdMicros: string;
  slippageBps: number;
  maxQuoteInWei: string;
  issuedAtEpochS: number;
  entryNotAfterEpochS: number;
  recoveryNotAfterEpochS: number;
  codeHead: string;
  e0StatePath: string;
  permissions: readonly PonsE4Permission[];
}

export interface PonsE4E0Operation {
  status: 'BUY_INCLUDED' | 'APPROVAL_INCLUDED';
  token: Address;
  wallet: Address;
  curve: Address;
  tokensOwned: bigint;
  buyTransactionHash: string;
  grantId: string;
}

export interface PonsE4ConsumedReceipt {
  version: 'PONS_E4_ONE_SHOT_FAILOVER_CANARY_CONSUMED_V1';
  grantId: string;
  grantDigestSha256: string;
  token: Address;
  wallet: Address;
  codeHead: string;
  e0StatePath: string;
  consumedAtEpochS: number;
}

export interface PonsE4RuntimeIdentityOverride {
  codeHead: string;
  treeClean: boolean;
}

export function consumePonsE4EntryGrant(params: {
  grantPath: string;
  expectedToken: Address;
  expectedWallet: Address;
  expectedNotionalUsdMicros: bigint;
  expectedSlippageBps: number;
  actualQuoteInWei: bigint;
  expectedE0StatePath: string;
  currentEpochS?: number;
  runtimeIdentity?: PonsE4RuntimeIdentityOverride;
}): {
  grant: PonsE4Grant;
  receipt: PonsE4ConsumedReceipt;
  consumedReceiptPath: string;
} {
  const now = params.currentEpochS ?? Math.floor(Date.now() / 1000);
  const loaded = loadGrant(params.grantPath);
  const identity = params.runtimeIdentity ?? readRuntimeIdentity();
  assertGrantCommon(loaded.grant, identity);
  assertEntryWindow(loaded.grant, now);

  if (getAddress(loaded.grant.token) !== getAddress(params.expectedToken)) {
    throw new Error('PONS_E4_GRANT_TOKEN_MISMATCH');
  }
  if (getAddress(loaded.grant.wallet) !== getAddress(params.expectedWallet)) {
    throw new Error('PONS_E4_GRANT_WALLET_MISMATCH');
  }
  if (
    BigInt(loaded.grant.notionalUsdMicros) !==
    params.expectedNotionalUsdMicros
  ) {
    throw new Error('PONS_E4_GRANT_NOTIONAL_MISMATCH');
  }
  if (loaded.grant.slippageBps !== params.expectedSlippageBps) {
    throw new Error('PONS_E4_GRANT_SLIPPAGE_MISMATCH');
  }
  if (params.actualQuoteInWei <= 0n) {
    throw new Error('PONS_E4_GRANT_QUOTE_IN_INVALID');
  }
  if (params.actualQuoteInWei > BigInt(loaded.grant.maxQuoteInWei)) {
    throw new Error(
      `PONS_E4_GRANT_QUOTE_IN_EXCEEDS_CAP:${params.actualQuoteInWei}:${loaded.grant.maxQuoteInWei}`
    );
  }
  if (
    path.resolve(loaded.grant.e0StatePath) !==
    path.resolve(params.expectedE0StatePath)
  ) {
    throw new Error('PONS_E4_GRANT_E0_STATE_PATH_MISMATCH');
  }

  const consumedReceiptPath = consumedPath(params.grantPath);
  const receipt: PonsE4ConsumedReceipt = {
    version: 'PONS_E4_ONE_SHOT_FAILOVER_CANARY_CONSUMED_V1',
    grantId: loaded.grant.grantId,
    grantDigestSha256: loaded.digest,
    token: loaded.grant.token,
    wallet: loaded.grant.wallet,
    codeHead: loaded.grant.codeHead,
    e0StatePath: path.resolve(loaded.grant.e0StatePath),
    consumedAtEpochS: now
  };

  fs.mkdirSync(path.dirname(consumedReceiptPath), { recursive: true });
  let fd: number | null = null;
  try {
    fd = fs.openSync(consumedReceiptPath, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'EEXIST'
    ) {
      throw new Error('PONS_E4_GRANT_ALREADY_CONSUMED');
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }

  return { grant: loaded.grant, receipt, consumedReceiptPath };
}

export function assertPonsE4RecoveryGrant(params: {
  grantPath: string;
  expectedToken: Address;
  expectedWallet: Address;
  requiredPermission: 'E3B_CURVE_REVOKE' | 'E2_V4_RECOVERY';
  expectedTokenAmount?: bigint;
  expectedBuyTransactionHash?: string;
  currentEpochS?: number;
  runtimeIdentity?: PonsE4RuntimeIdentityOverride;
}): {
  grant: PonsE4Grant;
  receipt: PonsE4ConsumedReceipt;
  consumedReceiptPath: string;
  e0Operation: PonsE4E0Operation;
} {
  const now = params.currentEpochS ?? Math.floor(Date.now() / 1000);
  const loaded = loadGrant(params.grantPath);
  const identity = params.runtimeIdentity ?? readRuntimeIdentity();
  assertGrantCommon(loaded.grant, identity);

  if (now > loaded.grant.recoveryNotAfterEpochS) {
    throw new Error(
      `PONS_E4_RECOVERY_AUTHORITY_EXPIRED:${now}:${loaded.grant.recoveryNotAfterEpochS}`
    );
  }
  if (!loaded.grant.permissions.includes(params.requiredPermission)) {
    throw new Error(
      `PONS_E4_RECOVERY_PERMISSION_MISSING:${params.requiredPermission}`
    );
  }
  if (getAddress(loaded.grant.token) !== getAddress(params.expectedToken)) {
    throw new Error('PONS_E4_GRANT_TOKEN_MISMATCH');
  }
  if (getAddress(loaded.grant.wallet) !== getAddress(params.expectedWallet)) {
    throw new Error('PONS_E4_GRANT_WALLET_MISMATCH');
  }

  const consumedReceiptPath = consumedPath(params.grantPath);
  if (!fs.existsSync(consumedReceiptPath)) {
    throw new Error('PONS_E4_GRANT_NOT_CONSUMED');
  }
  const receipt = JSON.parse(
    fs.readFileSync(consumedReceiptPath, 'utf8')
  ) as PonsE4ConsumedReceipt;
  assertReceipt(receipt);

  if (receipt.grantId !== loaded.grant.grantId) {
    throw new Error('PONS_E4_CONSUMED_GRANT_ID_MISMATCH');
  }
  if (receipt.grantDigestSha256 !== loaded.digest) {
    throw new Error('PONS_E4_CONSUMED_GRANT_DIGEST_MISMATCH');
  }
  if (getAddress(receipt.token) !== getAddress(loaded.grant.token)) {
    throw new Error('PONS_E4_CONSUMED_TOKEN_MISMATCH');
  }
  if (getAddress(receipt.wallet) !== getAddress(loaded.grant.wallet)) {
    throw new Error('PONS_E4_CONSUMED_WALLET_MISMATCH');
  }
  if (receipt.codeHead !== loaded.grant.codeHead) {
    throw new Error('PONS_E4_CONSUMED_CODE_HEAD_MISMATCH');
  }
  if (
    path.resolve(receipt.e0StatePath) !==
    path.resolve(loaded.grant.e0StatePath)
  ) {
    throw new Error('PONS_E4_CONSUMED_STATE_PATH_MISMATCH');
  }
  if (
    receipt.consumedAtEpochS < loaded.grant.issuedAtEpochS ||
    receipt.consumedAtEpochS > loaded.grant.entryNotAfterEpochS
  ) {
    throw new Error('PONS_E4_CONSUMED_OUTSIDE_ENTRY_WINDOW');
  }

  const e0Operation = readBoundE0Operation(loaded.grant);
  if (
    params.expectedTokenAmount !== undefined &&
    e0Operation.tokensOwned !== params.expectedTokenAmount
  ) {
    throw new Error(
      `PONS_E4_RECOVERY_TOKEN_AMOUNT_MISMATCH:${e0Operation.tokensOwned}:${params.expectedTokenAmount}`
    );
  }
  if (
    params.expectedBuyTransactionHash !== undefined &&
    e0Operation.buyTransactionHash.toLowerCase() !==
      params.expectedBuyTransactionHash.toLowerCase()
  ) {
    throw new Error('PONS_E4_RECOVERY_BUY_HASH_MISMATCH');
  }

  return { grant: loaded.grant, receipt, consumedReceiptPath, e0Operation };
}

export function getPonsE4ConsumedReceiptPath(grantPath: string): string {
  return consumedPath(grantPath);
}

function loadGrant(file: string): {
  grant: PonsE4Grant;
  digest: string;
} {
  const raw = fs.readFileSync(file);
  const digest = `0x${createHash('sha256').update(raw).digest('hex')}`;
  const grant = JSON.parse(raw.toString('utf8')) as PonsE4Grant;
  assertGrantShape(grant);
  return { grant, digest };
}

function assertGrantCommon(
  grant: PonsE4Grant,
  identity: PonsE4RuntimeIdentityOverride
): void {
  if (!identity.treeClean) {
    throw new Error('PONS_E4_RUNTIME_WORKTREE_NOT_CLEAN');
  }
  if (grant.codeHead !== identity.codeHead) {
    throw new Error(
      `PONS_E4_RUNTIME_CODE_HEAD_MISMATCH:${identity.codeHead}:${grant.codeHead}`
    );
  }
}

function assertEntryWindow(grant: PonsE4Grant, now: number): void {
  if (now < grant.issuedAtEpochS) {
    throw new Error(
      `PONS_E4_ENTRY_AUTHORITY_NOT_YET_VALID:${now}:${grant.issuedAtEpochS}`
    );
  }
  if (now > grant.entryNotAfterEpochS) {
    throw new Error(
      `PONS_E4_ENTRY_AUTHORITY_EXPIRED:${now}:${grant.entryNotAfterEpochS}`
    );
  }
}

function assertGrantShape(grant: PonsE4Grant): void {
  if (grant.version !== PONS_E4_GRANT_VERSION) {
    throw new Error('PONS_E4_GRANT_VERSION_INVALID');
  }
  if (grant.purpose !== PONS_E4_GRANT_PURPOSE) {
    throw new Error('PONS_E4_GRANT_PURPOSE_INVALID');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(grant.grantId)) {
    throw new Error('PONS_E4_GRANT_ID_INVALID');
  }
  if (grant.chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error('PONS_E4_GRANT_CHAIN_ID_INVALID');
  }
  grant.token = getAddress(grant.token);
  grant.wallet = getAddress(grant.wallet);
  if (
    !/^[0-9]+$/.test(grant.notionalUsdMicros) ||
    BigInt(grant.notionalUsdMicros) !== 1_000_000n
  ) {
    throw new Error('PONS_E4_GRANT_NOTIONAL_INVALID');
  }
  if (
    !Number.isInteger(grant.slippageBps) ||
    grant.slippageBps < 0 ||
    grant.slippageBps > 1_000
  ) {
    throw new Error('PONS_E4_GRANT_SLIPPAGE_INVALID');
  }
  if (
    !/^[0-9]+$/.test(grant.maxQuoteInWei) ||
    BigInt(grant.maxQuoteInWei) <= 0n ||
    BigInt(grant.maxQuoteInWei) > ABSOLUTE_MAX_QUOTE_IN_WEI
  ) {
    throw new Error('PONS_E4_GRANT_MAX_QUOTE_IN_INVALID');
  }
  for (const [name, value] of [
    ['issuedAtEpochS', grant.issuedAtEpochS],
    ['entryNotAfterEpochS', grant.entryNotAfterEpochS],
    ['recoveryNotAfterEpochS', grant.recoveryNotAfterEpochS]
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`PONS_E4_GRANT_TIME_INVALID:${name}`);
    }
  }
  if (
    grant.entryNotAfterEpochS < grant.issuedAtEpochS ||
    grant.entryNotAfterEpochS - grant.issuedAtEpochS > MAX_ENTRY_WINDOW_S
  ) {
    throw new Error('PONS_E4_GRANT_ENTRY_WINDOW_INVALID');
  }
  if (
    grant.recoveryNotAfterEpochS < grant.entryNotAfterEpochS ||
    grant.recoveryNotAfterEpochS - grant.issuedAtEpochS >
      MAX_RECOVERY_WINDOW_S
  ) {
    throw new Error('PONS_E4_GRANT_RECOVERY_WINDOW_INVALID');
  }
  if (!/^[0-9a-f]{40}$/.test(grant.codeHead)) {
    throw new Error('PONS_E4_GRANT_CODE_HEAD_INVALID');
  }
  if (
    typeof grant.e0StatePath !== 'string' ||
    grant.e0StatePath.trim().length === 0
  ) {
    throw new Error('PONS_E4_GRANT_E0_STATE_PATH_INVALID');
  }
  if (!Array.isArray(grant.permissions)) {
    throw new Error('PONS_E4_GRANT_PERMISSIONS_INVALID');
  }
  const normalized = [...new Set(grant.permissions)].sort();
  const required = [...REQUIRED_PERMISSIONS].sort();
  if (
    normalized.length !== required.length ||
    normalized.some((value, index) => value !== required[index])
  ) {
    throw new Error('PONS_E4_GRANT_PERMISSIONS_INVALID');
  }
}

function readBoundE0Operation(grant: PonsE4Grant): PonsE4E0Operation {
  if (!fs.existsSync(grant.e0StatePath)) {
    throw new Error('PONS_E4_RECOVERY_E0_STATE_MISSING');
  }
  const state = JSON.parse(
    fs.readFileSync(grant.e0StatePath, 'utf8')
  ) as Record<string, unknown>;
  if (state.version !== 'PONS_E0_LIVE_CANARY_R0') {
    throw new Error('PONS_E4_RECOVERY_E0_STATE_VERSION_INVALID');
  }
  if (state.status !== 'BUY_INCLUDED' && state.status !== 'APPROVAL_INCLUDED') {
    throw new Error(
      `PONS_E4_RECOVERY_E0_STATE_NOT_HANDOFFABLE:${String(state.status)}`
    );
  }
  if (
    typeof state.token !== 'string' ||
    typeof state.wallet !== 'string' ||
    typeof state.curve !== 'string' ||
    typeof state.tokensOwned !== 'string' ||
    !/^[0-9]+$/.test(state.tokensOwned) ||
    BigInt(state.tokensOwned) <= 0n ||
    typeof state.buyTransactionHash !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(state.buyTransactionHash) ||
    typeof state.e4GrantId !== 'string'
  ) {
    throw new Error('PONS_E4_RECOVERY_E0_STATE_SHAPE_INVALID');
  }
  if (state.e4GrantId !== grant.grantId) {
    throw new Error('PONS_E4_RECOVERY_E0_GRANT_ID_MISMATCH');
  }
  if (getAddress(state.token) !== getAddress(grant.token)) {
    throw new Error('PONS_E4_RECOVERY_E0_TOKEN_MISMATCH');
  }
  if (getAddress(state.wallet) !== getAddress(grant.wallet)) {
    throw new Error('PONS_E4_RECOVERY_E0_WALLET_MISMATCH');
  }
  return {
    status: state.status,
    token: getAddress(state.token),
    wallet: getAddress(state.wallet),
    curve: getAddress(state.curve),
    tokensOwned: BigInt(state.tokensOwned),
    buyTransactionHash: state.buyTransactionHash,
    grantId: state.e4GrantId
  };
}

function assertReceipt(receipt: PonsE4ConsumedReceipt): void {
  if (
    receipt.version !==
    'PONS_E4_ONE_SHOT_FAILOVER_CANARY_CONSUMED_V1'
  ) {
    throw new Error('PONS_E4_CONSUMED_VERSION_INVALID');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(receipt.grantId)) {
    throw new Error('PONS_E4_CONSUMED_GRANT_ID_INVALID');
  }
  if (!/^0x[0-9a-f]{64}$/.test(receipt.grantDigestSha256)) {
    throw new Error('PONS_E4_CONSUMED_DIGEST_INVALID');
  }
  receipt.token = getAddress(receipt.token);
  receipt.wallet = getAddress(receipt.wallet);
  if (!/^[0-9a-f]{40}$/.test(receipt.codeHead)) {
    throw new Error('PONS_E4_CONSUMED_CODE_HEAD_INVALID');
  }
  if (
    typeof receipt.e0StatePath !== 'string' ||
    receipt.e0StatePath.length === 0
  ) {
    throw new Error('PONS_E4_CONSUMED_STATE_PATH_INVALID');
  }
  if (
    !Number.isSafeInteger(receipt.consumedAtEpochS) ||
    receipt.consumedAtEpochS <= 0
  ) {
    throw new Error('PONS_E4_CONSUMED_TIME_INVALID');
  }
}

function readRuntimeIdentity(): PonsE4RuntimeIdentityOverride {
  let codeHead: string;
  let status: string;
  try {
    codeHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim();
    status = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8'
    });
  } catch {
    throw new Error('PONS_E4_RUNTIME_GIT_IDENTITY_UNAVAILABLE');
  }
  if (!/^[0-9a-f]{40}$/.test(codeHead)) {
    throw new Error('PONS_E4_RUNTIME_CODE_HEAD_INVALID');
  }
  return {
    codeHead,
    treeClean: status.trim().length === 0
  };
}

function consumedPath(grantPath: string): string {
  return `${path.resolve(grantPath)}.consumed.json`;
}
