#!/usr/bin/env node
// Bounded real-chain dual-RPC diagnostic. PR-only, ONE frozen-size scan,
// at most ONE real native C0; never a prospective S1 source or cohort.
import assert from 'node:assert/strict';
import {createPublicClient,defineChain,http,keccak256} from 'viem';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {
  CURRENT_PONS_V2_AUTHORITY as FACTORY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY as TEMPLATE,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY as USD,
  ViemPonsV2LaunchAdapter,ViemPonsV2CurveQuoteAdapter,
  ViemRobinhoodUsdCalibrationAdapter,buildPortableBaselineBatch,
  evaluateBuyEveryExecutableControl,ponsV2TokenLaunchedEvent,
  ponsV2FactoryReadAbi
} from '../dist/index.js';
import {SCHEMA,OFFICIAL,CANDIDATE,checkProviders,
  scanRange,selectLatestNative,checkQuoteParity,validateDiagnostic}
  from './pons-s1-dual-rpc-rehearsal-core-v1.mjs';

assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request','PR_ONLY');
assert.equal(process.env.GITHUB_REPOSITORY,'CipherCuttle/sentry-forensic-gate',
  'REPOSITORY_PIN');
assert.equal(process.env.GITHUB_HEAD_REF,'agent/pons-s1-c0-typed-unknown-v1',
  'EXACT_APPROVED_DRAFT_ONLY');
assert.equal(process.env.PONS_S1_DIAGNOSTIC,'ONE_BOUNDED_PUBLIC_DUAL_RPC',
  'EXPLICIT_READ_ONLY_DIAGNOSTIC_FLAG_REQUIRED');
assert.ok(process.argv[2],'USAGE: runner <exclusive-receipt.json>');
checkProviders(OFFICIAL,CANDIDATE);

