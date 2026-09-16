import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAddress, keccak256 } from 'viem';
import { CanaryApprovalStore } from '../dist/canary/approvalStore.js';
import { CanaryExitStore } from '../dist/canary/exitStore.js';
import { syncCanaryE0RoundTripWiring } from '../dist/canary/roundTripWiring.js';
import { buildCanarySwapIntent, CANARY_PRIMARY_NOTIONAL_USD_MICROS, INK_SWAP_ROUTER_02 } from '../dist/canary/swapIntent.js';
import { CanaryStore } from '../dist/canary/store.js';
import { WETH9 } from '../dist/tsunami/contracts.js';

const WALLET = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
const LAUNCHED = '0x1111111111111111111111111111111111111111';
const POOL = '0x2222222222222222222222222222222222222222';
const FACTORY = '0x3333333333333333333333333333333333333333';
const BUY_BLOCK_HASH = `0x${'44'.repeat(32)}`;
const EXIT_BLOCK_HASH = `0x${'55'.repeat(32)}`;
const ACQUIRED = 2_000_000n;
const BASE_BEFORE = 5_000_000n;
const BASE_AFTER = 5_900_000n;
const EXIT_AMOUNT_OUT = 900_000n;
const GAS = 80_000n;
const MAX_FEE = 5_000_000n;
const MAX_PRIORITY = 1_000_000n;
const options = { slippageBps: 500, deadlineSeconds: 30 };

const launch = {
  chainId: 57073,
  blockNumber: 90n,
  blockHash: BUY_BLOCK_HASH,
  observedAtMs: 1_700_000_000_000,
  launchId: 'e0-live-wiring-launch',
  eventId: 'event-1',
  factory: FACTORY,
  txHash: `0x${'66'.repeat(32)}`,
  logIndex: 0,
  token: LAUNCHED,
  creator: '0x4444444444444444444444444444444444444444',
  tokenId: 1n,
  name: 'Fixture',
  symbol: 'FIX',
  launchType: 'STANDARD',
  sourceEvent: 'TokenDeployed'
};

