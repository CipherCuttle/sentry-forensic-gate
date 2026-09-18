import assert from 'node:assert/strict';
import { keccak256 } from 'viem';
import {
  EXECUTABLE_BASELINE_R1,
  ViemPonsV2CreatorHistoryAdapter,
  derivePonsV2EventId,
  derivePonsV2LaunchId,
  buildNormalizedProvenanceFact,
  projectPortableCreatorOutcomeFeature
} from '../dist/index.js';

const factory = '0x1111111111111111111111111111111111111111';
const creator = '0x2222222222222222222222222222222222222222';
const other = '0x3333333333333333333333333333333333333333';
const code = '0x6000';
const authority = {
  authorityId: 'TEST_PONS_CREATOR_HISTORY',
  chainId: 4663,
  factory,
  fromBlock: 100n,
  factoryRuntimeCodeHash: keccak256(code)
};

const targetTxHash = hex64('300');
const targetToken = '0x4444444444444444444444444444444444444444';
const [targetLaunchId, targetEventId] = await Promise.all([
  derivePonsV2LaunchId({
    chainId: 4663,
    factory,
    txHash: targetTxHash,
    token: targetToken
  }),
  derivePonsV2EventId({
    chainId: 4663,
    factory,
    txHash: targetTxHash,
    logIndex: 5
  })
]);
const target = {
  chainId: 4663,
  ecosystem: 'ROBINHOOD',
  launchProtocol: 'PONS',
  launchId: targetLaunchId,
  eventId: targetEventId,
  factory,
  txHash: targetTxHash,
  blockNumber: 120n,
  blockHash: hex64('120'),
  logIndex: 5,
  token: targetToken,
  creator,
  name: 'Target',
  symbol: 'TGT',
  sourceEventName: 'TokenLaunched',
  observedAtMs: 1,
  sourceAuthority: { schema: 'TEST', payload: {} }
};

const prior1 = log({
  blockNumber: 105n,
  logIndex: 1,
  tx: '1051',
  token: '0x5555555555555555555555555555555555555555',
  deployer: creator
});
const sameBlockPrior = log({
  blockNumber: 120n,
  logIndex: 2,
  tx: '1202',
  token: '0x6666666666666666666666666666666666666666',
  deployer: creator
});
const targetLog = log({
  blockNumber: 120n,
  logIndex: 5,
  tx: '300',
  token: target.token,
  deployer: creator
});
const sameBlockLater = log({
  blockNumber: 120n,
  logIndex: 8,
  tx: '1208',
  token: '0x7777777777777777777777777777777777777777',
  deployer: creator
});
const otherCreator = log({
  blockNumber: 110n,
  logIndex: 1,
  tx: '1101',
  token: '0x8888888888888888888888888888888888888888',
  deployer: other
});

const blockHashes = new Map([
  [100n, hex64('100')],
  [120n, target.blockHash],
  [122n, hex64('122')]
]);
const requestedRanges = [];

const client = {
  async getChainId() { return 4663; },
  async getBytecode() { return code; },
  async getBlock({ blockNumber }) {
    return { hash: blockHashes.get(blockNumber) ?? hex64(blockNumber.toString()) };
  },
  async getLogs({ args, fromBlock, toBlock }) {
    assert.equal(args.deployer.toLowerCase(), creator);
    requestedRanges.push([fromBlock, toBlock]);
    return [prior1, sameBlockPrior, targetLog, sameBlockLater, otherCreator]
      .filter((item) =>
        item.blockNumber >= fromBlock &&
        item.blockNumber <= toBlock &&
        item.args.deployer.toLowerCase() === creator
      );
  }
};

const adapter = new ViemPonsV2CreatorHistoryAdapter({
  authority,
  client,
  maxRangeBlocks: 10n
});

const scan = await adapter.scan({
  target,
  decisionBlock: 122n,
  decisionBlockHash: hex64('122')
});
assert.equal(scan.priorFacts.length, 2);
assert.equal(scan.priorFacts[0].observedBlock, 105n);
assert.equal(scan.priorFacts[1].observedBlock, 120n);
assert.equal(scan.priorFacts[1].logIndex, 2);
assert.equal(scan.scannedFromBlock, 100n);
assert.equal(scan.scannedThroughBlock, 120n);
assert.deepEqual(requestedRanges, [[100n, 109n], [110n, 119n], [120n, 120n]]);
assert.equal(scan.sourceAuthority.payload.completeness, 'FULL_REVIEWED_FACTORY_EPOCH_LOG_RANGE_TO_TARGET');

const baseline = portableBaseline(target, 'baseline-target', 122n, hex64('122'));
const feature = await projectPortableCreatorOutcomeFeature(
  baseline,
  scan.targetFact,
  scan.priorFacts,
  []
);
assert.equal(feature.coverage, 'UNKNOWN');
assert.equal(feature.priorLaunchCount, 2);
assert.equal(feature.classifiedOutcomeCount, 0);

const noHistoryTarget = {
  ...target,
  launchId: 'fresh-launch',
  eventId: 'fresh-event',
  txHash: hex64('400'),
  blockNumber: 101n,
  blockHash: hex64('101'),
  logIndex: 1,
  token: '0x9999999999999999999999999999999999999999'
};
const noHistoryFact = await buildNormalizedProvenanceFact(noHistoryTarget);
const noHistoryFeature = await projectPortableCreatorOutcomeFeature(
  portableBaseline(noHistoryTarget, 'baseline-fresh', 103n, hex64('103')),
  noHistoryFact,
  [],
  []
);
assert.equal(noHistoryFeature.coverage, 'NO_HISTORY');
assert.equal(noHistoryFeature.priorLaunchCount, 0);

await assert.rejects(
  projectPortableCreatorOutcomeFeature(
    baseline,
    scan.targetFact,
    [{ ...scan.priorFacts[0], creator: other }],
    []
  ),
  /PORTABLE_CREATOR_PRIOR_FACT_INVALID/
);

const missingTargetClient = {
  ...client,
  async getLogs() { return [prior1]; }
};
const missingTargetAdapter = new ViemPonsV2CreatorHistoryAdapter({
  authority,
  client: missingTargetClient,
  maxRangeBlocks: 50n
});
await assert.rejects(
  missingTargetAdapter.scan({
    target,
    decisionBlock: 122n,
    decisionBlockHash: hex64('122')
  }),
  /PONS_V2_CREATOR_HISTORY_TARGET_CARDINALITY:0/
);

console.log('pons-v2-creator-history-check: PASS');

function log({ blockNumber, logIndex, tx, token, deployer }) {
  return {
    blockNumber,
    blockHash: hex64(blockNumber.toString()),
    transactionHash: hex64(tx),
    logIndex,
    args: {
      token,
      curve: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      deployer,
      pairToken: '0x0000000000000000000000000000000000000000',
      launchConfigId: 0n,
      graduationThreshold: 1n
    }
  };
}

function portableBaseline(launch, baselineId, decisionBlock, decisionBlockHash) {
  return {
    baselineId,
    authorityDigest: `authority-${baselineId}`,
    launchId: launch.launchId,
    policyVersion: EXECUTABLE_BASELINE_R1,
    decisionBlock,
    decisionBlockHash,
    observedAtMs: 1,
    status: 'COMPLETE',
    market: null,
    legs: [],
    reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
    chainId: launch.chainId,
    ecosystem: launch.ecosystem,
    launchProtocol: launch.launchProtocol,
    sourceAuthority: { schema: 'TEST_BASELINE', payload: {} }
  };
}

function hex64(value) {
  const raw = String(value).replace(/^0x/, '');
  return `0x${raw.padStart(64, '0')}`;
}
