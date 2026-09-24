#!/usr/bin/env node
// Synthetic-only V1 collector qualification; no provider, signer or release.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, sha256 } from './pons-s1-publisher-core-v1.mjs';
import { INCLUSION_RULE, normalizeV1FactoryLog,
  checkCompleteDualFactorySources, freezeV1PairedDecisionBatch }
  from './pons-s1-paired-collector-core-v1.mjs';

const protocol=JSON.parse(readFileSync(
  new URL('../docs/experiments/pons-s1-single-protocol-decision-v1.json',import.meta.url)));
protocol.status='CANONICAL_FROZEN_ACTIVE'; // TEST ONLY: canonical JSON remains DRAFT
protocol.timing.syntheticInclusionRule=INCLUSION_RULE; // NOT YET PRE-REVIEWED
const H=x=>'0x'+x.repeat(64),A=x=>'0x'+x.repeat(40);
const FACTORY=A('a'), RUNTIME=H('e'), ACT='a'.repeat(40);
const launch=Date.parse('2026-10-01T12:00:00Z');
const points={
  '100':{number:'100',hash:H('1'),officialHash:H('1'),archiveHash:H('1'),
    timestampMs:launch},
  '102':{number:'102',hash:H('2'),officialHash:H('2'),archiveHash:H('2'),
    timestampMs:launch+20_000},
  '104':{number:'104',hash:H('4'),officialHash:H('4'),archiveHash:H('4'),
    timestampMs:launch+40_000},
  '106':{number:'106',hash:H('6'),officialHash:H('6'),archiveHash:H('6'),
    timestampMs:launch+70_000}
};
const authority={
  schemaVersion:'PONS_S1_PUBLISH_AUTHORITY_V1',
  status:'CANONICAL_SEPARATELY_APPROVED',
  protocolDigest:digest(protocol),
  reviewedMergeSha:'b'.repeat(40),reviewedMergePr:79,
  originBlockNumber:'100',originBlockHash:H('1'),
  activationDigest:'e'.repeat(64),
  publicationAuthorized:true,collectionAuthorized:true,
  liveMoneyAuthorized:false,signingAuthorized:false,
  broadcastAuthorized:false,modelPromotionAuthorized:false,
  unattendedAuthorized:false
};
function log(i,native=true){
  return {address:FACTORY,blockNumber:100n,blockHash:H('1'),
    transactionHash:H('3'),logIndex:i,removed:false,
    args:{token:A((i+1).toString(16)),curve:A('b'),deployer:A('c'),
      pairToken:native?A('0'):A('f'),launchConfigId:1n,
      graduationThreshold:100n}};
}
const sources=[
  {sourceId:'official',chainId:4663,factoryRuntimeHash:RUNTIME,
    checkedAtBlock:'100',verified:true},
  {sourceId:'independent-archive',chainId:4663,factoryRuntimeHash:RUNTIME,
    checkedAtBlock:'100',verified:true}
];
function decisionFor(row,action='WOULD_TRADE',at=launch+45_000){
  const evidence={schemaVersion:'SYNTHETIC_POINT_IN_TIME_C0_ONLY',
    quoteBlock:'102',quoteBlockHash:H('2'),
    source:'OFFLINE_FIXTURE_NOT_CHAIN_EVIDENCE',
    ...(action==='UNKNOWN_PREOUTCOME_C0'?{reason:'SYNTHETIC_TIMEOUT'}:{})};
  return {action,decisionBlock:'102',decisionHash:H('2'),
    decidedAtMs:at,observedHeadBlock:'104',observedHeadHash:H('4'),
    evidence,sourceCapturedBeforeOutcome:true};
}
function input(logs,options={}){
  const receipts={};
  for(const l of logs){
    const normalized=normalizeV1FactoryLog(l,FACTORY);
    if(normalized.nativePair)receipts[normalized.eventKey]=decisionFor(normalized);
  }
  return {protocol,authority,activationSha:ACT,officialLogs:logs,
    archiveLogs:structuredClone(logs),factory:FACTORY,approvedFactory:FACTORY,
    approvedFactoryRuntimeHash:RUNTIME,approvedSourceReceipts:sources,
    points,fromCursor:{blockNumber:'100',logIndex:0},throughBlock:'100',
    confirmedHeadBlock:'118',captureTimeMs:launch+80_000,
    originTimestampMs:launch,decisionReceipts:receipts,
    sourceCaptureComplete:true,...options};
}
const mixed=input([log(0,false),log(1,true)]);
const one=freezeV1PairedDecisionBatch(mixed);
assert.equal(one.batch.census.length,2);
assert.equal(one.batch.census[0].nativePair,false);
assert.equal(one.batch.census[0].c0,null);
assert.equal(one.batch.census[1].c0.action,'WOULD_TRADE');
assert.equal(one.batch.selectedEventKeys.length,1);
assert.equal(one.batch.cumulativeEligibleDecisions,1);
assert.equal(one.batch.census[1].inclusion.blockNumber,'106');
assert.equal(one.checked.deadline,launch+300_000);
assert.equal(sha256(one.bytes),one.checked.assetSha256);
assert.equal(one.localDiagnosticOnly.independentlyAuthenticated,false);
const empty=freezeV1PairedDecisionBatch(input([]));
assert.equal(empty.batch.census.length,0);
assert.equal(empty.batch.scanned.nextCursor.blockNumber,'101');
assert.equal(empty.checked.deadlineKind,'EMPTY_OR_NONNATIVE_OPERATIONAL_EXPIRY');
const unknownArgs=input([log(0,true)]);
unknownArgs.decisionReceipts[normalizeV1FactoryLog(log(0,true),FACTORY).eventKey]=
  decisionFor(log(0,true),'UNKNOWN_PREOUTCOME_C0');
