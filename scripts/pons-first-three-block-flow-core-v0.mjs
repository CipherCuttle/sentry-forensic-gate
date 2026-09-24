// Source-bound, zero-money three-block Pons V2 flow observation.
// Trade logs are NOT owner identity, wallet balances, profitability, or an executable exit.
import { decodeEventLog, getAddress, parseAbiItem, zeroAddress } from 'viem';
import { PONS_V2_CURVE_BUY_EVENT } from './pons-opening-allocation-core-v0.mjs';

export const PONS_V2_CURVE_SELL_EVENT = parseAbiItem(
  'event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)'
);
export const ERC20_TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)'
);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const fail=(message)=>{throw new Error('PONS_EARLY_FLOW_'+message)};
const requireTrue=(x,msg)=>{if(!x)fail(msg)};
const addr=(x,msg)=>{try{return getAddress(x)}catch{fail('INVALID_'+msg)}};
const fullhash=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x);
const int=(x,msg)=>{requireTrue(typeof x==='bigint'&&x>=0n,'INVALID_'+msg);return x};

function validateLog(log, blocksByNumber, contract) {
  requireTrue(same(log?.address,contract),'WRONG_LOG_CONTRACT');
  requireTrue(typeof log.blockNumber==='bigint','LOG_HEIGHT_MISSING');
  requireTrue(fullhash(log.blockHash)&&fullhash(log.transactionHash),'LOG_HASH_MISSING');
  requireTrue(Number.isSafeInteger(log.logIndex)&&log.logIndex>=0,'LOG_INDEX_MISSING');
  const h=blocksByNumber.get(log.blockNumber.toString());
  requireTrue(!!h&&same(log.blockHash,h),'LOG_NONCANONICAL_OR_OUT_OF_RANGE');
  requireTrue(Array.isArray(log.topics)&&typeof log.data==='string','LOG_BYTES_MISSING');
}
function decode(log,abi,name) {
  try {
    const result=decodeEventLog({abi:[abi],topics:log.topics,data:log.data,strict:true});
    if(result.eventName===name)return result.args;
  } catch { /* unrelated signature */
  }
  return null;
}
function logId(log) {return log.blockHash.toLowerCase()+':'+log.transactionHash.toLowerCase()+':'+log.logIndex;}
function byAddress(a,b){return a.address.toLowerCase().localeCompare(b.address.toLowerCase());}

/** Input supplied only after attesting exact launch receipt/factory and canonical block headers.
 * Reconciles all launch-tx buy logs against independently decoded opening receipt.
 * Fixed window: creation block and the next two canonical blocks. No skipped blocks.
 */
