import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { INCLUSION_RULE } from './pons-s1-publisher-core-v1.mjs';

export const OBS_SCHEMA='PONS_S1_C0_SOURCE_OBSERVATION_V1';
const H=/^0x[0-9a-f]{64}$/i;
const A=/^0x[0-9a-f]{40}$/i;
const A_ZERO='0x0000000000000000000000000000000000000000';
const dec=v=>{assert.match(String(v),/^(0|[1-9]\d*)$/);return BigInt(v)};
const hash=(v,l)=>{assert.match(v,H,l);return v.toLowerCase()};
const addr=(v,l)=>{assert.match(v,A,l);return v.toLowerCase()};
export function canon(v){
  if(typeof v==='bigint') return v.toString();
  if(Array.isArray(v)) return v.map(canon);
  if(v&&typeof v==='object') return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])]));
  return v;
}
export const digest=v=>createHash('sha256').update(JSON.stringify(canon(v))).digest('hex');

export function buildC0Observation(input){
  const {event,officialLog,archiveLog,officialFactoryBlockLogs,archiveFactoryBlockLogs,
    officialPoints,archivePoints,expectedFactory,launch,baseline,control,decisionBlock,
    observedHead,capturedAtMs,officialRuntimeHash,archiveRuntimeHash}=input;
  assert.ok(Array.isArray(officialFactoryBlockLogs)&&Array.isArray(archiveFactoryBlockLogs),
    'FULL_LAUNCH_BLOCK_FACTORY_CENSUS_REQUIRED');
  assert.ok(officialFactoryBlockLogs.length<=4096&&archiveFactoryBlockLogs.length<=4096,
    'FACTORY_CENSUS_UNBOUNDED');
  assert.deepEqual(canon(officialFactoryBlockLogs),canon(archiveFactoryBlockLogs),
    'FULL_LAUNCH_BLOCK_FACTORY_SOURCE_DISAGREEMENT');
  assert.ok(officialPoints&&archivePoints,'INDEPENDENT_BLOCK_POINTS_REQUIRED');
  for(const k of ['launch','decision','observed']){
    assert.deepEqual(officialPoints[k],archivePoints[k],k+'_POINT_SOURCE_DISAGREEMENT');
    assert.ok(officialPoints[k]&&Number.isSafeInteger(officialPoints[k].timestampMs));
  }
  assert.deepEqual(officialPoints.launch,{
    number:String(event.blockNumber),hash:String(event.blockHash).toLowerCase(),
    timestampMs:event.launchTimestampMs},'AUTHORITATIVE_LAUNCH_TIMESTAMP_MISMATCH');
  assert.deepEqual(officialPoints.decision,decisionBlock,'DECISION_BLOCK_POINT_DRIFT');
  assert.deepEqual(officialPoints.observed,observedHead,'OBSERVED_HEAD_POINT_DRIFT');
  assert.ok(officialPoints.launch.timestampMs<=officialPoints.decision.timestampMs&&
    officialPoints.decision.timestampMs<=officialPoints.observed.timestampMs,
    'NONMONOTONIC_CANONICAL_BLOCK_TIMESTAMPS');
  assert.equal(addr(officialLog.address,'OFFICIAL_LOG_FACTORY'),addr(expectedFactory,'EXPECTED_FACTORY'));
  assert.equal(addr(archiveLog.address,'ARCHIVE_LOG_FACTORY'),addr(expectedFactory,'EXPECTED_FACTORY'));
  const logId=l=>String(l.blockNumber)+':'+String(l.transactionHash).toLowerCase()+':'+l.logIndex;
  const matching=ls=>ls.filter(x=>logId(x)===event.eventKey);
  assert.equal(matching(officialFactoryBlockLogs).length,1,'EXACT_EVENT_NOT_SINGLETON_IN_OFFICIAL_CENSUS');
  assert.equal(matching(archiveFactoryBlockLogs).length,1,'EXACT_EVENT_NOT_SINGLETON_IN_ARCHIVE_CENSUS');
  assert.deepEqual(canon(matching(officialFactoryBlockLogs)[0]),canon(officialLog),
    'SELECTED_OFFICIAL_EVENT_NOT_IN_FULL_CENSUS');
  assert.deepEqual(canon(matching(archiveFactoryBlockLogs)[0]),canon(archiveLog),
    'SELECTED_ARCHIVE_EVENT_NOT_IN_FULL_CENSUS');
  for(const l of officialFactoryBlockLogs){
    assert.equal(addr(l.address,'FACTORY_CENSUS_LOG_FACTORY'),addr(expectedFactory,'EXPECTED_FACTORY'));
    assert.equal(hash(l.blockHash,'FACTORY_CENSUS_LOG_BLOCK'),officialPoints.launch.hash,
      'CENSUS_BLOCK_HASH_DRIFT');
    assert.equal(String(l.blockNumber),String(event.blockNumber),'CENSUS_OUT_OF_LAUNCH_BLOCK');
    assert.equal(l.removed??false,false,'REMOVED_CENSUS_LOG_FORBIDDEN');
  }
  assert.equal(addr(officialLog.args?.pairToken,'PAIR_TOKEN'),A_ZERO,'C0_NOT_NATIVE_FACTORY_EVENT');
  assert.equal(addr(officialLog.args?.token,'FACTORY_TOKEN'),addr(event.token,'EVENT_TOKEN'),
    'FACTORY_EVENT_TOKEN_MISMATCH');
  assert.equal(event.eventKey,
    String(event.blockNumber)+':'+String(event.transactionHash).toLowerCase()+':'+event.logIndex);
  assert.equal(event.nativePair,true,'C0_OBSERVER_NATIVE_ONLY');
  assert.equal(addr(event.token,'TOKEN'),addr(launch.token,'LAUNCH_TOKEN'));
  assert.equal(hash(event.blockHash,'EVENT_BLOCK_HASH'),hash(launch.blockHash,'LAUNCH_BLOCK_HASH'));
  assert.equal(String(event.blockNumber),String(launch.blockNumber));
  assert.equal(addr(launch.factory,'LAUNCH_FACTORY'),addr(expectedFactory,'EXPECTED_FACTORY'));
  assert.equal(String(launch.txHash).toLowerCase(),String(event.transactionHash).toLowerCase(),
    'NORMALIZED_LAUNCH_TRANSACTION_MISMATCH');
  assert.equal(Number(event.logIndex),Number(launch.logIndex));
  assert.deepEqual(canon(officialLog),canon(archiveLog),'C0_SOURCE_LOG_DISAGREEMENT');
  assert.equal(hash(officialRuntimeHash,'OFFICIAL_RUNTIME'),hash(archiveRuntimeHash,'ARCHIVE_RUNTIME'),
    'C0_FACTORY_RUNTIME_SOURCE_DISAGREEMENT');
  assert.equal(String(baseline.decisionBlock),String(decisionBlock.number),'C0_DECISION_BLOCK_MISMATCH');
  assert.equal(hash(baseline.decisionBlockHash,'BASELINE_DECISION_HASH'),
    hash(decisionBlock.hash,'DECISION_HASH'),'C0_DECISION_HASH_MISMATCH');
  assert.ok(dec(observedHead.number)>=dec(decisionBlock.number)+2n,'C0_CONFIRMATIONS_NOT_OBSERVED');
  assert.ok(Number.isSafeInteger(capturedAtMs)&&capturedAtMs>=observedHead.timestampMs,
    'C0_CAPTURE_BEFORE_OBSERVED_HEAD');
  assert.ok(capturedAtMs<event.launchTimestampMs+300000,'C0_CAPTURE_AFTER_5M');
  assert.ok(Number.isSafeInteger(baseline.observedAtMs)&&
    baseline.observedAtMs>=officialPoints.decision.timestampMs&&
    baseline.observedAtMs<=capturedAtMs,'BASELINE_OBSERVATION_TIME_INVALID');
  assert.equal(baseline.status==='COMPLETE'||baseline.status==='UNVERIFIED',true,
    'C0_BASELINE_INVALID_STATUS');
  assert.ok(!Object.hasOwn(baseline,'futureOutcome') &&
    !Object.hasOwn(control,'futureOutcome'),'C0_OUTCOME_CONTAMINATION');
  assert.equal(control.policyVersion,'BUY_EVERY_EXECUTABLE_CONTROL_R1',
    'WRONG_C0_POLICY_VERSION');
  assert.equal(control.decision==='ELIGIBLE'||control.decision==='REJECT'||
    control.decision==='NO_DECISION',true,'WRONG_C0_CONTROL_DECISION');
  assert.equal(control.hypotheticalAction,
    control.decision==='ELIGIBLE'?'WOULD_TRADE':'WOULD_SKIP',
    'C0_CONTROL_ACTION_CONTRADICTS_DECISION');
  const ladder=['250000','500000','1000000','2000000','5000000'];
  if(baseline.status==='COMPLETE'){
    assert.equal(baseline.legs?.length,ladder.length,'C0_INCOMPLETE_FROZEN_LADDER');
    const prefix=[];
    for(let i=0;i<ladder.length;i++){
      const leg=baseline.legs[i];
      assert.equal(String(leg.notionalUsdMicros),ladder[i],'C0_FROZEN_LADDER_DRIFT');
      if(prefix.length===i && leg.entry?.executable===true &&
        leg.reverse?.executable===true) prefix.push(ladder[i]);
    }
    const expected=baseline.legs[0].entry?.executable===true &&
      baseline.legs[0].reverse?.executable===true?'ELIGIBLE':'REJECT';
    assert.equal(control.decision,expected,'C0_CONTROL_BASELINE_CONTRADICTION');
    assert.equal(control.capacityUsdMicros===null?null:String(control.capacityUsdMicros),
      expected==='ELIGIBLE'?prefix.at(-1):null,'C0_CONTROL_CAPACITY_CONTRADICTION');
  } else assert.equal(control.decision,'NO_DECISION',
    'UNVERIFIED_C0_BASELINE_MUST_BE_UNKNOWN');

  assert.equal(control.liveMoneyAuthority,false);
  assert.equal(control.mode,'SHADOW_ONLY');
  let action;
  if(baseline.status!=='COMPLETE'||control.decision==='NO_DECISION') action='UNKNOWN_PREOUTCOME_C0';
  else if(control.hypotheticalAction==='WOULD_TRADE') action='WOULD_TRADE';
  else action='REJECT';
  const evidence={
    schemaVersion:OBS_SCHEMA,
    sourceKind:'DUAL_RPC_POINT_IN_TIME_C0',
    eventKey:event.eventKey,
    chainId:4663,
    launchBlock:String(event.blockNumber),
    launchBlockHash:hash(event.blockHash,'LAUNCH_HASH'),
    token:addr(event.token,'TOKEN'),
    decisionBlock:String(decisionBlock.number),
    decisionBlockHash:hash(decisionBlock.hash,'DECISION_HASH'),
    observedHeadBlock:String(observedHead.number),
    observedHeadHash:hash(observedHead.hash,'OBSERVED_HASH'),
    observedHeadTimestampMs:observedHead.timestampMs,
    capturedAtMs,
    syntheticInclusionRule:INCLUSION_RULE,
    event:canon(event),expectedFactory:addr(expectedFactory,'EXPECTED_FACTORY'),
    officialLog:canon(officialLog),archiveLog:canon(archiveLog),
    officialFactoryBlockLogs:canon(officialFactoryBlockLogs),
    archiveFactoryBlockLogs:canon(archiveFactoryBlockLogs),
    officialPoints:canon(officialPoints),archivePoints:canon(archivePoints),
    officialFactoryRuntimeHash:hash(officialRuntimeHash,'OFFICIAL_RUNTIME'),
    archiveFactoryRuntimeHash:hash(archiveRuntimeHash,'ARCHIVE_RUNTIME'),
    launch:canon(launch),
    baseline:canon(baseline),
    control:canon(control),
    noOutcomeReads:true,
    liveMoneyAuthority:false
  };
  const receipt={
    action,decisionBlock:String(decisionBlock.number),
    decisionHash:hash(decisionBlock.hash,'DECISION_HASH'),
    decidedAtMs:capturedAtMs,
    observedHeadBlock:String(observedHead.number),
    observedHeadHash:hash(observedHead.hash,'OBSERVED_HASH'),
    evidence:{sourceObservationDigest:digest(evidence),
      sourceObservationSchema:OBS_SCHEMA,
      sourceCapturedAtMs:capturedAtMs,
      ...(action==='UNKNOWN_PREOUTCOME_C0'?{reason:'BASELINE_OR_CONTROL_UNVERIFIED'}:{})},
    sourceCapturedBeforeOutcome:true
  };
  return {evidence,receipt,sourceObservationDigest:digest(evidence)};
}

