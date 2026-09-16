import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAddress, keccak256 } from 'viem';
import { buildCanaryApprovalIntent } from '../dist/canary/approval.js';
import { CanaryApprovalStore } from '../dist/canary/approvalStore.js';
import { CanaryExitStore } from '../dist/canary/exitStore.js';
import { advanceCanaryE0RoundTrip } from '../dist/canary/roundTripRuntime.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02
} from '../dist/canary/swapIntent.js';
import { CanaryStore } from '../dist/canary/store.js';
import { WETH9 } from '../dist/tsunami/contracts.js';

const WALLET = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const LAUNCHED = '0x1111111111111111111111111111111111111111';
const POOL = '0x2222222222222222222222222222222222222222';
const BLOCK_HASH = `0x${'44'.repeat(32)}`;
const ACQUIRED = 2_000_000n;
const BASE_BEFORE = 5_000_000n;
const BASE_AFTER = 5_900_000n;
const EXIT_AMOUNT_OUT = 900_000n;
const GAS = 80_000n;
const MAX_FEE = 5_000_000n;
const MAX_PRIORITY = 1_000_000n;
const options = { slippageBps: 500, deadlineSeconds: 30 };

const buy = await buildCanarySwapIntent({
  launchId: 'e0-roundtrip-runtime-launch',
  baselineId: 'e0-roundtrip-runtime-baseline',
  quoteBlockNumber: 100n,
  quoteBlockHash: BLOCK_HASH,
  tokenIn: WETH9,
  tokenOut: LAUNCHED,
  fee: 10_000,
  recipient: WALLET,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: 1_000_000n,
  quotedAmountOut: ACQUIRED,
  slippageBps: 500,
  chainTimestampSeconds: 1_700_000_000,
  deadlineSeconds: 30
});

const exitQuote = {
  quoteId: 'e0-roundtrip-runtime-exit-quote',
  launchId: buy.launchId,
  blockNumber: 101n,
  blockHash: BLOCK_HASH,
  observedAtMs: 1_700_000_001_000,
  kind: 'INDEPENDENT_REVERSE_EXIT',
  mode: 'EXACT_INPUT',
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  pool: POOL,
  tokenIn: LAUNCHED,
  tokenOut: WETH9,
  fee: buy.fee,
  amountIn: ACQUIRED,
  amountOut: EXIT_AMOUNT_OUT,
  executable: true
};

let allowance = 0n;
let broadcastCalls = 0;
let approvalSignCalls = 0;
let exitSignCalls = 0;
let exitReceiptVisible = false;
let approvalActionId = null;
let exitActionId = null;
let exitHash = null;
const approvalHash = keccak256('0xa1');

