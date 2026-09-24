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
  assert.ok(['PROVIDER_FAIL','NO_NATIVE_IN_BOUNDED_WINDOW','QUOTE_UNVERIFIED',
    'REAL_DUAL_RPC_QUOTE_REHEARSAL_ONLY','INCLUSION_UNVERIFIED'].includes(x.state),
    'UNKNOWN_DIAGNOSTIC_STATE');
  if(x.state==='REAL_DUAL_RPC_QUOTE_REHEARSAL_ONLY'){
    assert.equal(x.quoteParity,true,'QUOTE_PARITY_REQUIRED');
    assert.equal(x.inclusion12,true,'INCLUSION_FINALITY_REQUIRED');
  }
  return {verdict:x.state,edge:'UNPROVEN',activationAuthority:false};
}