const buy = await buildCanarySwapIntent({
  launchId: launch.launchId,
  baselineId: 'e0-live-wiring-baseline',
  quoteBlockNumber: 100n,
  quoteBlockHash: BUY_BLOCK_HASH,
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

const market = {
  launchId: launch.launchId,
  launchedToken: LAUNCHED,
  baseToken: WETH9,
  token0: WETH9,
  token1: LAUNCHED,
  fee: buy.fee,
  pool: POOL,
  positionLiquidity: 10n,
  activeLiquidity: 10n,
  sqrtPriceX96Before: 1n
};

let allowance = 0n;
let approvalSignCalls = 0;
let exitSignCalls = 0;
let broadcastCalls = 0;
let quoteCalls = 0;
let authorityCalls = 0;
let exitReceiptVisible = false;
let approvalActionId = null;
let exitActionId = null;
let exitHash = null;
const approvalHash = keccak256('0xa1');

const executor = {
  walletAddress: WALLET,
  async getChainClock() {
    return { blockNumber: 102n, blockHash: EXIT_BLOCK_HASH, timestampSeconds: 1_700_000_002 };
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
    assert.equal(allowance, ACQUIRED);
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

const launchStore = {
  async getLaunch(launchId) {
    return launchId === launch.launchId ? launch : null;
  }
};
const quoteSource = {
  async getHeadBlockNumber() { return 101n; },
  async getBlockHash(blockNumber) {
    assert.equal(blockNumber, 101n);
    return EXIT_BLOCK_HASH;
  },
  async assertAuthority(blockNumber) {
    authorityCalls += 1;
    assert.equal(blockNumber, 101n);
  },
  async resolveMarket(observed, blockNumber) {
    assert.equal(observed.launchId, launch.launchId);
    assert.equal(blockNumber, 101n);
    return market;
  },
  async quoteIndependentReverse(params) {
    quoteCalls += 1;
    assert.equal(params.launch.launchId, launch.launchId);
    assert.equal(params.decisionBlock, 101n);
    assert.equal(params.decisionBlockHash, EXIT_BLOCK_HASH);
    assert.equal(params.notionalUsdMicros, CANARY_PRIMARY_NOTIONAL_USD_MICROS);
    assert.equal(params.amountIn, ACQUIRED);
    return {
      quoteId: 'e0-live-wiring-exit-quote',
      launchId: launch.launchId,
      blockNumber: 101n,
      blockHash: EXIT_BLOCK_HASH,
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
  }
};

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentry-e0-live-wiring-r0-'));
const dbPath = path.join(tempDir, 'canary.sqlite');
const buyStore = new CanaryStore(dbPath);
const approvalStore = new CanaryApprovalStore(dbPath);
const exitStore = new CanaryExitStore(dbPath);
try {
  seedIncludedBuy(buyStore, buy);
  assert.equal(buyStore.getCommittedBuy()?.actionId, buy.actionId);

  const disabled = await syncCanaryE0RoundTripWiring({
    enabled: false, deferForBuyCycle: false, launchStore, buyStore, approvalStore, exitStore, quoteSource, executor, options
  });
  assert.equal(disabled.action, 'DISABLED');
  assert.equal(broadcastCalls, 0);

  const dryArmed = await syncCanaryE0RoundTripWiring({
    enabled: true, deferForBuyCycle: false, launchStore, buyStore, approvalStore, exitStore, quoteSource, executor: null, options
  });
  assert.equal(dryArmed.action, 'DRY_ARMED');
  assert.equal(approvalSignCalls, 0);
  assert.equal(exitSignCalls, 0);
  assert.equal(quoteCalls, 0);

  const deferredBuyPoll = await syncCanaryE0RoundTripWiring({
    enabled: true, deferForBuyCycle: true, launchStore, buyStore, approvalStore, exitStore, quoteSource, executor, options
  });
  assert.equal(deferredBuyPoll.action, 'DEFERRED_BUY_POLL');
  assert.equal(approvalSignCalls, 0, 'buy side-effect poll must never also sign approval');
  assert.equal(exitSignCalls, 0);
  assert.equal(broadcastCalls, 0);
  assert.equal(quoteCalls, 0);

  const approval = await syncCanaryE0RoundTripWiring({
    enabled: true, deferForBuyCycle: false, launchStore, buyStore, approvalStore, exitStore, quoteSource, executor, options
  });
  assert.equal(approval.action, 'APPROVAL_INCLUDED');
  assert.equal(approvalSignCalls, 1);
  assert.equal(exitSignCalls, 0);
  assert.equal(broadcastCalls, 1);
  assert.equal(quoteCalls, 0, 'approval poll must not also quote/sign exit');

  const exitSubmit = await syncCanaryE0RoundTripWiring({
    enabled: true, deferForBuyCycle: false, launchStore, buyStore, approvalStore, exitStore, quoteSource, executor, options
  });
  assert.equal(exitSubmit.action, 'EXIT_SUBMITTED');
  assert.equal(exitSubmit.quoteBlockNumber, 101n);
  assert.equal(authorityCalls, 1);
  assert.equal(quoteCalls, 1);
  assert.equal(exitSignCalls, 1);
  assert.equal(broadcastCalls, 2);

  const ambiguous = await syncCanaryE0RoundTripWiring({
    enabled: true, deferForBuyCycle: false, launchStore, buyStore, approvalStore, exitStore, quoteSource, executor, options
  });
  assert.equal(ambiguous.action, 'BLOCKED_UNRESOLVED');
  assert.match(ambiguous.runtime?.reason ?? '', /CANARY_E0_EXIT_TX_NOT_YET_OBSERVED_NO_RETRY/);
  assert.equal(quoteCalls, 1, 'known-hash reconciliation must not requote');
  assert.equal(exitSignCalls, 1, 'known-hash ambiguity must not resign');
  assert.equal(broadcastCalls, 2, 'known-hash ambiguity must not rebroadcast');

  exitReceiptVisible = true;
  const included = await syncCanaryE0RoundTripWiring({
    enabled: true, deferForBuyCycle: false, launchStore, buyStore, approvalStore, exitStore, quoteSource, executor, options
  });
  assert.equal(included.action, 'EXIT_INCLUDED');
  assert.equal(quoteCalls, 1);

  const complete = await syncCanaryE0RoundTripWiring({
    enabled: true, deferForBuyCycle: false, launchStore, buyStore, approvalStore, exitStore, quoteSource, executor, options
  });
  assert.equal(complete.action, 'COMPLETE');
  assert.equal(approvalSignCalls, 1);
  assert.equal(exitSignCalls, 1);
  assert.equal(broadcastCalls, 2);
  assert.equal(quoteCalls, 1);
} finally {
  exitStore.close();
  approvalStore.close();
  buyStore.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

const liveGuard = spawnSync(process.execPath, ['dist/canarySniperCli.js', '--once'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    CANARY_SNIPER_R0_ENABLED: 'true',
    CANARY_E0_ROUNDTRIP_ENABLED: 'true',
    CANARY_LIVE: 'true'
  },
  encoding: 'utf8'
});
assert.notEqual(liveGuard.status, 0, 'live round-trip wiring must fail closed before runtime setup');
assert.match(`${liveGuard.stdout}\n${liveGuard.stderr}`, /CANARY_E0_ROUNDTRIP_LIVE_NOT_AUTHORIZED/);
assert.doesNotMatch(`${liveGuard.stdout}\n${liveGuard.stderr}`, /SENTRY_START_BLOCK is required/);

console.log(JSON.stringify({
  verdict: 'CANARY_E0_LIVE_WIRING_READINESS_R0_PASS',
  bankrollUsd: 40,
  fixedPrimaryTradeUsd: 1,
  primaryTradeFractionBps: 250,
  validationLossBudgetUsd: 5,
  approvalSignCalls,
  exitSignCalls,
  broadcastBoundaryCalls: broadcastCalls,
  freshExitQuoteCalls: quoteCalls,
  freshExitAuthorityChecks: authorityCalls,
  persistedCommittedBuyRehydrated: true,
  buyPollDefersRoundTripSideEffect: true,
  oneChildTransactionPerPoll: true,
  dryArmedNoSideEffects: true,
  knownHashNoRequoteResignRebroadcast: true,
  cliLiveRoundTripKillSwitch: true,
  realWalletSecretUsed: false,
  networkBroadcastInvoked: false,
  liveRoundTripReachable: false
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
    originDecisionBlockHash: BUY_BLOCK_HASH,
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
