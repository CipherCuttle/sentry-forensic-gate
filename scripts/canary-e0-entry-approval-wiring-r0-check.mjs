import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAddress, keccak256 } from 'viem';
import { advanceCanaryE0EntryApproval } from '../dist/canary/entryApprovalRuntime.js';
import { CanaryEntryApprovalStore } from '../dist/canary/entryApprovalStore.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02
} from '../dist/canary/swapIntent.js';
import { WETH9 } from '../dist/tsunami/contracts.js';

const TEST_WALLET = '0x1111111111111111111111111111111111111111';
const LAUNCHED = '0x2222222222222222222222222222222222222222';
const OTHER_LAUNCHED = '0x3333333333333333333333333333333333333333';
const HASH = `0x${'44'.repeat(32)}`;
const ENTRY_AMOUNT = 1_000_000n;
const QUOTED_OUT = 2_000_000n;
const SERIALIZED = '0x1234';
const TX_HASH = keccak256(SERIALIZED);

async function makeBuy({ amountIn = ENTRY_AMOUNT, tokenOut = LAUNCHED } = {}) {
  return buildCanarySwapIntent({
    launchId: 'e0-entry-wiring-launch',
    baselineId: 'e0-entry-wiring-baseline',
    quoteBlockNumber: 100n,
    quoteBlockHash: HASH,
    tokenIn: WETH9,
    tokenOut,
    fee: 10_000,
    recipient: TEST_WALLET,
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
    amountIn,
    quotedAmountOut: QUOTED_OUT,
    slippageBps: 500,
    chainTimestampSeconds: 1_700_000_000,
    deadlineSeconds: 30
  });
}

