import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createPublicClient, defineChain, http, keccak256 } from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  PONS_V2_NATIVE_PAIR_TOKEN,
  ROBINHOOD_CHAIN_ID,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildPortableBaselineBatch,
  buildPortableForwardOutcome,
  evaluateBuyEveryExecutableControl,
  evaluateFastVetR1CapacityGate,
  findPortableFirstBlockAtOrAfterTimestamp,
  ponsV2TokenLaunchedEvent
} from '../dist/index.js';
import {
  MAX_SCAN_BLOCKS, assertActivated, assertExternalSeal, assertOrigin,
  assertProviderParity, canonical, checkBatch, digest, freezeNextBatch, sha256Bytes
} from './pons-s1-collector-core.mjs';

const ROOT = new URL('../', import.meta.url);
const SPEC = new URL('../docs/experiments/pons-s1-five-minute-feasibility-v0.json', import.meta.url);
const ACTIVATION = new URL('../authority/pons-s1-activation-v0.json', import.meta.url);
const EXPECTED_SOURCE = '493c85b8d84565cedf6e936063549edfa02edf3a';
const mode = process.argv[2];
if (!['enroll', 'measure'].includes(mode)) {
  throw new Error('PONS_S1_USAGE: node scripts/pons-s1-prospective-collector.mjs enroll|measure');
}

async function mustReadJson(location, label) {
  try {
    const value = JSON.parse(await readFile(location, 'utf8'));
    assert.ok(value && typeof value === 'object' && !Array.isArray(value));
    return value;
  } catch (error) {
    throw new Error('PONS_S1_' + label + '_UNAVAILABLE_OR_INVALID:' +
      (error instanceof Error ? error.message : String(error)));
  }
}
const hexSha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const spec = await mustReadJson(SPEC, 'PREREG');
const activation = await mustReadJson(ACTIVATION, 'CANONICAL_ACTIVATION_RECEIPT');
const checkoutSha = (await readFile(new URL('../.git/HEAD', import.meta.url), 'utf8')).trim();
assert.match(checkoutSha, /^[0-9a-f]{40}$/i, 'PONS_S1_CANONICAL_CHECKOUT_MUST_BE_DETACHED');
const scriptSha = hexSha256(await readFile(new URL(import.meta.url)));
assert.equal(activation.reviewedSourceCommit, EXPECTED_SOURCE);
assert.equal(String(activation.factory).toLowerCase(),
  CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(), 'PONS_S1_FACTORY_PIN_MISMATCH');
assert.equal(spec.prospective.launchAuthority,
  CURRENT_PONS_V2_AUTHORITY.authorityId, 'PONS_S1_AUTHORITY_ID_MISMATCH');
const ctx = assertActivated(spec, activation,
  { collectorImplementationSha: scriptSha, checkoutSha });
assert.ok(BigInt(activation.originFromBlock) > 69066751n,
  'PONS_S1_PROSPECTIVE_ORIGIN_NOT_NEW');
assert.equal(process.env.PONS_S1_COLLECTION_MODE, 'READ_ONLY_EXPLICIT_CANONICAL_ACTIVATION',
  'PONS_S1_COLLECTION_MODE_DISABLED');
assert.ok(process.env.PONS_S1_RPC_URL?.startsWith('https://'),
  'PONS_S1_EXPLICIT_READ_ONLY_RPC_REQUIRED');
assert.equal(process.env.PONS_S1_DISCOVERY_RPC_URL,
  'https://rpc.mainnet.chain.robinhood.com',
  'PONS_S1_OFFICIAL_DISCOVERY_RPC_REQUIRED');
assert.notEqual(new URL(process.env.PONS_S1_RPC_URL).hostname,
  new URL(process.env.PONS_S1_DISCOVERY_RPC_URL).hostname,
  'PONS_S1_INDEPENDENT_ARCHIVE_SOURCE_REQUIRED');
assert.ok(process.env.PONS_S1_OUTPUT_FILE, 'PONS_S1_OUTPUT_FILE_REQUIRED');

