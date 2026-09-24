#!/usr/bin/env node
// One PR-only public-chain timing rehearsal. No factory log scan, no tokens,
// no quote reads, no prospective enrollment, no wallets or transactions.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {evaluateC0ChainTiming} from './pons-s1-c0-timing-core-v1.mjs';
const RPC='https://rpc.mainnet.chain.robinhood.com';
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request','PR_ONLY_NONSCIENTIFIC_REHEARSAL');
assert.equal(process.env.GITHUB_REPOSITORY,'CipherCuttle/sentry-forensic-gate');
assert.equal(process.env.PONS_S1_TIMING_REHEARSAL,'ONE_READ_ONLY_BLOCK_PROBE',
  'EXPLICIT_ONE_SHOT_DIAGNOSTIC_FLAG_REQUIRED');
const target=process.argv[2];
assert.ok(target,'USAGE: node timing-rehearsal <exclusive-output.json>');
let nextId=1,requests=0;
async function rpc(method,params=[]){
  requests++;
  assert.ok(requests<=180,'RPC_REHEARSAL_REQUEST_CAP');
  const response=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:nextId++,method,params}),
    signal:AbortSignal.timeout(12_000)});
  assert.ok(response.ok,'OFFICIAL_RPC_HTTP_'+response.status);
  const json=await response.json();
  assert.ok(!json.error,'OFFICIAL_RPC_ERROR_'+JSON.stringify(json.error));
  return json.result;
}
const height=async()=>BigInt(await rpc('eth_blockNumber'));
async function point(h,seen=Date.now()){
  const raw=await rpc('eth_getBlockByNumber',['0x'+h.toString(16),false]);
  assert.ok(raw&&raw.hash&&raw.number&&raw.timestamp,'CHAIN_POINT_MISSING');
  assert.equal(BigInt(raw.number),h,'CHAIN_POINT_HEIGHT_CHANGED');
  return {blockNumber:h.toString(),blockHash:raw.hash.toLowerCase(),
    timestampMs:Number(BigInt(raw.timestamp))*1000,
    firstObservedAtMs:seen};
}
const chainId=Number(BigInt(await rpc('eth_chainId')));
assert.equal(chainId,4663,'WRONG_PUBLIC_CHAIN');
const startHead=await height(),startSeen=Date.now();
const launch=await point(startHead,startSeen);
const start=Date.now(),MAX_MS=180_000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(required,label){
  for(;;){
    if(Date.now()-start>MAX_MS)throw new Error(label+'_TIMING_REHEARSAL_TIMEOUT_NO_CLAIM');
    const current=await height();
    if(current>=required)return {height:current,wall:Date.now()};
    await sleep(2000);
  }
}
const maturity=await until(startHead+4n,'BASELINE_MATURITY');
const decision=await point(startHead+2n,maturity.wall);
const mature=await point(startHead+4n,maturity.wall);
// Only a one-shot chain-cadence proxy: actual USD quotes and C0 evaluation
// are deliberately NOT performed. A separate real C0 latency gate remains.
const afterProxy=await height(),completionWall=Date.now();
assert.ok(afterProxy>=startHead+4n);
const completed=await point(afterProxy,completionWall);
const inclusionHeight=afterProxy+2n;
const inclusionArrived=await until(inclusionHeight,'INCLUSION_CANDIDATE');
const inclusion=await point(inclusionHeight,inclusionArrived.wall);
const confirmedHeight=inclusionHeight+12n;
const confirmationArrived=await until(confirmedHeight,'TWELVE_CONFIRMATIONS');
const confirmed=await point(confirmedHeight,confirmationArrived.wall);
const [launchAgain,decisionAgain,completedAgain,inclusionAgain]=await Promise.all([
  point(startHead),point(startHead+2n),point(afterProxy),point(inclusionHeight)]);
for(const [before,after] of [[launch,launchAgain],[decision,decisionAgain],
  [completed,completedAgain],[inclusion,inclusionAgain]]){
  assert.equal(before.blockHash,after.blockHash,'PUBLIC_CHAIN_BLOCK_REORG_DURING_REHEARSAL');
  assert.equal(before.timestampMs,after.timestampMs,'BLOCK_TIME_DRIFT');
}
const evaluation=evaluateC0ChainTiming({chainId,launch,decision,mature,completed,
  inclusion,confirmed});
const result={...evaluation,provenance:'REAL_OFFICIAL_PUBLIC_RPC_SINGLE_PROVIDER_PR_ONLY',
  rpcHost:'rpc.mainnet.chain.robinhood.com',
  observedAtUtc:new Date().toISOString(),
  firstObservedBlock:launch,decisionBlock:decision,baselineMatureBlock:mature,
  dummyCompletionHead:completed,inclusionBlock:inclusion,confirmedBlock:confirmed,
  requests,reads:['eth_chainId','eth_blockNumber','eth_getBlockByNumber'],
  actualFactoryEventsRead:false,actualC0DecisionMade:false,
  anyFutureOutcomeRead:false,anyNetworkWrites:false,
  genuineProspectiveSample:false};
const file=await open(resolve(target),'wx',0o600);
try{await file.writeFile(JSON.stringify(result)+'\n');await file.sync();}
finally{await file.close();}
console.log(JSON.stringify({verdict:result.diagnosticVerdict,chainId,requests,
  confirmationElapsedMs:evaluation.observedConfirmationElapsedMs,
  confirmedSlackMs:evaluation.confirmedSlackMs,
  actualC0Measured:false,releasePublicationMeasured:false,
  economicEdge:'UNPROVEN',liveMoneyAuthority:false}));
