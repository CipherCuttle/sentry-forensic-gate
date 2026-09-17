import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keccak256 } from 'viem';
import { buildCanaryEntryApprovalIntent } from '../dist/canary/entryApproval.js';
import { CanaryEntryApprovalStore } from '../dist/canary/entryApprovalStore.js';
import { advanceCanaryE0EntryApprovalRevoke } from '../dist/canary/entryApprovalRevokeRuntime.js';
import { CanaryEntryApprovalRevokeStore } from '../dist/canary/entryApprovalRevokeStore.js';
import { cleanupCanaryE0EntryApproval } from '../dist/canary/entryApprovalRevokeWiring.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02
} from '../dist/canary/swapIntent.js';
import { WETH9 } from '../dist/tsunami/contracts.js';

const OWNER = '0x0000000000000000000000000000000000000002';
const WRONG_OWNER = '0x0000000000000000000000000000000000000001';
const LAUNCHED = '0x1111111111111111111111111111111111111111';
const HASH = `0x${'44'.repeat(32)}`;
const ENTRY_AMOUNT = 1_000_000n;
const GAS = 65_000n;
const MAX_FEE = 5_000_000n;
const MAX_PRIORITY = 1_000_000n;

const buy = await buildCanarySwapIntent({
  launchId: 'e0-revoke-wiring-launch',
  baselineId: 'e0-revoke-wiring-baseline',
  quoteBlockNumber: 100n,
  quoteBlockHash: HASH,
  tokenIn: WETH9,
  tokenOut: LAUNCHED,
  fee: 10_000,
  recipient: OWNER,
  notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  amountIn: ENTRY_AMOUNT,
  quotedAmountOut: 2_000_000n,
  slippageBps: 500,
  chainTimestampSeconds: 1_700_000_000,
  deadlineSeconds: 30
});
const entryIntent = await buildCanaryEntryApprovalIntent(buy);

