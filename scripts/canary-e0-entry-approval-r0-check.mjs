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
import { CanaryEntryApprovalStore } from '../dist/canary/entryApprovalStore.js';
import {
  assertSignedApprovalTransaction,
  assertSignedCanaryTransactionEnvelope,
  ViemCanaryExecutor
} from '../dist/canary/viemCanaryExecutor.js';
import {
  buildCanarySwapIntent,
  CANARY_PRIMARY_NOTIONAL_USD_MICROS,
  INK_SWAP_ROUTER_02
} from '../dist/canary/swapIntent.js';
import { INK_CHAIN_ID } from '../dist/sentry/contracts.js';
import { TSUNAMI_V3_FACTORY, WETH9 } from '../dist/tsunami/contracts.js';

// Public deterministic test fixture. Never fund this key/address.
const TEST_PRIVATE_KEY = `0x${'11'.repeat(32)}`;
const TEST_WALLET = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const HASH = `0x${'44'.repeat(32)}`;
const LAUNCHED = '0x1111111111111111111111111111111111111111';
const ENTRY_AMOUNT = 1_000_000n;
const QUOTED_OUT = 2_000_000n;
const BASE_BALANCE = 40_000_000n;
const GAS = 65_000n;
const MAX_FEE = 5_000_000n;
const MAX_PRIORITY = 1_000_000n;
const nonce = 5;