const chain = defineChain({
  id: ROBINHOOD_CHAIN_ID, name: 'Robinhood Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:[process.env.PONS_S1_RPC_URL]}}
});
const discovery = createPublicClient({
  chain,transport:http(process.env.PONS_S1_DISCOVERY_RPC_URL,
    {retryCount:2,retryDelay:1000,timeout:30000})
});
const client = createPublicClient({
  chain, transport:http(process.env.PONS_S1_RPC_URL,
    {retryCount:2,retryDelay:1000,timeout:30000})
});
assert.equal(await client.getChainId(),4663,'PONS_S1_RPC_CHAIN_ID_MISMATCH');
assert.equal(await discovery.getChainId(),4663,
  'PONS_S1_DISCOVERY_CHAIN_ID_MISMATCH');
const rpcHead = await client.getBlockNumber();
assert.ok(rpcHead >= 12n,'PONS_S1_RPC_HEAD_BEFORE_CONFIRMATIONS');
const confirmedBlock = rpcHead - 12n;
const getPoint = async blockNumber => {
  const raw = await client.getBlock({blockNumber});
  assert.ok(raw.hash && raw.timestamp);
  return {number:String(raw.number),timestampMs:Number(raw.timestamp)*1000,
    hash:raw.hash.toLowerCase()};
};
const headPoint = await getPoint(confirmedBlock);
const launch = new ViemPonsV2LaunchAdapter({
  authority:CURRENT_PONS_V2_AUTHORITY,client,now:Date.now
});
const forward = new ViemPonsV2ForwardOutcomeAdapter({
  ponsAuthority:CURRENT_PONS_V2_AUTHORITY,
  curveTemplateAuthority:CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  usdAuthority:CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  outcomeAuthority:CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,client
});

async function resolveOrigin(prior) {
  const originBlockNumber = prior ? BigInt(prior.batch.originBlock) :
    (await findPortableFirstBlockAtOrAfterTimestamp(
      forward,BigInt(activation.originFromBlock),confirmedBlock,
      activation.originEarliestTimestampMs))?.blockNumber;
  assert.ok(originBlockNumber !== undefined,
    'PONS_S1_ORIGIN_NOT_YET_CONFIRMED');
  const [block,predecessor] = await Promise.all([
    getPoint(originBlockNumber),getPoint(originBlockNumber-1n)
  ]);
  const origin={block,predecessor};
  assertOrigin(activation,block,predecessor,confirmedBlock);
  return origin;
}
async function persistExclusive(path, payload) {
  const destination=resolve(path);
  assert.ok(destination.endsWith('.json'),'PONS_S1_JSON_OUTPUT_REQUIRED');
  await mkdir(dirname(destination),{recursive:true});
  const data=JSON.stringify(canonical(payload))+'\n';
  const handle=await open(destination,'wx',0o600);
  try { await handle.writeFile(data); await handle.sync(); }
  finally { await handle.close(); }
  // No in-place rewrite, no implicit retry and no outcome evaluation before
  // the separately persisted immutable pre-outcome selection witness.
  console.log(JSON.stringify({mode,output:destination,sha256:sha256Bytes(Buffer.from(data)),
    selectionOnly:mode==='enroll',scientificAuthority:'NONE',liveMoneyAuthority:false}));
}