const executor = {
  walletAddress: WALLET,
  async getChainClock() {
    return { blockNumber: 102n, blockHash: BLOCK_HASH, timestampSeconds: 1_700_000_002 };
  },
  async preflightApproval(intent) {
    assert.equal(getAddress(intent.owner), getAddress(WALLET));
    assert.equal(getAddress(intent.token), getAddress(LAUNCHED));
    assert.equal(getAddress(intent.spender), getAddress(INK_SWAP_ROUTER_02));
    assert.equal(intent.amount, ACQUIRED);
    assert.equal(allowance, 0n);
    approvalActionId = intent.actionId;
    return {
      actionId: intent.actionId,
      wallet: WALLET,
      token: LAUNCHED,
      spender: INK_SWAP_ROUTER_02,
      amount: ACQUIRED,
      checkedAtBlock: 102n,
      tokenBalance: ACQUIRED,
      allowanceBefore: 0n,
      gas: GAS,
      maxFeePerGas: MAX_FEE,
      maxPriorityFeePerGas: MAX_PRIORITY
    };
  },
  async signApproval(intent, preflight) {
    approvalSignCalls += 1;
    assert.equal(intent.actionId, preflight.actionId);
    return makeSigned(intent.actionId, 7, '0xa1');
  },
  async preflight(intent) {
    assert.equal(getAddress(intent.tokenIn), getAddress(LAUNCHED));
    assert.equal(getAddress(intent.tokenOut), getAddress(WETH9));
    assert.equal(intent.amountIn, ACQUIRED);
    assert.equal(allowance, ACQUIRED, 'exit requires exact included approval before preflight');
    exitActionId = intent.actionId;
    return {
      wallet: WALLET,
      checkedAtBlock: 102n,
      inputBalance: ACQUIRED,
      inputAllowance: allowance,
      outputBalanceBefore: BASE_BEFORE,
      gas: GAS,
      maxFeePerGas: MAX_FEE,
      maxPriorityFeePerGas: MAX_PRIORITY
    };
  },
  async sign(intent) {
    exitSignCalls += 1;
    return makeSigned(intent.actionId, 8, '0xb2');
  },
  async broadcastExact(signed) {
    broadcastCalls += 1;
    if (signed.actionId === approvalActionId) {
      allowance = ACQUIRED;
      return approvalHash;
    }
    assert.equal(signed.actionId, exitActionId);
    exitHash = signed.transactionHash;
    return signed.transactionHash;
  },
  async getReceiptIfPresent(hash) {
    if (hash === approvalHash) return { status: 'success' };
    if (exitHash && hash === exitHash && exitReceiptVisible) return { status: 'success' };
    return null;
  },
  async getTokenAllowance(token, spender) {
    assert.equal(getAddress(token), getAddress(LAUNCHED));
    assert.equal(getAddress(spender), getAddress(INK_SWAP_ROUTER_02));
    return allowance;
  },
  async getTokenBalance(token) {
    if (getAddress(token) === getAddress(WETH9)) return BASE_AFTER;
    if (getAddress(token) === getAddress(LAUNCHED)) return ACQUIRED;
    throw new Error(`UNEXPECTED_TOKEN_BALANCE:${token}`);
  }
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-e0-roundtrip-runtime-r0-'));
const dbPath = path.join(tempDir, 'canary.sqlite');
const buyStore = new CanaryStore(dbPath);
const approvalStore = new CanaryApprovalStore(dbPath);
const exitStore = new CanaryExitStore(dbPath);
try {
  seedIncludedBuy(buyStore, buy);

  const approvalResult = await advanceCanaryE0RoundTrip({
    buyActionId: buy.actionId, buyStore, approvalStore, exitStore, executor, options, exitQuote
  });
  assert.equal(approvalResult.action, 'APPROVAL_INCLUDED');
  assert.equal(approvalSignCalls, 1);
  assert.equal(exitSignCalls, 0, 'exit must not be signed in same advance call as approval');
  assert.equal(broadcastCalls, 1);
  assert.equal(approvalStore.getByParentBuyActionId(buy.actionId)?.state, 'INCLUDED');
  assert.equal(exitStore.getByParentBuyActionId(buy.actionId), null);

  const forgedQuote = { ...exitQuote, tokenOut: LAUNCHED };
  const forgedResult = await advanceCanaryE0RoundTrip({
    buyActionId: buy.actionId, buyStore, approvalStore, exitStore, executor, options, exitQuote: forgedQuote
  });
  assert.equal(forgedResult.action, 'BLOCKED_SETUP');
  assert.match(forgedResult.reason ?? '', /CANARY_E0_EXIT_QUOTE_TOKEN_OUT_MISMATCH/);
  assert.equal(broadcastCalls, 1, 'forged exit quote must fail before side effect');
  assert.equal(exitStore.getByParentBuyActionId(buy.actionId), null);

  const exitSubmit = await advanceCanaryE0RoundTrip({
    buyActionId: buy.actionId, buyStore, approvalStore, exitStore, executor, options, exitQuote
  });
  assert.equal(exitSubmit.action, 'EXIT_SUBMITTED');
  assert.equal(approvalSignCalls, 1);
  assert.equal(exitSignCalls, 1);
  assert.equal(broadcastCalls, 2);
  assert.equal(exitStore.getByParentBuyActionId(buy.actionId)?.state, 'SUBMITTED');

  const ambiguous = await advanceCanaryE0RoundTrip({
    buyActionId: buy.actionId, buyStore, approvalStore, exitStore, executor, options, exitQuote
  });
  assert.equal(ambiguous.action, 'BLOCKED_UNRESOLVED');
  assert.match(ambiguous.reason ?? '', /CANARY_E0_EXIT_TX_NOT_YET_OBSERVED_NO_RETRY/);
  assert.equal(exitSignCalls, 1, 'ambiguous exit must never be re-signed');
  assert.equal(broadcastCalls, 2, 'ambiguous exit must never be rebroadcast');

  exitReceiptVisible = true;
  const reconciled = await advanceCanaryE0RoundTrip({
    buyActionId: buy.actionId, buyStore, approvalStore, exitStore, executor, options, exitQuote
  });
  assert.equal(reconciled.action, 'EXIT_INCLUDED');
  const includedExit = exitStore.getByParentBuyActionId(buy.actionId);
  assert.equal(includedExit?.state, 'INCLUDED');
  assert.equal(includedExit?.outputBalanceBefore, BASE_BEFORE);
  assert.equal(includedExit?.outputBalanceAfter, BASE_AFTER);

  const complete = await advanceCanaryE0RoundTrip({
    buyActionId: buy.actionId, buyStore, approvalStore, exitStore, executor, options, exitQuote
  });
  assert.equal(complete.action, 'COMPLETE');
  assert.equal(approvalSignCalls, 1);
  assert.equal(exitSignCalls, 1);
  assert.equal(broadcastCalls, 2, 'complete round trip must be idempotent');
} finally {
  exitStore.close();
  approvalStore.close();
  buyStore.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// Independent crash fixture: RESERVED approval after restart becomes SAFE_HALT and
// can never be signed/retried by the coordinator.
const crashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-e0-roundtrip-crash-r0-'));
const crashDb = path.join(crashDir, 'canary.sqlite');
const crashBuyStore = new CanaryStore(crashDb);
const crashApprovalStore = new CanaryApprovalStore(crashDb);
const crashExitStore = new CanaryExitStore(crashDb);
try {
  seedIncludedBuy(crashBuyStore, buy);
  const approval = await buildCanaryApprovalIntent({ buyIntent: buy, acquiredAmount: ACQUIRED });
  assert.equal(await crashApprovalStore.insertReserved({
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
    createdAtMs: 1_700_000_010_000,
    updatedAtMs: 1_700_000_010_000
  }), 'INSERTED');
  const signsBefore = approvalSignCalls;
  const broadcastsBefore = broadcastCalls;
  const crashResult = await advanceCanaryE0RoundTrip({
    buyActionId: buy.actionId,
    buyStore: crashBuyStore,
    approvalStore: crashApprovalStore,
    exitStore: crashExitStore,
    executor,
    options,
    exitQuote
  });
  assert.equal(crashResult.action, 'BLOCKED_UNRESOLVED');
  assert.match(crashResult.reason ?? '', /CANARY_E0_RESTART_AFTER_APPROVAL_RESERVATION_NO_RETRY/);
  assert.equal(crashApprovalStore.getByParentBuyActionId(buy.actionId)?.state, 'SAFE_HALT');
  assert.equal(approvalSignCalls, signsBefore);
  assert.equal(broadcastCalls, broadcastsBefore);
} finally {
  crashExitStore.close();
  crashApprovalStore.close();
  crashBuyStore.close();
  fs.rmSync(crashDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  verdict: 'CANARY_E0_ROUNDTRIP_RUNTIME_R0_PASS',
  buyActionId: buy.actionId,
  approvalActionId,
  exitActionId,
  approvalSignCalls,
  exitSignCalls,
  broadcastBoundaryCalls: broadcastCalls,
  oneSideEffectingChildPerAdvance: true,
  forgedExitQuoteBlockedBeforeSideEffect: true,
  ambiguousExitNoResign: true,
  ambiguousExitNoRebroadcast: true,
  reservedApprovalRestartSafeHalt: true,
  persistedBuyRereadRequired: true,
  live: false,
  walletSecretUsed: false,
  networkBroadcastInvoked: false
}, null, 2));

function makeSigned(actionId, nonce, serializedTransaction) {
  const transactionHash = keccak256(serializedTransaction);
  return {
    actionId,
    nonce,
    transactionHash,
    serializedTransaction,
    serializedTransactionKeccak256: transactionHash,
    gas: GAS,
    maxFeePerGas: MAX_FEE,
    maxPriorityFeePerGas: MAX_PRIORITY
  };
}

function seedIncludedBuy(store, intent) {
  const now = 1_700_000_000_000;
  assert.equal(store.insert({
    actionId: intent.actionId,
    launchId: intent.launchId,
    baselineId: intent.baselineId,
    decision: 'PASS',
    reasons: [],
    state: 'INCLUDED',
    originDecisionBlock: 100n,
    originDecisionBlockHash: BLOCK_HASH,
    intent,
    nonce: 6,
    transactionHash: keccak256('0x01'),
    serializedTransaction: '0x01',
    lastError: null,
    outputBalanceBefore: 10_000n,
    outputBalanceAfter: 10_000n + ACQUIRED,
    createdAtMs: now,
    updatedAtMs: now
  }), 'INSERTED');
}
