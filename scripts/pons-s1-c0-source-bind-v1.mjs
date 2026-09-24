// Pure replay-and-bind stage. No network, source signing or collection authority.
// A local JSON replay is NOT independent evidence of when the RPC data was read.
import assert from 'node:assert/strict';
import { canon, replayStoredC0Observation } from './pons-s1-c0-observer-core-v1.mjs';
import { checkCompleteDualFactorySources } from './pons-s1-paired-collector-core-v1.mjs';

const byBlock = (rows, block) => rows.filter(r=>String(r.blockNumber)===String(block));
export function bindReplayedC0SourceObservations(input,observations){
  const {officialLogs,archiveLogs,factory,points,fromCursor,throughBlock,captureTimeMs}=input;
  assert.ok(Number.isSafeInteger(captureTimeMs)&&captureTimeMs>0,'INVALID_BIND_CAPTURE_TIME');
  assert.ok(Array.isArray(observations),'C0_OBSERVATION_ARRAY_REQUIRED');
  const {all}=checkCompleteDualFactorySources(officialLogs,archiveLogs,factory);
  const eligible=all.filter(row=>row.nativePair &&
    BigInt(row.blockNumber)<=BigInt(throughBlock) &&
    (BigInt(row.blockNumber)>BigInt(fromCursor.blockNumber) ||
      (row.blockNumber===fromCursor.blockNumber&&row.logIndex>=fromCursor.logIndex)));
  const seen=new Set(),receipts={};
  for(const stored of observations){
    const replay=replayStoredC0Observation(stored);
    const evidence=stored.evidence, event=evidence.event;
    assert.ok(!seen.has(event.eventKey),'DUPLICATE_C0_SOURCE_OBSERVATION');
    seen.add(event.eventKey);
    const factoryRow=eligible.find(row=>row.eventKey===event.eventKey);
    assert.ok(factoryRow,'SOURCE_OBSERVATION_NOT_IN_NEW_NATIVE_FACTORY_CENSUS');
    assert.equal(event.nativePair,true);
    assert.equal(event.blockHash,factoryRow.blockHash);
    assert.equal(event.token,factoryRow.token);
    assert.equal(event.blockNumber,factoryRow.blockNumber);
    assert.equal(evidence.expectedFactory,factory.toLowerCase(),'OBSERVATION_FACTORY_MISMATCH');
    assert.equal(evidence.capturedAtMs,stored.receipt.decidedAtMs);
    assert.ok(evidence.capturedAtMs<=captureTimeMs,
      'OBSERVATION_STORED_AFTER_BATCH_CAPTURE');
    assert.ok(evidence.capturedAtMs<event.launchTimestampMs+300_000,
      'OBSERVATION_AFTER_FIRST_OUTCOME');
    for(const [name,source] of [
      ['official',officialLogs],['archive',archiveLogs]]){
      const expected=byBlock(source,event.blockNumber);
      const actual=evidence[name+'FactoryBlockLogs'];
      assert.deepEqual(canon(expected),canon(actual),
        name.toUpperCase()+'_FULL_FACTORY_BLOCK_TRANSCRIPT_NOT_REPLAYED');
    }
    for(const [name,point] of [
      ['launch',evidence.officialPoints.launch],
      ['decision',evidence.officialPoints.decision],
      ['observed',evidence.officialPoints.observed]]){
      const p=points[point.number];
      assert.ok(p,name.toUpperCase()+'_POINT_NOT_IN_FROZEN_BATCH_PROOF');
      assert.equal(p.hash,point.hash,name.toUpperCase()+'_BLOCK_HASH_MISMATCH');
      assert.equal(p.timestampMs,point.timestampMs,name.toUpperCase()+'_BLOCK_TIME_MISMATCH');
    }
    assert.equal(replay.sourceObservationDigest,stored.receipt.evidence.sourceObservationDigest);
    receipts[event.eventKey]=stored.receipt;
  }
  assert.equal(seen.size,eligible.length,
    'MISSING_NATIVE_C0_OBSERVATION_FULL_DENOMINATOR_INCOMPLETE');
  assert.ok(eligible.length<=4096);
  return receipts;
}
