import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicClient, defineChain, http } from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2MarketStateResolver,
  buildPortableForwardOutcome,
  sha256Hex
} from '../dist/index.js';

const HORIZON_MS=300_000;
const rpcUrl=process.env.BINRAT_KILL_FAST_5M_RPC_URL;
assert.ok(rpcUrl,'BINRAT_KILL_FAST_5M_RPC_URL_REQUIRED');

const featurePath=process.env.BINRAT_KILL_FAST_FEATURES ??
  new URL('../docs/evidence/pons-s0-real-cohort-v1/features.jsonl',import.meta.url);
const features=parseJsonl(await readFile(featurePath,'utf8'))
  .filter(row=>row.baseline?.status==='COMPLETE')
  .filter(row=>row.policyComparison?.receipts?.buyEveryExecutableControl?.hypotheticalAction==='WOULD_TRADE');

const robinhood=defineChain({
  id:4663,
  name:'Robinhood Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:[rpcUrl]}}
});
const client=createPublicClient({
  chain:robinhood,
  transport:http(rpcUrl,{retryCount:2,retryDelay:750,timeout:120_000})
});
const marketResolver=new ViemPonsV2MarketStateResolver({
  authority:CURRENT_PONS_V2_AUTHORITY,
  client
});
const forwardAdapter=new ViemPonsV2ForwardOutcomeAdapter({
  ponsAuthority:CURRENT_PONS_V2_AUTHORITY,
  curveTemplateAuthority:CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  usdAuthority:CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  outcomeAuthority:CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  client
});

const packets=[];
const diagnostics=[];
for(const feature of features){
  try{
    const launch=await rehydrateLaunch(feature);
    const resolution=await marketResolver.resolve(launch,BigInt(feature.baseline.decisionBlock));
    assert.equal(resolution.decisionBlockHash.toLowerCase(),feature.baseline.decisionBlockHash.toLowerCase(),
      'KILL_FAST_5M_DECISION_HASH_MISMATCH');
    assert.ok(resolution.market,'KILL_FAST_5M_MARKET_UNAVAILABLE_AT_DECISION');
    assert.equal(resolution.market.marketId,feature.baseline.marketId,'KILL_FAST_5M_MARKET_ID_MISMATCH');

    const baseline=rehydrateBaseline(feature,resolution.market);
    const confirmedHead=await boundedConfirmedHead(forwardAdapter,launch,HORIZON_MS);
    const outcome=await buildPortableForwardOutcome(
      forwardAdapter,launch,baseline,HORIZON_MS,confirmedHead
    );
    if(!outcome){
      packets.push(unverified(feature,'KILL_FAST_5M_OUTCOME_NOT_MATURE'));
      diagnostics.push({launchId:feature.launch.launchId,status:'UNVERIFIED',reason:'OUTCOME_NOT_MATURE'});
      continue;
    }
    packets.push(projectOutcome(outcome));
    diagnostics.push({
      launchId:feature.launch.launchId,
      status:outcome.status,
      classification:outcome.classification??null,
      observedBlock:outcome.observedBlock.toString(),
      grossExecutableValueUsdMicros:outcome.executableValueUsdMicros?.toString()??null
    });
  }catch(error){
    const reason=stableError(error);
    packets.push(unverified(feature,reason));
    diagnostics.push({launchId:feature.launch.launchId,status:'UNVERIFIED',reason});
  }
}

for(const packet of packets) process.stdout.write(JSON.stringify(packet)+'\n');
process.stderr.write(JSON.stringify({
  schemaVersion:'BINRAT_KILL_FAST_5M_MATERIALIZATION_V1',
  mode:'RETROSPECTIVE_READ_ONLY_DIAGNOSTIC',
  horizonMs:HORIZON_MS,
  attempted:features.length,
  complete:packets.filter(row=>row.status==='COMPLETE').length,
  unverified:packets.filter(row=>row.status!=='COMPLETE').length,
  liveMoneyAuthority:false,
  signingAuthority:false,
  broadcastAuthority:false,
  diagnostics
},null,2)+'\n');

async function rehydrateLaunch(feature){
  const authority=CURRENT_PONS_V2_AUTHORITY;
  const sourceAuthority={
    schema:'ROBINHOOD_PONS_V2_TOKEN_LAUNCHED_V1',
    payload:{
      authorityId:authority.authorityId,
      authorityFromBlock:authority.fromBlock.toString(),
      authorityThroughBlock:authority.throughBlock?.toString()??null,
      factoryRuntimeCodeHash:authority.factoryRuntimeCodeHash.toLowerCase(),
      launchId:feature.launch.launchId,
      eventId:feature.launch.eventId,
      chainId:4663,
      factory:feature.launch.factory.toLowerCase(),
      blockNumber:String(feature.launch.blockNumber),
      blockHash:feature.launch.blockHash.toLowerCase(),
      txHash:feature.launch.txHash.toLowerCase(),
      logIndex:feature.launch.logIndex,
      token:feature.launch.token.toLowerCase(),
      curve:feature.launch.curve.toLowerCase(),
      deployer:feature.launch.creator.toLowerCase(),
      pairToken:feature.launch.pairToken.toLowerCase(),
      launchConfigId:String(feature.launch.launchConfigId),
      graduationThreshold:String(feature.launch.graduationThreshold),
      sourceEvent:'TokenLaunched',
      recordVerifiedAtBlockEnd:true,
      tokenCodePresent:true,
      curveCodePresent:true
    }
  };
  assert.equal(await sha256Hex(sourceAuthority),feature.launch.sourceAuthorityDigest,
    'KILL_FAST_5M_LAUNCH_AUTHORITY_DIGEST_MISMATCH');
  return {
    chainId:4663,
    ecosystem:'ROBINHOOD',
    launchProtocol:'PONS',
    launchId:feature.launch.launchId,
    eventId:feature.launch.eventId,
    factory:feature.launch.factory.toLowerCase(),
    txHash:feature.launch.txHash.toLowerCase(),
    blockNumber:BigInt(feature.launch.blockNumber),
    blockHash:feature.launch.blockHash.toLowerCase(),
    logIndex:feature.launch.logIndex,
    token:feature.launch.token.toLowerCase(),
    creator:feature.launch.creator.toLowerCase(),
    name:feature.launch.name,
    symbol:feature.launch.symbol,
    sourceEventName:'TokenLaunched',
    observedAtMs:feature.launch.observedAtMs,
    sourceAuthority
  };
}

