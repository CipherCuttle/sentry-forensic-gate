// Pure, inert PONS S1 V1 full-factory / paired-C0 frozen-batch builder.
// Network acquisition and permission are intentionally OUTSIDE this module.
import assert from 'node:assert/strict';
import { BATCH_SCHEMA, AUTHORITY_SCHEMA, canonicalBatchBytes, digest,
  validateBatch, INCLUSION_RULE } from './pons-s1-publisher-core-v1.mjs';

export { INCLUSION_RULE };
export const MAX_SCAN_BLOCKS=16;
export const MAX_NEW_ELIGIBLE=4;
export const MAX_FACTORY_EVENTS=4096;
export const MIN_BUDGET_MS=90_000;
const BLOCK=/^0x[0-9a-f]{64}$/;
const ADDRESS=/^0x[0-9a-f]{40}$/;
const NATIVE='0x0000000000000000000000000000000000000000';
const exact=(object,fields,label)=>{
  assert.ok(object && typeof object==='object' && !Array.isArray(object),
    label+'_OBJECT_REQUIRED');
  assert.deepEqual(Object.keys(object).sort(),fields.slice().sort(),
    label+'_FIELDS_MISMATCH');
};
const blockNumber=(v,label)=>{
  assert.match(v,/^(0|[1-9]\d*)$/,label+'_BAD_DECIMAL_BLOCK');
  return BigInt(v);
};
const addr=(v,label)=>{
  assert.match(v,ADDRESS,label+'_BAD_ADDRESS');
  return v;
};
const hash=(v,label)=>{
  assert.match(v,BLOCK,label+'_BAD_HASH');
  return v;
};
const validInt=(v,label)=>{
  assert.ok(Number.isSafeInteger(v)&&v>=0,label+'_BAD_INTEGER');
  return v;
};
const lower=v=>{
  assert.equal(typeof v,'string');
  return v.toLowerCase();
};
// Normalize the *whole* factory event, not only the pre-filtered native pair.
// A sidecar may preserve the complete two-provider event transcript; the
// V1 batch currently seals the publisher-compatible identity-only digest.
export function normalizeV1FactoryLog(log,expectedFactory) {
  assert.equal(log.removed??false,false,'REMOVED_REORG_LOG_FORBIDDEN');
  assert.equal(lower(log.address),lower(expectedFactory),'WRONG_FACTORY');
  const args=log.args??{};
  const normalized={
    blockNumber:String(log.blockNumber),blockHash:lower(log.blockHash),
    transactionHash:lower(log.transactionHash),logIndex:Number(log.logIndex),
    token:lower(args.token),curve:lower(args.curve),
    deployer:lower(args.deployer),pairToken:lower(args.pairToken),
    launchConfigId:String(args.launchConfigId),
    graduationThreshold:String(args.graduationThreshold)
  };
  blockNumber(normalized.blockNumber,'FACTORY_LOG');
  hash(normalized.blockHash,'FACTORY_LOG_BLOCK');
  hash(normalized.transactionHash,'FACTORY_TX');
  validInt(normalized.logIndex,'FACTORY_LOG_INDEX');
  for(const key of ['token','curve','deployer','pairToken'])
    addr(normalized[key],key);
  blockNumber(normalized.launchConfigId,'LAUNCH_CONFIG');
  blockNumber(normalized.graduationThreshold,'GRADUATION');
  assert.notEqual(normalized.token,normalized.curve,'TOKEN_CURVE_ALIAS');
  return {...normalized,eventKey:normalized.blockNumber+':'+
    normalized.transactionHash+':'+normalized.logIndex,
    nativePair:normalized.pairToken===NATIVE};
}
const byChain=(a,b)=>BigInt(a.blockNumber)<BigInt(b.blockNumber)?-1:
  BigInt(a.blockNumber)>BigInt(b.blockNumber)?1:a.logIndex-b.logIndex;
