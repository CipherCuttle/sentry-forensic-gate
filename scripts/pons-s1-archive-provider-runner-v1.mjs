#!/usr/bin/env node
// Manually dispatched, reviewed-main, protected-environment, ONE bounded
// read-only archive capability sample. NEVER a live trade or S1 enrollment.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPublicClient,defineChain,http,keccak256} from 'viem';
import {CURRENT_PONS_V2_AUTHORITY as FACTORY,
  ponsV2FactoryReadAbi,ponsV2TokenLaunchedEvent} from '../dist/index.js';
import {OFFICIAL,PROVIDER,assertArchiveEndpoint,historicBlockHeights,
  recentRange,classifyArchiveFailure,createArchiveReceipt,
  validateArchiveReceipt} from './pons-s1-archive-provider-core-v1.mjs';
import {selectLatestNative} from './pons-s1-dual-rpc-rehearsal-core-v1.mjs';

assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch','MANUAL_ONLY');
assert.equal(process.env.GITHUB_REPOSITORY,
  'CipherCuttle/sentry-forensic-gate','REPOSITORY_PIN');
assert.equal(process.env.GITHUB_REF,'refs/heads/main','REVIEWED_MAIN_ONLY');
assert.equal(process.env.PONS_S1_ARCHIVE_READONLY_PROBE,
  'ONE_BOUNDED_CAPABILITY_SAMPLE','EXPLICIT_PROBE_FLAG_REQUIRED');
assert.ok(process.argv[2],'OUTPUT_PATH_REQUIRED');
const receipt=createArchiveReceipt({fromBlock:FACTORY.fromBlock,
  runId:process.env.GITHUB_RUN_ID??null});
