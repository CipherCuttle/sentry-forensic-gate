import assert from 'node:assert/strict';
import { buildC0Observation, replayStoredC0Observation, digest, OBS_SCHEMA } from './pons-s1-c0-observer-core-v1.mjs';
import { INCLUSION_RULE } from './pons-s1-publisher-core-v1.mjs';
import { bindReplayedC0SourceObservations } from './pons-s1-c0-source-bind-v1.mjs';
const H=x=>'0x'+x.repeat(64),A=x=>'0x'+x.repeat(40);
const now=Date.parse('2026-10-01T12:00:40Z'), launchTs=Date.parse('2026-10-01T12:00:00Z');
const event={eventKey:'100:'+H('b')+':1',blockNumber:'100',blockHash:H('a'),
  transactionHash:H('b'),logIndex:1,token:A('1'),nativePair:true,launchTimestampMs:launchTs};
const log={address:A('f'),blockNumber:100n,blockHash:H('a'),transactionHash:H('b'),
  logIndex:1,removed:false,args:{token:A('1'),curve:A('2'),deployer:A('3'),pairToken:A('0'),
    launchConfigId:1n,graduationThreshold:2n}};
const launch={chainId:4663,ecosystem:'ROBINHOOD',launchProtocol:'PONS',launchId:'L',eventId:'E',
  factory:A('f'),txHash:H('b'),blockNumber:100n,blockHash:H('a'),logIndex:1,token:A('1'),
  creator:A('3'),name:'x',symbol:'x',sourceEventName:'TokenLaunched',observedAtMs:now,
  sourceAuthority:{schema:'TEST',payload:{}}};
const baseline={baselineId:'B',authorityDigest:'d',launchId:'L',policyVersion:'EXECUTABLE_BASELINE_R1',
  decisionBlock:102n,decisionBlockHash:H('c'),status:'COMPLETE',
  legs:[250000n,500000n,1000000n,2000000n,5000000n].map(notionalUsdMicros=>({
    notionalUsdMicros,entry:{executable:true},reverse:{executable:true}})),
  reverseSemantics:'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',chainId:4663,ecosystem:'ROBINHOOD',
  launchProtocol:'PONS',observedAtMs:now,market:null,sourceAuthority:{schema:'BASE',payload:{}}};
const control={policyVersion:'BUY_EVERY_EXECUTABLE_CONTROL_R1',decision:'ELIGIBLE',
  hypotheticalAction:'WOULD_TRADE',reasons:[],capacityUsdMicros:5000000n,
  capacitySemantics:'INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL',mode:'SHADOW_ONLY',
  liveMoneyAuthority:false};
const points={launch:{number:'100',hash:H('a'),timestampMs:launchTs},
  decision:{number:'102',hash:H('c'),timestampMs:launchTs+20_000},
  observed:{number:'104',hash:H('d'),timestampMs:launchTs+40_000}};
const input={event,expectedFactory:A('f'),officialLog:log,
  archiveLog:structuredClone(log),
  officialFactoryBlockLogs:[log],archiveFactoryBlockLogs:[structuredClone(log)],
  officialPoints:points,archivePoints:structuredClone(points),
  launch,baseline,control,
  decisionBlock:{number:'102',hash:H('c'),timestampMs:launchTs+20_000},
  observedHead:{number:'104',hash:H('d'),timestampMs:launchTs+40_000},
  capturedAtMs:now,officialRuntimeHash:H('e'),archiveRuntimeHash:H('e')};
const x=buildC0Observation(input);
assert.equal(x.evidence.schemaVersion,OBS_SCHEMA);
assert.equal(x.evidence.syntheticInclusionRule,INCLUSION_RULE);
assert.equal(x.receipt.action,'WOULD_TRADE');
assert.equal(x.receipt.observedHeadBlock,'104');
assert.equal(x.receipt.evidence.sourceObservationDigest,x.sourceObservationDigest);
assert.equal(digest(x.evidence),x.sourceObservationDigest);
assert.deepEqual(replayStoredC0Observation(JSON.parse(JSON.stringify({
  evidence:x.evidence,receipt:x.receipt,sourceObservationDigest:x.sourceObservationDigest
}))).replayed,true);
assert.equal(replayStoredC0Observation(JSON.parse(JSON.stringify(x))).independentLiveCaptureAttested,false);
let negative=0;
const bad=(name,patch,re)=>{assert.throws(()=>buildC0Observation({...input,...patch}),re,name);negative++};
bad('provider disagreement',{archiveLog:{...log,args:{...log.args,token:A('9')}}},/SELECTED_ARCHIVE_EVENT_NOT_IN_FULL_CENSUS/);
bad('runtime disagreement',{archiveRuntimeHash:H('9')},/C0_FACTORY_RUNTIME_SOURCE_DISAGREEMENT/);
bad('wrong launch token',{launch:{...launch,token:A('9')}},/Expected values to be strictly equal/);
bad('decision mismatch',{decisionBlock:{number:'103',hash:H('c'),timestampMs:launchTs+20_000}},
  /DECISION_BLOCK_POINT_DRIFT/);
