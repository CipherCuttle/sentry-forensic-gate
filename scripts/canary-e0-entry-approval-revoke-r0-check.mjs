import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress
} from 'viem';
import { erc20ApprovalAbi } from '../dist/canary/approval.js';
import { buildCanaryEntryApprovalIntent } from '../dist/canary/entryApproval.js';
import { buildCanaryEntryApprovalRevokeIntent } from '../dist/canary/entryApprovalRevoke.js';
import { CanaryEntryApprovalRevokeStore } from '../dist/canary/entryApprovalRevokeStore.js';
import { advanceCanaryE0EntryApprovalRevoke } from '../dist/canary/entryApprovalRevokeRuntime.js';
import {
  assertSignedCanaryTransactionEnvelope,
  assertSignedEntryApprovalRevokeTransaction,
  ViemCanaryExecutor
} from '../dist/canary/viemCanaryExecutor.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02
} from '../dist/canary/swapIntent.js';
import { INK_CHAIN_ID } from '../dist/sentry/contracts.js';
import { WETH9 } from '../dist/tsunami/contracts.js';

// Public deterministic test fixture. Never fund this key/address.
const TEST_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
const TEST_WALLET = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const HASH = `0x${'44'.repeat(32)}`;
const LAUNCHED = '0x1111111111111111111111111111111111111111';
const ENTRY_AMOUNT = 1_000_000n;
const QUOTED_OUT = 2_000_000n;
const GAS = 65_000n;
const MAX_FEE = 5_000_000n;
const MAX_PRIORITY = 1_000_000n;
const NONCE = 9;

const buy = await buildCanarySwapIntent({
  launchId: 'e0-entry-revoke-launch',
  baselineId: 'e0-entry-revoke-baseline',
  quoteBlockNumber: 100n,
  quoteBlockHash: HASH,
  tokenIn: WETH9,
  tokenOut: LAUNCHED,
  fee: 10_000,
  recipient: TEST_WALLET,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: ENTRY_AMOUNT,
  quotedAmountOut: QUOTED_OUT,
  slippageBps: 500,
  chainTimestampSeconds: 1_700_000_000,
  deadlineSeconds: 30
});
const entryApproval = await buildCanaryEntryApprovalIntent(buy);
const revoke = await buildCanaryEntryApprovalRevokeIntent(entryApproval);
assert.notEqual(revoke.actionId, entryApproval.actionId);
assert.notEqual(revoke.actionId, buy.actionId);
assert.equal(revoke.parentEntryApprovalActionId, entryApproval.actionId);
assert.equal(revoke.parentBuyActionId, buy.actionId);
assert.equal(revoke.expectedAllowance, ENTRY_AMOUNT);
assert.equal(revoke.amount, 0n);
const decodedRevoke = decodeFunctionData({ abi: erc20ApprovalAbi, data: revoke.calldata });
assert.equal(decodedRevoke.functionName, 'approve');
assert.equal(getAddress(decodedRevoke.args[0]), getAddress(INK_SWAP_ROUTER_02));
assert.equal(decodedRevoke.args[1], 0n);

let allowance = ENTRY_AMOUNT;
let simulationResult = true;
let balanceReads = 0;
let revokeSimulationCalls = 0;
const fakePublicClient = {
  async getChainId() { return INK_CHAIN_ID; },
  async getBlock({ blockNumber } = {}) {
    return { number: blockNumber ?? 101n, hash: HASH, timestamp: 1_700_000_001n };
  },
  async getBytecode({ address }) {
    if (getAddress(address) === getAddress(WETH9)) return '0x6000';
    throw new Error(`UNEXPECTED_CODE_ADDRESS:${address}`);
  },
  async readContract({ address, functionName, args }) {
    assert.equal(getAddress(address), getAddress(WETH9));
    if (functionName === 'balanceOf') {
      balanceReads += 1;
      return 40_000_000n;
    }
    if (functionName === 'allowance') {
      assert.equal(getAddress(args[0]), getAddress(TEST_WALLET));
      assert.equal(getAddress(args[1]), getAddress(INK_SWAP_ROUTER_02));
      return allowance;
    }
    throw new Error(`UNEXPECTED_READ:${functionName}`);
  },
  async call({ account, to, data, value }) {
    assert.equal(getAddress(account), getAddress(TEST_WALLET));
    assert.equal(getAddress(to), getAddress(WETH9));
    assert.equal(value, 0n);
    const decoded = decodeFunctionData({ abi: erc20ApprovalAbi, data });
    assert.equal(decoded.functionName, 'approve');
    assert.equal(getAddress(decoded.args[0]), getAddress(INK_SWAP_ROUTER_02));
    if (decoded.args[1] === 0n) revokeSimulationCalls += 1;
    return { data: encodeFunctionResult({ abi: erc20ApprovalAbi, functionName: 'approve', result: simulationResult }) };
  },
  async estimateGas() { return GAS; },
  async estimateFeesPerGas() { return { maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: MAX_PRIORITY }; },
  async getTransactionCount() { return NONCE; }
};

