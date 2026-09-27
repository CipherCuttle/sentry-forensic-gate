import assert from 'node:assert/strict';

// This is a provider CAPABILITY sample, not a production archive SLA,
// autonomous-provider attestation, prospective S1 source or money authority.
export const ARCHIVE_SCHEMA='PONS_S1_ARCHIVE_PROVIDER_SAMPLE_V1';
export const PROVIDER='ALCHEMY_ROBINHOOD_MAINNET_CANDIDATE';
export const OFFICIAL='https://rpc.mainnet.chain.robinhood.com';
export const HISTORIC_OFFSETS=Object.freeze([1000n,10000n]);
export const PINNED_FACTORY_FROM_BLOCK=26841846n;
export const MAX_HEAD_LAG=128n;
export const FIELDS=Object.freeze([
  'schemaVersion','chainId','provider','historicalSampleBlocks',
  'testedHistoricalSamples','officialHistoricHeadersCompared',
  'recentFactoryEvents','recentNativeEvents','factoryTranscriptDigest',
  'recentSourcesAgree','historicStateSamplesPassed','sampledArchiveReadCapacity',
  'backendIndependenceQualified','archiveSlaQualified','s1CollectionAuthorized',
  'sourcePublished','walletUsed','moneyAuthorized','scientificallyAdmissible',
  'state','failureStage','failureClass','runId','finishedAtUtc'
]);
export const STAGES=new Set([
  'CONFIG','CHAIN_ID','RECENT_HEADS','RECENT_FACTORY_PROVENANCE',
  'HISTORIC_ARCHIVE_BLOCK_A','HISTORIC_ARCHIVE_CODE_A',
  'HISTORIC_ARCHIVE_CALL_A','HISTORIC_REFERENCE_BLOCK_A',
  'HISTORIC_ARCHIVE_BLOCK_B','HISTORIC_ARCHIVE_CODE_B',
  'HISTORIC_ARCHIVE_CALL_B','HISTORIC_REFERENCE_BLOCK_B',
  'RECENT_FACTORY_LOGS','RECEIPT'
]);
export const CLASSES=new Set([
  'RPC_TIMEOUT','RPC_RATE_LIMIT','RPC_UNAVAILABLE',
  'INVARIANT_FAILED','CONFIG_INVALID','TIME_BUDGET_EXHAUSTED',
  'UNKNOWN_FAILURE'
]);
export function assertArchiveEndpoint(raw){
  // Only the reviewed chain-specific Alchemy hostname is accepted. A secret
  // URL is never part of any diagnostic result, exception or shell argument.
  assert.ok(typeof raw==='string'&&raw.length<=2048,'CONFIG_INVALID');
  let u;try{u=new URL(raw);}catch{throw new Error('CONFIG_INVALID');}
  assert.equal(u.protocol,'https:','CONFIG_INVALID');
  assert.equal(u.hostname,'robinhood-mainnet.g.alchemy.com','CONFIG_INVALID');
  assert.equal(u.port,'','CONFIG_INVALID');
  assert.equal(u.username,'','CONFIG_INVALID');
  assert.equal(u.password,'','CONFIG_INVALID');
  assert.equal(u.search,'','CONFIG_INVALID');
  assert.equal(u.hash,'','CONFIG_INVALID');
  assert.match(u.pathname,/^\/v2\/[a-zA-Z0-9_-]{8,128}$/,'CONFIG_INVALID');
  return true;
}
export function historicBlockHeights(fromBlock){
  assert.equal(fromBlock,PINNED_FACTORY_FROM_BLOCK,'FACTORY_EPOCH_NOT_PINNED');
  return HISTORIC_OFFSETS.map(x=>fromBlock+x);
}
export function recentRange(a,b,fromBlock){
  assert.ok(typeof a==='bigint'&&typeof b==='bigint');
  assert.ok(a>=fromBlock+10020n&&b>=fromBlock+10020n,'HEIGHT_UNAVAILABLE');
  const lag=a>b?a-b:b-a;
  assert.ok(lag<=MAX_HEAD_LAG,'RECENT_HEAD_LAG_MISMATCH');
  const lower=a<b?a:b, through=lower-4n;
  return {lag,from:through-15n,through};
}
export function classifyArchiveFailure(error){
  const name=String(error?.name??'')+':'+String(error?.cause?.name??'');
  if(error?.message==='CONFIG_INVALID')return 'CONFIG_INVALID';
  if(error?.message==='TIME_BUDGET_EXHAUSTED')return 'TIME_BUDGET_EXHAUSTED';
  if(error?.status===429||error?.cause?.status===429||
     /RateLimit|TooManyRequests/i.test(name))return 'RPC_RATE_LIMIT';
  if(/Timeout/i.test(name))return 'RPC_TIMEOUT';
  if(/Http|Rpc|Transport|Network|Request|Socket|Connect/i.test(name))
    return 'RPC_UNAVAILABLE';
  if(error?.code==='ERR_ASSERTION'||/^(?:HEIGHT_|RECENT_)/.test(
      String(error?.message??'')))return 'INVARIANT_FAILED';
  return 'UNKNOWN_FAILURE';
}
export function createArchiveReceipt({fromBlock,runId=null}){
  assert.equal(fromBlock,PINNED_FACTORY_FROM_BLOCK,'FACTORY_EPOCH_NOT_PINNED');
  if(runId!==null)assert.match(String(runId),/^\d{1,18}$/,'RUN_ID_INVALID');
  const r={
    schemaVersion:ARCHIVE_SCHEMA,chainId:4663,provider:PROVIDER,
    historicalSampleBlocks:historicBlockHeights(fromBlock).map(String),
    testedHistoricalSamples:0,officialHistoricHeadersCompared:0,
    recentFactoryEvents:null,recentNativeEvents:null,
    factoryTranscriptDigest:null,recentSourcesAgree:false,
    historicStateSamplesPassed:false,sampledArchiveReadCapacity:false,
    backendIndependenceQualified:false,archiveSlaQualified:false,
    s1CollectionAuthorized:false,sourcePublished:false,walletUsed:false,
    moneyAuthorized:false,scientificallyAdmissible:false,
    state:'NOT_RUN',failureStage:null,failureClass:null,
    runId:runId===null?null:String(runId),finishedAtUtc:null
  };
  return r;
}
export function validateArchiveReceipt(r){
  assert.deepEqual(Object.keys(r).sort(),[...FIELDS].sort(),'RECEIPT_FIELD_INJECTION');
  assert.equal(r.schemaVersion,ARCHIVE_SCHEMA);
  assert.equal(r.chainId,4663);
  assert.equal(r.provider,PROVIDER);
  for(const k of ['backendIndependenceQualified','archiveSlaQualified',
    's1CollectionAuthorized','sourcePublished','walletUsed',
    'moneyAuthorized','scientificallyAdmissible'])
    assert.equal(r[k],false,'FORBIDDEN_PROMOTION_'+k);
  assert.deepEqual(r.historicalSampleBlocks,
    HISTORIC_OFFSETS.map(offset=>String(PINNED_FACTORY_FROM_BLOCK+offset)),
    'SAMPLE_HEIGHTS_NOT_PINNED');
  assert.ok(r.runId===null||/^\d{1,18}$/.test(r.runId),'RUN_ID_INVALID');
  assert.ok(Number.isInteger(r.testedHistoricalSamples)&&
    r.testedHistoricalSamples>=0&&r.testedHistoricalSamples<=2);
  assert.ok(Number.isInteger(r.officialHistoricHeadersCompared)&&
    r.officialHistoricHeadersCompared>=0&&
    r.officialHistoricHeadersCompared<=r.testedHistoricalSamples);
  assert.ok(['NOT_RUN','ARCHIVE_UNVERIFIED',
    'ARCHIVE_SAMPLE_ONLY_REFERENCE_UNAVAILABLE',
    'ARCHIVE_SAMPLE_HEADERS_MATCHED_ONLY'].includes(r.state),'UNKNOWN_VERDICT');
  assert.ok(r.failureStage===null||STAGES.has(r.failureStage),
    'UNSAFE_FAILURE_STAGE');
  assert.ok(r.failureClass===null||CLASSES.has(r.failureClass),
    'UNSAFE_FAILURE_CLASS');
  assert.ok(r.recentFactoryEvents===null||
    Number.isSafeInteger(r.recentFactoryEvents)&&r.recentFactoryEvents>=0);
  assert.ok(r.recentNativeEvents===null||
    Number.isSafeInteger(r.recentNativeEvents)&&r.recentNativeEvents>=0);
  if(r.recentFactoryEvents!==null&&r.recentNativeEvents!==null)
    assert.ok(r.recentNativeEvents<=r.recentFactoryEvents);
  assert.ok(r.factoryTranscriptDigest===null||
    /^[0-9a-f]{64}$/.test(r.factoryTranscriptDigest));
  if(r.state.startsWith('ARCHIVE_SAMPLE_')){
    assert.equal(r.testedHistoricalSamples,2,'BOTH_ARCHIVE_SAMPLES_REQUIRED');
    assert.equal(r.historicStateSamplesPassed,true,'HISTORIC_STATE_REQUIRED');
    assert.equal(r.recentSourcesAgree,true,'RECENT_PARITY_REQUIRED');
    assert.equal(r.sampledArchiveReadCapacity,true);
    assert.ok(r.factoryTranscriptDigest,'FACTORY_TRANSCRIPT_REQUIRED');
    assert.equal(r.failureStage,null);
    assert.equal(r.failureClass,null);
    if(r.state==='ARCHIVE_SAMPLE_HEADERS_MATCHED_ONLY')
      assert.equal(r.officialHistoricHeadersCompared,2,
        'HISTORIC_REFERENCE_HEADERS_REQUIRED');
    else assert.ok(r.officialHistoricHeadersCompared<2,
      'MISSING_REFERENCE_MUST_REMAIN_EXPLICIT');
  }else{
    assert.equal(r.sampledArchiveReadCapacity,false,
      'UNVERIFIED_CANNOT_PROMOTE_CAPABILITY');
  }
  return {verdict:r.state,qualification:false,moneyAuthority:false};
}
