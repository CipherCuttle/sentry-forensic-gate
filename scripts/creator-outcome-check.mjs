import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CREATOR_OUTCOME_HORIZON_MS,
  CREATOR_OUTCOME_JOIN_V0,
  EXECUTABLE_BASELINE_R1,
  FORWARD_OUTCOMES_R1,
  MemoryStore,
  SqliteStore,
  buildProvenanceFact,
  projectCreatorOutcomeFeatures
} from '../dist/index.js';

const creatorA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const creatorB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function launch(launchId, creator, blockNumber, logIndex, suffix) {
  return {
    chainId: 57073,
    blockNumber,
    blockHash: hex64(suffix),
    observedAtMs: Number(blockNumber),
    launchId,
    eventId: `event-${launchId}`,
    factory: '0xdc37e11b68052d1539fa23386ee58ac444bf5be1',
    txHash: hex64((1000 + logIndex + Number(blockNumber)).toString(16)),
    logIndex,
    token: `0x${suffix.padStart(40, '0')}`,
    creator,
    tokenId: BigInt(100 + logIndex),
    name: launchId,
    symbol: launchId.toUpperCase(),
    launchType: 'STANDARD',
    sourceEvent: 'TokenDeployed'
  };
}

function baseline(launchId, decisionBlock) {
  return {
    baselineId: `baseline-${launchId}`,
    authorityDigest: `authority-${launchId}`,
    launchId,
    policyVersion: EXECUTABLE_BASELINE_R1,
    decisionBlock,
    decisionBlockHash: hex64(`d${decisionBlock}`),
    observedAtMs: Number(decisionBlock),
    status: 'UNVERIFIED',
    reason: 'FIXTURE_ONLY',
    market: null,
    legs: [],
    reverseSemantics: 'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL'
  };
}

function point(batch) {
  return {
    baselineId: batch.baselineId,
    authorityDigest: batch.authorityDigest,
    launchId: batch.launchId,
    decisionBlock: batch.decisionBlock,
    decisionBlockHash: batch.decisionBlockHash,
    status: batch.status
  };
}

function outcome(outcomeId, launchId, horizonMs, observedBlock, classification, sellable = true, policyVersion) {
  return {
    outcomeId,
    launchId,
    horizonMs,
    observedBlock,
    executableValueUsdMicros: 1_000_000n,
    sellable,
    liquidityUsdMicros: 5_000_000n,
    ...(classification ? { classification } : {}),
    ...(policyVersion ? { policyVersion } : {})
  };
}

function hex64(value) {
  return `0x${String(value).replace(/^0x/, '').padStart(64, '0')}`;
}

const a1 = launch('a1', creatorA, 10n, 1, 'a1');
const b1 = launch('b1', creatorB, 10n, 2, 'b1');
const a2 = launch('a2', creatorA, 10n, 3, 'a2');
const a3 = launch('a3', creatorA, 30n, 0, 'a3');
const launches = [a1, b1, a2, a3];
const facts = await Promise.all(launches.map(buildProvenanceFact));
const baselineBatches = [baseline('a1', 12n), baseline('b1', 12n), baseline('a2', 12n), baseline('a3', 32n)];
const baselinePoints = baselineBatches.map(point);
const outcomes = [
  outcome('a1-5m', 'a1', 300_000, 11n, 'NORMAL_WIN'),
  outcome('b1-24h', 'b1', CREATOR_OUTCOME_HORIZON_MS, 18n, 'NORMAL_WIN'),
  outcome('a1-24h', 'a1', CREATOR_OUTCOME_HORIZON_MS, 20n, 'NORMAL_WIN', true),
  outcome('a1-24h-r1', 'a1', CREATOR_OUTCOME_HORIZON_MS, 20n, 'CATASTROPHIC_LOSS', false, FORWARD_OUTCOMES_R1),
  outcome('a2-24h', 'a2', CREATOR_OUTCOME_HORIZON_MS, 35n, 'FAT_TAIL_WIN')
];

const projected = await projectCreatorOutcomeFeatures(baselinePoints, facts, outcomes);
const replayed = await projectCreatorOutcomeFeatures(
  [...baselinePoints].reverse(),
  [...facts].reverse(),
  [...outcomes].reverse()
);
assert.deepEqual(replayed, projected, 'projection must be deterministic across input ordering');
assert.ok(projected.every((receipt) => receipt.derivationVersion === CREATOR_OUTCOME_JOIN_V0));
assert.ok(projected.every((receipt) => receipt.inputDigest.length === 64 && receipt.outputDigest.length === 64 && receipt.evidenceDigest.length === 64));

