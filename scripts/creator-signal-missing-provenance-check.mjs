import assert from 'node:assert/strict';
import { buildCreatorSignalEvaluation } from '../dist/index.js';

function hash(block) {
  return `0x${block.toString(16).padStart(64, '0')}`;
}

function launch(id, blockNumber) {
  return {
    chainId: 57073,
    blockNumber,
    blockHash: hash(blockNumber),
    observedAtMs: Number(blockNumber) * 1_000_000,
    launchId: id,
    eventId: `event-${id}`,
    factory: '0xdc37e11b68052d1539fa23386ee58ac444bf5be1',
    txHash: hash(blockNumber + 1_000n),
    logIndex: 0,
    token: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    creator: '0xcccccccccccccccccccccccccccccccccccccccc',
    tokenId: blockNumber,
    name: id,
    symbol: 'T',
    launchType: 'STANDARD',
    sourceEvent: 'TokenDeployed'
  };
}

class Source {
  async getHeadBlockNumber() { return 100n; }
  async getBlockPoint(blockNumber) {
    return {
      blockNumber,
      blockHash: hash(blockNumber),
      timestampMs: Number(blockNumber) * 1_000_000
    };
  }
}

function storeWithMissing(missing) {
  return {
    async listLaunchesMissingProvenance() { return missing; },
    async listProvenanceFacts() { return []; },
    async listBaselineDecisionPoints() { return []; },
    async listOutcomes() { return []; }
  };
}

await assert.rejects(
  buildCreatorSignalEvaluation(new Source(), storeWithMissing([launch('missing-mature', 1n)])),
  /CREATOR_SIGNAL_MATURE_LAUNCH_MISSING_PROVENANCE:missing-mature/,
  'a mature canonical launch without provenance must never disappear from the evaluation cohort'
);

const nonMature = await buildCreatorSignalEvaluation(
  new Source(),
  storeWithMissing([launch('missing-not-yet-mature', 20n)])
);
assert.equal(nonMature.status, 'INSUFFICIENT_SAMPLE');
assert.equal(nonMature.metrics.matureLaunchCount, 0);
assert.equal(nonMature.verdict, null);

console.log('creator-signal-missing-provenance-check: PASS');
