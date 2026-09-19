import path from 'node:path';
import {
  createPublicClient,
  defineChain,
  getAddress,
  http,
  type Hex
} from 'viem';
import {
  DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_EXPLORER_URL
} from '../adapters/robinhood/ponsV2/contracts.js';
import { verifyPonsE1V4Recovery } from './viemPonsE1V4RecoveryVerifier.js';
import {
  buildPonsE2RecoveryIntents,
  type PonsE2RecoveryIntent
} from './ponsE2V4RecoveryIntent.js';
import {
  assertPonsE2StateMayStart,
  readPonsE2RecoveryState,
  reservePonsE2RecoveryState,
  transitionPonsE2RecoveryState,
  type PonsE2RecoveryState,
  type PonsE2RecoveryStatus
} from './ponsE2RecoveryState.js';
import { reconcilePonsE2Recovery } from './ponsE2RecoveryReconcile.js';
import {
  ViemPonsE2V4RecoveryExecutor,
  hasActivePonsE2Permit2Allowance
} from './viemPonsE2V4RecoveryExecutor.js';

if (process.env.PONS_E2_ENABLED !== 'true') {
  throw new Error('PONS_E2_REQUIRES_EXPLICIT_ENABLE');
}

const rpcUrl = process.env.PONS_E2_RPC_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: ROBINHOOD_EXPLORER_URL }
  }
});
const client = createPublicClient({
  chain: robinhood,
  transport: http(rpcUrl, { retryCount: 2, retryDelay: 1_000 })
});
const statePath = path.resolve(
  process.env.PONS_E2_STATE_PATH ?? './data/pons-e2-v4-recovery.json'
);

if (process.env.PONS_E2_RECONCILE_ONLY === 'true') {
  if (process.env.PONS_E2_PRIVATE_KEY) {
    throw new Error('PONS_E2_RECONCILE_PRIVATE_KEY_FORBIDDEN');
  }
  const state = readPonsE2RecoveryState(statePath);
  if (!state) throw new Error('PONS_E2_RECONCILE_STATE_MISSING');
  const reconciliation = await reconcilePonsE2Recovery({ state, client });
  console.log(JSON.stringify(jsonSafe(reconciliation), null, 2));
  process.exit(0);
}

const tokenRaw = process.env.PONS_E2_TOKEN;
if (!tokenRaw) throw new Error('PONS_E2_TOKEN_REQUIRED');
const token = getAddress(tokenRaw);
const slippageBps = envInt('PONS_E2_SLIPPAGE_BPS', 500);
if (slippageBps < 0 || slippageBps > 1_000) {
  throw new Error('PONS_E2_SLIPPAGE_INVALID');
}

const live = process.env.PONS_E2_LIVE === 'true';

if (!live) {
  if (process.env.PONS_E2_PRIVATE_KEY || process.env.PONS_E2_BROADCAST_AUTHORITY) {
    throw new Error('PONS_E2_DRY_MODE_LIVE_AUTHORITY_FORBIDDEN');
  }
  const ownerRaw = process.env.PONS_E2_OWNER;
  if (!ownerRaw) throw new Error('PONS_E2_OWNER_REQUIRED');
  const verification = await verifyPonsE1V4Recovery({
    token,
    owner: getAddress(ownerRaw),
    slippageBps,
    client
  });
  const intents = buildPonsE2RecoveryIntents({
    plan: verification.plan,
    poolId: verification.poolId
  });
  console.log(JSON.stringify(jsonSafe({
    verdict: 'PONS_E2_SIGNED_V4_RECOVERY_DRY_READY',
    mode: 'DRY_RUN_NO_SIGNER',
    verification,
    intentKinds: [
      intents.tokenApproval.kind,
      intents.permit2Approval.kind,
      intents.exit.kind,
      intents.permit2Revoke.kind,
      intents.tokenRevoke.kind
    ],
    crashSafeStateReserved: false,
    signerAvailable: false,
    broadcastAvailable: false,
    liveMoneyAuthority: false
  }), null, 2));
  process.exit(0);
}

if (process.env.PONS_E2_BROADCAST_AUTHORITY !== 'true') {
  throw new Error('PONS_E2_LIVE_REQUIRES_EXPLICIT_BROADCAST_AUTHORITY');
}
const privateKey = requirePrivateKey(process.env.PONS_E2_PRIVATE_KEY);
const executor = new ViemPonsE2V4RecoveryExecutor({
  privateKey,
  rpcUrl,
  publicClient: client,
  broadcastEnabled: true,
  caps: {
    maxGas: envBigInt('PONS_E2_MAX_GAS', 1_500_000n),
    maxFeePerGas: envBigInt('PONS_E2_MAX_FEE_PER_GAS_WEI', 20_000_000_000n),
    maxPriorityFeePerGas: envBigInt(
      'PONS_E2_MAX_PRIORITY_FEE_PER_GAS_WEI',
      2_000_000_000n
    )
  }
});
if (
  process.env.PONS_E2_OWNER &&
  getAddress(process.env.PONS_E2_OWNER) !== getAddress(executor.walletAddress)
) {
  throw new Error('PONS_E2_OWNER_MUST_EQUAL_SIGNER');
}