const buy = await buildCanarySwapIntent({
  launchId: 'e0-entry-approval-launch',
  baselineId: 'e0-entry-approval-baseline',
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
assert.notEqual(entryApproval.actionId, buy.actionId);
assert.equal(entryApproval.parentBuyActionId, buy.actionId);
assert.equal(getAddress(entryApproval.token), getAddress(WETH9));
assert.equal(entryApproval.amount, ENTRY_AMOUNT);
assert.equal(entryApproval.notionalUsdMicros, CANARY_PRIMARY_NOTIONAL_USD_MICROS);

let allowance = 0n;
let simulationResult = true;
let approvalSimulationCalls = 0;
let swapSimulationCalls = 0;
const fakePublicClient = {
  async getChainId() { return INK_CHAIN_ID; },
  async getBlock({ blockNumber } = {}) {
    return { number: blockNumber ?? 101n, hash: HASH, timestamp: 1_700_000_001n };
  },
  async getBytecode({ address }) {
    if ([WETH9, INK_SWAP_ROUTER_02].some((candidate) => getAddress(candidate) === getAddress(address))) return '0x6000';
    throw new Error(`UNEXPECTED_CODE_ADDRESS:${address}`);
  },
  async readContract({ address, functionName, args }) {
    if (getAddress(address) === getAddress(INK_SWAP_ROUTER_02)) {
      if (functionName === 'factory') return TSUNAMI_V3_FACTORY;
      if (functionName === 'WETH9') return WETH9;
      throw new Error(`UNEXPECTED_ROUTER_READ:${functionName}`);
    }
    if (getAddress(address) === getAddress(WETH9)) {
      if (functionName === 'balanceOf') {
        assert.equal(getAddress(args[0]), getAddress(TEST_WALLET));
        return BASE_BALANCE;
      }
      if (functionName === 'allowance') {
        assert.equal(getAddress(args[0]), getAddress(TEST_WALLET));
        assert.equal(getAddress(args[1]), getAddress(INK_SWAP_ROUTER_02));
        return allowance;
      }
    }
    if (getAddress(address) === getAddress(LAUNCHED) && functionName === 'balanceOf') return 0n;
    throw new Error(`UNEXPECTED_READ:${address}:${functionName}`);
  },
  async call({ account, to, data, value }) {
    assert.equal(getAddress(account), getAddress(TEST_WALLET));
    assert.equal(value, 0n);
    if (getAddress(to) === getAddress(WETH9)) {
      approvalSimulationCalls += 1;
      const decoded = decodeFunctionData({ abi: erc20ApprovalAbi, data });
      assert.equal(decoded.functionName, 'approve');
      assert.equal(getAddress(decoded.args[0]), getAddress(INK_SWAP_ROUTER_02));
      assert.equal(decoded.args[1], ENTRY_AMOUNT);
      return { data: encodeFunctionResult({ abi: erc20ApprovalAbi, functionName: 'approve', result: simulationResult }) };
    }
    if (getAddress(to) === getAddress(INK_SWAP_ROUTER_02)) {
      swapSimulationCalls += 1;
      return { data: '0x' };
    }
    throw new Error(`UNEXPECTED_CALL_TARGET:${to}`);
  },
  async estimateGas() { return GAS; },
  async estimateFeesPerGas() { return { maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: MAX_PRIORITY }; },
  async getTransactionCount() { return nonce; }
};

const caps = {
  maxQuoteAgeBlocks: 3n,
  maxGas: 100_000n,
  maxFeePerGas: 10_000_000n,
  maxPriorityFeePerGas: 2_000_000n
};
const executor = new ViemCanaryExecutor({ privateKey: TEST_PRIVATE_KEY, caps, publicClient: fakePublicClient });
assert.equal(getAddress(executor.walletAddress), getAddress(TEST_WALLET));

// A clean wallet starts at zero allowance. Any non-zero pre-existing approval is dirty.
allowance = 1n;
await assert.rejects(() => executor.preflightApproval(entryApproval), /CANARY_APPROVAL_DIRTY_ALLOWANCE/);
allowance = 0n;

// Fail closed if the base token's approve simulation returns false.
simulationResult = false;
await assert.rejects(() => executor.preflightApproval(entryApproval), /CANARY_APPROVAL_SIMULATION_FALSE/);
simulationResult = true;

const preflight = await executor.preflightApproval(entryApproval);
assert.equal(preflight.actionId, entryApproval.actionId);
assert.equal(getAddress(preflight.wallet), getAddress(TEST_WALLET));
assert.equal(getAddress(preflight.token), getAddress(WETH9));
assert.equal(preflight.amount, ENTRY_AMOUNT);
assert.equal(preflight.allowanceBefore, 0n);

// Preflight identity and caps remain bound at signing.
await assert.rejects(
  () => executor.signApproval(entryApproval, { ...preflight, actionId: 'forged-entry-approval' }),
  /CANARY_APPROVAL_PREFLIGHT_ACTION_ID_MISMATCH/
);
await assert.rejects(
  () => executor.signApproval(entryApproval, { ...preflight, gas: caps.maxGas + 1n }),
  /CANARY_GAS_CAP_EXCEEDED/
);

// Race after preflight: dirty allowance must be caught before signing.
allowance = 1n;
await assert.rejects(() => executor.signApproval(entryApproval, preflight), /CANARY_APPROVAL_ALLOWANCE_CHANGED/);
allowance = 0n;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-e0-entry-approval-r0-'));
const dbPath = path.join(tempDir, 'canary.sqlite');
const store = new CanaryEntryApprovalStore(dbPath);
let signed;
try {
  const now = 1_700_000_000_000;
  const record = {
    actionId: entryApproval.actionId,
    parentBuyActionId: entryApproval.parentBuyActionId,
    launchId: entryApproval.launchId,
    baselineId: entryApproval.baselineId,
    state: 'RESERVED',
    intent: entryApproval,
    observedAllowanceBefore: 0n,
    observedAllowanceAfter: null,
    nonce: null,
    transactionHash: null,
    serializedTransaction: null,
    lastError: null,
    createdAtMs: now,
    updatedAtMs: now
  };

  // Reservation ownership is an ephemeral instance-local capability. Only the INSERT winner may sign.
  const reservation = await store.insertReserved(record);
  assert.equal(reservation.status, 'INSERTED');
  assert.match(reservation.signingCapability, /^[0-9a-f]{64}$/);
  const duplicate = await store.insertReserved(record);
  assert.equal(duplicate.status, 'DUPLICATE');
  assert.equal(duplicate.signingCapability, null);

  const hostileSigned = {
    nonce: 0,
    transactionHash: keccak256('0x00'),
    serializedTransaction: '0x00'
  };
  assert.throws(
    () => store.markSigned(entryApproval.actionId, '', hostileSigned),
    /CANARY_ENTRY_APPROVAL_SIGNING_CAPABILITY_INVALID/
  );
  assert.throws(
    () => store.markSigned(entryApproval.actionId, '00'.repeat(32), hostileSigned),
    /CANARY_ENTRY_APPROVAL_SIGNING_CAPABILITY_INVALID/
  );

  const duplicateStore = new CanaryEntryApprovalStore(dbPath);
  try {
    const duplicateWorker = await duplicateStore.insertReserved(record);
    assert.equal(duplicateWorker.status, 'DUPLICATE');
    assert.equal(duplicateWorker.signingCapability, null);
    assert.throws(
      () => duplicateStore.markSigned(entryApproval.actionId, reservation.signingCapability, hostileSigned),
      /CANARY_ENTRY_APPROVAL_SIGNING_CAPABILITY_INVALID/
    );
  } finally {
    duplicateStore.close();
  }

  // Restart loses the non-persisted capability and therefore strands RESERVED fail-closed.
  const restartDbPath = path.join(tempDir, 'restart.sqlite');
  const restartWriter = new CanaryEntryApprovalStore(restartDbPath);
  const restartReservation = await restartWriter.insertReserved(record);
  assert.equal(restartReservation.status, 'INSERTED');
  restartWriter.close();
  const restartReader = new CanaryEntryApprovalStore(restartDbPath);
  try {
    assert.equal(restartReader.getCommitted()?.state, 'RESERVED');
    assert.throws(
      () => restartReader.markSigned(entryApproval.actionId, restartReservation.signingCapability, hostileSigned),
      /CANARY_ENTRY_APPROVAL_SIGNING_CAPABILITY_INVALID/
    );
  } finally {
    restartReader.close();
  }

  // The actual signing operation occurs only after this worker won the reservation.
  signed = await executor.signApproval(entryApproval, preflight);
  assert.equal(signed.actionId, entryApproval.actionId);
  assert.equal(signed.transactionHash, keccak256(signed.serializedTransaction));
  await assertSignedApprovalTransaction(entryApproval, signed, TEST_WALLET);
  await assertSignedCanaryTransactionEnvelope(signed, TEST_WALLET, caps);

  store.markSigned(entryApproval.actionId, reservation.signingCapability, {
    nonce: signed.nonce,
    transactionHash: signed.transactionHash,
    serializedTransaction: signed.serializedTransaction
  });
  assert.throws(
    () => store.markSigned(entryApproval.actionId, reservation.signingCapability, {
      nonce: signed.nonce,
      transactionHash: signed.transactionHash,
      serializedTransaction: signed.serializedTransaction
    }),
    /CANARY_ENTRY_APPROVAL_SIGNING_CAPABILITY_INVALID/
  );

  store.markSubmitted(entryApproval.actionId);
  assert.throws(
    () => store.markIncluded(entryApproval.actionId, ENTRY_AMOUNT + 1n),
    /CANARY_ENTRY_APPROVAL_INCLUDED_ALLOWANCE_NOT_EXACT/
  );
  store.markIncluded(entryApproval.actionId, ENTRY_AMOUNT);
  assert.equal(store.getCommitted()?.state, 'INCLUDED');
  assert.equal(store.getCommitted()?.observedAllowanceAfter, ENTRY_AMOUNT);

  const secondBuy = await buildCanarySwapIntent({
    launchId: 'e0-entry-approval-second-launch',
    baselineId: 'e0-entry-approval-second-baseline',
    quoteBlockNumber: 101n,
    quoteBlockHash: HASH,
    tokenIn: WETH9,
    tokenOut: '0x2222222222222222222222222222222222222222',
    fee: 10_000,
    recipient: TEST_WALLET,
    notionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS,
    amountIn: ENTRY_AMOUNT,
    quotedAmountOut: QUOTED_OUT,
    slippageBps: 500,
    chainTimestampSeconds: 1_700_000_001,
    deadlineSeconds: 30
  });
  const secondApproval = await buildCanaryEntryApprovalIntent(secondBuy);
  const secondReservation = await store.insertReserved({
    ...record,
    actionId: secondApproval.actionId,
    parentBuyActionId: secondApproval.parentBuyActionId,
    launchId: secondApproval.launchId,
    baselineId: secondApproval.baselineId,
    intent: secondApproval,
    createdAtMs: now + 1,
    updatedAtMs: now + 1
  });
  assert.equal(secondReservation.status, 'ENTRY_SLOT_TAKEN');
  assert.equal(secondReservation.signingCapability, null);
} finally {
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

assert.ok(signed, 'entry approval must have been signed after reservation ownership was established');
const parsed = parseTransaction(signed.serializedTransaction);
assert.equal(parsed.chainId, INK_CHAIN_ID);
assert.equal(getAddress(parsed.to), getAddress(WETH9));
assert.equal(parsed.value ?? 0n, 0n);
assert.equal(parsed.data, entryApproval.calldata);
assert.equal(getAddress(await recoverTransactionAddress({ serializedTransaction: signed.serializedTransaction })), getAddress(TEST_WALLET));

// After the exact base-token approval is included, the existing BUY preflight sees
// sufficient allowance. No second wallet framework or manual pre-approval is needed.
allowance = ENTRY_AMOUNT;
const buyPreflight = await executor.preflight(buy);
assert.equal(buyPreflight.inputAllowance, ENTRY_AMOUNT);
assert.equal(buyPreflight.inputBalance, BASE_BALANCE);
assert.ok(swapSimulationCalls >= 1);

const executorSource = fs.readFileSync(new URL('../src/canary/viemCanaryExecutor.ts', import.meta.url), 'utf8');
const validatorMarker = 'await assertSignedCanaryTransactionEnvelope(signed, this.account.address, this.caps)';
const broadcastMarker = 'this.walletClient.' + 'sendRaw' + 'Transaction';
assert.ok(executorSource.indexOf(validatorMarker) >= 0);
assert.ok(executorSource.indexOf(broadcastMarker) > executorSource.indexOf(validatorMarker));

assert.ok(approvalSimulationCalls >= 3, 'approval simulation must execute in preflight and signing qualification');
console.log(JSON.stringify({
  verdict: 'CANARY_E0_ENTRY_APPROVAL_EXECUTOR_R0_PASS',
  chainId: INK_CHAIN_ID,
  parentBuyActionId: buy.actionId,
  entryApprovalActionId: entryApproval.actionId,
  token: WETH9,
  spender: INK_SWAP_ROUTER_02,
  exactEntryApprovalAmount: ENTRY_AMOUNT.toString(),
  fixedPrimaryNotionalUsdMicros: CANARY_PRIMARY_NOTIONAL_USD_MICROS.toString(),
  cleanWalletZeroAllowanceRequired: true,
  infiniteApprovalForbidden: true,
  exactIncludedAllowanceRequired: true,
  buyPreflightSatisfiedAfterExactApproval: true,
  singletonEntryApprovalSlot: true,
  reservationBeforeSigning: true,
  reservationCapabilityWinnerOnly: true,
  duplicateReservationCannotSign: true,
  forgedCapabilityRejected: true,
  crossStoreCapabilityRejected: true,
  oneShotCapabilityConsumed: true,
  restartReservedFailsClosed: true,
  sameViemCanaryExecutorUsed: true,
  preBroadcastSignedEnvelopeValidationPreserved: true,
  networkBroadcastInvoked: false,
  live: false,
  walletSecretUsed: false,
  testOnlyDeterministicKey: true
}, null, 2));
