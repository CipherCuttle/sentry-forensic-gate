import assert from 'node:assert/strict';
import {checkCompleteDualFactorySources} from './pons-s1-paired-collector-core-v1.mjs';
// Pure proof obligations: a second hostname is NOT a qualified independent node.
export const SCHEMA='PONS_S1_DUAL_RPC_NON_ENROLLING_REHEARSAL_V1';
export const OFFICIAL='https://rpc.mainnet.chain.robinhood.com';
export const CANDIDATE='https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public';
export function checkProviders(a,b){
  assert.equal(a,OFFICIAL,'OFFICIAL_RPC_PIN_REQUIRED');
  assert.equal(b,CANDIDATE,'REHEARSAL_CANDIDATE_RPC_PIN_REQUIRED');
  assert.equal(new URL(a).protocol,'https:');
  assert.equal(new URL(b).protocol,'https:');
  assert.notEqual(new URL(a).hostname,new URL(b).hostname,'SAME_PROVIDER_HOST');
  return {backendIndependenceQualified:false,archiveHistoryQualified:false};
}
export function scanRange(officialHead,otherHead,authorityStart){
  assert.equal(typeof officialHead,'bigint');
  assert.equal(typeof otherHead,'bigint');
  assert.ok(officialHead>=authorityStart&&otherHead>=authorityStart,'FACTORY_AUTHORITY_NOT_REACHED');
  const lag=officialHead>otherHead?officialHead-otherHead:otherHead-officialHead;
  assert.ok(lag<=128n,'SECOND_PROVIDER_HEAD_LAG');
  const low=officialHead<otherHead?officialHead:otherHead;
  assert.ok(low>=authorityStart+260n,'NOT_ENOUGH_BLOCKS');
  // Contiguous 256-block diagnostic, 16 sequential 16-block RPC ranges.
  return {from:low-259n,through:low-4n,lag};
}
export function selectLatestNative(official,other,factory){
  const full=checkCompleteDualFactorySources(official,other,factory);
  const native=full.all.filter(r=>r.nativePair);
  return {row:native.at(-1)??null,nativeCount:native.length,
    allCount:full.all.length,digest:full.fullFactoryTranscriptDigest};
}
function compact(b){
  return {status:b.status,block:String(b.decisionBlock),
    hash:b.decisionBlockHash.toLowerCase(),legs:b.legs.map(l=>({
      notional:String(l.notionalUsdMicros),base:String(l.calibration?.baseAmount??''),
      buy:!!l.entry?.executable,buyOut:String(l.entry?.amountOut??''),
      sell:!!l.reverse?.executable,sellOut:String(l.reverse?.amountOut??'')
    }))};
}
export function checkQuoteParity(x,y){
  const a=compact(x),b=compact(y);
  assert.equal(a.status,'COMPLETE','OFFICIAL_BASELINE_UNVERIFIED');
  assert.equal(b.status,'COMPLETE','SECOND_BASELINE_UNVERIFIED');
  assert.equal(a.legs.length,5,'OFFICIAL_NOT_FIVE_NOTIONALS');
  assert.equal(b.legs.length,5,'SECOND_NOT_FIVE_NOTIONALS');
  const ladder=['250000','500000','1000000','2000000','5000000'];
  assert.deepEqual(a.legs.map(x=>x.notional),ladder,'OFFICIAL_FROZEN_LADDER_DRIFT');
  assert.deepEqual(b.legs.map(x=>x.notional),ladder,'SECOND_FROZEN_LADDER_DRIFT');
  assert.deepEqual(a,b,'FROZEN_QUOTE_PARITY_FAILURE');
  return {matchingNotionals:5,sequentialSellCapacityProven:false};
}
export function validateDiagnostic(x){
  assert.equal(x.schemaVersion,SCHEMA);
  assert.equal(x.chainId,4663);
  assert.equal(x.secondProvider,'BLOCKREQ_PUBLIC_CANDIDATE');
  for(const key of ['backendQualified','studyActivated','cohortEnrolled',
    'sourcePublished','walletUsed','outcomesRead','scientificallyAdmissible'])
    assert.equal(x[key],false,'FORBIDDEN_PROMOTION_'+key);
  assert.ok(['PROVIDER_FAIL','C0_STAGE_FAIL','NO_NATIVE_IN_BOUNDED_WINDOW','QUOTE_UNVERIFIED',
    'REAL_DUAL_RPC_QUOTE_REHEARSAL_ONLY','RECENT_C0_ARCHIVE_UNVERIFIED',
    'INCLUSION_UNVERIFIED'].includes(x.state),
    'UNKNOWN_DIAGNOSTIC_STATE');
  if(x.state==='REAL_DUAL_RPC_QUOTE_REHEARSAL_ONLY' ||
     x.state==='RECENT_C0_ARCHIVE_UNVERIFIED'){
    assert.equal(x.quoteParity,true,'QUOTE_PARITY_REQUIRED');
    assert.equal(x.inclusion12,true,'INCLUSION_FINALITY_REQUIRED');
  }
  // Untrusted diagnostic bytes cannot impersonate real quote parity or include
  // raw provider error strings. The report is explicitly not S1 evidence.
  const allowedStages=new Set(['LAUNCH_NORMALIZATION','LAUNCH_EVENT_BINDING',
    'BASELINE_COMPOSITION','BASELINE_HEAD','FACTORY_AUTHORITY',
    'DECISION_BLOCK_HASH','MARKET_STATE','USD_CALIBRATION','ENTRY_QUOTE',
    'REVERSE_QUOTE','C0_CONTROL_EVALUATION']);
  const allowedErrors=new Set(['RPC_RATE_LIMIT','RPC_TIMEOUT',
    'RPC_UNAVAILABLE','SOURCE_OR_ADAPTER_INVARIANT','UNCLASSIFIED_ERROR']);
  for(const key of ['c0Official','c0Candidate']){
    const c=x[key];if(c===undefined)continue;
    assert.ok(c&&['COMPLETE','UNVERIFIED','ERROR'].includes(c.state),
      'BAD_C0_DIAGNOSTIC_STATE');
    assert.ok(c.failedStage===null||allowedStages.has(c.failedStage),
      'BAD_C0_DIAGNOSTIC_STAGE');
    assert.ok(c.lastCompletedStage===null||
      allowedStages.has(c.lastCompletedStage),'BAD_C0_COMPLETION_STAGE');
    assert.ok(c.failureClass===null||
      allowedErrors.has(c.failureClass),'BAD_C0_FAILURE_CLASS');
    assert.ok(c.notionalUsdMicros===null||
      C0_LADDER.has(c.notionalUsdMicros),'BAD_C0_NOTIONAL');
  }
  if(x.state==='C0_STAGE_FAIL'){
    assert.ok(x.c0Official&&x.c0Candidate,'BOTH_C0_DIAGNOSTICS_REQUIRED');
    assert.ok(x.c0Official.state==='ERROR'||x.c0Candidate.state==='ERROR',
      'C0_FAILURE_MUST_BE_OBSERVED');
    assert.equal(x.quoteParity,false,'C0_ERROR_CANNOT_PROVE_QUOTE_PARITY');
  }
  if(x.state==='REAL_DUAL_RPC_QUOTE_REHEARSAL_ONLY')
    assert.equal(x.historicArchiveStateSample,true,'HISTORIC_SAMPLE_REQUIRED');
  if(x.state==='RECENT_C0_ARCHIVE_UNVERIFIED')
    assert.equal(x.historicArchiveStateSample,false,'UNQUALIFIED_ARCHIVE_MUST_REMAIN_FALSE');
  return {verdict:x.state,edge:'UNPROVEN',activationAuthority:false};
}