const caps = {
  maxQuoteAgeBlocks: 3n,
  maxGas: 100_000n,
  maxFeePerGas: 10_000_000n,
  maxPriorityFeePerGas: 2_000_000n
};
const executor = new ViemCanaryExecutor({ privateKey: TEST_PRIVATE_KEY, caps, publicClient: fakePublicClient });
assert.equal(getAddress(executor.walletAddress), getAddress(TEST_WALLET));

// Existing positive-approval authority remains unchanged: a non-zero allowance is dirty.
await assert.rejects(() => executor.preflightApproval(entryApproval), /CANARY_APPROVAL_DIRTY_ALLOWANCE/);

// Revoke authority is the inverse: only the exact original allowance may be cleared.
allowance = 0n;
await assert.rejects(
  () => executor.preflightEntryApprovalRevoke(revoke),
  /CANARY_ENTRY_APPROVAL_REVOKE_ALLOWANCE_NOT_EXACT/
);
allowance = ENTRY_AMOUNT + 1n;
await assert.rejects(
  () => executor.preflightEntryApprovalRevoke(revoke),
  /CANARY_ENTRY_APPROVAL_REVOKE_ALLOWANCE_NOT_EXACT/
);
allowance = ENTRY_AMOUNT;

simulationResult = false;
await assert.rejects(
  () => executor.preflightEntryApprovalRevoke(revoke),
  /CANARY_ENTRY_APPROVAL_REVOKE_SIMULATION_FALSE/
);
simulationResult = true;

const balanceReadsBeforeRevoke = balanceReads;
const preflight = await executor.preflightEntryApprovalRevoke(revoke);
assert.equal(balanceReads, balanceReadsBeforeRevoke, 'revocation must not depend on token balance');
assert.equal(preflight.actionId, revoke.actionId);
assert.equal(getAddress(preflight.wallet), getAddress(TEST_WALLET));
assert.equal(getAddress(preflight.token), getAddress(WETH9));
assert.equal(preflight.expectedAllowance, ENTRY_AMOUNT);
assert.equal(preflight.amount, 0n);
assert.equal(preflight.allowanceBefore, ENTRY_AMOUNT);

await assert.rejects(
  () => executor.signEntryApprovalRevoke(revoke, { ...preflight, actionId: 'forged-revoke' }),
  /CANARY_ENTRY_APPROVAL_REVOKE_PREFLIGHT_ACTION_ID_MISMATCH/
);
await assert.rejects(
  () => executor.signEntryApprovalRevoke(revoke, { ...preflight, gas: caps.maxGas + 1n }),
  /CANARY_GAS_CAP_EXCEEDED/
);

// Race after preflight: changed allowance must fail before signing.
allowance = ENTRY_AMOUNT - 1n;
await assert.rejects(
  () => executor.signEntryApprovalRevoke(revoke, preflight),
  /CANARY_ENTRY_APPROVAL_REVOKE_ALLOWANCE_CHANGED/
);
allowance = ENTRY_AMOUNT;