if (mode==='enroll') {
  const previousPath=process.env.PONS_S1_PREVIOUS_SEALED_BATCH;
  const previous=previousPath ? await mustReadJson(previousPath,'PREVIOUS_SEALED_BATCH') : null;
  if (previous) assertExternalSeal(previous.batch,previous.seal);
  const origin=await resolveOrigin(previous);
  const from=previous?BigInt(previous.batch.nextCursor.blockNumber):
    BigInt(origin.block.number);
  assert.ok(from<=confirmedBlock,'PONS_S1_NO_CONFIRMED_BLOCKS_TO_ENROLL');
  const to=from+BigInt(MAX_SCAN_BLOCKS-1)<confirmedBlock?
    from+BigInt(MAX_SCAN_BLOCKS-1):confirmedBlock;
  await launch.assertAuthority(from);
  await launch.assertAuthority(to);
  // Strict event decoding selects the exact Pons factory; never use token
  // names, market outcomes, liquidity or later price to determine membership.
  const readFactoryLogs = source => source.getLogs({
    address:CURRENT_PONS_V2_AUTHORITY.factory,
    event:ponsV2TokenLaunchedEvent,fromBlock:from,toBlock:to,strict:true
  });
  const [officialLogs,archiveLogs] = await Promise.all([
    readFactoryLogs(discovery),readFactoryLogs(client)
  ]);
  const parity=assertProviderParity(officialLogs,archiveLogs,activation.factory);
  const rawLogs=parity.logs;
  const [officialHead,officialEnd,officialRuntime] = await Promise.all([
    discovery.getBlockNumber(),
    discovery.getBlock({blockNumber:to}),
    discovery.getBytecode({address:CURRENT_PONS_V2_AUTHORITY.factory,blockNumber:to})
  ]);
  assert.ok(officialHead>=confirmedBlock,'PONS_S1_DISCOVERY_BEHIND_CONFIRMED_HEAD');
  assert.equal(keccak256(officialRuntime??'0x').toLowerCase(),
    CURRENT_PONS_V2_AUTHORITY.factoryRuntimeCodeHash.toLowerCase(),
    'PONS_S1_OFFICIAL_FACTORY_RUNTIME_DRIFT');
  const archiveEnd=await getPoint(to);
  assert.equal(officialEnd.hash?.toLowerCase(),archiveEnd.hash,
    'PONS_S1_INDEPENDENT_END_BLOCK_HASH_DISAGREEMENT');
  assert.ok(rawLogs.length<=4096,'PONS_S1_LOG_CHUNK_TOO_LARGE_FAIL_CLOSED');
  const blockSet=new Set([String(to),...rawLogs.map(log=>String(log.blockNumber))]);
  const blocks={};
  for(const block of blockSet) {
    blocks[block]=await getPoint(BigInt(block));
  }
  const result=freezeNextBatch({
    spec,activation,origin,previous,scanFrom:from,scanThrough:to,
    confirmedHead:{blockNumber:confirmedBlock,rpcHeadBlock:rpcHead,
      hash:headPoint.hash,timestampMs:headPoint.timestampMs},
    blocks,logs:rawLogs,capturedAtMs:Date.now()
  });
  const endRecheck=await getPoint(to);
  assert.equal(endRecheck.hash,result.scannedThroughBlockHash,
    'PONS_S1_REORG_BETWEEN_LOGS_AND_FREEZE');
  assert.equal(result.rawFactoryEventDigest,parity.allFactoryLogsDigest);
  assert.equal(result.observedFactoryEventCount,parity.count);
  checkBatch(result);
  await persistExclusive(process.env.PONS_S1_OUTPUT_FILE,result);
}