const chain=defineChain({id:4663,name:'Robinhood Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:[OFFICIAL]}}});
const client=url=>createPublicClient({chain,
  transport:http(url,{timeout:12000,retryCount:0})});
const [official,other]=[client(OFFICIAL),client(CANDIDATE)];
const result={
  schemaVersion:SCHEMA,chainId:4663,
  secondProvider:'BLOCKREQ_PUBLIC_CANDIDATE',backendQualified:false,
  studyActivated:false,cohortEnrolled:false,sourcePublished:false,
  walletUsed:false,outcomesRead:false,scientificallyAdmissible:false,
  quoteParity:false,inclusion12:false,
  scientificProof:false,actualFill:false,independentSourceSeal:false,
  runId:process.env.GITHUB_RUN_ID??null,
  exactPrHead:process.env.PONS_S1_PR_HEAD_SHA??null,
  historicArchiveStateSample:false
};
let phase='CHAIN_ID';
const started=Date.now();
const budget=()=>assert.ok(Date.now()-started<150000,'REHEARSAL_TIME_BUDGET_EXHAUSTED');
async function point(c,n){
  budget();
  const b=await c.getBlock({blockNumber:n});
  assert.ok(b?.hash&&b?.timestamp,'BLOCK_POINT_MISSING');
  return {blockNumber:String(n),hash:b.hash.toLowerCase(),
    timestampMs:Number(b.timestamp)*1000};
}
const same=(x,y,label)=>assert.deepEqual(x,y,label+'_DUAL_PROVIDER_DISAGREEMENT');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function oneC0(c,row,decisionHeight){
  const adapter=new ViemPonsV2LaunchAdapter({authority:FACTORY,client:c});
  const launches=await adapter.catchUp(BigInt(row.blockNumber),
    BigInt(row.blockNumber));
  const launch=launches.find(x=>
    String(x.blockNumber)===row.blockNumber &&
    x.txHash.toLowerCase()===row.transactionHash &&
    x.logIndex===row.logIndex);
  assert.ok(launch,'ACTUAL_LAUNCH_NOT_FOUND_IN_ADAPTER');
  assert.equal(launch.token.toLowerCase(),row.token,
    'NORMALIZED_TOKEN_DISAGREEMENT');
  const quote=new ViemPonsV2CurveQuoteAdapter({authority:FACTORY,
    templateAuthority:TEMPLATE,client:c,now:Date.now});
  const usd=new ViemRobinhoodUsdCalibrationAdapter({authority:USD,client:c});
  const begin=Date.now();
  const baseline=await buildPortableBaselineBatch({
    launch:adapter,marketQuotes:quote,usdCalibration:usd
  },launch,Date.now);
  assert.equal(String(baseline.decisionBlock),String(decisionHeight));
  const control=evaluateBuyEveryExecutableControl(baseline);
  return {baseline,control,elapsedMs:Date.now()-begin};
}
try{
  const ids=await Promise.all([official.getChainId(),other.getChainId()]);
  assert.deepEqual(ids,[4663,4663],'CHAIN_ID_MISMATCH');
  phase='HEAD_AND_FACTORY_PROVENANCE';
  const [h1,h2]=await Promise.all([
    official.getBlockNumber(),other.getBlockNumber()]);
  const range=scanRange(h1,h2,FACTORY.fromBlock);
  result.headLagBlocks=String(range.lag);
  result.scanFrom=String(range.from);result.scanThrough=String(range.through);
  const [p1,p2,c1,c2]=await Promise.all([
    point(official,range.through),point(other,range.through),
    official.getBytecode({address:FACTORY.factory,blockNumber:range.through}),
    other.getBytecode({address:FACTORY.factory,blockNumber:range.through})
  ]);
  same(p1,p2,'SCAN_BOUNDARY');
  assert.ok(c1&&c2,'FACTORY_RUNTIME_MISSING');
  assert.equal(keccak256(c1).toLowerCase(),
    FACTORY.factoryRuntimeCodeHash.toLowerCase(),
    'OFFICIAL_FACTORY_RUNTIME_MISMATCH');
  assert.equal(keccak256(c2).toLowerCase(),
    FACTORY.factoryRuntimeCodeHash.toLowerCase(),
    'SECOND_FACTORY_RUNTIME_MISMATCH');

  // One previous live diagnostic failed in an undifferentiated historical
  // Promise.all. Probe each endpoint and read method separately, then still
  // measure RECENT quote transport if historic access is unavailable.
  const old=FACTORY.fromBlock+1000n;
  const historic=async(client,label)=>{
    let stage='BLOCK';
    try{
      phase='HISTORIC_'+label+'_'+stage;
      const b=await point(client,old);
      stage='CODE';phase='HISTORIC_'+label+'_'+stage;
      const code=await client.getBytecode({
        address:FACTORY.factory,blockNumber:old});
      assert.ok(code,'HISTORIC_CODE_MISSING');
      assert.equal(keccak256(code).toLowerCase(),
        FACTORY.factoryRuntimeCodeHash.toLowerCase(),
        'HISTORIC_CODE_NOT_PINNED');
      stage='ETH_CALL';phase='HISTORIC_'+label+'_'+stage;
      const hook=await client.readContract({
        address:FACTORY.factory,abi:ponsV2FactoryReadAbi,
        functionName:'memeHook',blockNumber:old});
      return {block:b,hook:String(hook).toLowerCase()};
    }catch(err){
      const n=String(err?.name??'');
      result['historic'+label+'FailureStage']=stage;
      result['historic'+label+'FailureClass']=/timeout/i.test(n)?
        'RPC_TIMEOUT':/rpc|http|transport|network|request/i.test(n)?
        'RPC_UNAVAILABLE':'HISTORICAL_STATE_OR_CONTRACT_INVARIANT';
      return null;
    }
  };
  const hOfficial=await historic(official,'Official');
  const hCandidate=await historic(other,'Candidate');
  if(hOfficial&&hCandidate){
    same(hOfficial,hCandidate,'HISTORIC_STATE_PARITY');
    result.historicArchiveStateSample=true;
  }
  result.historicSampleBlock=String(old);
  phase='DUAL_PROVIDER_CONTIGUOUS_256_BLOCK_CENSUS';
  const logs1=[],logs2=[];
  for(let from=range.from;from<=range.through;from+=16n){
    budget();
    const to=from+15n<=range.through?from+15n:range.through;
    const filter={address:FACTORY.factory,event:ponsV2TokenLaunchedEvent,
      fromBlock:from,toBlock:to,strict:true};
    const [x,y]=await Promise.all([
      official.getLogs(filter),other.getLogs(filter)]);
    selectLatestNative(x,y,FACTORY.factory);
    logs1.push(...x);logs2.push(...y);
  }
  const full=selectLatestNative(logs1,logs2,FACTORY.factory);
  result.contiguousScannedBlocks=256;
  result.scannedEvents=full.allCount;result.nativeEvents=full.nativeCount;
  result.fullFactoryTranscriptDigest=full.digest;
  if(!full.row)result.state='NO_NATIVE_IN_BOUNDED_WINDOW';
  else{
    const row=full.row,launchHeight=BigInt(row.blockNumber);
    const decisionHeight=launchHeight+2n;
    phase='REAL_NATIVE_LAUNCH_AND_DUAL_PROVIDER_C0';
    const [l1,l2,d1,d2]=await Promise.all([
      point(official,launchHeight),point(other,launchHeight),
      point(official,decisionHeight),point(other,decisionHeight)
    ]);
    same(l1,l2,'LAUNCH');same(d1,d2,'DECISION');
    assert.equal(l1.hash,row.blockHash,'LAUNCH_HASH_CHANGED');
    result.launchBlock=String(launchHeight);
    result.launchAgeAtSelectionMs=Date.now()-l1.timestampMs;
    const [a,b]=await Promise.all([
      oneC0(official,row,decisionHeight),oneC0(other,row,decisionHeight)
    ]);
    result.c0AcquisitionElapsedMs=Math.max(a.elapsedMs,b.elapsedMs);
    result.c0CompletedAtUtc=new Date().toISOString();
    if(a.baseline.status!=='COMPLETE'||b.baseline.status!=='COMPLETE'){
      result.state='QUOTE_UNVERIFIED';
    }else{
      checkQuoteParity(a.baseline,b.baseline);
      assert.equal(a.control.hypotheticalAction,b.control.hypotheticalAction,
        'FROZEN_C0_ACTION_SOURCE_DISAGREEMENT');
      result.quoteParity=true;
      phase='POST_C0_COMPLETION_HEAD_INCLUSION_PLUS_12';
      budget();
      const [after1,after2]=await Promise.all([
        official.getBlockNumber(),other.getBlockNumber()]);
      const completed=after1<after2?after1:after2;
      const [cp1,cp2]=await Promise.all([
        point(official,completed),point(other,completed)]);
      same(cp1,cp2,'C0_COMPLETION_HEAD');
      const inclusion=completed+2n,confirmed=inclusion+12n;
      let enough=false;
      for(let i=0;i<24;i++){
        budget();
        const [x,y]=await Promise.all([
          official.getBlockNumber(),other.getBlockNumber()]);
        if(x>=confirmed&&y>=confirmed){enough=true;break;}
        await pause(2500);
      }
      if(enough){
        const [i1,i2,f1,f2,re1,re2,rd1,rd2]=await Promise.all([
          point(official,inclusion),point(other,inclusion),
          point(official,confirmed),point(other,confirmed),
          point(official,launchHeight),point(other,launchHeight),
          point(official,decisionHeight),point(other,decisionHeight)
        ]);
        same(i1,i2,'INCLUSION');same(f1,f2,'TWELVE_CONFIRMATIONS');
        same(re1,re2,'RECHECK_LAUNCH');same(rd1,rd2,'RECHECK_DECISION');
        assert.equal(re1.hash,l1.hash,'REORG_DURING_REHEARSAL');
        assert.equal(rd1.hash,d1.hash,'DECISION_REORG_DURING_REHEARSAL');
        result.inclusion12=true;
        result.inclusion12ObservedAtUtc=new Date().toISOString();
      }
      result.remainingLaunchFiveMinuteBudgetMs=l1.timestampMs+300000-Date.now();
      result.state=result.inclusion12&&result.remainingLaunchFiveMinuteBudgetMs>90000?
        (result.historicArchiveStateSample?
          'REAL_DUAL_RPC_QUOTE_REHEARSAL_ONLY':
          'RECENT_C0_ARCHIVE_UNVERIFIED'):'INCLUSION_UNVERIFIED';
    }
    // No transcript/source batch is emitted; this is a technical probe only.
    result.observedBeforeFiveMinuteOutcomeAtSelection=
      result.launchAgeAtSelectionMs<300000;
  }
}catch(err){
  result.state='PROVIDER_FAIL';result.failureStage=phase;
  const name=String(err?.name??'');
  result.failureClass=/timeout/i.test(name)?'RPC_TIMEOUT':
    /rpc|http|transport|network|request/i.test(name)?'RPC_UNAVAILABLE':
    'SOURCE_OR_ADAPTER_INVARIANT_FAILED';
  // Never store raw errors, secret-bearing URLs, or any observed return.
}
result.finishedAtUtc=new Date().toISOString();
result.report=validateDiagnostic(result);
const out=await open(resolve(process.argv[2]),'wx',0o600);
try{await out.writeFile(JSON.stringify(result)+'\n');await out.sync();}
finally{await out.close();}
console.log(JSON.stringify({verdict:result.state,stage:phase,
  failureClass:result.failureClass??null,
  scannedEvents:result.scannedEvents??null,
  nativeEvents:result.nativeEvents??null,
  historicArchiveStateSample:result.historicArchiveStateSample,
  historicOfficialFailureStage:result.historicOfficialFailureStage??null,
  historicOfficialFailureClass:result.historicOfficialFailureClass??null,
  historicCandidateFailureStage:result.historicCandidateFailureStage??null,
  historicCandidateFailureClass:result.historicCandidateFailureClass??null,
  actualDualRpcQuoteParity:result.quoteParity,
  inclusion12:result.inclusion12,
  providerBackendIndependenceQualified:false,
  prospectiveCohortEnrolled:false,scientificallyAdmissible:false}));
if(result.state==='PROVIDER_FAIL')process.exitCode=1;