let phase='CONFIG';
const started=Date.now();
const checkTime=()=>{
  if(Date.now()-started>=120_000)throw new Error('TIME_BUDGET_EXHAUSTED');
};
const stage=async(label,fn)=>{
  phase=label;checkTime();const x=await fn();checkTime();return x;
};
const chain=defineChain({id:4663,name:'Robinhood Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:[OFFICIAL]}}});
const client=url=>createPublicClient({chain,
  transport:http(url,{timeout:12000,retryCount:0})});
const point=async(c,h)=>{
  const b=await c.getBlock({blockNumber:h});
  assert.equal(b.number,h,'BLOCK_NUMBER_MISMATCH');
  assert.ok(b.hash&&b.timestamp,'BLOCK_POINT_MISSING');
  return {height:String(h),hash:b.hash.toLowerCase(),
    timestampMs:Number(b.timestamp)*1000};
};
try{
  assertArchiveEndpoint(process.env.PONS_S1_ARCHIVE_RPC_URL);
  // This value is never printed, persisted, serialized or passed to a shell.
  const archive=client(process.env.PONS_S1_ARCHIVE_RPC_URL);
  const official=client(OFFICIAL);
  const ids=await stage('CHAIN_ID',()=>Promise.all([
    official.getChainId(),archive.getChainId()]));
  assert.deepEqual(ids,[4663,4663],'WRONG_CHAIN');
  const heads=await stage('RECENT_HEADS',()=>Promise.all([
    official.getBlockNumber(),archive.getBlockNumber()]));
  const range=recentRange(heads[0],heads[1],FACTORY.fromBlock);
  const [b1,b2,c1,c2]=await stage('RECENT_FACTORY_PROVENANCE',
    ()=>Promise.all([
      point(official,range.through),point(archive,range.through),
      official.getBytecode({address:FACTORY.factory,blockNumber:range.through}),
      archive.getBytecode({address:FACTORY.factory,blockNumber:range.through})
    ]));
  assert.deepEqual(b1,b2,'RECENT_BLOCK_SOURCE_DISAGREEMENT');
  assert.ok(c1&&c1!=='0x'&&c2&&c2!=='0x','RECENT_CODE_MISSING');
  assert.equal(keccak256(c1).toLowerCase(),
    FACTORY.factoryRuntimeCodeHash.toLowerCase(),
    'OFFICIAL_FACTORY_HASH_DRIFT');
  assert.equal(keccak256(c2).toLowerCase(),
    FACTORY.factoryRuntimeCodeHash.toLowerCase(),
    'ARCHIVE_FACTORY_HASH_DRIFT');

  const heights=historicBlockHeights(FACTORY.fromBlock);
  for(let i=0;i<heights.length;i++){
    const name=i===0?'A':'B',h=heights[i];
    const historicalBlock=await stage('HISTORIC_ARCHIVE_BLOCK_'+name,
      ()=>point(archive,h));
    const code=await stage('HISTORIC_ARCHIVE_CODE_'+name,
      ()=>archive.getBytecode({address:FACTORY.factory,blockNumber:h}));
    assert.ok(code&&code!=='0x','HISTORIC_CODE_MISSING');
    assert.equal(keccak256(code).toLowerCase(),
      FACTORY.factoryRuntimeCodeHash.toLowerCase(),
      'HISTORIC_ARCHIVE_FACTORY_HASH_DRIFT');
    const hook=await stage('HISTORIC_ARCHIVE_CALL_'+name,
      ()=>archive.readContract({address:FACTORY.factory,
        abi:ponsV2FactoryReadAbi,functionName:'memeHook',blockNumber:h}));
    assert.match(String(hook),/^0x[0-9a-fA-F]{40}$/,
      'HISTORIC_MEME_HOOK_MALFORMED');
    receipt.testedHistoricalSamples++;
    // Official historical HEADER is an optional corroboration, not evidence
    // that the public endpoint serves archived bytecode or contract storage.
    // If unavailable, preserve the epistemic gap rather than fail open.
    let reference=null;
    try{
      reference=await stage('HISTORIC_REFERENCE_BLOCK_'+name,
        ()=>point(official,h));
    }catch{
      reference=null;
    }
    if(reference){
      assert.deepEqual(reference,historicalBlock,
        'HISTORIC_HEADER_SOURCE_DISAGREEMENT');
      receipt.officialHistoricHeadersCompared++;
    }
  }
  receipt.historicStateSamplesPassed=true;

  const filter={address:FACTORY.factory,event:ponsV2TokenLaunchedEvent,
    fromBlock:range.from,toBlock:range.through,strict:true};
  const [logsA,logsB]=await stage('RECENT_FACTORY_LOGS',
    ()=>Promise.all([official.getLogs(filter),archive.getLogs(filter)]));
  const full=selectLatestNative(logsA,logsB,FACTORY.factory);
  receipt.recentFactoryEvents=full.allCount;
  receipt.recentNativeEvents=full.nativeCount;
  receipt.factoryTranscriptDigest=full.digest;
  receipt.recentSourcesAgree=true;
  receipt.sampledArchiveReadCapacity=true;
  receipt.state=receipt.officialHistoricHeadersCompared===2?
    'ARCHIVE_SAMPLE_HEADERS_MATCHED_ONLY':
    'ARCHIVE_SAMPLE_ONLY_REFERENCE_UNAVAILABLE';
}catch(error){
  receipt.state='ARCHIVE_UNVERIFIED';
  receipt.failureStage=phase;
  receipt.failureClass=classifyArchiveFailure(error);
  // Raw errors and the key-bearing archive URL are deliberately discarded.
}
receipt.finishedAtUtc=new Date().toISOString();
validateArchiveReceipt(receipt);
const fd=await open(resolve(process.argv[2]),'wx',0o600);
try{await fd.writeFile(JSON.stringify(receipt)+'\n');await fd.sync();}
finally{await fd.close();}
console.log(JSON.stringify({verdict:receipt.state,provider:PROVIDER,
  testedHistoricalSamples:receipt.testedHistoricalSamples,
  corroboratedHistoricalHeaders:receipt.officialHistoricHeadersCompared,
  recentFactoryEvents:receipt.recentFactoryEvents,
  recentSourcesAgree:receipt.recentSourcesAgree,
  failureStage:receipt.failureStage,failureClass:receipt.failureClass,
  archiveSlaQualified:false,backendIndependenceQualified:false,
  prospectiveStudy:false,walletUsed:false,moneyAuthorized:false}));
if(receipt.state==='ARCHIVE_UNVERIFIED')process.exitCode=1;
