import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createPublicClient,
  decodeFunctionData,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  keccak256
} from 'viem';
import {
  buildCanaryApprovalIntent,
  CANARY_E0_APPROVAL_R0,
  classifyCanaryApprovalAllowance,
  deriveCanaryApprovalActionId,
  erc20ApprovalAbi,
  ERC20_MAX_UINT256
} from '../dist/canary/approval.js';
import { CanaryApprovalStore } from '../dist/canary/approvalStore.js';
import { CanaryStore } from '../dist/canary/store.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02
} from '../dist/canary/swapIntent.js';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from '../dist/sentry/contracts.js';
import { USDT0, WETH9 } from '../dist/tsunami/contracts.js';

const HASH = `0x${'44'.repeat(32)}`;
const LAUNCHED = '0x1111111111111111111111111111111111111111';
const OTHER_LAUNCHED = '0x3333333333333333333333333333333333333333';
const WALLET = '0x2222222222222222222222222222222222222222';
const OTHER_WALLET = '0x4444444444444444444444444444444444444444';
const OTHER_ROUTER = '0x5555555555555555555555555555555555555555';
const ACQUIRED = 2_000_000n;

const buy = await buildCanarySwapIntent({
  launchId: 'e0-approval-launch', baselineId: 'e0-approval-baseline', quoteBlockNumber: 100n, quoteBlockHash: HASH,
  tokenIn: WETH9, tokenOut: LAUNCHED, fee: 10_000, recipient: WALLET,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: 1_000_000n, quotedAmountOut: ACQUIRED,
  slippageBps: 500, chainTimestampSeconds: 1_700_000_000, deadlineSeconds: 30
});
const approval = await buildCanaryApprovalIntent({ buyIntent: buy, acquiredAmount: ACQUIRED });
assert.equal(approval.version, CANARY_E0_APPROVAL_R0);
assert.equal(approval.parentBuyActionId, buy.actionId);
assert.notEqual(approval.actionId, buy.actionId);
assert.notEqual(approval.actionId, approval.parentExitActionId);
assert.equal(getAddress(approval.owner), getAddress(WALLET));
assert.equal(getAddress(approval.token), getAddress(LAUNCHED));
assert.equal(getAddress(approval.spender), getAddress(INK_SWAP_ROUTER_02));
assert.equal(approval.amount, ACQUIRED);
const decoded = decodeFunctionData({ abi: erc20ApprovalAbi, data: approval.calldata });
assert.equal(decoded.functionName, 'approve');
assert.equal(getAddress(decoded.args[0]), getAddress(INK_SWAP_ROUTER_02));
assert.equal(decoded.args[1], ACQUIRED);