const signed = await executor.signEntryApprovalRevoke(revoke, preflight);
assert.equal(signed.actionId, revoke.actionId);
assert.equal(signed.transactionHash, keccak256(signed.serializedTransaction));
await assertSignedEntryApprovalRevokeTransaction(revoke, signed, TEST_WALLET);
await assertSignedCanaryTransactionEnvelope(signed, TEST_WALLET, caps);
const parsed = parseTransaction(signed.serializedTransaction);
assert.equal(parsed.chainId, INK_CHAIN_ID);
assert.equal(getAddress(parsed.to), getAddress(WETH9));
assert.equal(parsed.value ?? 0n, 0n);
assert.equal(parsed.data, revoke.calldata);
assert.equal(getAddress(await recoverTransactionAddress({ serializedTransaction: signed.serializedTransaction })), getAddress(TEST_WALLET));

let runtimeSignCalls = 0;
let runtimeBroadcastCalls = 0;
let runtimeReceiptCalls = 0;
let runtimeAllowance = ENTRY_AMOUNT;
let runtimeReceipt = { status: 'success' };
const runtimeExecutor = {
  walletAddress: TEST_WALLET,
  async getTokenAllowance(token, spender) {
    assert.equal(getAddress(token), getAddress(WETH9));
    assert.equal(getAddress(spender), getAddress(INK_SWAP_ROUTER_02));
    return runtimeAllowance;
  },
  async preflightEntryApprovalRevoke(intent) {
    assert.equal(intent.actionId, revoke.actionId);
    assert.equal(runtimeAllowance, ENTRY_AMOUNT);
    return {
      actionId: intent.actionId,
      wallet: TEST_WALLET,
      token: WETH9,
      spender: INK_SWAP_ROUTER_02,
      expectedAllowance: ENTRY_AMOUNT,
      amount: 0n,
      checkedAtBlock: 101n,
      allowanceBefore: ENTRY_AMOUNT,
      gas: GAS,
      maxFeePerGas: MAX_FEE,
      maxPriorityFeePerGas: MAX_PRIORITY
    };
  },
  async signEntryApprovalRevoke(intent) {
    runtimeSignCalls += 1;
    assert.equal(intent.actionId, revoke.actionId);
    return signed;
  },
  async broadcastExact(tx) {
    runtimeBroadcastCalls += 1;
    assert.equal(tx.transactionHash, signed.transactionHash);
    if (runtimeReceipt?.status === 'success') runtimeAllowance = 0n;
    return tx.transactionHash;
  },
  async getReceiptIfPresent(hash) {
    runtimeReceiptCalls += 1;
    assert.equal(hash, signed.transactionHash);
    return runtimeReceipt;
  }
};

