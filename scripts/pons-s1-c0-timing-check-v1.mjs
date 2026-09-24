import assert from 'node:assert/strict';
import {evaluateC0ChainTiming,TIMING_SCHEMA} from './pons-s1-c0-timing-core-v1.mjs';
const t=Date.parse('2026-10-01T12:00:00Z');
const H=c=>'0x'+c.repeat(64);
const p=(n,chainMs,wallMs)=>({
  blockNumber:String(n),blockHash:H('a'),timestampMs:t+chainMs,
  firstObservedAtMs:t+wallMs});
const f={
 chainId:4663,
 launch:p(100,0,5000),decision:p(102,20000,48000),
 mature:p(104,40000,50000),completed:p(104,40000,55000),
 inclusion:p(106,60000,75000),confirmed:p(118,180000,195000)
};
const plain=evaluateC0ChainTiming(f);
assert.equal(plain.schemaVersion,TIMING_SCHEMA);
assert.equal(plain.confirmedSlackMs,105000);
assert.equal(plain.confirmedWithReserve,true);
assert.equal(plain.artifactWindowWithReserve,null);
assert.equal(plain.diagnosticVerdict,'REAL_CHAIN_CONFIRMATIONS_ONLY_NO_PUBLICATION_PROOF');
const uploaded=evaluateC0ChainTiming({...f,
  sourceArtifactCreatedAt:'2026-10-01T12:03:20Z'});
assert.equal(uploaded.artifactWindowWithReserve,true);
assert.equal(uploaded.artifactArrivedBeforeLaunchFiveMinutes,true);
assert.equal(uploaded.scientificAdmissibility,'BLOCKED');
const late=evaluateC0ChainTiming({...f,
  sourceArtifactCreatedAt:'2026-10-01T12:04:30Z'});
assert.equal(late.artifactWindowWithReserve,false);
assert.equal(late.diagnosticVerdict,'REHEARSAL_DEADLINE_INFEASIBLE_IN_OBSERVED_WINDOW');
let negatives=0;
const bad=(name,patch,pattern)=>{
  assert.throws(()=>evaluateC0ChainTiming({...f,...patch}),pattern,name);negatives++;
};
bad('wrong chain',{chainId:1},/WRONG_CHAIN/);
bad('decision lookahead',{decision:p(103,20000,48000)},/DECISION_NOT_LAUNCH_PLUS_TWO/);
bad('missing baseline confirmations',{mature:p(103,40000,50000)},/C0_NOT_MATURE_AFTER_TWO_CONFIRMATIONS/);
bad('pre-mature C0 completion',{completed:p(103,40000,55000)},/C0_COMPLETED_BEFORE_MATURITY/);
bad('inclusion too early',{inclusion:p(105,60000,75000)},/INCLUSION_NOT_POST_C0_PLUS_TWO/);
bad('missing twelve blocks',{confirmed:p(117,180000,195000)},
  /INCLUSION_MISSING_TWELVE_CONFIRMATIONS/);
bad('nonmonotonic chain timestamps',{confirmed:p(118,35000,195000)},
  /NONMONOTONIC_CHAIN_TIME/);
bad('nonmonotonic observation timestamps',{confirmed:p(118,180000,70000)},
  /NONMONOTONIC_OBSERVER_TIME/);
bad('invalid deadline reserve',{deadlineReserveMs:0},
  /DEADLINE_BUFFER_MUST_REMAIN_FROZEN/);
bad('artifact before confirmation',{sourceArtifactCreatedAt:'2026-10-01T12:00:10Z'},
  /ARTIFACT_PRECEDES_CHAIN_CONFIRMATION/);
bad('bad external UTC',{sourceArtifactCreatedAt:'yesterday'},
  /SOURCE_ARTIFACT_UTC_REQUIRED/);
console.log(JSON.stringify({verdict:'PONS_S1_C0_TIMING_OFFLINE_PASS',
  syntheticPositive:3,adversarialNegative:negatives,
  realRpcUsed:false,genuineC0Measured:false,studyActivated:false}));