export function checkCompleteDualFactorySources(official,archive,factory){
  assert.ok(Array.isArray(official)&&Array.isArray(archive),'DUAL_LOG_ARRAYS_REQUIRED');
  assert.ok(official.length<=MAX_FACTORY_EVENTS&&archive.length<=MAX_FACTORY_EVENTS,
    'FACTORY_EVENTS_UNBOUNDED');
  const normalized=logs=>logs.map(x=>normalizeV1FactoryLog(x,factory)).sort(byChain);
  const a=normalized(official),b=normalized(archive);
  for(const list of [a,b]){
    const seen=new Set();
    for(const row of list){
      assert.ok(!seen.has(row.eventKey),'DUPLICATE_FACTORY_EVENT');
      seen.add(row.eventKey);
    }
  }
  assert.deepEqual(a,b,'OFFICIAL_AND_ARCHIVE_FACTORY_EVENT_DISAGREEMENT');
  return {all:a,fullFactoryTranscriptDigest:digest(a),
    identityDigest:digest(a.map(x=>({
      eventKey:x.eventKey,blockHash:x.blockHash,
      token:x.token,nativePair:x.nativePair
    })))};
}
function checkedPoint(points,height,label){
  const key=String(height),p=points[key];
  assert.ok(p,label+'_BLOCK_UNAVAILABLE');
  assert.equal(p.number,key,label+'_BLOCK_NUMBER_MISMATCH');
  validInt(p.timestampMs,label+'_TIME');
  hash(p.hash,label+'_HASH');
  assert.equal(p.officialHash,p.hash,label+'_OFFICIAL_BLOCK_DISAGREEMENT');
  assert.equal(p.archiveHash,p.hash,label+'_ARCHIVE_BLOCK_DISAGREEMENT');
  return p;
}
const receiptFields=['action','decisionBlock','decisionHash','decidedAtMs',
  'observedHeadBlock','observedHeadHash','evidence','sourceCapturedBeforeOutcome'];
