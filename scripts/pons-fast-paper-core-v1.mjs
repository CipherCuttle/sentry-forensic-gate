import assert from 'node:assert/strict';

export const SCHEMA='PONS_FAST_PAPER_LOOP_V1';
export const ONE_USD=1_000_000n;
export const FIVE_USD=5_000_000n;
export const MAX_ENTRY_AGE_MS=240_000; // stop before the five-minute target
export const HORIZONS=Object.freeze({fiveMinute:300_000,day:86_400_000});
export const MAX_SCANNED_BLOCKS=8n;
export const MAX_BLOCK_EVENTS=8;

const NONNEG=/^(0|[1-9]\d*)$/;
const HASH=/^0x[0-9a-f]{64}$/;
const ADDR=/^0x[0-9a-f]{40}$/;
const fail=(reason)=>({action:'SKIP',reason});

export function newPaperState(now=Date.now()){
  assert.ok(Number.isSafeInteger(now)&&now>=0);
  return {schemaVersion:SCHEMA,chainId:4663,mode:'PAPER_ONLY',
    createdAtMs:now,updatedAtMs:now,lastScannedBlock:null,
    launches:{},unverifiedBlocks:{},observability:{
      skippedBlockCount:0,backlogGapCount:0,providerFailureCount:0}};
}
export function validatePaperState(s){
  assert.ok(s&&typeof s==='object'&&!Array.isArray(s),'STATE_OBJECT_REQUIRED');
  assert.equal(s.schemaVersion,SCHEMA);assert.equal(s.chainId,4663);
  assert.equal(s.mode,'PAPER_ONLY','LIVE_MODE_FORBIDDEN');
  assert.ok(s.lastScannedBlock===null||
    typeof s.lastScannedBlock==='string'&&NONNEG.test(s.lastScannedBlock));
  assert.ok(s.launches&&typeof s.launches==='object'&&!Array.isArray(s.launches));
  assert.ok(s.unverifiedBlocks&&typeof s.unverifiedBlocks==='object'&&
    !Array.isArray(s.unverifiedBlocks));
  for(const [k,row] of Object.entries(s.launches)){
    assert.match(k,/^0x[0-9a-f]{64}:\d+$/,'EVENT_KEY_INVALID');
    assert.match(row.token,ADDR,'TOKEN_INVALID');
    assert.equal(row.eventKey,k,'EVENT_KEY_DRIFT');
    assert.ok(['SKIP','PAPER_OPEN'].includes(row.action),'UNKNOWN_PAPER_ACTION');
    if(row.action==='PAPER_OPEN'){
      assert.ok(row.entry&&NONNEG.test(row.entry.ethInWei)&&
        NONNEG.test(row.entry.tokenOut)&&
        row.entry.usdNotionalMicros===String(ONE_USD),'BAD_PAPER_ENTRY');
      assert.equal(row.netProfitUsdMicros,undefined,
        'PAPER_CANNOT_INVENT_NET_PROFIT');
      assert.ok(row.exits&&Object.keys(row.exits).sort().join(',')==='day,fiveMinute');
      for(const value of Object.values(row.exits))
        assert.ok(value===null||
          ['GROSS_QUOTE_ONLY','UNVERIFIED'].includes(value.state),
          'EXIT_STATE_NOT_SUPPORTED');
    }
  }
  return s;
}
export function eventKey(log){
  assert.match(String(log.transactionHash??'').toLowerCase(),HASH,
    'EVENT_TX_HASH_INVALID');
  assert.ok(Number.isSafeInteger(log.logIndex)&&log.logIndex>=0,
    'EVENT_INDEX_INVALID');
  return log.transactionHash.toLowerCase()+':'+log.logIndex;
}
export function scanWindow(head,lastScanned,origin){
  assert.ok(typeof head==='bigint'&&typeof origin==='bigint');
  const safe=head-4n;
  if(safe<origin)return null;
  // Cold start targets the newest eight safe blocks, not stale history.
  // A newly started process ONLY samples recent launches. It never rewinds
  // until the entire older chain is scanned or pretends to be exhaustive.
  const recentStart=safe-7n>origin?safe-7n:origin;
  let from=lastScanned===null?recentStart:BigInt(lastScanned)+1n;
  let missed=null;
  if(from<recentStart){missed={from:String(from),through:String(recentStart-1n)};
    from=recentStart;}
  if(from>safe)return {from:null,through:null,missed};
  const through=from+MAX_SCANNED_BLOCKS-1n<safe?
    from+MAX_SCANNED_BLOCKS-1n:safe;
  return {from,through,missed};
}
export function isFresh(launchTimestampMs,now=Date.now()){
  return Number.isSafeInteger(launchTimestampMs)&&
    now>=launchTimestampMs&&now-launchTimestampMs<MAX_ENTRY_AGE_MS;
}
export function paperEntryDecision(baseline,launchTimestampMs,now=Date.now()){
  if(!isFresh(launchTimestampMs,now))return fail('STALE_LAUNCH');
  if(baseline?.status!=='COMPLETE')return fail('BASELINE_UNVERIFIED');
  if(baseline.reverseSemantics!=='INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL')
    return fail('REVERSE_SEMANTICS_UNVERIFIED');
  const ladder=['250000','500000','1000000','2000000','5000000'];
  if(baseline.legs?.length!==5||baseline.legs.some((x,i)=>
    String(x.notionalUsdMicros)!==ladder[i]))
    return fail('LADDER_INCOMPLETE');
  const leg=baseline.legs[2];
  if(!leg.entry?.executable||!leg.reverse?.executable||
      leg.entry.amountOut<=0n||leg.entry.amountIn<=0n||
      leg.reverse.amountOut<=0n||
      leg.reverse.amountIn!==leg.entry.amountOut)
    return fail('ONE_DOLLAR_EXIT_UNVERIFIED');
  if(leg.entry.amountIn>leg.calibration.baseAmount)
    return fail('ENTRY_EXCEEDS_CALIBRATION');
  return {action:'PAPER_OPEN',reason:'ONE_DOLLAR_EXECUTABLE_CONTROL',
    entry:{usdNotionalMicros:String(ONE_USD),
      ethInWei:String(leg.entry.amountIn),
      tokenOut:String(leg.entry.amountOut),
      sameStateReverseEthWei:String(leg.reverse.amountOut),
      reverseRecoveryBps:leg.independentReverseRecoveryBps===null?
        null:String(leg.independentReverseRecoveryBps),
      fiveDollarEntryExecutable:!!baseline.legs[4].entry.executable,
      fiveDollarReverseExecutable:!!baseline.legs[4].reverse?.executable,
      decisionBlock:String(baseline.decisionBlock),
      decisionBlockHash:String(baseline.decisionBlockHash).toLowerCase(),
      baselineAuthorityDigest:baseline.authorityDigest}};
}
export function dueHorizons(row,blockTimestampMs){
  if(row.action!=='PAPER_OPEN')return [];
  return Object.entries(HORIZONS).filter(([k,delta])=>
    row.exits[k]===null && blockTimestampMs>=row.launchTimestampMs+delta)
    .map(([k])=>k);
}
export function exitGrossQuote(row,horizon,market,quote,calibration,
  blockNumber,blockHash,observedAtMs){
  assert.ok(Object.hasOwn(HORIZONS,horizon));
  assert.equal(row.action,'PAPER_OPEN');
  assert.ok(!row.exits[horizon],'HORIZON_ALREADY_RECORDED');
  assert.equal(quote.kind,'INDEPENDENT_REVERSE_EXIT','WRONG_QUOTE_KIND');
  assert.equal(String(quote.amountIn),row.entry.tokenOut,'EXIT_TOKEN_QTY_MISMATCH');
  assert.equal(quote.blockNumber,blockNumber,'EXIT_BLOCK_MISMATCH');
  assert.equal(quote.blockHash.toLowerCase(),blockHash.toLowerCase(),
    'EXIT_BLOCK_HASH_MISMATCH');
  assert.equal(calibration.notionalUsdMicros,ONE_USD,
    'EXIT_CALIBRATION_NOT_ONE_USD');
  assert.ok(calibration.baseAmount>0n,'EXIT_USD_CALIBRATION_UNAVAILABLE');
  assert.equal(quote.executable,true,'EXIT_QUOTE_NOT_EXECUTABLE');
  assert.ok(quote.amountOut>0n,'EXIT_AMOUNT_ZERO');
  assert.equal(market.baseAsset.toLowerCase(),
    '0x0000000000000000000000000000000000000000',
    'EXIT_NOT_NATIVE');
  assert.ok(Number.isSafeInteger(observedAtMs));
  const grossUsdMicros=quote.amountOut*ONE_USD/calibration.baseAmount;
  return {state:'GROSS_QUOTE_ONLY',horizon,blockNumber:String(blockNumber),
    blockHash:blockHash.toLowerCase(),observedAtMs,
    grossNativeOutWei:String(quote.amountOut),
    grossUsdMicros:String(grossUsdMicros),
    grossDeltaUsdMicros:String(grossUsdMicros-ONE_USD),
    gasIncluded:false,actualFill:false,slippageIncluded:false,
    v4Supported:false,netProfitEstablished:false};
}
export function unknownExit(horizon,reason,blockNumber,observedAtMs){
  assert.ok(Object.hasOwn(HORIZONS,horizon));
  assert.ok(['RPC_UNAVAILABLE','MARKET_NOT_ACTIVE','QUOTE_UNVERIFIED',
    'USD_CALIBRATION_UNVERIFIED','MISSED_WINDOW','REORG','UNKNOWN'].includes(reason));
  return {state:'UNVERIFIED',horizon,reason,blockNumber:String(blockNumber),
    observedAtMs,actualFill:false,netProfitEstablished:false};
}
export function finiteFailure(error){
  const n=String(error?.name??'')+':'+String(error?.cause?.name??'');
  const m=String(error?.message??'');
  if(/reorg|HASH_MISMATCH|BLOCK_HASH_MISMATCH/i.test(m))return 'REORG';
  if(/QUOTE_MARKET_NOT_ACTIVE|CURVE_NOT_ACTIVE|MARKET.*NOT_ACTIVE/i.test(m))
    return 'MARKET_NOT_ACTIVE';
  if(/CALIBRATION/i.test(m))return 'USD_CALIBRATION_UNVERIFIED';
  if(/QUOTE_UNVERIFIED|QUOTE.*NOT_EXECUTABLE/i.test(m))
    return 'QUOTE_UNVERIFIED';
  if(/TIMEOUT|RPC|HTTP|TRANSPORT|NETWORK|RATE.?LIMIT/i.test(n+' '+m))
    return 'RPC_UNAVAILABLE';
  return 'UNKNOWN';
}