// Diagnostic-only wrappers: preserve underlying adapter behavior and freeze
// a finite, sanitized stage on each provider independently. No raw RPC errors,
// endpoint URLs, addresses or credentials enter the uploaded diagnostic.
const C0_METHOD_STAGES=Object.freeze({
  getHeadBlockNumber:'BASELINE_HEAD',
  assertAuthority:'FACTORY_AUTHORITY',
  getBlockHash:'DECISION_BLOCK_HASH',
  resolveMarket:'MARKET_STATE',
  calibrateUsd:'USD_CALIBRATION',
  quoteEntry:'ENTRY_QUOTE',
  quoteIndependentReverse:'REVERSE_QUOTE'
});
const C0_LADDER=new Set(['250000','500000','1000000','2000000','5000000']);
export function newC0StageTrace(){
  return {stage:'LAUNCH_NORMALIZATION',lastCompletedStage:null,
    failedStage:null,failureClass:null,notionalUsdMicros:null};
}
export function classifyC0Failure(error){
  const names=[error?.name,error?.cause?.name].map(x=>String(x??'')).join(':');
  const code=error?.status??error?.cause?.status;
  if(code===429||/RateLimit|TooManyRequests/i.test(names))return 'RPC_RATE_LIMIT';
  if(/Timeout/i.test(names))return 'RPC_TIMEOUT';
  if(/Rpc|Http|Transport|Network|Socket|Connect/i.test(names))
    return 'RPC_UNAVAILABLE';
  const message=String(error?.message??'');
  if(/^(?:PONS_V2_|PORTABLE_BASELINE_|ROBINHOOD_USD_CALIBRATION_)/.test(message))
    return 'SOURCE_OR_ADAPTER_INVARIANT';
  return 'UNCLASSIFIED_ERROR';
}
export function observeC0Adapter(adapter,trace){
  return new Proxy(adapter,{get(target,prop){
    const value=Reflect.get(target,prop,target);
    if(typeof value!=='function')return value;
    const stage=C0_METHOD_STAGES[prop];
    if(!stage)return value.bind(target);
    return async(...args)=>{
      trace.stage=stage;
      const notional=args[0]?.notionalUsdMicros;
      if(typeof notional==='bigint'&&C0_LADDER.has(String(notional)))
        trace.notionalUsdMicros=String(notional);
      try{
        const result=await value.apply(target,args);
        trace.lastCompletedStage=stage;
        return result;
      }catch(error){
        trace.failedStage=stage;
        trace.failureClass=classifyC0Failure(error);
        throw error;
      }
    };
  }});
}
export function safeC0Report(trace,state,error=null){
  assert.ok(['COMPLETE','UNVERIFIED','ERROR'].includes(state));
  return {state,failedStage:trace.failedStage??(
    state==='COMPLETE'?null:trace.stage),
    lastCompletedStage:trace.lastCompletedStage,
    failureClass:trace.failureClass??(
      error===null?null:classifyC0Failure(error)),
    notionalUsdMicros:trace.notionalUsdMicros};
}