assert.equal(classifyCanaryApprovalAllowance(0n, ACQUIRED), 'APPROVE_EXACT');
assert.equal(classifyCanaryApprovalAllowance(ACQUIRED, ACQUIRED), 'BLOCKED_DIRTY_ALLOWANCE');
assert.equal(classifyCanaryApprovalAllowance(1n, ACQUIRED), 'BLOCKED_DIRTY_ALLOWANCE');
assert.equal(classifyCanaryApprovalAllowance(ACQUIRED + 1n, ACQUIRED), 'BLOCKED_DIRTY_ALLOWANCE');
await assert.rejects(() => buildCanaryApprovalIntent({ buyIntent: buy, acquiredAmount: ERC20_MAX_UINT256 }), /CANARY_APPROVAL_INFINITE_ALLOWANCE_FORBIDDEN/);
await assert.rejects(() => buildCanaryApprovalIntent({ buyIntent: { ...buy, router: OTHER_ROUTER }, acquiredAmount: ACQUIRED }), /CANARY_APPROVAL_PARENT_ROUTER_INVALID/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-e0-approval-r0-'));
const dbPath = path.join(tempDir, 'approval.sqlite');
const buyStore = new CanaryStore(dbPath);
const approvalStoreA = new CanaryApprovalStore(dbPath);
const approvalStoreB = new CanaryApprovalStore(dbPath);
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
    transactionHash: `0x${'66'.repeat(32)}`,
    serializedTransaction: '0x01',
    lastError: null,
    outputBalanceBefore: 10_000n,
    outputBalanceAfter: 2_010_000n,
    createdAtMs: now,
    updatedAtMs: now
  }), 'INSERTED');

  const record = {
    actionId: approval.actionId,
    parentBuyActionId: buy.actionId,
    parentExitActionId: approval.parentExitActionId,
    launchId: buy.launchId,
    baselineId: buy.baselineId,
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
  };

  await assert.rejects(() => approvalStoreA.insertReserved({ ...record, observedAllowanceBefore: 1n }), /CANARY_APPROVAL_DIRTY_ALLOWANCE/);

  const partialApproval = await buildCanaryApprovalIntent({ buyIntent: buy, acquiredAmount: ACQUIRED - 1n });
  await assert.rejects(() => approvalStoreA.insertReserved({
    ...record,
    actionId: partialApproval.actionId,
    parentExitActionId: partialApproval.parentExitActionId,
    intent: partialApproval
  }), /CANARY_APPROVAL_AMOUNT_MUST_EQUAL_ACQUIRED/);

  const tamperedBuy = { ...buy, tokenOut: OTHER_LAUNCHED };
  assert.equal(tamperedBuy.actionId, buy.actionId);
  const tamperedApproval = await buildCanaryApprovalIntent({ buyIntent: tamperedBuy, acquiredAmount: ACQUIRED });
  await assert.rejects(() => approvalStoreA.insertReserved({
    ...record,
    actionId: tamperedApproval.actionId,
    parentExitActionId: tamperedApproval.parentExitActionId,
    intent: tamperedApproval
  }), /CANARY_APPROVAL_PERSISTED_PARENT_INTENT_BINDING_MISMATCH/);

  const tamperedOwnerActionId = await deriveCanaryApprovalActionId({
    parentBuyActionId: approval.parentBuyActionId,
    parentExitActionId: approval.parentExitActionId,
    launchId: approval.launchId,
    baselineId: approval.baselineId,
    owner: OTHER_WALLET,
    token: approval.token,
    spender: approval.spender,
    amount: approval.amount
  });
  const tamperedOwnerApproval = { ...approval, owner: OTHER_WALLET, actionId: tamperedOwnerActionId };
  await assert.rejects(() => approvalStoreA.insertReserved({
    ...record,
    actionId: tamperedOwnerActionId,
    intent: tamperedOwnerApproval
  }), /CANARY_APPROVAL_PERSISTED_PARENT_INTENT_BINDING_MISMATCH/);

  const malformedCalldata = encodeFunctionData({
    abi: erc20ApprovalAbi,
    functionName: 'approve',
    args: [INK_SWAP_ROUTER_02, ACQUIRED + 1n]
  });
  await assert.rejects(() => approvalStoreA.insertReserved({
    ...record,
    intent: { ...approval, calldata: malformedCalldata }
  }), /CANARY_APPROVAL_CALLDATA_AMOUNT_MISMATCH/);

  assert.equal(await approvalStoreA.insertReserved(record), 'INSERTED');
  assert.equal(await approvalStoreB.insertReserved(record), 'DUPLICATE', 'concurrent observers must converge on one approval action');
  assert.equal(approvalStoreA.listUnresolved().length, 1);

  const serializedTransaction = '0x02';
  const signed = {
    nonce: 8,
    transactionHash: keccak256(serializedTransaction),
    serializedTransaction
  };
  assert.throws(() => approvalStoreA.markSigned(approval.actionId, { ...signed, transactionHash: `0x${'77'.repeat(32)}` }), /CANARY_APPROVAL_SIGNED_IDENTITY_MISMATCH/);
  approvalStoreA.markSigned(approval.actionId, signed);
  assert.equal(approvalStoreA.listUnresolved()[0].state, 'SIGNED');
  approvalStoreA.markSubmitted(approval.actionId);
  approvalStoreA.markSafeHalt(approval.actionId, 'SIMULATED_RPC_TIMEOUT_AFTER_BROADCAST');
  const halted = approvalStoreA.listUnresolved();
  assert.equal(halted.length, 1);
  assert.equal(halted[0].state, 'SAFE_HALT');
  assert.equal(halted[0].transactionHash, signed.transactionHash);
  assert.equal(halted[0].serializedTransaction, signed.serializedTransaction);
  assert.throws(() => approvalStoreA.markIncluded(approval.actionId, ACQUIRED + 1n), /CANARY_APPROVAL_POST_ALLOWANCE_NOT_EXACT/);
  approvalStoreA.markIncluded(approval.actionId, ACQUIRED);
  assert.equal(approvalStoreA.listUnresolved().length, 0);
} finally {
  approvalStoreB.close();
  approvalStoreA.close();
  buyStore.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// Read-only chain qualification only. This proves the configured Ink RPC can
// simulate an exact ERC-20 approve call on a known token. Every future candidate
// token must still be simulated again at runtime before signing.
const ink = defineChain({
  id: INK_CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL] } }
});
const client = createPublicClient({ chain: ink, transport: http(process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL) });
assert.equal(await client.getChainId(), INK_CHAIN_ID);
for (const address of [USDT0, INK_SWAP_ROUTER_02]) {
  const code = await client.getBytecode({ address });
  assert.ok(code && code !== '0x', `code must exist at ${address}`);
}
const readOnlyCalldata = encodeFunctionData({ abi: erc20ApprovalAbi, functionName: 'approve', args: [INK_SWAP_ROUTER_02, 1n] });
await client.call({ account: WALLET, to: USDT0, data: readOnlyCalldata, value: 0n });

console.log(JSON.stringify({
  verdict: 'CANARY_E0_APPROVAL_LIFECYCLE_R0_PASS',
  chainId: INK_CHAIN_ID,
  owner: WALLET,
  spender: INK_SWAP_ROUTER_02,
  readOnlySimulationToken: USDT0,
  exactApprovalAmount: ACQUIRED.toString(),
  preApprovalAllowancePolicy: 'ZERO_ONLY',
  dirtyAllowancePolicy: 'FAIL_CLOSED',
  infiniteAllowance: 'FORBIDDEN',
  persistedBeforeBroadcast: ['actionId', 'nonce', 'transactionHash', 'serializedTransaction'],
  ambiguousOutcomePolicy: 'SAFE_HALT_RECONCILE_KNOWN_HASH_NO_RETRY',
  live: false,
  walletAuthorityUsed: false
}, null, 2));
