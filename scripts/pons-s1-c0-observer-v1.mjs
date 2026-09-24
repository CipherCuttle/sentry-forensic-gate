#!/usr/bin/env node
// Candidate main-only read-only C0 observer. It has no signer, transaction,
// outcome adapter, release write or model-promotion surface.
import assert from 'node:assert/strict';
import { createPublicClient, defineChain, http, keccak256 } from 'viem';
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  ROBINHOOD_CHAIN_ID,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPortableBaselineBatch,
  evaluateBuyEveryExecutableControl,
  ponsV2TokenLaunchedEvent
} from '../dist/index.js';
import { buildC0Observation, buildC0TypedUnknownObservation, canon } from './pons-s1-c0-observer-core-v1.mjs';
import { INCLUSION_RULE } from './pons-s1-publisher-core-v1.mjs';

const inputPath=process.argv[2], outputPath=process.argv[3];
assert.ok(inputPath&&outputPath,'USAGE: observer-v1 <event.json> <exclusive-output.json>');
assert.equal(process.env.GITHUB_REPOSITORY,'CipherCuttle/sentry-forensic-gate','TRUSTED_REPO_ONLY');
assert.equal(process.env.GITHUB_REF,'refs/heads/main','MAIN_ONLY_OBSERVER');
assert.equal(process.env.PONS_S1_READ_ONLY_OBSERVER,'EXPLICIT_CANONICAL_READ_ONLY',
  'OBSERVER_NOT_EXPLICITLY_ENABLED');
const protocol=JSON.parse(await readFile(
  new URL('../docs/experiments/pons-s1-single-protocol-decision-v1.json',import.meta.url),'utf8'));
assert.equal(protocol.status,'CANONICAL_FROZEN_ACTIVE','DRAFT_PROTOCOL_CANNOT_OBSERVE');
assert.equal(protocol.timing.syntheticInclusionRule,INCLUSION_RULE,'UNAPPROVED_INCLUSION_RULE');
const authority=JSON.parse(await readFile(
  new URL('../authority/pons-s1-publish-v1.json',import.meta.url),'utf8'));
assert.equal(authority.status,'CANONICAL_SEPARATELY_APPROVED','OBSERVER_AUTHORITY_NOT_APPROVED');
assert.equal(authority.collectionAuthorized,true,'COLLECTION_NOT_AUTHORIZED');
assert.equal(authority.liveMoneyAuthorized,false);
const event=JSON.parse(await readFile(resolve(inputPath),'utf8'));
assert.equal(event.nativePair,true,'OBSERVER_ACCEPTS_ONLY_NATIVE_C0_EVENTS');
const officialUrl=process.env.PONS_S1_OFFICIAL_RPC_URL;
const archiveUrl=process.env.PONS_S1_ARCHIVE_RPC_URL;
assert.equal(officialUrl,'https://rpc.mainnet.chain.robinhood.com','OFFICIAL_RPC_PIN_REQUIRED');
assert.ok(archiveUrl?.startsWith('https://'),'ARCHIVE_RPC_REQUIRED');
assert.notEqual(new URL(archiveUrl).hostname,new URL(officialUrl).hostname,
  'INDEPENDENT_ARCHIVE_HOST_REQUIRED');
