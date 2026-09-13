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
    launchId: id
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
    async readLaunchProvenanceSnapshot() { return { missingProvenance: missing, facts: [] }; },
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
