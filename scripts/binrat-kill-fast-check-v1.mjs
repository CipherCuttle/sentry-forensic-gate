import assert from 'node:assert/strict';
import { evaluateKillFast, FUNDING_OBSERVATION_SCHEMA } from './binrat-kill-fast-core-v1.mjs';

const hex=n=>n.toString(16).padStart(64,'0');
const addr=n=>'0x'+n.toString(16).padStart(40,'0');
const launchId=n=>hex(n);

function feature(n,{control=true,r1=true}={}){
  return {
    schemaVersion:'PONS_S0_FEATURE_PACKET_V1',
    launch:{launchId:launchId(n),creator:addr(100+n),blockNumber:String(n*100)},
    boundaries:{containsTargetLaunchFutureOutcome:false,liveMoneyAuthority:false},
    policyComparison:{receipts:{
      buyEveryExecutableControl:{hypotheticalAction:control?'WOULD_TRADE':'WOULD_SKIP'},
      r1:{hypotheticalAction:r1?'WOULD_TRADE':'WOULD_SKIP'}
    }}
  };
}
function outcome(n,classification,value,horizonMs=300_000){
  return {
    schemaVersion:'PONS_S0_OUTCOME_PACKET_V1',
    launchId:launchId(n),horizonMs,status:'COMPLETE',classification,
    entryNotionalUsdMicros:'1000000',
    grossExecutableValueUsdMicros:String(value),
    grossExecutableReturnBps:String(Math.floor(value/100)),
    boundaries:{forbiddenAsFeatureInput:true,liveMoneyAuthority:false}
  };
}
function funding(n,source,block){
  return {
    schemaVersion:FUNDING_OBSERVATION_SCHEMA,
    launchId:launchId(n),deployer:addr(100+n),launchBlock:String(block),
    sourceAddress:source,postOutcomeEvidence:false,liveMoneyAuthority:false
  };
}

const features=[];
const outcomes=[];
const fundingRows=[];
for(let i=1;i<=30;i++){
  features.push(feature(i));
  const isBad=i<=10;
  outcomes.push(outcome(i,isBad?'CATASTROPHIC_LOSS':'NORMAL_WIN',isBad?100_000:1_300_000));
  if(i<=5) fundingRows.push(funding(i,addr(900+i),i*100));
  else if(i<=10) fundingRows.push(funding(i,addr(900+(i-5)),i*100));
  else fundingRows.push(funding(i,addr(1000+i),i*100));
}
const promoted=evaluateKillFast({features,outcomes,fundingObservations:fundingRows,horizonMs:300_000});
assert.equal(promoted.fundingRecurrenceV0.vetoed.count,5);
assert.equal(promoted.fundingRecurrenceV0.verdict,'PROMOTE_VETO_TO_SHORT_SHADOW');
assert.equal(promoted.programVerdict,'PROMOTE_ONE_SHORT_HORIZON_SHADOW_TEST');
assert.equal(promoted.liveMoneyAuthority,false);

const sparse=evaluateKillFast({
  features,
  outcomes,
  fundingObservations:fundingRows.map((row,index)=>index<2?row:{...row,sourceAddress:addr(2000+index)}),
  horizonMs:300_000
});
assert.notEqual(sparse.fundingRecurrenceV0.verdict,'PROMOTE_VETO_TO_SHORT_SHADOW');

const leaked=fundingRows.map(row=>({...row}));
leaked[0]={...leaked[0],postOutcomeEvidence:true};
assert.throws(()=>evaluateKillFast({features,outcomes,fundingObservations:leaked,horizonMs:300_000}),
  /KILL_FAST_FUNDING_LOOKAHEAD/);

const futureFirst=[
  funding(2,addr(777),200),
  funding(1,addr(777),100)
];
const ordered=evaluateKillFast({features,outcomes,fundingObservations:futureFirst,horizonMs:300_000});
assert.equal(ordered.fundingRecurrenceV0.vetoed.count,1,
  'only the later-in-block-order launch may inherit recurrence');

assert.throws(()=>evaluateKillFast({
  features,
  outcomes,
  fundingObservations:[funding(1,addr(777),100),funding(1,addr(778),100)],
  horizonMs:300_000
}),/KILL_FAST_DUPLICATE_FUNDING_LAUNCH/);

assert.throws(()=>evaluateKillFast({
  features,
  outcomes,
  fundingObservations:[{...funding(1,addr(777),100),deployer:addr(9999)}],
  horizonMs:300_000
}),/KILL_FAST_FUNDING_DEPLOYER_MISMATCH/);

console.log(JSON.stringify({
  verdict:'BINRAT_KILL_FAST_CHECK_PASS',
  pointInTimeFundingRecurrence:true,
  futureOutcomeLeakRejected:true,
  duplicateAndBindingConflictsRejected:true,
  promotionGateDeterministic:true,
  liveMoneyAuthority:false
},null,2));
