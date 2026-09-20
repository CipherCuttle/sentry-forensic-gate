import path from 'node:path';
import { getAddress, type Hex } from 'viem';
import {
  buildPonsE3BCurveRevokeIntent
} from './ponsE3BRuntimeFailover.js';
import {
  readPonsE3BRuntimeState,
  transitionPonsE3BRuntimeState
} from './ponsE3BRuntimeState.js';
import {
  ViemPonsE3BCurveCleanupExecutor
} from './viemPonsE3BCurveCleanupExecutor.js';

if (process.env.PONS_E3B_ENABLED !== 'true') {
  throw new Error('PONS_E3B_REQUIRES_EXPLICIT_ENABLE');
}
if (process.env.PONS_E3B_LIVE !== 'true') {
  throw new Error('PONS_E3B_CURVE_CLEANUP_REQUIRES_LIVE_MODE');
}
if (process.env.PONS_E3B_BROADCAST_AUTHORITY !== 'true') {
  throw new Error('PONS_E3B_CURVE_CLEANUP_REQUIRES_BROADCAST_AUTHORITY');
}

const statePath = path.resolve(
  process.env.PONS_E3B_STATE_PATH ?? './data/pons-e3b-runtime.json'
);
const existing = readPonsE3BRuntimeState(statePath);
if (!existing) {
  throw new Error('PONS_E3B_CURVE_CLEANUP_STATE_MISSING');
}
if (existing.status !== 'CURVE_REVOKE_REQUIRED') {
  throw new Error(
    `PONS_E3B_CURVE_CLEANUP_STATE_NOT_READY:${existing.status}`
  );
}

const privateKey = requirePrivateKey(process.env.PONS_E3B_PRIVATE_KEY);
const executor = new ViemPonsE3BCurveCleanupExecutor({
  privateKey,
  rpcUrl: process.env.PONS_E3B_RPC_URL,
  broadcastEnabled: true,
  caps: {
    maxGas: envBigInt('PONS_E3B_MAX_GAS', 150_000n),
    maxFeePerGas: envBigInt(
      'PONS_E3B_MAX_FEE_PER_GAS_WEI',
      20_000_000_000n
    ),
    maxPriorityFeePerGas: envBigInt(
      'PONS_E3B_MAX_PRIORITY_FEE_PER_GAS_WEI',
      2_000_000_000n
    )
  }
});

if (getAddress(existing.wallet) !== executor.walletAddress) {
  throw new Error('PONS_E3B_CURVE_CLEANUP_WALLET_MISMATCH');
}

const token = getAddress(existing.token);
const curve = getAddress(existing.curve);
const expectedTokenAmount = BigInt(existing.tokenAmount);

const [tokenBalanceBefore, allowanceBefore] = await Promise.all([
  executor.getTokenBalance(token),
  executor.getCurveAllowance(token, curve)
]);
if (tokenBalanceBefore !== expectedTokenAmount) {
  throw new Error(
    `PONS_E3B_CURVE_CLEANUP_TOKEN_BALANCE_DRIFT:${tokenBalanceBefore}:${expectedTokenAmount}`
  );
}
if (allowanceBefore <= 0n) {
  throw new Error('PONS_E3B_CURVE_CLEANUP_ALLOWANCE_ALREADY_ZERO');
}

const intent = buildPonsE3BCurveRevokeIntent({
  token,
  owner: executor.walletAddress,
  curve
});
const preflight = await executor.preflight(intent);
const signed = await executor.sign(intent, preflight);

let state = transitionPonsE3BRuntimeState(
  statePath,
  existing,
  'CURVE_REVOKE_SIGNED',
  {
    latestTransactionHash: signed.transactionHash,
    curveRevokeTransactionHash: signed.transactionHash
  }
);

const transactionHash = await executor.broadcastExact(signed);
state = transitionPonsE3BRuntimeState(
  statePath,
  state,
  'CURVE_REVOKE_SUBMITTED',
  { latestTransactionHash: transactionHash }
);

const receipt = await waitForReceipt(
  executor,
  transactionHash,
  envInt('PONS_E3B_RECEIPT_TIMEOUT_MS', 120_000)
);
if (receipt.status !== 'success') {
  throw new Error(
    `PONS_E3B_CURVE_CLEANUP_TRANSACTION_REVERTED:${transactionHash}`
  );
}

const [tokenBalanceAfter, allowanceAfter] = await Promise.all([
  executor.getTokenBalance(token),
  executor.getCurveAllowance(token, curve)
]);
if (tokenBalanceAfter !== expectedTokenAmount) {
  throw new Error(
    `PONS_E3B_CURVE_CLEANUP_TOKEN_BALANCE_CHANGED:${tokenBalanceAfter}:${expectedTokenAmount}`
  );
}
if (allowanceAfter !== 0n) {
  throw new Error(
    `PONS_E3B_CURVE_CLEANUP_ALLOWANCE_NOT_ZERO:${allowanceAfter}`
  );
}

state = transitionPonsE3BRuntimeState(
  statePath,
  state,
  'CURVE_REVOKE_INCLUDED',
  { latestTransactionHash: transactionHash }
);

console.log(JSON.stringify({
  verdict: 'PONS_E3B_CURVE_CLEANUP_COMPLETE',
  token,
  curve,
  wallet: executor.walletAddress,
  tokenAmount: expectedTokenAmount.toString(),
  transactionHash,
  allowanceBefore: allowanceBefore.toString(),
  allowanceAfter: allowanceAfter.toString(),
  tokenBalanceAfter: tokenBalanceAfter.toString(),
  nextAction: 'START_FRESH_E3B_PROOF_CYCLE_WITH_NEW_STATE_PATH',
  autoContinueToV4: false
}, null, 2));

async function waitForReceipt(
  cleanupExecutor: ViemPonsE3BCurveCleanupExecutor,
  hash: Hex,
  timeoutMs: number
) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await cleanupExecutor.getReceiptIfPresent(hash);
    if (found) return found;
    await sleep(500);
  }
  throw new Error(`PONS_E3B_CURVE_CLEANUP_RECEIPT_TIMEOUT_NO_RETRY:${hash}`);
}

function requirePrivateKey(value: string | undefined): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('PONS_E3B_PRIVATE_KEY_REQUIRED');
  }
  return value as Hex;
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`PONS_E3B_ENV_BIGINT_INVALID:${name}`);
  }
  return BigInt(raw);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`PONS_E3B_ENV_INTEGER_INVALID:${name}`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
