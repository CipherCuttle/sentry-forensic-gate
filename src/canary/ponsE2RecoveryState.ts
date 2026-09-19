import fs from 'node:fs';
import path from 'node:path';

export const PONS_E2_STATE_VERSION = 'PONS_E2_SIGNED_V4_RECOVERY_V1' as const;

export type PonsE2RecoveryStatus =
  | 'ARMED'
  | 'TOKEN_APPROVAL_SIGNED'
  | 'TOKEN_APPROVAL_SUBMITTED'
  | 'TOKEN_APPROVAL_INCLUDED'
  | 'PERMIT2_APPROVAL_SIGNED'
  | 'PERMIT2_APPROVAL_SUBMITTED'
  | 'PERMIT2_APPROVAL_INCLUDED'
  | 'EXIT_SIGNED'
  | 'EXIT_SUBMITTED'
  | 'EXIT_INCLUDED'
  | 'PERMIT2_REVOKE_SIGNED'
  | 'PERMIT2_REVOKE_SUBMITTED'
  | 'PERMIT2_REVOKE_INCLUDED'
  | 'TOKEN_REVOKE_SIGNED'
  | 'TOKEN_REVOKE_SUBMITTED'
  | 'TOKEN_REVOKE_INCLUDED'
  | 'COMPLETED';

export interface PonsE2RecoveryState {
  version: typeof PONS_E2_STATE_VERSION;
  status: PonsE2RecoveryStatus;
  token: string;
  wallet: string;
  poolId: string;
  tokenAmount: string;
  minNativeOut: string;
  deadline: string;
  permit2Expiration: string;
  latestTransactionHash?: string;
  tokenApprovalTransactionHash?: string;
  permit2ApprovalTransactionHash?: string;
  exitTransactionHash?: string;
  permit2RevokeTransactionHash?: string;
  tokenRevokeTransactionHash?: string;
}

const ALLOWED_TRANSITIONS: Readonly<Record<PonsE2RecoveryStatus, readonly PonsE2RecoveryStatus[]>> =
  Object.freeze({
    ARMED: ['TOKEN_APPROVAL_SIGNED'],
    TOKEN_APPROVAL_SIGNED: ['TOKEN_APPROVAL_SUBMITTED'],
    TOKEN_APPROVAL_SUBMITTED: ['TOKEN_APPROVAL_INCLUDED'],
    TOKEN_APPROVAL_INCLUDED: ['PERMIT2_APPROVAL_SIGNED'],
    PERMIT2_APPROVAL_SIGNED: ['PERMIT2_APPROVAL_SUBMITTED'],
    PERMIT2_APPROVAL_SUBMITTED: ['PERMIT2_APPROVAL_INCLUDED'],
    PERMIT2_APPROVAL_INCLUDED: ['EXIT_SIGNED'],
    EXIT_SIGNED: ['EXIT_SUBMITTED'],
    EXIT_SUBMITTED: ['EXIT_INCLUDED'],
    EXIT_INCLUDED: ['PERMIT2_REVOKE_SIGNED', 'TOKEN_REVOKE_SIGNED', 'COMPLETED'],
    PERMIT2_REVOKE_SIGNED: ['PERMIT2_REVOKE_SUBMITTED'],
    PERMIT2_REVOKE_SUBMITTED: ['PERMIT2_REVOKE_INCLUDED'],
    PERMIT2_REVOKE_INCLUDED: ['TOKEN_REVOKE_SIGNED', 'COMPLETED'],
    TOKEN_REVOKE_SIGNED: ['TOKEN_REVOKE_SUBMITTED'],
    TOKEN_REVOKE_SUBMITTED: ['TOKEN_REVOKE_INCLUDED'],
    TOKEN_REVOKE_INCLUDED: ['COMPLETED'],
    COMPLETED: []
  });

export function readPonsE2RecoveryState(
  file: string
): PonsE2RecoveryState | null {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PonsE2RecoveryState;
  assertStateShape(parsed);
  return parsed;
}

export function reservePonsE2RecoveryState(
  file: string,
  state: Omit<PonsE2RecoveryState, 'version' | 'status'>
): PonsE2RecoveryState {
  const initial: PonsE2RecoveryState = {
    version: PONS_E2_STATE_VERSION,
    status: 'ARMED',
    ...state
  };
  assertStateShape(initial);
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let fd: number | null = null;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(initial, null, 2)}\n`);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'EEXIST'
    ) {
      throw new Error('PONS_E2_STATE_RESERVATION_EXISTS');
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return initial;
}

export function transitionPonsE2RecoveryState(
  file: string,
  current: PonsE2RecoveryState,
  nextStatus: PonsE2RecoveryStatus,
  patch: Partial<PonsE2RecoveryState> = {}
): PonsE2RecoveryState {
  assertStateShape(current);
  const allowed = ALLOWED_TRANSITIONS[current.status];
  if (!allowed.includes(nextStatus)) {
    throw new Error(
      `PONS_E2_STATE_TRANSITION_INVALID:${current.status}:${nextStatus}`
    );
  }

  for (const key of [
    'version',
    'token',
    'wallet',
    'poolId',
    'tokenAmount',
    'minNativeOut',
    'deadline',
    'permit2Expiration'
  ] as const) {
    if (patch[key] !== undefined && patch[key] !== current[key]) {
      throw new Error(`PONS_E2_STATE_IMMUTABLE_FIELD_DRIFT:${key}`);
    }
  }

  const next: PonsE2RecoveryState = {
    ...current,
    ...patch,
    version: PONS_E2_STATE_VERSION,
    status: nextStatus
  };
  assertStateShape(next);
  writeAtomic(file, next);
  return next;
}

export function assertPonsE2StateMayStart(
  existing: PonsE2RecoveryState | null
): void {
  if (!existing) return;
  if (existing.status === 'COMPLETED') {
    throw new Error('PONS_E2_ALREADY_COMPLETED_USE_NEW_STATE_PATH');
  }
  throw new Error(
    `PONS_E2_NONTERMINAL_STATE_REQUIRES_MANUAL_RECONCILIATION:${existing.status}:${existing.latestTransactionHash ?? 'NO_HASH'}`
  );
}

function writeAtomic(file: string, state: PonsE2RecoveryState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600
  });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function assertStateShape(state: PonsE2RecoveryState): void {
  if (state.version !== PONS_E2_STATE_VERSION) {
    throw new Error('PONS_E2_STATE_VERSION_INVALID');
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, state.status)) {
    throw new Error(`PONS_E2_STATE_STATUS_INVALID:${String(state.status)}`);
  }
  for (const key of [
    'token',
    'wallet',
    'poolId',
    'tokenAmount',
    'minNativeOut',
    'deadline',
    'permit2Expiration'
  ] as const) {
    if (typeof state[key] !== 'string' || state[key].length === 0) {
      throw new Error(`PONS_E2_STATE_FIELD_INVALID:${key}`);
    }
  }
  for (const key of [
    'tokenAmount',
    'minNativeOut',
    'deadline',
    'permit2Expiration'
  ] as const) {
    if (!/^[0-9]+$/.test(state[key])) {
      throw new Error(`PONS_E2_STATE_NUMERIC_FIELD_INVALID:${key}`);
    }
  }
  for (const [key, value] of Object.entries(state)) {
    if (
      key.endsWith('TransactionHash') &&
      value !== undefined &&
      (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value))
    ) {
      throw new Error(`PONS_E2_STATE_TRANSACTION_HASH_INVALID:${key}`);
    }
  }
}