export function buildPonsV2FirstThreeBlockFlow({opening,blocks,curveLogs,transferLogs,totalSupply}) {
  requireTrue(opening?.schemaVersion==='PONS_V2_OPENING_ALLOCATION_EVIDENCE_V0'&&opening.chainId===4663,'OPENING_EVIDENCE_REQUIRED');
  const curve=addr(opening.curve,'CURVE'),token=addr(opening.token,'TOKEN');
  const launchHeight=BigInt(opening.blockNumber),supply=int(totalSupply,'SUPPLY');
  requireTrue(supply>0n,'ZERO_SUPPLY');
  requireTrue(fullhash(opening.blockHash)&&fullhash(opening.launchTransactionHash),'OPENING_HASH_INVALID');
  requireTrue(Array.isArray(blocks)&&blocks.length===3,'NEED_EXACTLY_THREE_BLOCKS');
  const hashes=new Map();
  for(let i=0;i<3;i++){
    const b=blocks[i];
    requireTrue(b?.number===launchHeight+BigInt(i)&&fullhash(b.hash),'BLOCK_GAP_OR_MALFORMED');
    requireTrue(!hashes.has(b.number.toString()),'DUPLICATE_BLOCK');
    hashes.set(b.number.toString(),b.hash);
  }
  requireTrue(same(blocks[0].hash,opening.blockHash),'OPENING_BLOCK_HASH_CHANGED');
  requireTrue(Array.isArray(curveLogs)&&Array.isArray(transferLogs),'LOG_ARRAYS_MISSING');
  requireTrue(curveLogs.length+transferLogs.length<=2500,'LOG_CAP_EXCEEDED');
  const seen=new Set(),exempt=new Set();
  for(const x of opening.observedExemptAddresses??[]){
    exempt.add(addr(x.address,'EXEMPT_ADDRESS').toLowerCase());
  }
  const expectedOpening=new Map();
  for(const x of opening.openingBuys??[]){
    const a=addr(x.recipient,'OPENING_RECIPIENT').toLowerCase();
    requireTrue(!expectedOpening.has(a),'DUPLICATE_OPENING_RECIPIENT');
    const n=BigInt(x.tokensOut);
    requireTrue(n>=0n,'NEGATIVE_OPENING_AMOUNT');
    expectedOpening.set(a,n);
  }
  const observedOpening=new Map();
  const recipients=new Map(),buyers=new Set(),sellers=new Set(),sellRecipients=new Set(),directTransferAddresses=new Set();
  let buyEvents=0,sellEvents=0,unknownCurveEvents=0,exemptBuyEvents=0;
  let boughtTokens=0n,soldTokens=0n,boughtByKnownExempt=0n;
  let totalQuoteIn=0n,totalQuoteOut=0n,basePlusSnipeBuyFee=0n,creatorBuyTax=0n,sellFee=0n,sellTax=0n;
  const ordered=curveLogs.slice().sort((a,b)=>a.blockNumber===b.blockNumber?a.logIndex-b.logIndex:a.blockNumber<b.blockNumber?-1:1);
  const events=[];
  for(const log of ordered) {
    validateLog(log,hashes,curve);
    const id=logId(log);
    requireTrue(!seen.has(id),'DUPLICATE_CURVE_LOG');seen.add(id);
    const buy=decode(log,PONS_V2_CURVE_BUY_EVENT,'CurveBuy');
    const sell=buy?null:decode(log,PONS_V2_CURVE_SELL_EVENT,'CurveSell');
    if(buy){
      const buyer=addr(buy.buyer,'BUYER'),recipient=addr(buy.recipient,'RECIPIENT');
      const amount=int(buy.tokensOut,'BOUGHT_TOKENS'),quote=int(buy.quoteIn,'BUY_QUOTE');
      const fee=int(buy.fee,'BUY_FEE'),tax=int(buy.tax,'BUY_CREATOR_TAX');
      buyers.add(buyer.toLowerCase());
      const r=recipients.get(recipient.toLowerCase())??{address:recipient,boughtTokens:0n,buyEvents:0,knownDeclaredExemption:exempt.has(recipient.toLowerCase())};
      r.boughtTokens+=amount;r.buyEvents++;recipients.set(recipient.toLowerCase(),r);
      buyEvents++;boughtTokens+=amount;totalQuoteIn+=quote;basePlusSnipeBuyFee+=fee;creatorBuyTax+=tax;
      if(r.knownDeclaredExemption){exemptBuyEvents++;boughtByKnownExempt+=amount;}
      if(same(log.transactionHash,opening.launchTransactionHash)){
        const old=observedOpening.get(recipient.toLowerCase())??0n;
        observedOpening.set(recipient.toLowerCase(),old+amount);
      }
      events.push({type:'CurveBuy',blockNumber:log.blockNumber.toString(),transactionHash:log.transactionHash,
        logIndex:log.logIndex,buyer,recipient,quoteIn:quote.toString(),tokensOut:amount.toString(),
        feeIncludesPossibleSnipeTax:fee.toString(),creatorTax:tax.toString(),
        recipientInKnownExemptionList:r.knownDeclaredExemption});
      continue;
    }
    if(sell){
      const seller=addr(sell.seller,'SELLER'),recipient=addr(sell.recipient,'SELL_RECIPIENT');
      const amount=int(sell.tokensIn,'SOLD_TOKENS'),quote=int(sell.quoteOut,'SELL_QUOTE');
      const fee=int(sell.fee,'SELL_FEE'),tax=int(sell.tax,'SELL_TAX');
      sellers.add(seller.toLowerCase());sellRecipients.add(recipient.toLowerCase());
      sellEvents++;soldTokens+=amount;totalQuoteOut+=quote;sellFee+=fee;sellTax+=tax;
      events.push({type:'CurveSell',blockNumber:log.blockNumber.toString(),transactionHash:log.transactionHash,
        logIndex:log.logIndex,seller,recipient,tokensIn:amount.toString(),
        quoteOut:quote.toString(),fee:fee.toString(),tax:tax.toString()});
    }else unknownCurveEvents++;
  }
  requireTrue(observedOpening.size===expectedOpening.size,'OPENING_RECEIPT_LOG_COUNT_MISMATCH');
  for(const [recipient,amount] of expectedOpening) {
    requireTrue(observedOpening.get(recipient)===amount,'OPENING_RECEIPT_TRADE_MISMATCH');
  }
  requireTrue(boughtTokens<=supply,'THREE_BLOCK_BUYS_EXCEED_LAUNCH_SUPPLY');

  let mintEvents=0,burnEvents=0,otherTransferEvents=0,transferVolume=0n;
  const tSeen=new Set();
  for(const log of transferLogs){
    validateLog(log,hashes,token);
    const id=logId(log);requireTrue(!tSeen.has(id),'DUPLICATE_TRANSFER_LOG');tSeen.add(id);
    const args=decode(log,ERC20_TRANSFER_EVENT,'Transfer');
    if(!args)fail('NON_TRANSFER_TOKEN_LOG');
    const from=addr(args.from,'TRANSFER_FROM'),to=addr(args.to,'TRANSFER_TO'),value=int(args.value,'TRANSFER_VALUE');
    transferVolume+=value;
    if(same(from,zeroAddress))mintEvents++;
    else if(same(to,zeroAddress))burnEvents++;
    else {otherTransferEvents++;directTransferAddresses.add(from.toLowerCase());directTransferAddresses.add(to.toLowerCase());}
  }
  const ranked=[...recipients.values()].sort((a,b)=>a.boughtTokens===b.boughtTokens?
    byAddress(a,b):a.boughtTokens>b.boughtTokens?-1:1);
  const topBuyRecipients=ranked.slice(0,10).map(x=>({
    recipient:x.address,boughtTokens:x.boughtTokens.toString(),buyEvents:x.buyEvents,
    boughtSupplyShareBpsFloor:Number(x.boughtTokens*10_000n/supply),
    knownDeclaredExemption:x.knownDeclaredExemption
  }));
  return {
    schemaVersion:'PONS_V2_FIRST_THREE_BLOCK_FLOW_V0',
    source:{chainId:4663,token,curve,launchTransactionHash:opening.launchTransactionHash,
      launchBlockNumber:opening.blockNumber,launchBlockHash:opening.blockHash,
      windowEndBlockNumber:blocks[2].number.toString(),windowEndBlockHash:blocks[2].hash,
      windowType:'LAUNCH_BLOCK_PLUS_NEXT_TWO'},
    coverage:{blocks:blocks.map(x=>({number:x.number.toString(),hash:x.hash})),
      curveLogs:curveLogs.length,tokenTransferLogs:transferLogs.length,
      unknownCurveEvents,atomicOpeningReconciled:true},
    buyerFlow:{buyEvents,uniqueTransactionSendersObserved:buyers.size,
      uniqueTokenRecipients:recipients.size,knownExemptRecipientBuyEvents:exemptBuyEvents,
      grossTokensOut:boughtTokens.toString(),grossQuoteIn:totalQuoteIn.toString(),
      feeIncludesBaseAndPossibleSnipe:basePlusSnipeBuyFee.toString(),
      creatorTax:creatorBuyTax.toString(),
      knownDeclaredExemptRecipientGrossTokensOut:boughtByKnownExempt.toString(),
      boughtSupplyShareBpsFloor:Number(boughtTokens*10_000n/supply),
      knownExemptRecipientBoughtSupplyShareBpsFloor:Number(boughtByKnownExempt*10_000n/supply),
      topBuyRecipients},
    sellerFlow:{sellEvents,uniqueSellers:sellers.size,uniqueQuoteRecipients:sellRecipients.size,
      grossTokensIn:soldTokens.toString(),grossQuoteOut:totalQuoteOut.toString(),
      fee:sellFee.toString(),creatorTax:sellTax.toString()},
    tokenTransfers:{mintEvents,burnEvents,otherTransferEvents,
      directTransferEndpointCount:directTransferAddresses.size,
      grossTransferAmountIncludingCurveTradesAndMint:transferVolume.toString(),
      note:'Transfer events overlap with curve trades and mint. Never add transfer and trade volume or infer actual wallet balances.'},
    eventRows:events,
    interpretation:[
      'Gross buys/sells in exactly three canonical source-bound blocks; NOT holder balances or realized profits.',
      'Buyer and recipient may differ. Exemption checks apply to declared recipient only; other wallet common ownership is unknown.',
      'A CurveBuy fee event folds base fee and opening snipe tax together; cannot derive sniper tax from this field.',
      'A low exemption allocation does not prove independence of other buyers or token safety.',
      'No RPC latency advantage, sequencer priority, pending-transaction or executable-exit claim.'
    ]
  };
}