async function withTempStore(prefix, fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(tempDir, 'canary.sqlite');
  const store = new CanaryEntryApprovalRevokeStore(dbPath);
  try {
    return await fn(store);
  } finally {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Exact allowance -> one revoke side effect -> included -> later polls are clean no-ops.
runtimeAllowance = ENTRY_AMOUNT;
runtimeReceipt = { status: 'success' };
runtimeSignCalls = 0;
runtimeBroadcastCalls = 0;
runtimeReceiptCalls = 0;
await withTempStore('sentry-e0-entry-revoke-success-', async (store) => {
  const first = await advanceCanaryE0EntryApprovalRevoke({ parentApproval: entryApproval, store, executor: runtimeExecutor });
  assert.equal(first.action, 'ENTRY_APPROVAL_REVOKE_INCLUDED');
  assert.equal(runtimeSignCalls, 1);
  assert.equal(runtimeBroadcastCalls, 1);
  assert.equal(store.getCommitted()?.state, 'INCLUDED');
  assert.equal(store.getCommitted()?.observedAllowanceAfter, 0n);

  const second = await advanceCanaryE0EntryApprovalRevoke({ parentApproval: entryApproval, store, executor: runtimeExecutor });
  assert.equal(second.action, 'ALREADY_CLEAN');
  assert.equal(runtimeSignCalls, 1);
  assert.equal(runtimeBroadcastCalls, 1);
});

// Already-zero allowance is a pure no-op: no reservation, signature or broadcast.
runtimeAllowance = 0n;
runtimeSignCalls = 0;
runtimeBroadcastCalls = 0;
await withTempStore('sentry-e0-entry-revoke-clean-', async (store) => {
  const result = await advanceCanaryE0EntryApprovalRevoke({ parentApproval: entryApproval, store, executor: runtimeExecutor });
  assert.equal(result.action, 'ALREADY_CLEAN');
  assert.equal(store.getCommitted(), null);
  assert.equal(runtimeSignCalls, 0);
  assert.equal(runtimeBroadcastCalls, 0);
});

// Any non-zero allowance other than the exact parent approval is ambiguous and blocks.
runtimeAllowance = ENTRY_AMOUNT + 1n;
runtimeSignCalls = 0;
runtimeBroadcastCalls = 0;
await withTempStore('sentry-e0-entry-revoke-drift-', async (store) => {
  const result = await advanceCanaryE0EntryApprovalRevoke({ parentApproval: entryApproval, store, executor: runtimeExecutor });
  assert.equal(result.action, 'BLOCKED_SETUP');
  assert.match(result.reason ?? '', /CANARY_ENTRY_APPROVAL_REVOKE_ALLOWANCE_DRIFT/);
  assert.equal(runtimeSignCalls, 0);
  assert.equal(runtimeBroadcastCalls, 0);
});

// Known signed hash with no receipt must never re-sign or rebroadcast on restart.
runtimeAllowance = ENTRY_AMOUNT;
runtimeReceipt = null;
runtimeSignCalls = 0;
runtimeBroadcastCalls = 0;
runtimeReceiptCalls = 0;
await withTempStore('sentry-e0-entry-revoke-restart-', async (store) => {
  const first = await advanceCanaryE0EntryApprovalRevoke({ parentApproval: entryApproval, store, executor: runtimeExecutor });
  assert.equal(first.action, 'ENTRY_APPROVAL_REVOKE_SUBMITTED');
  assert.equal(runtimeSignCalls, 1);
  assert.equal(runtimeBroadcastCalls, 1);
  assert.equal(store.getCommitted()?.state, 'SUBMITTED');

  const second = await advanceCanaryE0EntryApprovalRevoke({ parentApproval: entryApproval, store, executor: runtimeExecutor });
  assert.equal(second.action, 'BLOCKED_UNRESOLVED');
  assert.match(second.reason ?? '', /TX_NOT_YET_OBSERVED_NO_RETRY/);
  assert.equal(runtimeSignCalls, 1);
  assert.equal(runtimeBroadcastCalls, 1);
  assert.ok(runtimeReceiptCalls >= 2);
});

const cycleSource = fs.readFileSync(new URL('../src/canary/cycle.ts', import.meta.url), 'utf8');
const cliSource = fs.readFileSync(new URL('../src/canarySniperCli.ts', import.meta.url), 'utf8');
assert.ok(cycleSource.includes('entryApprovalRevokeRuntime'), 'successor wiring must preserve revoke runtime integration');
assert.ok(cliSource.includes('entryApprovalRevoke'), 'successor wiring must preserve revoke CLI integration');

assert.ok(revokeSimulationCalls >= 3, 'revoke simulation must execute in preflight and signing qualification');
console.log(JSON.stringify({
  verdict: 'CANARY_E0_ENTRY_APPROVAL_REVOKE_R0_PASS',
  chainId: INK_CHAIN_ID,
  parentBuyActionId: buy.actionId,
  parentEntryApprovalActionId: entryApproval.actionId,
  revokeActionId: revoke.actionId,
  token: WETH9,
  spender: INK_SWAP_ROUTER_02,
  expectedAllowance: ENTRY_AMOUNT.toString(),
  revokeAmount: '0',
  exactParentAllowanceRequired: true,
  widenedAllowanceBlocked: true,
  zeroBeforeRevokeIsNoop: true,
  tokenBalanceIndependent: true,
  allowanceRaceBeforeSignBlocked: true,
  postIncludeAllowanceMustBeZero: true,
  knownHashNoResignRebroadcast: true,
  sameViemCanaryExecutorUsed: true,
  preBroadcastSignedEnvelopeValidationPreserved: true,
  cycleWiringAdded: true,
  cliWiringAdded: true,
  networkBroadcastInvoked: false,
  liveCleanupReachable: false,
  realWalletSecretUsed: false,
  testOnlyDeterministicKey: true
}, null, 2));