// Deterministic local replay verifies the exact source bytes against the
// frozen policy output. It does NOT independently prove live acquisition time.
export function replayStoredC0Observation(stored){
  assert.ok(stored&&stored.evidence&&stored.receipt,'SOURCE_OBSERVATION_MISSING');
  const e=stored.evidence;
  assert.equal(e.schemaVersion,OBS_SCHEMA);
  const rebuilt=buildC0Observation({
    event:e.event,expectedFactory:e.expectedFactory,
    officialLog:e.officialLog,archiveLog:e.archiveLog,
    officialFactoryBlockLogs:e.officialFactoryBlockLogs,
    archiveFactoryBlockLogs:e.archiveFactoryBlockLogs,
    officialPoints:e.officialPoints,archivePoints:e.archivePoints,
    launch:e.launch,baseline:e.baseline,control:e.control,
    decisionBlock:e.officialPoints.decision,
    observedHead:e.officialPoints.observed,
    capturedAtMs:e.capturedAtMs,
    officialRuntimeHash:e.officialFactoryRuntimeHash,
    archiveRuntimeHash:e.archiveFactoryRuntimeHash
  });
  assert.deepEqual(canon(stored),canon(rebuilt),
    'STORED_SOURCE_EVIDENCE_OR_C0_RECEIPT_TAMPERED');
  return {schemaVersion:OBS_SCHEMA,sourceObservationDigest:rebuilt.sourceObservationDigest,
    replayed:true,independentLiveCaptureAttested:false,scientificAdmissibility:'BLOCKED'};
}