const chain=defineChain({id:ROBINHOOD_CHAIN_ID,name:'Robinhood Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:[archiveUrl]}}});
const official=createPublicClient({chain,transport:http(officialUrl,{timeout:30000,retryCount:2})});
const archive=createPublicClient({chain,transport:http(archiveUrl,{timeout:30000,retryCount:2})});
assert.equal(await official.getChainId(),4663);assert.equal(await archive.getChainId(),4663);
const launchBlock=BigInt(event.blockNumber), decisionBlock=launchBlock+2n;
const [officialHead,archiveHead]=await Promise.all([official.getBlockNumber(),archive.getBlockNumber()]);
const initialHead=officialHead<archiveHead?officialHead:archiveHead;
assert.ok(initialHead>=decisionBlock+2n,'C0_NOT_YET_OBSERVABLE');
const getPoint=async(client,n)=>{
  const b=await client.getBlock({blockNumber:n});
  assert.ok(b.hash&&b.timestamp);return {number:String(n),hash:b.hash.toLowerCase(),
    timestampMs:Number(b.timestamp)*1000};
};
const [offLaunch,arcLaunch,offDecision,arcDecision]=await Promise.all([
  getPoint(official,launchBlock),getPoint(archive,launchBlock),
  getPoint(official,decisionBlock),getPoint(archive,decisionBlock)]);
for(const [a,b,label] of [[offLaunch,arcLaunch,'LAUNCH'],[offDecision,arcDecision,'DECISION']]) assert.equal(a.hash,b.hash,label+'_SOURCE_HASH_DISAGREEMENT');
assert.equal(offLaunch.hash,String(event.blockHash).toLowerCase(),'EVENT_LAUNCH_HASH_DRIFT');
assert.equal(offLaunch.timestampMs,event.launchTimestampMs,
  'EVENT_LAUNCH_TIME_NOT_FROM_CANONICAL_BLOCK');
const fetchLog=client=>client.getLogs({address:CURRENT_PONS_V2_AUTHORITY.factory,
  event:ponsV2TokenLaunchedEvent,fromBlock:launchBlock,toBlock:launchBlock,strict:true});
const [officialLogs,archiveLogs,officialCode,archiveCode]=await Promise.all([
  fetchLog(official),fetchLog(archive),
  official.getBytecode({address:CURRENT_PONS_V2_AUTHORITY.factory,blockNumber:initialHead}),
  archive.getBytecode({address:CURRENT_PONS_V2_AUTHORITY.factory,blockNumber:initialHead})]);
const key=l=>String(l.blockNumber)+':'+String(l.transactionHash).toLowerCase()+':'+l.logIndex;
const officialLog=officialLogs.find(l=>key(l)===event.eventKey);
const archiveLog=archiveLogs.find(l=>key(l)===event.eventKey);
assert.ok(officialLog&&archiveLog,'EXACT_FACTORY_EVENT_MISSING');
assert.ok(officialCode&&archiveCode,'FACTORY_RUNTIME_MISSING');
const officialRuntimeHash=keccak256(officialCode).toLowerCase();
const archiveRuntimeHash=keccak256(archiveCode).toLowerCase();
assert.equal(officialRuntimeHash,CURRENT_PONS_V2_AUTHORITY.factoryRuntimeCodeHash.toLowerCase(),
  'OFFICIAL_FACTORY_RUNTIME_DRIFT');
assert.equal(archiveRuntimeHash,officialRuntimeHash,'ARCHIVE_FACTORY_RUNTIME_DRIFT');
// Failures before independent dual-source native factory identity, runtime
// checks or the post-C0 canonical head are HARD stops, not invented UNKNOWNs.
const launchAdapter=new ViemPonsV2LaunchAdapter({authority:CURRENT_PONS_V2_AUTHORITY,client:archive});
let launch=null,baseline=null,control=null,failure=null;
const failureCode=error=>{
  const name=String(error?.name??'');
  return /timeout/i.test(name)?'RPC_TIMEOUT':
    /network|connection/i.test(name)?'RPC_UNAVAILABLE':'ADAPTER_ERROR';
};
try{
  const candidates=await launchAdapter.catchUp(launchBlock,launchBlock);
  launch=candidates.find(x=>x.txHash.toLowerCase()===String(event.transactionHash).toLowerCase()&&
    x.logIndex===event.logIndex&&x.token.toLowerCase()===String(event.token).toLowerCase());
  if(!launch)failure={stage:'LAUNCH_NORMALIZATION',code:'REQUIRED_LAUNCH_METADATA_MISSING'};
}catch(error){failure={stage:'LAUNCH_NORMALIZATION',code:failureCode(error)};}
if(!failure){
  const quote=new ViemPonsV2CurveQuoteAdapter({authority:CURRENT_PONS_V2_AUTHORITY,
    templateAuthority:CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,client:archive,now:Date.now});
  const usd=new ViemRobinhoodUsdCalibrationAdapter({
    authority:CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,client:archive});
  try{
    baseline=await buildPortableBaselineBatch(
      {launch:launchAdapter,marketQuotes:quote,usdCalibration:usd},launch,Date.now);
  }catch(error){failure={stage:'BASELINE_ACQUISITION',code:failureCode(error)};}
}
if(!failure){
  try{control=evaluateBuyEveryExecutableControl(baseline);}
  catch{failure={stage:'CONTROL_EVALUATION',code:'CONTROL_ERROR'};}
}
// The fresh two-provider completion head is mandatory for either outcome.
const [offHeadAfter,arcHeadAfter]=await Promise.all([
  official.getBlockNumber(),archive.getBlockNumber()]);
const completionHead=offHeadAfter<arcHeadAfter?offHeadAfter:arcHeadAfter;
assert.ok(completionHead>=initialHead,'C0_HEAD_REWIND_DURING_EVALUATION');
const [offObserved,arcObserved,offLaunchAgain,arcLaunchAgain,offDecisionAgain,arcDecisionAgain]=
  await Promise.all([
    getPoint(official,completionHead),getPoint(archive,completionHead),
    getPoint(official,launchBlock),getPoint(archive,launchBlock),
    getPoint(official,decisionBlock),getPoint(archive,decisionBlock)]);
for(const [p,q,label] of [[offObserved,arcObserved,'C0_COMPLETION_HEAD'],
  [offLaunchAgain,offLaunch,'LAUNCH_RECHECK'],
  [arcLaunchAgain,arcLaunch,'ARCHIVE_LAUNCH_RECHECK'],
  [offDecisionAgain,offDecision,'DECISION_RECHECK'],
  [arcDecisionAgain,arcDecision,'ARCHIVE_DECISION_RECHECK']])
  assert.deepEqual(p,q,label+'_CANONICAL_BLOCK_DRIFT');
const capturedAtMs=Date.now();
assert.ok(capturedAtMs<offLaunch.timestampMs+300_000,
  'C0_COMPLETED_TOO_LATE_FOR_FIVE_MINUTE_PROOF');
assert.ok(capturedAtMs+90_000<offLaunch.timestampMs+300_000,
  'NO_TIME_FOR_C0_SOURCE_IMMUTABLE_WITNESS');
const source={
  event,expectedFactory:CURRENT_PONS_V2_AUTHORITY.factory,
  officialLog,archiveLog,officialFactoryBlockLogs:officialLogs,
  archiveFactoryBlockLogs:archiveLogs,
  officialPoints:{launch:offLaunch,decision:offDecision,observed:offObserved},
  archivePoints:{launch:arcLaunch,decision:arcDecision,observed:arcObserved},
  decisionBlock:offDecision,observedHead:offObserved,capturedAtMs,
  officialRuntimeHash,archiveRuntimeHash
};
const observation=failure?
  buildC0TypedUnknownObservation({...source,failure}):
  buildC0Observation({...source,launch,baseline,control});
const fd=await open(resolve(outputPath),'wx',0o600);
try{await fd.writeFile(JSON.stringify(canon(observation))+'\n');await fd.sync();}finally{await fd.close();}
console.log(JSON.stringify({verdict:'PONS_S1_C0_OBSERVATION_CAPTURED_READ_ONLY',
  action:observation.receipt.action,eventKey:event.eventKey,
  sourceObservationDigest:observation.sourceObservationDigest,
  outcomeReads:false,signer:false,broadcast:false,liveMoneyAuthority:false}));
