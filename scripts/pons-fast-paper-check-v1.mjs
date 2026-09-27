import assert from 'node:assert/strict';
import {
  SCHEMA,ONE_USD,MAX_ENTRY_AGE_MS,HORIZONS,newPaperState,
  validatePaperState,eventKey,scanWindow,isFresh,paperEntryDecision,
  dueHorizons,exitGrossQuote,unknownExit,finiteFailure
} from './pons-fast-paper-core-v1.mjs';

// No network, real funds, wallet or RPC secret. Only the paper-mode control
// is tested; creator history and actual fill execution are NOT fabricated.
let negatives=0;
function bad(fn,pattern){assert.throws(fn,pattern);negatives++;}
const tx='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
assert.equal(eventKey({transactionHash:tx.toUpperCase().replace('0X','0x'),
  logIndex:4}),tx+':4');
bad(()=>eventKey({transactionHash:'MY_FAKE_TX',logIndex:1}),
  /EVENT_TX_HASH_INVALID/);
const from=26841846n,head=26850000n;
const first=scanWindow(head,null,from);
assert.equal(first.from,head-4n-7n);
assert.equal(first.through,first.from+7n);
assert.equal(first.missed,null);
assert.equal(scanWindow(head,String(head-4n),from).from,null);
const gap=scanWindow(head,String(from),from);
assert.deepEqual(gap.missed,{from:String(from+1n),
  through:String(head-4n-8n)});
assert.equal(gap.from,first.from);
assert.equal(scanWindow(from+3n,null,from),null);
assert.equal(isFresh(1000,MAX_ENTRY_AGE_MS+999),true);
assert.equal(isFresh(1000,MAX_ENTRY_AGE_MS+1000),false);
assert.equal(isFresh(2000,1000),false);
const makeLeg=(n)=>({
  notionalUsdMicros:n,calibration:{baseAmount:20_000_000_000_000n},
  entry:{executable:true,amountIn:20_000_000_000_000n,
    amountOut:1_000_000_000n},
  reverse:{executable:true,amountIn:1_000_000_000n,
    amountOut:19_000_000_000_000n},
  independentReverseRecoveryBps:9500n
});
const baseline={status:'COMPLETE',
  reverseSemantics:'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
  legs:[250000n,500000n,1000000n,2000000n,5000000n].map(makeLeg),
  decisionBlock:26850000n,decisionBlockHash:blockHash,
  authorityDigest:'sha256:FIXTURE_ONLY'};
const decision=paperEntryDecision(baseline,1000,2000);
assert.equal(decision.action,'PAPER_OPEN');
assert.equal(decision.entry.usdNotionalMicros,String(ONE_USD));
assert.equal(decision.entry.ethInWei,'20000000000000');
assert.equal(decision.entry.fiveDollarReverseExecutable,true);
assert.equal(paperEntryDecision(baseline,1000,MAX_ENTRY_AGE_MS+1000).reason,
  'STALE_LAUNCH');
assert.equal(paperEntryDecision({...baseline,status:'UNVERIFIED'},1000,2000)
  .reason,'BASELINE_UNVERIFIED');
assert.equal(paperEntryDecision({...baseline,legs:baseline.legs.slice(0,4)},
  1000,2000).reason,'LADDER_INCOMPLETE');
assert.equal(paperEntryDecision({...baseline,
  reverseSemantics:'SIMULATED_SEQUENTIAL'},1000,2000).reason,
  'REVERSE_SEMANTICS_UNVERIFIED');
assert.equal(paperEntryDecision({...baseline,
  legs:baseline.legs.map((l,i)=>i===2?
    {...l,reverse:{...l.reverse,executable:false}}:l)},1000,2000)
  .reason,'ONE_DOLLAR_EXIT_UNVERIFIED');
const event=tx+':4',state=newPaperState(2000);
assert.equal(state.schemaVersion,SCHEMA);
state.lastScannedBlock=String(from);
state.launches[event]={eventKey:event,
  token:'0x'+'c'.repeat(40),launchBlock:String(from),
  launchTimestampMs:1000,action:'PAPER_OPEN',
  entry:decision.entry,exits:{fiveMinute:null,day:null},
  actualFill:false,netProfitEstablished:false};
assert.equal(validatePaperState(state),state);
bad(()=>validatePaperState({...state,mode:'LIVE'}),/LIVE_MODE_FORBIDDEN/);
bad(()=>validatePaperState({...state,launches:{[event]:{
  ...state.launches[event],netProfitUsdMicros:'1'}}}),
  /PAPER_CANNOT_INVENT_NET_PROFIT/);
const row=state.launches[event];
assert.deepEqual(dueHorizons(row,1000+HORIZONS.fiveMinute-1),[]);
assert.deepEqual(dueHorizons(row,1000+HORIZONS.fiveMinute),
  ['fiveMinute']);
assert.deepEqual(dueHorizons(row,1000+HORIZONS.day),['fiveMinute','day']);
const market={baseAsset:'0x'+'0'.repeat(40)};
const quote={kind:'INDEPENDENT_REVERSE_EXIT',executable:true,
  amountIn:1_000_000_000n,amountOut:25_000_000_000_000n,
  blockNumber:26850500n,blockHash};
const calibration={notionalUsdMicros:ONE_USD,
  baseAmount:20_000_000_000_000n};
const exit=exitGrossQuote(row,'fiveMinute',market,quote,calibration,
  quote.blockNumber,blockHash,302000);
assert.equal(exit.state,'GROSS_QUOTE_ONLY');
assert.equal(exit.grossUsdMicros,'1250000');
assert.equal(exit.grossDeltaUsdMicros,'250000');
assert.equal(exit.gasIncluded,false);
assert.equal(exit.actualFill,false);
assert.equal(exit.netProfitEstablished,false);
bad(()=>exitGrossQuote(row,'day',market,{...quote,amountIn:1n},
  calibration,quote.blockNumber,blockHash,302000),
  /EXIT_TOKEN_QTY_MISMATCH/);
bad(()=>exitGrossQuote(row,'day',market,{...quote,blockHash:'0x'+'d'.repeat(64)},
  calibration,quote.blockNumber,blockHash,302000),
  /EXIT_BLOCK_HASH_MISMATCH/);
bad(()=>exitGrossQuote(row,'day',market,{...quote,executable:false},
  calibration,quote.blockNumber,blockHash,302000),
  /EXIT_QUOTE_NOT_EXECUTABLE/);
bad(()=>exitGrossQuote(row,'day',market,quote,
  {...calibration,baseAmount:0n},quote.blockNumber,blockHash,302000),
  /EXIT_USD_CALIBRATION_UNAVAILABLE/);
assert.equal(unknownExit('day','MISSED_WINDOW',26850500n,302000)
  .state,'UNVERIFIED');
assert.equal(finiteFailure(new Error('curl failed private SECRET=abcd')),
  'UNKNOWN');
assert.equal(finiteFailure(new Error('EXIT_REORG_BLOCK_HASH_MISMATCH')),
  'REORG');
assert.equal(finiteFailure(new Error('PONS_V2_QUOTE_MARKET_NOT_ACTIVE')),
  'MARKET_NOT_ACTIVE');
assert.equal(finiteFailure(new Error('QUOTE_UNVERIFIED')),
  'QUOTE_UNVERIFIED');
bad(()=>unknownExit('fiveMinute','RAW_SECRET_KEY',26850500n,302000),
  /AssertionError/);
console.log(JSON.stringify({verdict:'PONS_FAST_PAPER_OFFLINE_PASS',
  adversarialNegatives:negatives,actualRpc:false,wallet:false,
  liveMoney:false,scientificPromotion:false}));