assertPonsE2StateMayStart(readPonsE2RecoveryState(statePath));

const verification = await verifyPonsE1V4Recovery({
  token,
  owner: executor.walletAddress,
  slippageBps,
  client
});
const intents = buildPonsE2RecoveryIntents({
  plan: verification.plan,
  poolId: verification.poolId
});

let state = reservePonsE2RecoveryState(statePath, {
  token,
  wallet: executor.walletAddress,
  poolId: verification.poolId,
  tokenAmount: verification.tokenBalance.toString(),
  minNativeOut: verification.plan.minNativeOut.toString(),
  deadline: verification.plan.deadline.toString(),
  permit2Expiration: verification.plan.permit2Expiration.toString()
});

state = await executeStep({
  intent: intents.tokenApproval,
  signedStatus: 'TOKEN_APPROVAL_SIGNED',
  submittedStatus: 'TOKEN_APPROVAL_SUBMITTED',
  includedStatus: 'TOKEN_APPROVAL_INCLUDED',
  hashField: 'tokenApprovalTransactionHash'
});
try {
  state = await executeStep({
    intent: intents.permit2Approval,
    signedStatus: 'PERMIT2_APPROVAL_SIGNED',
    submittedStatus: 'PERMIT2_APPROVAL_SUBMITTED',
    includedStatus: 'PERMIT2_APPROVAL_INCLUDED',
    hashField: 'permit2ApprovalTransactionHash'
  });
} catch (error) {
  if (state.status === 'TOKEN_APPROVAL_INCLUDED') {
    await abortPreExitClean(error);
  }
  throw error;
}

try {
  state = await executeStep({
    intent: intents.exit,
    signedStatus: 'EXIT_SIGNED',
    submittedStatus: 'EXIT_SUBMITTED',
    includedStatus: 'EXIT_INCLUDED',
    hashField: 'exitTransactionHash'
  });
} catch (error) {
  if (state.status === 'PERMIT2_APPROVAL_INCLUDED') {
    await abortPreExitClean(error);
  }
  throw error;
}

const tokenAfterExit = await executor.getTokenBalance(token);
if (tokenAfterExit !== 0n) {
  throw new Error(`PONS_E2_EXIT_TOKEN_BALANCE_NOT_ZERO:${tokenAfterExit}`);
}

const permit2Residual = await executor.getPermit2AllowanceToRouter(token);
if (hasActivePonsE2Permit2Allowance(permit2Residual.amount)) {
  state = await executeStep({
    intent: intents.permit2Revoke,
    signedStatus: 'PERMIT2_REVOKE_SIGNED',
    submittedStatus: 'PERMIT2_REVOKE_SUBMITTED',
    includedStatus: 'PERMIT2_REVOKE_INCLUDED',
    hashField: 'permit2RevokeTransactionHash'
  });
}

const tokenResidual = await executor.getTokenAllowanceToPermit2(token);
if (tokenResidual !== 0n) {
  state = await executeStep({
    intent: intents.tokenRevoke,
    signedStatus: 'TOKEN_REVOKE_SIGNED',
    submittedStatus: 'TOKEN_REVOKE_SUBMITTED',
    includedStatus: 'TOKEN_REVOKE_INCLUDED',
    hashField: 'tokenRevokeTransactionHash'
  });
}

const [tokenFinal, tokenAllowanceFinal, permit2Final] = await Promise.all([
  executor.getTokenBalance(token),
  executor.getTokenAllowanceToPermit2(token),
  executor.getPermit2AllowanceToRouter(token)
]);
if (tokenFinal !== 0n) {
  throw new Error(`PONS_E2_FINAL_TOKEN_BALANCE_NOT_ZERO:${tokenFinal}`);
}
if (tokenAllowanceFinal !== 0n) {
  throw new Error(
    `PONS_E2_FINAL_TOKEN_ALLOWANCE_NOT_ZERO:${tokenAllowanceFinal}`
  );
}
if (hasActivePonsE2Permit2Allowance(permit2Final.amount)) {
  throw new Error(
    `PONS_E2_FINAL_PERMIT2_AUTHORITY_NOT_ZERO:${permit2Final.amount}:${permit2Final.expiration}`
  );
}

state = transitionPonsE2RecoveryState(statePath, state, 'COMPLETED');

console.log(JSON.stringify(jsonSafe({
  verdict: 'PONS_E2_V4_RECOVERY_COMPLETE',
  token,
  wallet: executor.walletAddress,
  poolId: verification.poolId,
  tokenAmount: verification.tokenBalance,
  minNativeOut: verification.plan.minNativeOut,
  tokenApprovalTransactionHash: state.tokenApprovalTransactionHash,
  permit2ApprovalTransactionHash: state.permit2ApprovalTransactionHash,
  exitTransactionHash: state.exitTransactionHash,
  permit2RevokeTransactionHash: state.permit2RevokeTransactionHash ?? null,
  tokenRevokeTransactionHash: state.tokenRevokeTransactionHash ?? null,
  finalTokenBalance: tokenFinal,
  finalTokenAllowanceToPermit2: tokenAllowanceFinal,
  finalPermit2AllowanceToRouter: permit2Final.amount,
  finalPermit2Expiration: permit2Final.expiration,
  stoppedAfterRecovery: true
}), null, 2));