function rehydrateBaseline(feature,market){
  return {
    baselineId:feature.baseline.baselineId,
    authorityDigest:feature.baseline.authorityDigest,
    launchId:feature.launch.launchId,
    policyVersion:feature.baseline.policyVersion,
    decisionBlock:BigInt(feature.baseline.decisionBlock),
    decisionBlockHash:feature.baseline.decisionBlockHash.toLowerCase(),
    observedAtMs:feature.baseline.observedAtMs,
    status:'COMPLETE',
    market,
    legs:feature.baseline.legs.map(leg=>({
      notionalUsdMicros:BigInt(leg.notionalUsdMicros),
      calibration:{
        notionalUsdMicros:BigInt(leg.notionalUsdMicros),
        baseAsset:feature.baseline.baseAsset.toLowerCase(),
        baseAmount:BigInt(leg.baseAmount),
        baseDecimals:18,
        sourceAuthority:{schema:'BINRAT_KILL_FAST_REHYDRATED_CALIBRATION_V1',payload:{
          featureEvidenceDigest:feature.evidenceDigest,
          notionalUsdMicros:String(leg.notionalUsdMicros)
        }}
      },
      entry:{
        executable:Boolean(leg.entry.executable),
        amountOut:BigInt(leg.entry.amountOut),
        amountIn:BigInt(leg.entry.amountIn)
      },
      reverse:leg.reverse?{executable:Boolean(leg.reverse.executable)}:null,
      independentReverseRecoveryBps:leg.independentReverseRecoveryBps===null
        ? null:BigInt(leg.independentReverseRecoveryBps)
    })),
    reverseSemantics:feature.baseline.reverseSemantics,
    chainId:4663,
    ecosystem:'ROBINHOOD',
    launchProtocol:'PONS',
    sourceAuthority:{schema:'BINRAT_KILL_FAST_REHYDRATED_BASELINE_V1',payload:{
      featurePacketId:feature.packetId,
      featureEvidenceDigest:feature.evidenceDigest,
      originalBaselineAuthorityDigest:feature.baseline.authorityDigest
    }}
  };
}

async function boundedConfirmedHead(adapter,launch,horizonMs){
  const launchPoint=await adapter.getBlockPoint(launch.blockNumber);
  const target=launchPoint.timestampMs+horizonMs;
  let step=512n;
  for(let attempt=0;attempt<12;attempt++){
    const block=launch.blockNumber+step;
    const point=await adapter.getBlockPoint(block);
    if(point.timestampMs>=target) return point;
    step*=2n;
  }
  throw new Error('KILL_FAST_5M_TARGET_BOUNDARY_NOT_FOUND');
}

function projectOutcome(outcome){
  return {
    schemaVersion:'PONS_S0_OUTCOME_PACKET_V1',
    launchId:outcome.launchId,
    horizonMs:outcome.horizonMs,
    status:outcome.status,
    reason:outcome.reason??null,
    entryNotionalUsdMicros:outcome.entryNotionalUsdMicros.toString(),
    exitExecutable:outcome.exitExecutable,
    grossExecutableValueUsdMicros:outcome.executableValueUsdMicros?.toString()??null,
    grossExecutableReturnBps:outcome.executableReturnBps?.toString()??null,
    classification:outcome.classification??null,
    boundaries:{postOutcomeEvidence:true,forbiddenAsFeatureInput:true,mode:'SHADOW_ONLY',liveMoneyAuthority:false,edge:'UNPROVEN'}
  };
}
function unverified(feature,reason){
  return {
    schemaVersion:'PONS_S0_OUTCOME_PACKET_V1',
    launchId:feature.launch.launchId,
    horizonMs:HORIZON_MS,
    status:'UNVERIFIED',
    reason:reason.slice(0,512),
    entryNotionalUsdMicros:'1000000',
    exitExecutable:false,
    grossExecutableValueUsdMicros:null,
    grossExecutableReturnBps:null,
    classification:null,
    boundaries:{postOutcomeEvidence:true,forbiddenAsFeatureInput:true,mode:'SHADOW_ONLY',liveMoneyAuthority:false,edge:'UNPROVEN'}
  };
}
function parseJsonl(text){
  return text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>JSON.parse(line));
}
function stableError(error){
  return (error instanceof Error?error.message:String(error)).slice(0,512);
}