const first = projected.find((receipt) => receipt.launchId === 'a1');
assert.equal(first.coverage, 'NO_HISTORY');
assert.equal(first.priorLaunchCount, 0);

const sameBlock = projected.find((receipt) => receipt.launchId === 'a2');
assert.equal(sameBlock.priorLaunchCount, 1, 'same-block earlier creator launch must be prior evidence');
assert.equal(sameBlock.coverage, 'UNKNOWN', 'future 24h outcome must not leak backward');
assert.equal(sameBlock.outcomeReceiptCount, 0);

const target = projected.find((receipt) => receipt.launchId === 'a3');
assert.equal(target.priorLaunchCount, 2);
assert.equal(target.outcomeReceiptCount, 1, 'wrong horizon, other creator and future outcome must be excluded');
assert.equal(target.classifiedOutcomeCount, 1);
assert.equal(target.unresolvedOutcomeCount, 1);
assert.equal(target.coverage, 'PARTIAL');
assert.equal(target.catastrophicLossCount, 1, 'canonical R1 receipt must supersede legacy receipt for the same slot');
assert.equal(target.unsellableOutcomeCount, 1);
assert.equal(target.fatTailWinCount, 0, 'a2 24h result occurs after the target decision block');
assert.deepEqual(target.sourceOutcomeIds, ['a1-24h-r1']);

const portableProjected = await projectCreatorOutcomeFeatures(
  baselinePoints,
  facts,
  outcomes.filter((item) => item.outcomeId !== 'a1-24h-r1').concat([
    outcome(
      'a1-24h-portable',
      'a1',
      CREATOR_OUTCOME_HORIZON_MS,
      20n,
      'NORMAL_WIN',
      true,
      'PORTABLE_FORWARD_OUTCOMES_R1'
    )
  ])
);
const portableTarget = portableProjected.find((receipt) => receipt.launchId === 'a3');
assert.equal(portableTarget.outcomeReceiptCount, 1);
assert.equal(portableTarget.normalWinCount, 1);
assert.deepEqual(portableTarget.sourceOutcomeIds, ['a1-24h-portable']);
assert.ok(target.sourceFactIds.includes(facts.find((fact) => fact.launchId === 'a3').factId));

await exerciseStore(new MemoryStore());

const dir = mkdtempSync(join(tmpdir(), 'sentry-creator-outcome-'));
const dbPath = join(dir, 'test.sqlite');
try {
  const store = new SqliteStore(dbPath, 57073);
  await exerciseStore(store);
  store.close();

  const reopened = new SqliteStore(dbPath, 57073);
  assert.equal((await reopened.listOutcomes()).length, outcomes.length);
  assert.equal((await reopened.listBaselineDecisionPoints()).length, baselineBatches.length);
  const sqliteProjection = await projectCreatorOutcomeFeatures(
    await reopened.listBaselineDecisionPoints(),
    await reopened.listProvenanceFacts(),
    await reopened.listOutcomes()
  );
  assert.deepEqual(sqliteProjection, projected, 'SQLite revival must preserve deterministic projection');
  reopened.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}

async function exerciseStore(store) {
  for (const item of launches) await store.putLaunch(item);
  for (const fact of facts) await store.putProvenanceFact(fact);
  for (const batch of baselineBatches) await store.putBaselineBatch(batch);
  for (const item of outcomes) assert.equal(await store.putOutcome(item), 'INSERTED');

  assert.equal(await store.putOutcome(outcomes[2]), 'DUPLICATE');
  await assert.rejects(
    store.putOutcome({ ...outcomes[2], classification: 'CATASTROPHIC_LOSS' }),
    /OUTCOME_IDENTITY_CONFLICT/
  );
  await assert.rejects(
    store.putOutcome({ ...outcomes[2], outcomeId: 'conflicting-slot' }),
    /OUTCOME_IDENTITY_CONFLICT/
  );
  assert.equal(await store.putOutcome(outcomes[3]), 'DUPLICATE', 'R1 replay should be idempotent in its own policy slot');

  const receipts = await projectCreatorOutcomeFeatures(
    await store.listBaselineDecisionPoints(),
    await store.listProvenanceFacts(),
    await store.listOutcomes()
  );
  assert.deepEqual(receipts, projected);
}

console.log('creator-outcome-check: PASS');