async function withStores(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dbPath = path.join(dir, 'canary.sqlite');
  const entryStore = new CanaryEntryApprovalStore(dbPath);
  const revokeStore = new CanaryEntryApprovalRevokeStore(dbPath);
  try {
    const now = Date.now();
    assert.equal(await entryStore.insertReserved({
      actionId: entryIntent.actionId,
      parentBuyActionId: entryIntent.parentBuyActionId,
      launchId: entryIntent.launchId,
      baselineId: entryIntent.baselineId,
      state: 'RESERVED',
      intent: entryIntent,
      observedAllowanceBefore: 0n,
      observedAllowanceAfter: null,
      nonce: null,
      transactionHash: null,
      serializedTransaction: null,
      lastError: null,
      createdAtMs: now,
      updatedAtMs: now
    }), 'INSERTED');
    const serializedTransaction = '0x01';
    const transactionHash = keccak256(serializedTransaction);
    entryStore.markSigned(entryIntent.actionId, { nonce: 1, transactionHash, serializedTransaction });
    entryStore.markSubmitted(entryIntent.actionId);
    entryStore.markIncluded(entryIntent.actionId, ENTRY_AMOUNT);
    const parent = entryStore.getCommitted();
    assert(parent);
    assert.equal(parent.state, 'INCLUDED');
    return await fn({ entryStore, revokeStore, parent });
  } finally {
    revokeStore.close();
    entryStore.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// BUY already consumed the exact allowance: terminalize without a wallet signature.
let alreadyCleanSignCalls = 0;
let alreadyCleanBroadcastCalls = 0;
await withStores('sentry-revoke-wiring-clean-', async ({ entryStore, revokeStore, parent }) => {
  const executor = {
    walletAddress: OWNER,
    async getTokenAllowance() { return 0n; },
    async preflightEntryApprovalRevoke() { throw new Error('NO_PREFLIGHT_EXPECTED'); },
    async signEntryApprovalRevoke() { alreadyCleanSignCalls += 1; throw new Error('NO_SIGN_EXPECTED'); },
    async broadcastExact() { alreadyCleanBroadcastCalls += 1; throw new Error('NO_BROADCAST_EXPECTED'); },
    async getReceiptIfPresent() { throw new Error('NO_RECEIPT_EXPECTED'); }
  };
  const result = await cleanupCanaryE0EntryApproval({
    trigger: 'PARENT_BUY_INCLUDED', parentApproval: parent, entryApprovalStore: entryStore, revokeStore, executor
  });
  assert.equal(result.action, 'ENTRY_APPROVAL_CLEANED');
  assert.equal(alreadyCleanSignCalls, 0);
  assert.equal(alreadyCleanBroadcastCalls, 0);
  const terminal = entryStore.getCommitted();
  assert(terminal);
  assert.equal(terminal.state, 'SKIPPED');
  assert.equal(terminal.observedAllowanceAfter, 0n);
  assert.equal(terminal.lastError, 'CANARY_E0_ENTRY_APPROVAL_CLEANUP_TERMINAL:PARENT_BUY_INCLUDED');
  entryStore.markCleanupTerminal(terminal.actionId, 'PARENT_BUY_INCLUDED');
  assert.throws(
    () => entryStore.markCleanupTerminal(terminal.actionId, 'CANDIDATE_EXPIRED'),
    /CANARY_ENTRY_APPROVAL_CLEANUP_TERMINAL_REASON_DRIFT/
  );
});

// Hostile identity case: a different executor wallet must be rejected before even reading allowance.
let wrongOwnerAllowanceReads = 0;
await withStores('sentry-revoke-wiring-owner-', async ({ entryStore, revokeStore, parent }) => {
  const executor = {
    walletAddress: WRONG_OWNER,
    async getTokenAllowance() { wrongOwnerAllowanceReads += 1; return 0n; },
    async preflightEntryApprovalRevoke() { throw new Error('NO_PREFLIGHT_EXPECTED'); },
    async signEntryApprovalRevoke() { throw new Error('NO_SIGN_EXPECTED'); },
    async broadcastExact() { throw new Error('NO_BROADCAST_EXPECTED'); },
    async getReceiptIfPresent() { throw new Error('NO_RECEIPT_EXPECTED'); }
  };
  const result = await cleanupCanaryE0EntryApproval({
    trigger: 'PARENT_BUY_INCLUDED', parentApproval: parent, entryApprovalStore: entryStore, revokeStore, executor
  });
  assert.equal(result.action, 'BLOCKED_SETUP');
  assert.equal(result.reason, 'CANARY_E0_ENTRY_APPROVAL_CLEANUP_OWNER_MUST_EQUAL_EXECUTOR_WALLET');
  assert.equal(wrongOwnerAllowanceReads, 0);
  assert.equal(entryStore.getCommitted()?.state, 'INCLUDED');
});

// Deterministic expiry: one exact revoke may be signed, then the parent approval is terminal.
let revokeSignCalls = 0;
let revokeBroadcastCalls = 0;
await withStores('sentry-revoke-wiring-expired-', async ({ entryStore, revokeStore, parent }) => {
  let allowance = ENTRY_AMOUNT;
  const serializedTransaction = '0x02';
  const transactionHash = keccak256(serializedTransaction);
  const executor = {
    walletAddress: OWNER,
    async getTokenAllowance(token, spender) {
      assert.equal(token.toLowerCase(), WETH9.toLowerCase());
      assert.equal(spender.toLowerCase(), INK_SWAP_ROUTER_02.toLowerCase());
      return allowance;
    },
    async preflightEntryApprovalRevoke(intent) {
      assert.equal(intent.expectedAllowance, ENTRY_AMOUNT);
      assert.equal(allowance, ENTRY_AMOUNT);
      return {
        actionId: intent.actionId,
        wallet: OWNER,
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
      revokeSignCalls += 1;
      return {
        actionId: intent.actionId,
        nonce: 2,
        transactionHash,
        serializedTransaction,
        serializedTransactionKeccak256: transactionHash,
        gas: GAS,
        maxFeePerGas: MAX_FEE,
        maxPriorityFeePerGas: MAX_PRIORITY
      };
    },
    async broadcastExact(signed) {
      revokeBroadcastCalls += 1;
      assert.equal(signed.transactionHash, transactionHash);
      allowance = 0n;
      return transactionHash;
    },
    async getReceiptIfPresent(hash) {
      assert.equal(hash, transactionHash);
      return { status: 'success' };
    }
  };
  const result = await cleanupCanaryE0EntryApproval({
    trigger: 'CANDIDATE_EXPIRED', parentApproval: parent, entryApprovalStore: entryStore, revokeStore, executor
  });
  assert.equal(result.action, 'ENTRY_APPROVAL_REVOKE_INCLUDED');
  assert.equal(revokeSignCalls, 1);
  assert.equal(revokeBroadcastCalls, 1);
  assert.equal(revokeStore.getCommitted()?.state, 'INCLUDED');
  const terminal = entryStore.getCommitted();
  assert(terminal);
  assert.equal(terminal.state, 'SKIPPED');
  assert.equal(terminal.observedAllowanceAfter, 0n);
  assert.equal(terminal.lastError, 'CANARY_E0_ENTRY_APPROVAL_CLEANUP_TERMINAL:CANDIDATE_EXPIRED');
});

// Crash seam: an included revoke may be recovered and terminalized without a second signature/broadcast.
let recoverySignCalls = 0;
let recoveryBroadcastCalls = 0;
await withStores('sentry-revoke-wiring-recovery-', async ({ entryStore, revokeStore, parent }) => {
  let allowance = ENTRY_AMOUNT;
  const serializedTransaction = '0x03';
  const transactionHash = keccak256(serializedTransaction);
  const executor = {
    walletAddress: OWNER,
    async getTokenAllowance() { return allowance; },
    async preflightEntryApprovalRevoke(intent) {
      return {
        actionId: intent.actionId,
        wallet: OWNER,
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
      recoverySignCalls += 1;
      return {
        actionId: intent.actionId,
        nonce: 3,
        transactionHash,
        serializedTransaction,
        serializedTransactionKeccak256: transactionHash,
        gas: GAS,
        maxFeePerGas: MAX_FEE,
        maxPriorityFeePerGas: MAX_PRIORITY
      };
    },
    async broadcastExact() {
      recoveryBroadcastCalls += 1;
      allowance = 0n;
      return transactionHash;
    },
    async getReceiptIfPresent() { return { status: 'success' }; }
  };
  const first = await advanceCanaryE0EntryApprovalRevoke({ parentApproval: parent.intent, store: revokeStore, executor });
  assert.equal(first.action, 'ENTRY_APPROVAL_REVOKE_INCLUDED');
  assert.equal(entryStore.getCommitted()?.state, 'INCLUDED');
  const recovered = await cleanupCanaryE0EntryApproval({
    trigger: 'REVOKE_RECOVERY', parentApproval: entryStore.getCommitted(), entryApprovalStore: entryStore, revokeStore, executor
  });
  assert.equal(recovered.action, 'ENTRY_APPROVAL_CLEANED');
  assert.equal(recoverySignCalls, 1);
  assert.equal(recoveryBroadcastCalls, 1);
  assert.equal(entryStore.getCommitted()?.state, 'SKIPPED');
});

const cycleSource = fs.readFileSync(new URL('../src/canary/cycle.ts', import.meta.url), 'utf8');
const cliSource = fs.readFileSync(new URL('../src/canarySniperCli.ts', import.meta.url), 'utf8');
const wiringSource = fs.readFileSync(new URL('../src/canary/entryApprovalRevokeWiring.ts', import.meta.url), 'utf8');

for (const trigger of [
  'PARENT_BUY_INCLUDED', 'PARENT_BUY_REVERTED', 'PARENT_BUY_SKIPPED',
  'CANDIDATE_EXPIRED', 'CANDIDATE_REJECTED', 'REVOKE_RECOVERY'
]) {
  assert.match(cycleSource + wiringSource, new RegExp(trigger));
}
assert.match(cycleSource, /vet\.decision === 'REJECT'/);
assert.match(cycleSource, /CANDIDATE_NO_LONGER_PASS:UNKNOWN/);
assert.ok(
  cycleSource.indexOf("state: 'SKIPPED'") < cycleSource.lastIndexOf('cleanupCanaryE0EntryApproval({'),
  'terminal parent BUY persistence must exist before cleanup signing path'
);
const quoteTryStart = cycleSource.indexOf('// Cleanup is intentionally forbidden inside this quote/execution try block.');
const quoteTryEnd = cycleSource.indexOf('\n    } catch (error) {', quoteTryStart);
assert.ok(quoteTryStart >= 0 && quoteTryEnd > quoteTryStart);
assert.ok(!cycleSource.slice(quoteTryStart, quoteTryEnd).includes('runCleanup({'), 'transient quote path must not invoke cleanup');
assert.match(wiringSource, /CLEANUP_OWNER_MUST_EQUAL_EXECUTOR_WALLET/);

const revokeFlag = cliSource.indexOf('CANARY_E0_ENTRY_APPROVAL_REVOKE_ENABLED');
const revokeRequiresEntry = cliSource.indexOf('CANARY_E0_ENTRY_APPROVAL_REVOKE_REQUIRES_ENTRY_APPROVAL');
const revokeKill = cliSource.indexOf('CANARY_E0_ENTRY_APPROVAL_REVOKE_LIVE_NOT_AUTHORIZED');
const dbSetup = cliSource.indexOf('const dbPath');
const privateKeyRead = cliSource.indexOf('const privateKey');
const networkExecutor = cliSource.indexOf('new ViemCanaryExecutor');
assert.ok(revokeFlag >= 0);
assert.ok(revokeRequiresEntry > revokeFlag);
assert.ok(revokeKill > revokeRequiresEntry);
assert.ok(revokeKill < dbSetup && revokeKill < privateKeyRead && revokeKill < networkExecutor);
assert.match(cliSource, /entryApprovalRevokeStore/);
assert.match(cycleSource, /entryApprovalRevokeStore/);

console.log(JSON.stringify({
  verdict: 'CANARY_E0_ENTRY_APPROVAL_REVOKE_WIRING_R0_PASS',
  deterministicTriggersOnly: true,
  candidateUnknownDoesNotRevoke: true,
  transientQuoteFailureDoesNotRevoke: true,
  parentBuyTerminalizedBeforeCleanup: true,
  ownerMismatchBlockedBeforeAllowanceRead: wrongOwnerAllowanceReads === 0,
  alreadyZeroNoSign: alreadyCleanSignCalls === 0 && alreadyCleanBroadcastCalls === 0,
  exactRevokeSignCalls: revokeSignCalls,
  exactRevokeBroadcastCalls: revokeBroadcastCalls,
  recoveryNoResignRebroadcast: recoverySignCalls === 1 && recoveryBroadcastCalls === 1,
  cleanupTerminalState: 'SKIPPED',
  cleanupObservedAllowance: '0',
  cliLiveRevokeKillSwitch: true,
  liveCleanupReachable: false,
  networkBroadcastInvoked: false,
  realWalletSecretUsed: false
}, null, 2));