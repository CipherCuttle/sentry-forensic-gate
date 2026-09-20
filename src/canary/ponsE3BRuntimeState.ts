import fs from 'node:fs';
import path from 'node:path';

export const PONS_E3B_RUNTIME_STATE_VERSION =
  'PONS_E3B_RUNTIME_FAILOVER_V1' as const;

export type PonsE3BRuntimeStatus =
  | 'POST_BUY_CAPTURED'
  | 'CURVE_PATH_ACTIVE'
  | 'CURVE_REVOKE_REQUIRED'
  | 'CURVE_REVOKE_SIGNED'
  | 'CURVE_REVOKE_SUBMITTED'
  | 'CURVE_REVOKE_INCLUDED'
  | 'V4_HANDOFF_READY'
  | 'STOPPED';

export interface PonsE3BRuntimeState {
  version: typeof PONS_E3B_RUNTIME_STATE_VERSION;
  status: PonsE3BRuntimeStatus;
  token: string;
  wallet: string;
  curve: string;
  tokenAmount: string;
  e0Status: 'BUY_INCLUDED' | 'APPROVAL_INCLUDED';
  e0TransactionHash: string;
  latestTransactionHash?: string;
  curveRevokeTransactionHash?: string;
  reason?: string;
}

const ALLOWED: Readonly<Record<PonsE3BRuntimeStatus, readonly PonsE3BRuntimeStatus[]>> =
  Object.freeze({
    POST_BUY_CAPTURED: [
      'CURVE_PATH_ACTIVE',
      'CURVE_REVOKE_REQUIRED',
      'V4_HANDOFF_READY',
      'STOPPED'
    ],
    CURVE_PATH_ACTIVE: [],
    CURVE_REVOKE_REQUIRED: ['CURVE_REVOKE_SIGNED', 'STOPPED'],
    CURVE_REVOKE_SIGNED: ['CURVE_REVOKE_SUBMITTED'],
    CURVE_REVOKE_SUBMITTED: ['CURVE_REVOKE_INCLUDED'],
    CURVE_REVOKE_INCLUDED: [],
    V4_HANDOFF_READY: [],
    STOPPED: []
  });

export function readPonsE3BRuntimeState(
  file: string
): PonsE3BRuntimeState | null {
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PonsE3BRuntimeState;
  assertState(parsed);
  return parsed;
}

export function reservePonsE3BRuntimeState(
  file: string,
  state: Omit<PonsE3BRuntimeState, 'version' | 'status'>
): PonsE3BRuntimeState {
  const initial: PonsE3BRuntimeState = {
    version: PONS_E3B_RUNTIME_STATE_VERSION,
    status: 'POST_BUY_CAPTURED',
    ...state
  };
  assertState(initial);
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
      throw new Error('PONS_E3B_STATE_RESERVATION_EXISTS');
    }
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return initial;
}

export function transitionPonsE3BRuntimeState(
  file: string,
  current: PonsE3BRuntimeState,
  nextStatus: PonsE3BRuntimeStatus,
  patch: Partial<PonsE3BRuntimeState> = {}
): PonsE3BRuntimeState {
  assertState(current);
  if (!ALLOWED[current.status].includes(nextStatus)) {
    throw new Error(
      `PONS_E3B_STATE_TRANSITION_INVALID:${current.status}:${nextStatus}`
    );
  }

  for (const key of [
    'version',
    'token',
    'wallet',
    'curve',
    'tokenAmount',
    'e0Status',
    'e0TransactionHash'
  ] as const) {
    if (patch[key] !== undefined && patch[key] !== current[key]) {
      throw new Error(`PONS_E3B_STATE_IMMUTABLE_FIELD_DRIFT:${key}`);
    }
  }

  const next: PonsE3BRuntimeState = {
    ...current,
    ...patch,
    version: PONS_E3B_RUNTIME_STATE_VERSION,
    status: nextStatus
  };
  assertState(next);
  writeAtomic(file, next);
  return next;
}

export function assertPonsE3BStateMayStart(
  existing: PonsE3BRuntimeState | null
): void {
  if (!existing) return;
  throw new Error(
    `PONS_E3B_EXISTING_STATE_REQUIRES_MANUAL_RECONCILIATION:${existing.status}:${existing.latestTransactionHash ?? 'NO_HASH'}`
  );
}

function writeAtomic(file: string, state: PonsE3BRuntimeState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function assertState(state: PonsE3BRuntimeState): void {
  if (state.version !== PONS_E3B_RUNTIME_STATE_VERSION) {
    throw new Error('PONS_E3B_STATE_VERSION_INVALID');
  }
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, state.status)) {
    throw new Error(`PONS_E3B_STATE_STATUS_INVALID:${String(state.status)}`);
  }
  if (state.e0Status !== 'BUY_INCLUDED' && state.e0Status !== 'APPROVAL_INCLUDED') {
    throw new Error(`PONS_E3B_E0_STATUS_INVALID:${String(state.e0Status)}`);
  }
  for (const key of ['token', 'wallet', 'curve', 'tokenAmount', 'e0TransactionHash'] as const) {
    if (typeof state[key] !== 'string' || state[key].length === 0) {
      throw new Error(`PONS_E3B_STATE_FIELD_INVALID:${key}`);
    }
  }
  if (!/^[0-9]+$/.test(state.tokenAmount) || BigInt(state.tokenAmount) <= 0n) {
    throw new Error('PONS_E3B_STATE_TOKEN_AMOUNT_INVALID');
  }
  for (const [key, value] of Object.entries(state)) {
    if (
      key.endsWith('TransactionHash') &&
      value !== undefined &&
      (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value))
    ) {
      throw new Error(`PONS_E3B_STATE_TRANSACTION_HASH_INVALID:${key}`);
    }
  }
}
