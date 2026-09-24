#!/usr/bin/env node
// One PR-only public-chain timing rehearsal. No factory log scan, no tokens,
// no quote reads, no prospective enrollment, no wallets or transactions.
import assert from 'node:assert/strict';
import {createPublicClient,defineChain,http} from 'viem';
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
// Reuse the reviewed read-only viem public-client boundary. Direct
// fetch/RPC escape hatches are forbidden by the repository AST gate.
const robinhood=defineChain({id:4663,name:'Robinhood Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:[RPC]}}});
const client=createPublicClient({chain:robinhood,
  transport:http(RPC,{timeout:12000,retryCount:0})});
let requests=0;
function meter(){requests++;assert.ok(requests<=180,'RPC_REHEARSAL_REQUEST_CAP');}
const height=async()=>{meter();return client.getBlockNumber();};
async function point(h,seen=Date.now()){
  meter();
  const raw=await client.getBlock({blockNumber:h});
  assert.ok(raw&&raw.hash&&raw.number!==null&&raw.timestamp!==null,
    'CHAIN_POINT_MISSING');
  assert.equal(raw.number,h,'CHAIN_POINT_HEIGHT_CHANGED');
  return {blockNumber:h.toString(),blockHash:raw.hash.toLowerCase(),
    timestampMs:Number(raw.timestamp)*1000,firstObservedAtMs:seen};
}
meter();const chainId=await client.getChainId();
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
  requests,reads:['viem.getChainId','viem.getBlockNumber','viem.getBlock'],
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