if (mode==='measure') {
  const batchPath=process.env.PONS_S1_EXTERNAL_BATCH_PATH;
  const sealPath=process.env.PONS_S1_EXTERNAL_SEAL_PATH;
  assert.ok(batchPath && sealPath,
    'PONS_S1_MEASURE_REQUIRES_EXTERNAL_BATCH_AND_INDEPENDENT_SEAL');
  const batch=await mustReadJson(batchPath,'EXTERNAL_BATCH');
  const seal=await mustReadJson(sealPath,'EXTERNAL_SEAL');
  assert.equal(batch.specSha256,ctx.specSha256);
  assert.equal(batch.activationDigest,ctx.activationDigest);
  assertExternalSeal(batch,seal);
  // This local assertion is not an independent GitHub API witness: the
  // activation workflow must separately reverify release immutability and
  // exact asset SHA before treating results as controlled research evidence.
  const origin=await resolveOrigin({batch,seal});
  const selected=await client.getBlock({blockNumber:BigInt(batch.scannedThrough)});
  assert.equal(selected.hash?.toLowerCase(),batch.scannedThroughBlockHash,
    'PONS_S1_SEALED_SELECTION_REORG');
  const confirmedPoint=await forward.getBlockPoint(confirmedBlock);
  const quote=new ViemPonsV2CurveQuoteAdapter({
    authority:CURRENT_PONS_V2_AUTHORITY,
    templateAuthority:CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,client,now:Date.now
  });
  const usd=new ViemRobinhoodUsdCalibrationAdapter({
    authority:CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,client
  });
  const launches=new Map();
  const results=[];
  for(const item of batch.newEvents) {
    let candidates=launches.get(item.blockNumber);
    if(!candidates) {
      candidates=await launch.catchUp(BigInt(item.blockNumber),BigInt(item.blockNumber));
      launches.set(item.blockNumber,candidates);
    }
    const candidate=candidates.find(x=>
      x.txHash.toLowerCase()===item.transactionHash &&
      x.logIndex===item.logIndex &&
      x.token.toLowerCase()===item.token &&
      x.blockHash.toLowerCase()===item.blockHash);
    assert.ok(candidate,'PONS_S1_SELECTED_LAUNCH_RECONSTRUCTION_MISMATCH');
    assert.equal(candidate.pairToken.toLowerCase(),PONS_V2_NATIVE_PAIR_TOKEN);
    const launchPoint=await forward.getBlockPoint(candidate.blockNumber);
    assert.equal(launchPoint.timestampMs,item.launchTimestampMs,
      'PONS_S1_LAUNCH_TIME_RECONSTRUCTION_MISMATCH');
    const baseline=await buildPortableBaselineBatch(
      {launch,marketQuotes:quote,usdCalibration:usd},candidate,Date.now
    );
    const c0=evaluateBuyEveryExecutableControl(baseline);
    const c1=evaluateFastVetR1CapacityGate({baseline,creatorFeature:null});
    const primary=baseline.legs?.[2];
    const primaryOneDollarEntryVerified=
      baseline.status==='COMPLETE' && c0.hypotheticalAction==='WOULD_TRADE' &&
      primary?.notionalUsdMicros===1_000_000n &&
      primary.entry.executable===true && primary.entry.amountOut>0n &&
      primary.reverse?.executable===true;
    const mature=confirmedPoint.timestampMs>=
      item.launchTimestampMs+spec.prospective.primaryExit.horizonMs;
    const forwardOutcome=(mature && primaryOneDollarEntryVerified) ?
      await buildPortableForwardOutcome(
        forward,candidate,baseline,spec.prospective.primaryExit.horizonMs,confirmedPoint
      ):null;
    const outcome=forwardOutcome?{
      status:forwardOutcome.status,
      reason:forwardOutcome.reason??null,
      horizonMs:forwardOutcome.horizonMs,
      observedBlock:String(forwardOutcome.observedBlock),
      observedBlockHash:forwardOutcome.observedBlockHash,
      classification:forwardOutcome.classification??null,
      exitExecutable:forwardOutcome.exitExecutable,
      grossExecutableValueUsdMicros:forwardOutcome.executableValueUsdMicros?.toString()??null,
      grossExecutableReturnBps:forwardOutcome.executableReturnBps?.toString()??null,
      outcomeAuthorityDigest:forwardOutcome.authorityDigest
    }:{status:!mature?'PENDING_MATURITY':!primaryOneDollarEntryVerified?
      'NO_MECHANICALLY_VERIFIED_ONE_DOLLAR_ENTRY':'UNVERIFIED_OUTCOME',reason:null};
    results.push({
      eventKey:item.eventKey,launchId:candidate.launchId,
      launchBlock:String(candidate.blockNumber),baselineId:baseline.baselineId,
      decisionBlock:String(baseline.decisionBlock),
      decisionHash:baseline.decisionBlockHash,
      baselineStatus:baseline.status,baselineReason:baseline.reason??null,
      baselineAuthorityDigest:baseline.authorityDigest,
      c0Action:c0.hypotheticalAction,c1Action:c1.hypotheticalAction,
      c1CreatorHistory:'UNKNOWN_NOT_BACKFILLED',
      primaryOneDollarEntryVerified,
      outcome,
      costStatus:'UNVERIFIED_FULL_EXECUTION_COST',
      personaParity:'SHADOW_RECIPIENT_BOUND_LIVE_WALLET_UNVERIFIED',
      entryImpact:'UNPERTURBED_HISTORICAL_STATE_NOT_SEQUENTIAL_PNL',
      quoteToInclusion:'UNVERIFIED',
      featureReconstruction:'HISTORICAL_BLOCK_STATE_RECONSTRUCTED_AFTER_SELECTION_NOT_A_PREOUTCOME_FORECAST'
    });
  }
  const report={
    schemaVersion:'PONS_S1_EXPLORATORY_BATCH_MEASUREMENT_V0',
    batchDigest:batch.batchDigest,sealDigest:digest(seal),
    sourceReviewedCommit:EXPECTED_SOURCE,collectorImplementationSha:scriptSha,
    firstHorizonMs:300000,recordCount:results.length,
    fullCostVerifiedCount:0,scientificAuthority:'NONE_LOCAL_SEAL_METADATA_REQUIRES_INDEPENDENT_API_WITNESS',
    noTradingAuthority:true,noAutomaticPromotion:true,results
  };
  assert.equal(report.recordCount,batch.newEvents.length);
  await persistExclusive(process.env.PONS_S1_OUTPUT_FILE,report);
}
