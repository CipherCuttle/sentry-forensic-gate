#!/usr/bin/env node
// Operational paper ONLY. No signer, wallet, private key, transaction builder,
// sendTransaction, live order API, scientific publisher or profit claim.
import assert from 'node:assert/strict';
import {createPublicClient,defineChain,http} from 'viem';
import {appendFile,mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {
  CURRENT_PONS_V2_AUTHORITY as FACTORY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY as TEMPLATE,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY as USD,
  DEFAULT_ROBINHOOD_RPC_URL as OFFICIAL,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ponsV2TokenLaunchedEvent,
  ViemPonsV2LaunchAdapter,ViemPonsV2CurveQuoteAdapter,
  ViemRobinhoodUsdCalibrationAdapter,buildPortableBaselineBatch,
  evaluatePortableFastVet
} from '../dist/index.js';
import {newPaperState,validatePaperState,eventKey,scanWindow,isFresh,
  paperEntryDecision,dueHorizons,exitGrossQuote,unknownExit,finiteFailure,
  MAX_BLOCK_EVENTS,HORIZONS} from './pons-fast-paper-core-v1.mjs';

const argSet=new Set(process.argv.slice(2));
assert.ok([...argSet].every(x=>x==='--once'||x==='--loop'),
  'USAGE: pons-fast-paper-v1.mjs [--once|--loop] (no live mode)');
assert.ok(!(argSet.has('--once')&&argSet.has('--loop')),
  'ONE_RUN_MODE_REQUIRED');
const looping=argSet.has('--loop');
const dataDir=resolve(process.env.PONS_PAPER_DATA_DIR??'.runtime/pons-paper');
const interval=Number(process.env.PONS_PAPER_POLL_MS??'15000');
const pacing=Number(process.env.PONS_PAPER_RPC_MIN_INTERVAL_MS??'150');
assert.ok(Number.isSafeInteger(interval)&&interval>=10000&&interval<=120000,
  'POLL_INTERVAL_OUT_OF_RANGE');
assert.ok(Number.isSafeInteger(pacing)&&pacing>=75&&pacing<=2000,
  'RPC_PACING_OUT_OF_RANGE');
const url=process.env.PONS_PAPER_RPC_URL??OFFICIAL;
let parsed;
try{parsed=new URL(url);}catch{throw new Error('INVALID_RPC_URL');}
assert.equal(parsed.protocol,'https:','HTTPS_RPC_REQUIRED');
assert.equal(parsed.username,'','RPC_USERINFO_FORBIDDEN');
assert.equal(parsed.password,'','RPC_PASSWORD_FORBIDDEN');
const chain=defineChain({id:4663,name:'Robinhood Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:[OFFICIAL]}}});
const raw=createPublicClient({chain,transport:http(url,{retryCount:0,timeout:12000})});
let tail=Promise.resolve(),lastRpc=0;
const rpc=new Proxy(raw,{get(target,prop){
  const method=Reflect.get(target,prop,target);
  if(typeof method!=='function')return method;
  if(!['getChainId','getBlockNumber','getBlock','getBytecode','getLogs',
    'getStorageAt','readContract','call'].includes(String(prop)))
    return method.bind(target);
  return (...args)=>{
    const work=tail.then(async()=>{
      const wait=Math.max(0,lastRpc+pacing-Date.now());
      if(wait)await sleep(wait);
      lastRpc=Date.now();
      return method.apply(target,args);
    });
    tail=work.catch(()=>{});
    return work;
  };
}});
const adapter=new ViemPonsV2LaunchAdapter({authority:FACTORY,client:rpc});
const quotes=new ViemPonsV2CurveQuoteAdapter({authority:FACTORY,
  templateAuthority:TEMPLATE,client:rpc});
const usd=new ViemRobinhoodUsdCalibrationAdapter({authority:USD,client:rpc});
const statePath=join(dataDir,'state.json');
const journalPath=join(dataDir,'events.jsonl');
const lockPath=join(dataDir,'runner.lock');
let state,lock=null,active=true;
const emit=async(kind,data)=>{
  const event={kind,atMs:Date.now(),...data};
  await appendFile(journalPath,JSON.stringify(event)+'\n',{mode:0o600});
  console.log(JSON.stringify(event));
};
const save=async()=>{
  state.updatedAtMs=Date.now();
  validatePaperState(state);
  const tmp=join(dataDir,'state.json.'+process.pid+'.tmp');
  const fd=await open(tmp,'wx',0o600);
  try{await fd.writeFile(JSON.stringify(state)+'\n');await fd.sync();}
  finally{await fd.close();}
  await rename(tmp,statePath);
};
const jsonSafe=(x)=>JSON.parse(JSON.stringify(x,(_k,v)=>
  typeof v==='bigint'?v.toString():v));
const revived=(x)=>({...x,blockNumber:BigInt(x.blockNumber)});
const point=async(height)=>{
  const b=await rpc.getBlock({blockNumber:height});
  assert.ok(b?.hash&&b.timestamp,'BLOCK_UNVERIFIED');
  return {blockNumber:height,hash:b.hash.toLowerCase(),
    timestampMs:Number(b.timestamp)*1000};
};
const fromError=(error)=>finiteFailure(error);
// A paper record is a frozen historical quote, NEVER an executed fill.
const evaluateNative=async(log,block)=>{
  const key=eventKey(log);
  if(state.launches[key])return;
  const now=Date.now();
  const payload=log.args;
  const token=String(payload.token).toLowerCase();
  const base={eventKey:key,token,launchBlock:String(block.blockNumber),
    launchTimestampMs:block.timestampMs,recordedAtMs:now,
    action:'SKIP',reason:'UNVERIFIED',entry:null,exits:null};
  if(!isFresh(block.timestampMs,now)){
    state.launches[key]={...base,reason:'STALE_LAUNCH'};
    await save();await emit('DECISION',{eventKey:key,action:'SKIP',reason:'STALE_LAUNCH'});
    return;
  }
  try{
    // catchUp independently binds real factory event, contract record,
    // token/curve code and metadata at the exact observed launch block.
    const launches=await adapter.catchUp(block.blockNumber,block.blockNumber);
    const launch=launches.find(l=>l.txHash.toLowerCase()===
      log.transactionHash.toLowerCase()&&l.logIndex===log.logIndex);
    assert.ok(launch,'LAUNCH_EVENT_NOT_MATERIALIZED');
    assert.equal(launch.blockHash.toLowerCase(),block.hash,'LAUNCH_REORG');
    const baseline=await buildPortableBaselineBatch(
      {launch:adapter,marketQuotes:quotes,usdCalibration:usd},launch);
    const when=Date.now();
    const decision=paperEntryDecision(baseline,block.timestampMs,when);
    // This is a permissive control, NOT FAST_VET approval: absent historical
    // creator outcomes remain UNKNOWN and would not authorize any real trade.
    const fastVet=evaluatePortableFastVet({baseline,creatorFeature:null});
    if(decision.action!=='PAPER_OPEN'){
      state.launches[key]={...base,reason:decision.reason,
        fastVetDecision:fastVet.decision};
      await save();await emit('DECISION',{eventKey:key,action:'SKIP',
        reason:decision.reason,fastVet:fastVet.decision});
      return;
    }
    state.launches[key]={...base,action:'PAPER_OPEN',
      reason:decision.reason,entry:decision.entry,exits:{fiveMinute:null,day:null},
      launchSnapshot:jsonSafe(launch),baselineStatus:baseline.status,
      fastVetDecision:fastVet.decision,
      actualFill:false,netProfitEstablished:false};
    await save();await emit('PAPER_ENTRY',{eventKey:key,token,action:'PAPER_OPEN',
      entry:decision.entry,fastVet:fastVet.decision,
      creatorHistory:'NOT_EVALUATED',actualFill:false});
  }catch(err){
    const reason=fromError(err);
    // Do not erase the opportunity or pretend an entry occurred. A failed
    // quote at C0 has an UNKNOWN result even if a future retry succeeds.
    state.launches[key]={...base,reason:reason==='UNKNOWN'?
      'BASELINE_UNVERIFIED':reason};
    await save();await emit('DECISION',{eventKey:key,action:'SKIP',
      reason:state.launches[key].reason});
  }
};
async function scan(){
  const head=await rpc.getBlockNumber();
  const w=scanWindow(head,state.lastScannedBlock,FACTORY.fromBlock);
  if(!w||w.from===null){if(w?.missed){state.observability.backlogGapCount++;
    await emit('SCAN_GAP',w.missed);await save();}return;}
  if(w.missed){state.observability.backlogGapCount++;
    state.lastScannedBlock=String(w.from-1n);await save();
    await emit('SCAN_GAP',w.missed);}
  const logs=await rpc.getLogs({address:FACTORY.factory,
    event:ponsV2TokenLaunchedEvent,fromBlock:w.from,toBlock:w.through,
    strict:true});
  for(let n=w.from;n<=w.through;n++){
    const atBlock=logs.filter(x=>x.blockNumber===n);
    if(atBlock.length>MAX_BLOCK_EVENTS){
      state.observability.skippedBlockCount++;
      state.lastScannedBlock=String(n);await save();
      await emit('OVERSIZED_BLOCK_SKIPPED',{block:String(n),
        count:atBlock.length});continue;
    }
    if(atBlock.length){
      let b;
      try{b=await point(n);}catch(error){
        await scanFailure(n,error);return;
      }
      for(const log of atBlock){
        if(log.blockHash?.toLowerCase()!==b.hash){
          await scanFailure(n,new Error('REORG_BLOCK_HASH_MISMATCH'));return;
        }
        const key=eventKey(log);
        if(state.launches[key])continue;
        if(String(log.args?.pairToken??'').toLowerCase()!==
          PONS_V2_NATIVE_PAIR_TOKEN.toLowerCase()){
          state.launches[key]={eventKey:key,token:String(log.args.token).toLowerCase(),
            launchBlock:String(n),launchTimestampMs:b.timestampMs,
            action:'SKIP',reason:'NON_NATIVE_PAIR',entry:null,exits:null};
          await save();continue;
        }
        await evaluateNative(log,b);
      }
    }
    state.lastScannedBlock=String(n);
    await save();
  }
  await emit('SCAN',{from:String(w.from),through:String(w.through),
    factoryEvents:logs.length,nativeEvents:logs.filter(l=>
      String(l.args?.pairToken).toLowerCase()===
      PONS_V2_NATIVE_PAIR_TOKEN.toLowerCase()).length});
}
async function scanFailure(n,error){
  const key=String(n),count=(state.unverifiedBlocks[key]??0)+1;
  state.unverifiedBlocks[key]=count;
  state.observability.providerFailureCount++;
  const reason=fromError(error);
  if(count>=3){
    state.lastScannedBlock=key;
    state.observability.skippedBlockCount++;
    await emit('UNVERIFIED_BLOCK_SKIPPED',{block:key,reason,attempts:count});
  }else await emit('SCAN_RETRY_PENDING',{block:key,reason,attempts:count});
  await save();
}
async function monitorExits(){
  const openRows=Object.values(state.launches).filter(x=>x.action==='PAPER_OPEN'&&
    Object.values(x.exits).some(v=>v===null));
  if(!openRows.length)return;
  const head=await rpc.getBlockNumber();
  if(head<FACTORY.fromBlock+3n)return;
  const at=await point(head-2n);
  for(const row of openRows){
    const due=dueHorizons(row,at.timestampMs);
    for(const horizon of due){
      const delta=HORIZONS[horizon];
      const lateness=at.timestampMs-(row.launchTimestampMs+delta);
      // A late quote cannot be relabeled as a five-minute / 24h quote.
      const tolerance=horizon==='fiveMinute'?120_000:3_600_000;
      if(lateness>tolerance){
        row.exits[horizon]=unknownExit(horizon,'MISSED_WINDOW',
          at.blockNumber,Date.now());
        await save();await emit('PAPER_EXIT_UNKNOWN',{eventKey:row.eventKey,
          horizon,reason:'MISSED_WINDOW'});continue;
      }
      try{
        const launch=revived(row.launchSnapshot);
        const market=await quotes.resolveMarket(launch,at.blockNumber);
        const rawQuote=await quotes.quoteIndependentReverse({
          launch,market,decisionBlock:at.blockNumber,
          decisionBlockHash:at.hash,notionalUsdMicros:1_000_000n,
          amountIn:BigInt(row.entry.tokenOut)
        });
        if(!rawQuote.executable||rawQuote.amountOut<=0n)
          throw new Error('QUOTE_UNVERIFIED');
        const calibration=await usd.calibrateUsd({
          launch,market,decisionBlock:at.blockNumber,
          decisionBlockHash:at.hash,notionalUsdMicros:1_000_000n
        });
        const final=await point(at.blockNumber);
        assert.equal(final.hash,at.hash,'EXIT_REORG_BLOCK_HASH_MISMATCH');
        row.exits[horizon]=exitGrossQuote(row,horizon,market,rawQuote,
          calibration,at.blockNumber,at.hash,Date.now());
        await save();await emit('PAPER_EXIT_GROSS_QUOTE',{
          eventKey:row.eventKey,horizon,receipt:row.exits[horizon]});
      }catch(error){
        const reason=fromError(error);
        row.exits[horizon]=unknownExit(horizon,reason,
          at.blockNumber,Date.now());
        await save();await emit('PAPER_EXIT_UNKNOWN',{eventKey:row.eventKey,
          horizon,reason});
      }
    }
  }
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
process.once('SIGTERM',()=>{active=false;});
process.once('SIGINT',()=>{active=false;});
try{
  await mkdir(dataDir,{recursive:true,mode:0o700});
  lock=await open(lockPath,'wx',0o600);
  await lock.writeFile(String(process.pid)+'\n');
  try{
    state=validatePaperState(JSON.parse(await readFile(statePath,'utf8')));
  }catch(error){
    if(error?.code!=='ENOENT')throw error; // corrupt state: fail CLOSED
    state=newPaperState();await save();
  }
  assert.equal(await rpc.getChainId(),4663,'WRONG_CHAIN');
  await emit('BOOT',{mode:'PAPER_ONLY',looping,
    restoredEvents:Object.keys(state.launches).length,
    lastScannedBlock:state.lastScannedBlock,
    rpcMode:url===OFFICIAL?'OFFICIAL_PUBLIC':'OPERATOR_READ_ONLY',
    wallet:false,transactions:false});
  do{
    try{await scan();}
    catch(error){
      state.observability.providerFailureCount++;await save();
      await emit('SCAN_UNVERIFIED',{reason:fromError(error)});
    }
    try{await monitorExits();}
    catch(error){
      state.observability.providerFailureCount++;await save();
      await emit('EXIT_MONITOR_UNVERIFIED',{reason:fromError(error)});
    }
    if(looping&&active)await sleep(interval);
  }while(looping&&active);
}finally{
  if(lock){await lock.close();await unlink(lockPath);}
}
