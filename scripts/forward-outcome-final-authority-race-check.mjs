import assert from 'node:assert/strict';
import { buildForwardOutcome, EXECUTABLE_BASELINE_R1 } from '../dist/index.js';

const ONE_MINUTE = 60_000;
const LAUNCH_BLOCK = 52_269_353n;
const DECISION_BLOCK = LAUNCH_BLOCK + 2n;
const PREDECESSOR_BLOCK = LAUNCH_BLOCK + 5n;
const OBSERVED_BLOCK = LAUNCH_BLOCK + 6n;
const CONFIRMED_HEAD_BLOCK = LAUNCH_BLOCK + 8n;
const token = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const base = '0x0200c29006150606b650577bbe7b6248f58470c1';
const pool = '0x1111111111111111111111111111111111111111';

function hash(block, suffix = '') {
  return `0x${block.toString(16).padStart(64 - suffix.length, '0')}${suffix}`;
}

const launch = {
  chainId: 57073,
  blockNumber: LAUNCH_BLOCK,
  blockHash: hash(LAUNCH_BLOCK),
  observedAtMs: 1,
  launchId: 'launch-final-authority-race',
  eventId: 'event-final-authority-race',
  factory: '0xdc37e11b68052d1539fa23386ee58ac444bf5be1',
  txHash: hash(100n),
  logIndex: 1,
  token,
  creator: '0xcccccccccccccccccccccccccccccccccccccccc',
  tokenId: 7n,
  name: 'A',
  symbol: 'A',
  launchType: 'STANDARD',
  sourceEvent: 'TokenDeployed'
};

const batch = {
  baselineId: 'baseline-final-authority-race',
  authorityDigest: 'authority-final-authority-race',
  launchId: launch.launchId,
  policyVersion: EXECUTABLE_BASELINE_R1,
  decisionBlock: DECISION_BLOCK,
  decisionBlockHash: hash(DECISION_BLOCK),
  observedAtMs: 2,
  status: 'COMPLETE',
  market: {
    launchId: launch.launchId,
    launchedToken: token,
    baseToken: base,
    token0: token,
    token1: base,
    fee: 10_000,
    pool,
    positionLiquidity: 100n,
    activeLiquidity: 90n,
    sqrtPriceX96Before: 123n
  },
  legs: [{
    notionalUsdMicros: 1_000_000n,
    calibration: {
      kind: 'USDT0_NOMINAL_PEG_V0',
      notionalUsdMicros: 1_000_000n,
      baseToken: base,
      baseAmount: 1_000_000n,
      baseDecimals: 6
    },
    entry: {
      quoteId: 'entry-final-authority-race',
      launchId: launch.launchId,
      blockNumber: DECISION_BLOCK,
      blockHash: hash(DECISION_BLOCK),
      observedAtMs: 2,
      kind: 'ENTRY',
      mode: 'EXACT_INPUT',
      notionalUsdMicros: 1_000_000n,
      pool,
      tokenIn: base,
      tokenOut: token,
      fee: 10_000,
      amountIn: 1_000_000n,
      amountOut: 2_000_000n,
      executable: true
    },
    reverse: null,
    independentReverseRecoveryBps: null
  }],
  reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL'
};

class BaseRaceSource {
  authorityCalls = 0;
  reorged = false;

  point(blockNumber) {
    const timestampMs = 900_000 + Number(blockNumber) * 10_000;
    return {
      blockNumber,
      blockHash: this.reorged && blockNumber === OBSERVED_BLOCK ? hash(blockNumber, 'ff') : hash(blockNumber),
      timestampMs
    };
  }

  async getBlockPoint(blockNumber) { return this.point(blockNumber); }
  async assertMarketAuthority() { this.authorityCalls += 1; }
  async readMarketState() { return { activeLiquidity: 100n }; }
  async quoteTokenToBase() { return { executable: true, amountOut: 150_000n }; }
  async valueBaseAmountUsdMicros() { return 150_000n; }
}

class FinalAuthorityRaceSource extends BaseRaceSource {
  async assertMarketAuthority() {
    this.authorityCalls += 1;
    // Simulate the shallow reorg landing during the *final* authority pass.
    if (this.authorityCalls === 2) this.reorged = true;
  }
}

class FinalValidationRaceSource extends BaseRaceSource {
  async getBlockPoint(blockNumber) {
    const point = this.point(blockNumber);
    // Once the final authority pass has completed, let the predecessor read
    // return from the old fork and then land the reorg. A correct implementation
    // must read the selected horizon block after this and observe the new hash.
    if (this.authorityCalls >= 2 && blockNumber === PREDECESSOR_BLOCK && !this.reorged) {
      this.reorged = true;
    }
    return point;
  }
}

const confirmedHeadPoint = {
  blockNumber: CONFIRMED_HEAD_BLOCK,
  blockHash: hash(CONFIRMED_HEAD_BLOCK),
  timestampMs: 900_000 + Number(CONFIRMED_HEAD_BLOCK) * 10_000
};

const authorityRace = new FinalAuthorityRaceSource();
await assert.rejects(
  buildForwardOutcome(authorityRace, launch, batch, ONE_MINUTE, confirmedHeadPoint),
  /OUTCOME_REORG_DURING_READ/,
  'a fork change during the final authority read must be caught by the last canonicality check'
);
assert.equal(authorityRace.authorityCalls, 2);

const validationRace = new FinalValidationRaceSource();
await assert.rejects(
  buildForwardOutcome(validationRace, launch, batch, ONE_MINUTE, confirmedHeadPoint),
  /OUTCOME_REORG_DURING_READ/,
  'the selected horizon hash must be re-read after predecessor validation'
);
assert.equal(validationRace.authorityCalls, 2);

console.log('forward-outcome-final-authority-race-check: PASS');