// Caller supplies receipts obtained at decision time from the read-only
// runtime. Accepting a local fixture never authenticates acquisition time.
function checkReceipt(receipt,row,decisionPoint,observedPoint,capturedAtMs){
  exact(receipt,receiptFields,'C0_RECEIPT');
  assert.ok(['WOULD_TRADE','REJECT','UNKNOWN_PREOUTCOME_C0'].includes(receipt.action),
    'UNKNOWN_C0_ACTION');
  assert.equal(receipt.sourceCapturedBeforeOutcome,true,
    'C0_NOT_OBSERVED_PREOUTCOME');
  assert.equal(blockNumber(receipt.decisionBlock,'C0_DECISION_BLOCK'),
    BigInt(row.blockNumber)+2n,'C0_WRONG_DECISION_HEIGHT');
  assert.equal(receipt.decisionHash,decisionPoint.hash,'C0_DECISION_HASH_DISAGREEMENT');
  assert.ok(BigInt(receipt.observedHeadBlock)>=BigInt(receipt.decisionBlock)+2n,
    'C0_BASELINE_CONFIRMATIONS_NOT_OBSERVED');
  assert.equal(receipt.observedHeadHash,observedPoint.hash,
    'C0_OBSERVATION_HEAD_HASH_UNVERIFIED');
  validInt(receipt.decidedAtMs,'C0_DECIDED_TIME');
  assert.ok(receipt.decidedAtMs>=observedPoint.timestampMs,
    'C0_RECORDED_BEFORE_OBSERVED_HEAD');
  assert.ok(receipt.decidedAtMs<=capturedAtMs,'C0_FROM_FUTURE');
  assert.ok(receipt.decidedAtMs<row.launchTimestampMs+300_000,
    'C0_RECEIPT_AFTER_EARLIEST_OUTCOME');
  assert.ok(receipt.evidence&&typeof receipt.evidence==='object'&&
    !Array.isArray(receipt.evidence),'C0_EVIDENCE_OBJECT_REQUIRED');
  assert.ok(!Object.hasOwn(receipt.evidence,'futureOutcome'),
    'FUTURE_OUTCOME_EVIDENCE_FORBIDDEN');
  if(receipt.action==='UNKNOWN_PREOUTCOME_C0')
    assert.match(receipt.evidence.reason??'',/^.{1,160}$/,
      'UNKNOWN_REASON_REQUIRED');
  for(const key of ['observedHeadBlock','observedHeadHash','syntheticInclusionRule',
    'observedC0CompletionAtMs'])
    assert.ok(!Object.hasOwn(receipt.evidence,key),'SOURCE_MAY_NOT_OVERRIDE_PROOF');
  const evidence={...receipt.evidence,observedHeadBlock:receipt.observedHeadBlock,
    observedHeadHash:receipt.observedHeadHash,
    observedC0CompletionAtMs:receipt.decidedAtMs,
    syntheticInclusionRule:INCLUSION_RULE};
  return {action:receipt.action,decisionBlock:receipt.decisionBlock,
    decisionHash:receipt.decisionHash,decidedAtMs:receipt.decidedAtMs,
    evidence,evidenceSha256:digest(evidence)};
}
export function freezeV1PairedDecisionBatch(input){
  const {protocol,authority,activationSha,officialLogs,archiveLogs,
    factory,points,fromCursor,throughBlock,confirmedHeadBlock,
    captureTimeMs,decisionReceipts,prior=null,sourceCaptureComplete}=input;
  assert.equal(sourceCaptureComplete,true,'FACTORY_SOURCE_ACQUISITION_UNQUALIFIED');
  assert.equal(protocol?.timing?.syntheticInclusionRule,INCLUSION_RULE,
    'PAIRED_INCLUSION_RULE_NOT_SEPARATELY_FROZEN');
  assert.equal(protocol?.status,'CANONICAL_FROZEN_ACTIVE',
    'DRAFT_PROTOCOL_CANNOT_COLLECT');
  assert.equal(authority?.schemaVersion,AUTHORITY_SCHEMA);
  assert.equal(authority?.status,'CANONICAL_SEPARATELY_APPROVED',
    'COLLECTOR_AUTHORITY_NOT_APPROVED');
  assert.equal(authority.collectionAuthorized,true,'COLLECTION_NOT_AUTHORIZED');
  assert.equal(authority.publicationAuthorized,true,'PUB_NOT_AUTHORIZED');
  assert.equal(authority.liveMoneyAuthorized,false);
  assert.equal(factory,lower(factory));
  assert.equal(factory,lower(input.approvedFactory??''),
    'CANONICAL_FACTORY_NOT_PINNED');
  assert.ok(Array.isArray(input.approvedSourceReceipts)&&
    input.approvedSourceReceipts.length===2 &&
    new Set(input.approvedSourceReceipts.map(x=>x.sourceId)).size===2,
    'TWO_INDEPENDENT_QUALIFIED_SOURCES_REQUIRED');
  for(const s of input.approvedSourceReceipts){
    exact(s,['sourceId','chainId','factoryRuntimeHash','checkedAtBlock',
      'verified'],'APPROVED_SOURCE');
    assert.equal(s.chainId,4663,'WRONG_SOURCE_CHAIN');
    assert.equal(s.verified,true,'UNQUALIFIED_SOURCE');
    assert.equal(s.factoryRuntimeHash, input.approvedFactoryRuntimeHash,
      'FACTORY_RUNTIME_MISMATCH');
    assert.equal(blockNumber(s.checkedAtBlock,'SOURCE_CHECKED'),
      BigInt(throughBlock),'SOURCE_FACTORY_CHECK_NOT_AT_THROUGH');
  }
  validInt(captureTimeMs,'CAPTURE_TIME');
  const from=blockNumber(fromCursor.blockNumber,'FROM_BLOCK');
  const to=blockNumber(throughBlock,'THROUGH_BLOCK');
  const head=blockNumber(confirmedHeadBlock,'CONFIRMED_HEAD');
  validInt(fromCursor.logIndex,'FROM_LOG');
  assert.ok(to>=from && to-from<16n,'UNBOUNDED_OR_REWOUND_SCAN');
  assert.ok(head>=to+12n,'SCANNED_RANGE_NOT_FINALIZED');
  assert.ok(from>=BigInt(authority.originBlockNumber),
    'SCAN_PREDATES_ACTIVATION_ORIGIN');
  if(prior){
    assert.equal(prior.independentLiveGitHubCheck,true,
      'PRIOR_LIVE_WITNESS_REQUIRED');
    assert.equal(prior.batch.scanned.nextCursor.blockNumber,fromCursor.blockNumber,
      'PREVIOUS_CURSOR_BLOCK_GAP');
    assert.equal(prior.batch.scanned.nextCursor.logIndex,fromCursor.logIndex,
      'PREVIOUS_CURSOR_LOG_GAP');
    assert.ok(prior.publishedAtMs<=captureTimeMs,
      'PREVIOUS_RELEASE_AFTER_NEW_CAPTURE');
    assert.equal(prior.batch.activationCommitSha,activationSha,
      'PREVIOUS_DIFFERENT_ACTIVATION');
  }else{
    assert.equal(fromCursor.blockNumber,authority.originBlockNumber,
      'GENESIS_WRONG_ORIGIN');
    assert.equal(fromCursor.logIndex,0,'GENESIS_WRONG_LOG_INDEX');
  }
  const officialEnd=checkedPoint(points,throughBlock,'THROUGH');
  checkedPoint(points,authority.originBlockNumber,'ORIGIN');
  const originTime=input.originTimestampMs;
  validInt(originTime,'ORIGIN_TIMESTAMP');
  assert.equal(points[authority.originBlockNumber].timestampMs,originTime,
    'ORIGIN_TIMESTAMP_MISMATCH');
  assert.ok(officialEnd.timestampMs<originTime+604800_000,
    'SEVEN_DAY_WINDOW_ALREADY_CLOSED');
  const {all,fullFactoryTranscriptDigest,identityDigest}=checkCompleteDualFactorySources(
    officialLogs,archiveLogs,factory);
  assert.ok(all.every(x=>BigInt(x.blockNumber)>=from&&
    BigInt(x.blockNumber)<=to),'FACTORY_EVENTS_OUTSIDE_SCAN');
  const priorCount=prior?.batch.cumulativeEligibleDecisions??0;
  assert.ok(Number.isSafeInteger(priorCount)&&priorCount>=0&&priorCount<200,
    'ELIGIBLE_CAP_ALREADY_REACHED_OR_INVALID');
  const selectedLimit=Math.min(MAX_NEW_ELIGIBLE,200-priorCount);
  const selected=[],census=[],included=[];
  const seenEvent=new Set(),seenToken=new Set();
  let finalBlock=to,cut=false;
  for(const log of all){
    if(log.blockNumber===fromCursor.blockNumber &&
       log.logIndex<fromCursor.logIndex) continue;
    assert.ok(!seenEvent.has(log.eventKey),'DUPLICATE_EVENT');
    assert.ok(!seenToken.has(log.token),'DUPLICATE_TOKEN_IN_BATCH');
    seenEvent.add(log.eventKey);seenToken.add(log.token);
    const launch=checkedPoint(points,log.blockNumber,'LAUNCH');
    assert.equal(launch.hash,log.blockHash,'LOG_BLOCK_REORG');
    assert.ok(launch.timestampMs>=originTime&&
      launch.timestampMs<originTime+604800_000,'EVENT_OUTSIDE_STUDY_WINDOW');
    const row={eventKey:log.eventKey,blockNumber:log.blockNumber,
      blockHash:log.blockHash,transactionHash:log.transactionHash,
      logIndex:log.logIndex,token:log.token,nativePair:log.nativePair,
      launchTimestampMs:launch.timestampMs,c0:null,inclusion:null};
    if(log.nativePair){
      const decisionHeight=(BigInt(log.blockNumber)+2n).toString();
      const decision=checkedPoint(points,decisionHeight,'DECISION');
      assert.ok(head>=BigInt(decisionHeight)+12n,
        'DECISION_NOT_FINALIZED_TWELVE_BLOCKS');
      const receipt=decisionReceipts?.[log.eventKey];
      assert.ok(receipt,'C0_RECEIPT_MISSING_FAIL_CLOSED');
      const observed=checkedPoint(points,receipt.observedHeadBlock,'C0_OBSERVED_HEAD');
      row.c0=checkReceipt(receipt,row,decision,observed,captureTimeMs);
      if(row.c0.action==='WOULD_TRADE'){
        const inclusionHeight=(BigInt(receipt.observedHeadBlock)+2n).toString();
        const inclusion=checkedPoint(points,inclusionHeight,'INCLUSION');
        assert.ok(head>=BigInt(inclusionHeight)+12n,
          'INCLUSION_NOT_FINALIZED_TWELVE_BLOCKS');
        assert.ok(inclusion.timestampMs>=receipt.decidedAtMs,
          'INCLUSION_TIME_TRAVEL_BEFORE_C0_OBSERVED');
        row.inclusion={blockNumber:inclusionHeight,blockHash:inclusion.hash,
          timestampMs:inclusion.timestampMs};
        selected.push(row.eventKey);
      }
    }
    census.push(row);
    included.push(log);
    if(selected.length===selectedLimit){
      finalBlock=BigInt(log.blockNumber);cut=true;break;
    }
  }
  assert.ok(priorCount+selected.length<=200,'ELIGIBLE_CAP_EXCEEDED');
  const remaining=200-priorCount;
  assert.ok(remaining>0,'STUDY_TARGET_ALREADY_REACHED');
  assert.ok(selected.length<=remaining,'OVER_TARGET_SELECTED');
  const actualThrough=cut?finalBlock:to;
  const atEnd=checkedPoint(points,actualThrough.toString(),'ACTUAL_THROUGH');
  let cursor;
  if(cut){
    const last=included.at(-1);
    cursor={blockNumber:last.blockNumber,logIndex:last.logIndex+1};
  }else cursor={blockNumber:(actualThrough+1n).toString(),logIndex:0};
  const identities=included.map(row=>({
    eventKey:row.eventKey,blockHash:row.blockHash,
    token:row.token,nativePair:row.nativePair
  }));
  const sealDigest=digest(identities);
  // The full transcript checksum is deliberately retained only as a local
  // diagnostic: the existing V1 singleton immutable batch cannot seal it.
  // Do not promote this to source-qualified without a reviewed schema update.
  assert.ok(fullFactoryTranscriptDigest&&identityDigest);
  const payload={
    schemaVersion:BATCH_SCHEMA,phase:'FROZEN_PREOUTCOME_NO_RESULTS',
    protocolDigest:digest(protocol),activationCommitSha:activationSha,
    activationDigest:authority.activationDigest,
    batchIndex:prior?prior.batch.batchIndex+1:0,
    previous:prior?{
      batchDigest:prior.batch.batchDigest,assetSha256:prior.assetSha256,
      releaseId:prior.releaseId,assetId:prior.assetId,
      cumulativeEligibleDecisions:prior.batch.cumulativeEligibleDecisions,
      nextCursor:prior.batch.scanned.nextCursor
    }:null,
    scanned:{
      originBlockNumber:authority.originBlockNumber,
      originBlockHash:authority.originBlockHash,
      scanFromCursor:fromCursor,
      scannedThrough:actualThrough.toString(),
      scannedThroughHash:atEnd.hash,nextCursor:cursor,
      confirmedHeadBlock:confirmedHeadBlock,
      factoryEventsDigest:sealDigest,
      officialEventsDigest:sealDigest,archiveEventsDigest:sealDigest
    },
    census,selectedEventKeys:selected,
    cumulativeEligibleDecisions:priorCount+selected.length,
    capturedAtMs:captureTimeMs,outcomesRead:false
  };
  const batch={...payload,batchDigest:digest(payload)};
  const checked=validateBatch(batch,protocol,authority,activationSha,prior,captureTimeMs);
  assert.ok(checked.deadline>captureTimeMs+MIN_BUDGET_MS,
    'BATCH_CANNOT_REACH_RELEASE_BEFORE_OUTCOME');
  return {batch,bytes:canonicalBatchBytes(batch),checked,
    localDiagnosticOnly:{
      schema:'UNSEALED_COLLECTOR_DIAGNOSTIC_NOT_SCIENTIFIC_EVIDENCE',
      fullFactoryTranscriptDigest,
      fullScannedFactoryCount:all.length,
      includedInBatchFactoryCount:included.length,
      excludedBeforeCursor:all.length-included.length,
      independentlyAuthenticated:false
    }};
}