const unknown=freezeV1PairedDecisionBatch(unknownArgs);
assert.equal(unknown.batch.selectedEventKeys.length,0);
assert.equal(unknown.batch.census[0].c0.action,'UNKNOWN_PREOUTCOME_C0');
assert.equal(unknown.batch.census[0].inclusion,null);
const five=[0,1,2,3,4].map(i=>log(i,true));
const first=freezeV1PairedDecisionBatch(input(five));
assert.equal(first.batch.census.length,4);
assert.equal(first.batch.selectedEventKeys.length,4);
assert.deepEqual(first.batch.scanned.nextCursor,{blockNumber:'100',logIndex:4});
assert.equal(first.localDiagnosticOnly.fullScannedFactoryCount,5);
const prior={
  batch:first.batch,assetSha256:sha256(first.bytes),releaseId:456,
  assetId:789,publishedAtMs:launch+90_000,independentLiveGitHubCheck:true
};
const second=freezeV1PairedDecisionBatch(input(five,{
  prior,fromCursor:first.batch.scanned.nextCursor,
  captureTimeMs:launch+100_000
}));
assert.equal(second.batch.census.length,1);
assert.equal(second.batch.selectedEventKeys.length,1);
assert.equal(second.batch.cumulativeEligibleDecisions,5);
assert.deepEqual(second.batch.scanned.nextCursor,{blockNumber:'101',logIndex:0});
assert.equal(second.batch.previous.batchDigest,first.batch.batchDigest);
let negative=0;
function fails(name,patch,regex,base=mixed){
  assert.throws(()=>freezeV1PairedDecisionBatch({...base,...patch}),regex,name);
  negative++;
}
fails('protocol not separately active',{protocol:{...protocol,status:'DRAFT_RECONCILED_NOT_ACTIVE'}},
  /DRAFT_PROTOCOL_CANNOT_COLLECT/);
fails('protocol has no pre-frozen inclusion rule',
  {protocol:{...protocol,timing:{...protocol.timing,syntheticInclusionRule:undefined}}},
  /PAIRED_INCLUSION_RULE_NOT_SEPARATELY_FROZEN/);
fails('disabled collection',{authority:{...authority,collectionAuthorized:false}},
  /COLLECTION_NOT_AUTHORIZED/);
fails('incomplete source',{sourceCaptureComplete:false},
  /FACTORY_SOURCE_ACQUISITION_UNQUALIFIED/);
