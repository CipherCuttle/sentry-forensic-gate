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
import { privateKeyToAccount } from 'viem/accounts';
import { buildCanaryApprovalIntent, erc20ApprovalAbi } from '../dist/canary/approval.js';
import { CanaryApprovalStore } from '../dist/canary/approvalStore.js';
import { CanaryStore } from '../dist/canary/store.js';
import {
  assertSignedApprovalTransaction,
  ViemCanaryExecutor
} from '../dist/canary/viemCanaryExecutor.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02
} from '../dist/canary/swapIntent.js';
import { INK_CHAIN_ID } from '../dist/sentry/contracts.js';
import { WETH9 } from '../dist/tsunami/contracts.js';

// Public, deterministic fixture key. DO NOT FUND. This qualifies offline signing
// without using CANARY_PRIVATE_KEY, repository secrets, or any live wallet authority.
const TEST_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_WALLET = testAccount.address;
const HASH = `0x${'44'.repeat(32)}`;
const LAUNCHED = '0x1111111111111111111111111111111111111111';
const ACQUIRED = 2_000_000n;
const GAS = 65_000n;
const MAX_FEE = 5_000_000n;
const MAX_PRIORITY = 1_000_000n;

const buy = await buildCanarySwapIntent({
  launchId: 'e0-approval-executor-launch',
  baselineId: 'e0-approval-executor-baseline',
  quoteBlockNumber: 100n,
  quoteBlockHash: HASH,
  tokenIn: WETH9,
  tokenOut: LAUNCHED,
  fee: 10_000,
  recipient: TEST_WALLET,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: 1_000_000n,
  quotedAmountOut: ACQUIRED,
  slippageBps: 500,
  chainTimestampSeconds: 1_700_000_000,
  deadlineSeconds: 30
});
const approval = await buildCanaryApprovalIntent({ buyIntent: buy, acquiredAmount: ACQUIRED });

let allowance = 0n;
let tokenBalance = ACQUIRED;
let simulationResult = true;
let callCount = 0;
let nonce = 9;
const fakePublicClient = {
  async getChainId() { return INK_CHAIN_ID; },
  async getBlock() {
    return { number: 101n, hash: HASH, timestamp: 1_700_000_001n };
  },
  async getBytecode({ address }) {
    assert.equal(getAddress(address), getAddress(LAUNCHED));
    return '0x6000';
  },
  async readContract({ address, functionName, args }) {
    assert.equal(getAddress(address), getAddress(LAUNCHED));
    if (functionName === 'balanceOf') {
      assert.equal(getAddress(args[0]), getAddress(TEST_WALLET));
      return tokenBalance;
    }
    if (functionName === 'allowance') {
      assert.equal(getAddress(args[0]), getAddress(TEST_WALLET));
      assert.equal(getAddress(args[1]), getAddress(INK_SWAP_ROUTER_02));
      return allowance;
    }
    throw new Error(`UNEXPECTED_READ:${functionName}`);
  },
  async call({ account, to, data, value }) {
    callCount += 1;
    assert.equal(getAddress(account), getAddress(TEST_WALLET));
    assert.equal(getAddress(to), getAddress(LAUNCHED));
    assert.equal(value, 0n);
    const decoded = decodeFunctionData({ abi: erc20ApprovalAbi, data });
    assert.equal(decoded.functionName, 'approve');
    assert.equal(getAddress(decoded.args[0]), getAddress(INK_SWAP_ROUTER_02));
    assert.equal(decoded.args[1], ACQUIRED);
    return {
      data: encodeFunctionResult({ abi: erc20ApprovalAbi, functionName: 'approve', result: simulationResult })
    };
  },
  async estimateGas() { return GAS; },
  async estimateFeesPerGas() {
    return { maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: MAX_PRIORITY };
  },
  async getTransactionCount() { return nonce; }
};

const caps = {
  maxQuoteAgeBlocks: 3n,
  maxGas: 100_000n,
  maxFeePerGas: 10_000_000n,
  maxPriorityFeePerGas: 2_000_000n
};
const executor = new ViemCanaryExecutor({
  privateKey: TEST_PRIVATE_KEY,
  caps,
  publicClient: fakePublicClient
});
assert.equal(getAddress(executor.account.address), getAddress(TEST_WALLET));

// Dirty allowance is a hard block before simulation/signing.
allowance = 1n;
await assert.rejects(() => executor.preflightApproval(approval), /CANARY_APPROVAL_DIRTY_ALLOWANCE/);
allowance = 0n;

// A token that returns false from approve simulation is fail-closed.
simulationResult = false;
await assert.rejects(() => executor.preflightApproval(approval), /CANARY_APPROVAL_SIMULATION_FALSE/);
simulationResult = true;

const preflight = await executor.preflightApproval(approval);
assert.equal(preflight.actionId, approval.actionId);
assert.equal(getAddress(preflight.wallet), getAddress(TEST_WALLET));
assert.equal(getAddress(preflight.token), getAddress(LAUNCHED));
assert.equal(getAddress(preflight.spender), getAddress(INK_SWAP_ROUTER_02));
assert.equal(preflight.amount, ACQUIRED);
assert.equal(preflight.allowanceBefore, 0n);
assert.equal(preflight.gas, GAS);

// Preflight identity/caps cannot be swapped or widened before signing.
await assert.rejects(
  () => executor.signApproval(approval, { ...preflight, actionId: 'forged-action' }),
  /CANARY_APPROVAL_PREFLIGHT_ACTION_ID_MISMATCH/
);
await assert.rejects(
  () => executor.signApproval(approval, { ...preflight, gas: caps.maxGas + 1n }),
  /CANARY_GAS_CAP_EXCEEDED/
);