bad('insufficient confirmation',{
  observedHead:{number:'103',hash:H('d'),timestampMs:launchTs+30_000},
  officialPoints:{...points,observed:{number:'103',hash:H('d'),timestampMs:launchTs+30_000}},
  archivePoints:{...points,observed:{number:'103',hash:H('d'),timestampMs:launchTs+30_000}}},
  /C0_CONFIRMATIONS_NOT_OBSERVED/);
bad('capture before observed block',{capturedAtMs:launchTs+30_000},/C0_CAPTURE_BEFORE_OBSERVED_HEAD/);
bad('capture after five minutes',{capturedAtMs:launchTs+300_000},/C0_CAPTURE_AFTER_5M/);
bad('live authority',{control:{...control,liveMoneyAuthority:true}},/Expected values to be strictly equal/);
bad('complete block census source omission',{archiveFactoryBlockLogs:[]},
  /FULL_LAUNCH_BLOCK_FACTORY_SOURCE_DISAGREEMENT/);
bad('duplicate selected event',{officialFactoryBlockLogs:[log,log],
  archiveFactoryBlockLogs:[log,log]},/EXACT_EVENT_NOT_SINGLETON_IN_OFFICIAL_CENSUS/);
bad('factory drift',{expectedFactory:A('e')},/Expected values to be strictly equal/);
bad('spoofed event time',{event:{...event,launchTimestampMs:launchTs+1000}},
  /AUTHORITATIVE_LAUNCH_TIMESTAMP_MISMATCH/);
bad('disagreeing decision blocks',{archivePoints:{...points,
  decision:{...points.decision,hash:H('9')}}},/decision_POINT_SOURCE_DISAGREEMENT/);
bad('reorged census log',{officialFactoryBlockLogs:[{...log,removed:true}],
  archiveFactoryBlockLogs:[{...log,removed:true}],officialLog:{...log,removed:true},
  archiveLog:{...log,removed:true}},/REMOVED_CENSUS_LOG_FORBIDDEN/);
bad('baseline observed after capture',{baseline:{...baseline,observedAtMs:now+1000}},
  /BASELINE_OBSERVATION_TIME_INVALID/);
bad('control policy mismatch',{control:{...control,policyVersion:'OTHER_CONTROL'}},
  /WRONG_C0_POLICY_VERSION/);
bad('control action contradiction',{control:{...control,hypotheticalAction:'WOULD_SKIP'}},
  /C0_CONTROL_ACTION_CONTRADICTS_DECISION/);
bad('control capacity contradiction',{control:{...control,capacityUsdMicros:1n}},
  /C0_CONTROL_CAPACITY_CONTRADICTION/);
bad('missing complete baseline ladder',{baseline:{...baseline,legs:[]}},
  /C0_INCOMPLETE_FROZEN_LADDER/);
assert.throws(()=>replayStoredC0Observation({...x,
  evidence:{...x.evidence,sourceKind:'FABRICATED'}}),
  /STORED_SOURCE_EVIDENCE_OR_C0_RECEIPT_TAMPERED/);negative++;
const unknown=buildC0Observation({...input,baseline:{...baseline,status:'UNVERIFIED'},
  control:{...control,decision:'NO_DECISION',hypotheticalAction:'WOULD_SKIP',
    capacityUsdMicros:null}});
assert.equal(unknown.receipt.action,'UNKNOWN_PREOUTCOME_C0');
assert.equal(unknown.receipt.evidence.reason,'BASELINE_OR_CONTROL_UNVERIFIED');
const reject=buildC0Observation({...input,
  baseline:{...baseline,legs:baseline.legs.map((l,i)=>i===0?{...l,reverse:{executable:false}}:l)},
  control:{...control,decision:'REJECT',hypotheticalAction:'WOULD_SKIP',capacityUsdMicros:null}});
assert.equal(reject.receipt.action,'REJECT');

const binderInput={officialLogs:[log],archiveLogs:[structuredClone(log)],factory:A('f'),
  fromCursor:{blockNumber:'100',logIndex:0},throughBlock:'100',captureTimeMs:now,
  points:Object.fromEntries(Object.values(points).map(p=>[p.number,{...p}]))};
const receiptMap=bindReplayedC0SourceObservations(binderInput,[x]);
assert.deepEqual(Object.keys(receiptMap),[event.eventKey]);
assert.equal(receiptMap[event.eventKey].action,'WOULD_TRADE');
assert.throws(()=>bindReplayedC0SourceObservations(binderInput,[x,x]),
  /DUPLICATE_C0_SOURCE_OBSERVATION/);negative++;
assert.throws(()=>bindReplayedC0SourceObservations(binderInput,[]),
  /MISSING_NATIVE_C0_OBSERVATION_FULL_DENOMINATOR_INCOMPLETE/);negative++;
assert.throws(()=>bindReplayedC0SourceObservations({
  ...binderInput,captureTimeMs:now-1},[x]),/OBSERVATION_STORED_AFTER_BATCH_CAPTURE/);negative++;
console.log(JSON.stringify({verdict:'PONS_S1_C0_OBSERVER_OFFLINE_PASS',
  positive:4,negative,realRpc:false,outcomeReads:false,liveMoneyAuthority:false,
  independentLiveCaptureAttested:false}));