fails('unapproved source runtime',
  {approvedSourceReceipts:[sources[0],{...sources[1],factoryRuntimeHash:H('f')}]},
  /FACTORY_RUNTIME_MISMATCH/);
fails('same source twice',
  {approvedSourceReceipts:[sources[0],sources[0]]},
  /TWO_INDEPENDENT_QUALIFIED_SOURCES_REQUIRED/);
fails('different source log',{archiveLogs:[log(0,false),
  {...log(1,true),args:{...log(1,true).args,token:A('f')}}]},
  /OFFICIAL_AND_ARCHIVE_FACTORY_EVENT_DISAGREEMENT/);
fails('missing non-native event',{archiveLogs:[log(1,true)]},
  /OFFICIAL_AND_ARCHIVE_FACTORY_EVENT_DISAGREEMENT/);
fails('no C0 point-in-time receipt',{decisionReceipts:{}},
  /C0_RECEIPT_MISSING_FAIL_CLOSED/);
const nativeKey=normalizeV1FactoryLog(log(1,true),FACTORY).eventKey;
fails('later historical C0 reconstruction',
  {decisionReceipts:{[nativeKey]:decisionFor(log(1,true),'WOULD_TRADE',launch+310_000)}},
  /C0_FROM_FUTURE|C0_RECEIPT_AFTER_EARLIEST_OUTCOME/);
fails('quote completed before observed head',
  {decisionReceipts:{[nativeKey]:decisionFor(log(1,true),'WOULD_TRADE',launch+30_000)}},
  /C0_RECORDED_BEFORE_OBSERVED_HEAD/);
fails('entry timestamp before completed C0',
  {points:{...points,'106':{...points['106'],timestampMs:launch+43_000}}},
  /INCLUSION_TIME_TRAVEL_BEFORE_C0_OBSERVED/);
fails('receipt with outcome data',
  {decisionReceipts:{[nativeKey]:{
    ...mixed.decisionReceipts[nativeKey],
    evidence:{...mixed.decisionReceipts[nativeKey].evidence,futureOutcome:99}
  }}},/FUTURE_OUTCOME_EVIDENCE_FORBIDDEN/);
fails('unconfirmed inclusion',{confirmedHeadBlock:'117'},
  /INCLUSION_NOT_FINALIZED_TWELVE_BLOCKS/);
fails('missing independent block agreement',
  {points:{...points,'100':{...points['100'],archiveHash:H('d')}}},
  /ARCHIVE_BLOCK_DISAGREEMENT/);
fails('too little outcome publication budget',
  {captureTimeMs:launch+220_000},
  /INSUFFICIENT_PREOUTCOME_PUBLICATION_BUDGET|BATCH_CANNOT_REACH_RELEASE/);
fails('rewound or out-of-range origin',{fromCursor:{blockNumber:'101',logIndex:0}},
  /GENESIS_WRONG_ORIGIN|UNBOUNDED_OR_REWOUND_SCAN/);
fails('preexisting stale predecessor',{prior:{...prior,publishedAtMs:launch+90_000},
  fromCursor:first.batch.scanned.nextCursor,captureTimeMs:launch+100_000},
  /PREVIOUS_RELEASE_AFTER_NEW_CAPTURE/);
fails('previous cursor gap',{prior,fromCursor:{blockNumber:'100',logIndex:99}},
  /PREVIOUS_CURSOR_LOG_GAP/);
fails('wrong factory',{factory:A('d')},/CANONICAL_FACTORY_NOT_PINNED/);
assert.throws(()=>checkCompleteDualFactorySources([log(0,true),log(0,true)],
  [log(0,true)],FACTORY),/DUPLICATE_FACTORY_EVENT/);
negative++;
assert.throws(()=>normalizeV1FactoryLog({...log(0,true),removed:true},FACTORY),
  /REMOVED_REORG_LOG_FORBIDDEN/);
negative++;
console.log(JSON.stringify({verdict:'PONS_S1_PAIRED_C0_COLLECTOR_OFFLINE_PASS',
  syntheticPositive:5,syntheticNegative:negative,realRpc:false,
  realC0Acquisition:false,sourceQualified:false,
  realProspectiveEnrollment:false,liveMoneyAuthority:false}));