// Race after preflight: non-zero allowance must be caught again at sign time.
allowance = 1n;
await assert.rejects(() => executor.signApproval(approval, preflight), /CANARY_APPROVAL_ALLOWANCE_CHANGED/);
allowance = 0n;

// Balance must also still cover the exact acquired amount at signing time.
tokenBalance = ACQUIRED - 1n;
await assert.rejects(() => executor.signApproval(approval, preflight), /CANARY_APPROVAL_TOKEN_BALANCE_CHANGED/);
tokenBalance = ACQUIRED;

const signed = await executor.signApproval(approval, preflight);
assert.equal(signed.actionId, approval.actionId);
assert.equal(signed.nonce, nonce);
assert.equal(signed.transactionHash, keccak256(signed.serializedTransaction));
assert.equal(signed.serializedTransactionKeccak256, signed.transactionHash);
await assertSignedApprovalTransaction(approval, signed, TEST_WALLET);

const parsed = parseTransaction(signed.serializedTransaction);
assert.equal(parsed.chainId, INK_CHAIN_ID);
assert.equal(getAddress(parsed.to), getAddress(LAUNCHED));
assert.equal(parsed.value ?? 0n, 0n);
assert.equal(parsed.data, approval.calldata);
assert.equal(parsed.nonce, nonce);
assert.equal(parsed.gas, GAS);
assert.equal(parsed.maxFeePerGas, MAX_FEE);
assert.equal(parsed.maxPriorityFeePerGas, MAX_PRIORITY);
assert.equal(getAddress(await recoverTransactionAddress({ serializedTransaction: signed.serializedTransaction })), getAddress(TEST_WALLET));

// Prove the signed bytes/hash can be persisted before any broadcast boundary and
// then reconciled by the already-qualified approval ledger without creating a retry.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-e0-approval-executor-r0-'));
const dbPath = path.join(tempDir, 'canary.sqlite');
const buyStore = new CanaryStore(dbPath);
const approvalStore = new CanaryApprovalStore(dbPath);
try {
  const now = 1_700_000_000_000;
  assert.equal(buyStore.insert({
    actionId: buy.actionId,
    launchId: buy.launchId,
    baselineId: buy.baselineId,
    decision: 'PASS',
    reasons: [],
    state: 'INCLUDED',
    originDecisionBlock: 100n,
    originDecisionBlockHash: HASH,
    intent: buy,
    nonce: 7,
    transactionHash: keccak256('0x01'),
    serializedTransaction: '0x01',
    lastError: null,
    outputBalanceBefore: 10_000n,
    outputBalanceAfter: 10_000n + ACQUIRED,
    createdAtMs: now,
    updatedAtMs: now
  }), 'INSERTED');
  assert.equal(await approvalStore.insertReserved({
    actionId: approval.actionId,
    parentBuyActionId: approval.parentBuyActionId,
    parentExitActionId: approval.parentExitActionId,
    launchId: approval.launchId,
    baselineId: approval.baselineId,
    state: 'RESERVED',
    intent: approval,
    observedAllowanceBefore: 0n,
    observedAllowanceAfter: null,
    nonce: null,
    transactionHash: null,
    serializedTransaction: null,
    lastError: null,
    createdAtMs: now + 1,
    updatedAtMs: now + 1
  }), 'INSERTED');

  approvalStore.markSigned(approval.actionId, {
    nonce: signed.nonce,
    transactionHash: signed.transactionHash,
    serializedTransaction: signed.serializedTransaction
  });
  let unresolved = approvalStore.listUnresolved();
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].state, 'SIGNED');
  assert.equal(unresolved[0].transactionHash, signed.transactionHash);
  assert.equal(unresolved[0].serializedTransaction, signed.serializedTransaction);

  approvalStore.markSubmitted(approval.actionId);
  approvalStore.markSafeHalt(approval.actionId, 'SIMULATED_TIMEOUT_AFTER_EXACT_BROADCAST_BOUNDARY');
  unresolved = approvalStore.listUnresolved();
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].state, 'SAFE_HALT');
  assert.equal(unresolved[0].transactionHash, signed.transactionHash);
  assert.equal(unresolved[0].serializedTransaction, signed.serializedTransaction);
  approvalStore.markIncluded(approval.actionId, ACQUIRED);
  assert.equal(approvalStore.listUnresolved().length, 0);
} finally {
  approvalStore.close();
  buyStore.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

assert.ok(callCount >= 3, 'approval simulation must run during qualification and again before signing');
console.log(JSON.stringify({
  verdict: 'CANARY_E0_APPROVAL_EXECUTOR_R0_PASS',
  chainId: INK_CHAIN_ID,
  actionId: approval.actionId,
  owner: TEST_WALLET,
  token: LAUNCHED,
  spender: INK_SWAP_ROUTER_02,
  exactApprovalAmount: ACQUIRED.toString(),
  signedTo: LAUNCHED,
  signedValue: '0',
  signedHash: signed.transactionHash,
  persistedBeforeBroadcastBoundary: true,
  signTimeAllowanceRecheck: 'ZERO_ONLY',
  signTimeBalanceRecheck: 'REQUIRED',
  preflightIdentityBinding: 'REQUIRED',
  gasAndFeeCapsRecheckedAtSigning: true,
  ambiguousOutcomePolicy: 'SAFE_HALT_RECONCILE_KNOWN_HASH_NO_RETRY',
  broadcastInvoked: false,
  live: false,
  walletSecretUsed: false,
  testOnlyDeterministicKey: true
}, null, 2));