const buy = await makeBuy();
let allowance = 0n;
let signCalls = 0;
let fakeBroadcastBoundaryCalls = 0;
let receiptCalls = 0;
let reservationCapabilityObserved = false;
let frozenParentBuyAuthorityObserved = false;
const executor = {
  walletAddress: TEST_WALLET,
  async preflightApproval(intent) {
    assert.equal(getAddress(intent.owner), getAddress(TEST_WALLET));
    assert.equal(getAddress(intent.token), getAddress(WETH9));
    assert.equal(getAddress(intent.spender), getAddress(INK_SWAP_ROUTER_02));
    assert.equal(intent.amount, ENTRY_AMOUNT);
    assert.equal(allowance, 0n);
    return {
      actionId: intent.actionId,
      wallet: TEST_WALLET,
      token: WETH9,
      spender: INK_SWAP_ROUTER_02,
      amount: ENTRY_AMOUNT,
      checkedAtBlock: 101n,
      tokenBalance: 40_000_000n,
      allowanceBefore: 0n,
      gas: 65_000n,
      maxFeePerGas: 5_000_000n,
      maxPriorityFeePerGas: 1_000_000n
    };
  },
  async signEntryApprovalReserved({ intent, preflight, store: authorityStore, signingCapability }) {
    assert.equal(preflight.actionId, intent.actionId);
    authorityStore.assertSigningAuthority(intent.actionId, signingCapability);
    reservationCapabilityObserved = true;
    const frozenParentBuy = await authorityStore.consumeSigningAuthority(intent.actionId, signingCapability);
    assert.equal(frozenParentBuy.actionId, intent.parentBuyActionId);
    assert.equal(frozenParentBuy.launchId, intent.launchId);
    assert.equal(frozenParentBuy.baselineId, intent.baselineId);
    assert.equal(getAddress(frozenParentBuy.tokenIn), getAddress(intent.token));
    assert.equal(getAddress(frozenParentBuy.tokenOut), getAddress(intent.buyTokenOut));
    assert.equal(frozenParentBuy.fee, intent.buyFee);
    assert.equal(frozenParentBuy.amountIn, intent.amount);
    assert.equal(frozenParentBuy.quoteBlockNumber, intent.sourceQuoteBlockNumber);
    assert.equal(frozenParentBuy.quoteBlockHash.toLowerCase(), intent.sourceQuoteBlockHash.toLowerCase());
    frozenParentBuyAuthorityObserved = true;
    signCalls += 1;
    return {
      actionId: intent.actionId,
      nonce: 7,
      transactionHash: TX_HASH,
      serializedTransaction: SERIALIZED,
      serializedTransactionKeccak256: TX_HASH,
      gas: 65_000n,
      maxFeePerGas: 5_000_000n,
      maxPriorityFeePerGas: 1_000_000n
    };
  },
  async broadcastExact(signed) {
    fakeBroadcastBoundaryCalls += 1;
    assert.equal(signed.transactionHash, TX_HASH);
    allowance = ENTRY_AMOUNT;
    return TX_HASH;
  },
  async getReceiptIfPresent(hash) {
    receiptCalls += 1;
    assert.equal(hash, TX_HASH);
    return { status: 'success' };
  },
  async getTokenAllowance(token, spender) {
    assert.equal(getAddress(token), getAddress(WETH9));
    assert.equal(getAddress(spender), getAddress(INK_SWAP_ROUTER_02));
    return allowance;
  }
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-e0-entry-wiring-r0-'));
const dbPath = path.join(tempDir, 'canary.sqlite');
const store = new CanaryEntryApprovalStore(dbPath);
try {
  const first = await advanceCanaryE0EntryApproval({ plannedBuy: buy, store, executor });
  assert.equal(first.action, 'ENTRY_APPROVAL_INCLUDED');
  assert.equal(signCalls, 1);
  assert.equal(fakeBroadcastBoundaryCalls, 1);
  assert.equal(reservationCapabilityObserved, true);
  assert.equal(frozenParentBuyAuthorityObserved, true);
  assert.equal(store.getCommitted()?.state, 'INCLUDED');

  const second = await advanceCanaryE0EntryApproval({ plannedBuy: buy, store, executor });
  assert.equal(second.action, 'READY_TO_BUY');
  assert.equal(signCalls, 1, 'included approval must not sign again');
  assert.equal(fakeBroadcastBoundaryCalls, 1, 'included approval must not rebroadcast');

  const amountDrift = await advanceCanaryE0EntryApproval({
    plannedBuy: await makeBuy({ amountIn: ENTRY_AMOUNT - 1n }),
    store,
    executor
  });
  assert.equal(amountDrift.action, 'BLOCKED_SETUP');
  assert.match(amountDrift.reason ?? '', /CANARY_ENTRY_APPROVAL_BUY_AMOUNT_MISMATCH/);

  const tokenDrift = await advanceCanaryE0EntryApproval({
    plannedBuy: await makeBuy({ tokenOut: OTHER_LAUNCHED }),
    store,
    executor
  });
  assert.equal(tokenDrift.action, 'BLOCKED_SETUP');
  assert.match(tokenDrift.reason ?? '', /CANARY_ENTRY_APPROVAL_BUY_TOKEN_OUT_MISMATCH/);

  allowance = ENTRY_AMOUNT + 1n;
  const widened = await advanceCanaryE0EntryApproval({ plannedBuy: buy, store, executor });
  assert.equal(widened.action, 'BLOCKED_SETUP');
  assert.match(widened.reason ?? '', /CANARY_E0_ENTRY_APPROVAL_LIVE_ALLOWANCE_NOT_EXACT/);
  allowance = ENTRY_AMOUNT;

  const readyAgain = await advanceCanaryE0EntryApproval({ plannedBuy: buy, store, executor });
  assert.equal(readyAgain.action, 'READY_TO_BUY');
} finally {
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const cycleSource = fs.readFileSync(new URL('../src/canary/cycle.ts', import.meta.url), 'utf8');
const approvalGateMarker = 'const entryApproval = await advanceCanaryE0EntryApproval({';
const buyPreflightMarker = 'const preflight = await params.executor.preflight(intent);';
assert.ok(cycleSource.indexOf(approvalGateMarker) >= 0, 'entry approval gate must be wired into BUY cycle');
assert.ok(cycleSource.indexOf(buyPreflightMarker) > cycleSource.indexOf(approvalGateMarker), 'approval gate must precede BUY preflight/signing');
assert.ok(cycleSource.includes('preflight.inputAllowance !== intent.amountIn'), 'BUY must require exact approved allowance');
assert.ok(cycleSource.includes('committedEntry.intent.amount > calibration.baseAmount'), 'frozen approved spend must never exceed fresh $1 calibration');
assert.ok(cycleSource.includes('getCompleteBaseline(committedEntry.launchId, committedEntry.baselineId)'), 'committed approval must rehydrate exact baseline');
assert.ok(cycleSource.includes('CANARY_E0_ENTRY_APPROVAL_CANDIDATE_NO_LONGER_PASS'), 'candidate re-evaluation must fail closed after approval');

const runtimeSource = fs.readFileSync(new URL('../src/canary/entryApprovalRuntime.ts', import.meta.url), 'utf8');
assert.ok(runtimeSource.includes('insertReserved({'));
assert.ok(runtimeSource.includes('}, params.plannedBuy);'), 'reservation must persist authoritative parent BUY');
assert.ok(runtimeSource.includes("inserted.status !== 'INSERTED'"), 'duplicate reservation must not sign');
assert.ok(runtimeSource.includes('signEntryApprovalReserved({'), 'ENTRY approval must use reservation-gated signer');
assert.ok(runtimeSource.includes('signingCapability: inserted.signingCapability'), 'winning capability must reach signing boundary');
assert.ok(!runtimeSource.includes('executor.signApproval(intent, preflight)'), 'generic approval signing must not be used for ENTRY');

const cliSource = fs.readFileSync(new URL('../src/canarySniperCli.ts', import.meta.url), 'utf8');
const kill = "if (entryApprovalEnabled && live) throw new Error('CANARY_E0_ENTRY_APPROVAL_LIVE_NOT_AUTHORIZED');";
const dbMarker = "const dbPath = resolve(process.env.DB_PATH";
const keyMarker = 'const privateKey = process.env.CANARY_PRIVATE_KEY';
const networkMarker = 'const truthSource = new ViemSentryLaunchSource';
assert.ok(cliSource.indexOf(kill) >= 0);
assert.ok(cliSource.indexOf(kill) < cliSource.indexOf(dbMarker));
assert.ok(cliSource.indexOf(kill) < cliSource.indexOf(keyMarker));
assert.ok(cliSource.indexOf(kill) < cliSource.indexOf(networkMarker));
assert.ok(cliSource.includes('entryApprovalStore,'), 'real canary cycle must receive the entry approval store when enabled');

console.log(JSON.stringify({
  verdict: 'CANARY_E0_ENTRY_APPROVAL_WIRING_R0_PASS',
  fixedPrimaryNotionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS.toString(),
  approvalSignCalls: signCalls,
  fakeBroadcastBoundaryCalls,
  receiptCalls,
  approvalAndBuySeparatedAcrossPolls: true,
  exactApprovedAmountBoundToBuy: true,
  buyTokenAndFeeIdentityBound: true,
  widenedAllowanceBlocked: true,
  freshDollarCapCannotBeExceeded: true,
  exactBaselineRehydrationRequired: true,
  candidateReevaluationFailClosed: true,
  reservationCapabilityGatesSigning: reservationCapabilityObserved,
  frozenParentBuyAuthorityPreserved: frozenParentBuyAuthorityObserved,
  genericEntrySigningForbidden: true,
  cliLiveEntryApprovalKillSwitch: true,
  cleanupRevokeQualified: false,
  networkBroadcastInvoked: false,
  realWalletSecretUsed: false,
  liveEntryApprovalReachable: false
}, null, 2));