async function abortPreExitClean(cause: unknown): Promise<never> {
  if (
    state.status !== 'TOKEN_APPROVAL_INCLUDED' &&
    state.status !== 'PERMIT2_APPROVAL_INCLUDED'
  ) {
    throw cause;
  }

  const permit2Residual = await executor.getPermit2AllowanceToRouter(token);
  if (hasActivePonsE2Permit2Allowance(permit2Residual.amount)) {
    if (state.status !== 'PERMIT2_APPROVAL_INCLUDED') {
      throw new Error(
        `PONS_E2_UNEXPECTED_PERMIT2_AUTHORITY_BEFORE_APPROVAL:${permit2Residual.amount}`
      );
    }
    state = await executeStep({
      intent: intents.permit2Revoke,
      signedStatus: 'PERMIT2_REVOKE_SIGNED',
      submittedStatus: 'PERMIT2_REVOKE_SUBMITTED',
      includedStatus: 'PERMIT2_REVOKE_INCLUDED',
      hashField: 'permit2RevokeTransactionHash'
    });
  }

  const tokenResidual = await executor.getTokenAllowanceToPermit2(token);
  if (tokenResidual !== 0n) {
    state = await executeStep({
      intent: intents.tokenRevoke,
      signedStatus: 'TOKEN_REVOKE_SIGNED',
      submittedStatus: 'TOKEN_REVOKE_SUBMITTED',
      includedStatus: 'TOKEN_REVOKE_INCLUDED',
      hashField: 'tokenRevokeTransactionHash'
    });
  }

  const [tokenAllowanceAfter, permit2After] = await Promise.all([
    executor.getTokenAllowanceToPermit2(token),
    executor.getPermit2AllowanceToRouter(token)
  ]);
  if (tokenAllowanceAfter !== 0n) {
    throw new Error(
      `PONS_E2_ABORT_CLEAN_TOKEN_ALLOWANCE_NOT_ZERO:${tokenAllowanceAfter}`
    );
  }
  if (hasActivePonsE2Permit2Allowance(permit2After.amount)) {
    throw new Error(
      `PONS_E2_ABORT_CLEAN_PERMIT2_AUTHORITY_NOT_ZERO:${permit2After.amount}`
    );
  }

  state = transitionPonsE2RecoveryState(
    statePath,
    state,
    'ABORTED_CLEAN'
  );

  const message = cause instanceof Error ? cause.message : String(cause);
  throw new Error(`PONS_E2_PRE_EXIT_ABORTED_CLEAN:${message}`);
}

async function executeStep(params: {
  intent: PonsE2RecoveryIntent;
  signedStatus: PonsE2RecoveryStatus;
  submittedStatus: PonsE2RecoveryStatus;
  includedStatus: PonsE2RecoveryStatus;
  hashField:
    | 'tokenApprovalTransactionHash'
    | 'permit2ApprovalTransactionHash'
    | 'exitTransactionHash'
    | 'permit2RevokeTransactionHash'
    | 'tokenRevokeTransactionHash';
}): Promise<PonsE2RecoveryState> {
  const preflight = await executor.preflight(params.intent);
  const signed = await executor.sign(params.intent, preflight);
  state = transitionPonsE2RecoveryState(
    statePath,
    state,
    params.signedStatus,
    {
      latestTransactionHash: signed.transactionHash,
      [params.hashField]: signed.transactionHash
    }
  );
  const hash = await executor.broadcastExact(signed);
  state = transitionPonsE2RecoveryState(
    statePath,
    state,
    params.submittedStatus,
    { latestTransactionHash: hash }
  );
  const receipt = await waitForReceipt(hash, 120_000);
  if (receipt.status !== 'success') {
    throw new Error(
      `PONS_E2_TRANSACTION_REVERTED:${params.intent.kind}:${hash}`
    );
  }
  state = transitionPonsE2RecoveryState(
    statePath,
    state,
    params.includedStatus,
    { latestTransactionHash: hash }
  );
  return state;
}

async function waitForReceipt(hash: Hex, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const receipt = await executor.getReceiptIfPresent(hash);
    if (receipt) return receipt;
    await sleep(500);
  }
  throw new Error(`PONS_E2_RECEIPT_TIMEOUT_NO_RETRY:${hash}`);
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`PONS_E2_ENV_INTEGER_INVALID:${name}`);
  }
  return value;
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`PONS_E2_ENV_BIGINT_INVALID:${name}`);
  }
  return BigInt(raw);
}

function requirePrivateKey(value: string | undefined): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('PONS_E2_PRIVATE_KEY_REQUIRED');
  }
  return value as Hex;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        jsonSafe(item)
      ])
    );
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
