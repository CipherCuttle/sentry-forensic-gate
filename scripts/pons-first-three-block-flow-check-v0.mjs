import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  encodeAbiParameters, encodeEventTopics, encodeFunctionData,
  getAddress, zeroAddress
} from 'viem';
import {
  attestPonsV2OpeningAllocation, PONS_V2_FORWARDER_LAUNCH_ABI,
  PONS_V2_TOKEN_LAUNCHED_EVENT, PONS_V2_CURVE_BUY_EVENT
} from './pons-opening-allocation-core-v0.mjs';
import {
  buildPonsV2FirstThreeBlockFlow, PONS_V2_CURVE_SELL_EVENT,
  ERC20_TRANSFER_EVENT
} from './pons-first-three-block-flow-core-v0.mjs';

const address = n => getAddress('0x' + n.repeat(40));
const factory=address('1'),forwarder=address('2'),token=address('3'),curve=address('4');
const launcher=address('5'),feeRecipient=address('6'),privileged=address('7'),publicBuyer=address('8');
const supply=1_000_000n;
const tx0='0x'+'a'.repeat(64),tx1='0x'+'b'.repeat(64),tx2='0x'+'c'.repeat(64);
const hash0='0x'+'d'.repeat(64),hash1='0x'+'e'.repeat(64),hash2='0x'+'f'.repeat(64);
const blocks=[
  {number:500n,hash:hash0},{number:501n,hash:hash1},{number:502n,hash:hash2}
];
const launchEvent={
  address:factory,blockNumber:500n,blockHash:hash0,transactionHash:tx0,logIndex:0,
  topics:encodeEventTopics({abi:[PONS_V2_TOKEN_LAUNCHED_EVENT],eventName:'TokenLaunched',
    args:{token,curve,deployer:launcher}}),
  data:encodeAbiParameters([
    {name:'pairToken',type:'address'},{name:'launchConfigId',type:'uint256'},
    {name:'graduationThreshold',type:'uint256'}
  ],[zeroAddress,1n,100n]),
  args:{token,curve,deployer:launcher,pairToken:zeroAddress,
    launchConfigId:1n,graduationThreshold:100n}
};
const params={
  name:'PROBE',symbol:'PRB',logo:'',description:'',
  socials:{twitter:'',telegram:'',discord:'',website:'',farcaster:''},
  creatorFeeRecipient:feeRecipient,creatorTaxBps:0,buybackEnabled:false,
  expectedEconomics:'0x'+'9'.repeat(64),salt:'0x'+'8'.repeat(64)
};
const tx={hash:tx0,blockNumber:500n,from:launcher,to:forwarder,
  input:encodeFunctionData({abi:PONS_V2_FORWARDER_LAUNCH_ABI,functionName:'launchAndBuy',
    args:[params,1n,zeroAddress,100n,1n,privileged,[privileged]]})};
function logBase(block,txHash,logIndex,contract) {
  return {address:contract,blockNumber:block.number,blockHash:block.hash,transactionHash:txHash,logIndex};
}
const abiUint=[{type:'uint256'},{type:'uint256'},{type:'uint256'},{type:'uint256'}];
function buy(block,hash,index,buyer,recipient,quoteIn,tokensOut) {
  return {...logBase(block,hash,index,curve),
    topics:encodeEventTopics({abi:[PONS_V2_CURVE_BUY_EVENT],eventName:'CurveBuy',
      args:{buyer,recipient}}),
    data:encodeAbiParameters(abiUint,[quoteIn,tokensOut,1n,0n])};
}
function sell(block,hash,index,seller,recipient,tokensIn,quoteOut) {
  return {...logBase(block,hash,index,curve),
    topics:encodeEventTopics({abi:[PONS_V2_CURVE_SELL_EVENT],eventName:'CurveSell',
      args:{seller,recipient}}),
    data:encodeAbiParameters(abiUint,[tokensIn,quoteOut,1n,0n])};
}
function transfer(block,hash,index,from,to,value) {
  return {...logBase(block,hash,index,token),
    topics:encodeEventTopics({abi:[ERC20_TRANSFER_EVENT],eventName:'Transfer',
      args:{from,to}}),
    data:encodeAbiParameters([{type:'uint256'}],[value])};
}
// Gross buy turnover intentionally exceeds supply because the same tokens
// can be bought, resold and bought again. It is NOT insider ownership.
const buy0=buy(blocks[0],tx0,1,launcher,privileged,100n,200_000n);
const buy1=buy(blocks[1],tx1,0,publicBuyer,publicBuyer,200n,600_000n);
const sell2=sell(blocks[2],tx2,0,publicBuyer,publicBuyer,400_000n,90n);
const buy2=buy(blocks[2],tx2,2,publicBuyer,publicBuyer,150n,500_000n);
const mint=transfer(blocks[0],tx0,2,zeroAddress,curve,supply);
const xfer0=transfer(blocks[0],tx0,3,curve,privileged,200_000n);
const xfer1=transfer(blocks[1],tx1,1,curve,publicBuyer,600_000n);
const xfer2=transfer(blocks[2],tx2,1,publicBuyer,curve,400_000n);
const xfer3=transfer(blocks[2],tx2,3,curve,publicBuyer,500_000n);
const opening=attestPonsV2OpeningAllocation({
  factory,forwarder,transaction:tx,
  receipt:{transactionHash:tx0,blockNumber:500n,blockHash:hash0,status:'success',
    logs:[launchEvent,buy0]},
  launchLog:launchEvent,totalSupply:supply,
  factoryRecord:{exists:true,token,curve,deployer:launcher,creatorFeeRecipient:feeRecipient,
    pairToken:zeroAddress}
});
assert.equal(opening.observedOpeningTokens,'200000');
const input={opening,blocks,curveLogs:[buy0,buy1,sell2,buy2],
  transferLogs:[mint,xfer0,xfer1,xfer2,xfer3],totalSupply:supply};
const out=buildPonsV2FirstThreeBlockFlow(input);
assert.equal(out.schemaVersion,'PONS_V2_FIRST_THREE_BLOCK_FLOW_V0');
assert.equal(out.coverage.atomicOpeningReconciled,true);
assert.equal(out.coverage.curveLogs,4);
assert.equal(out.buyerFlow.buyEvents,3);
assert.equal(out.buyerFlow.uniqueCurveBuyersObserved,2);
assert.equal(out.buyerFlow.uniqueTokenRecipients,2);
assert.equal(out.buyerFlow.grossTokensOut,'1300000');
assert.equal(out.buyerFlow.grossBuyTurnoverBpsFloor,13000);
assert.equal(out.buyerFlow.knownDeclaredExemptRecipientGrossBuyTurnoverBpsFloor,2000);
assert.equal(out.sellerFlow.sellEvents,1);
assert.equal(out.sellerFlow.grossTokensIn,'400000');
assert.equal(out.tokenTransfers.mintEvents,1);
assert.equal(out.tokenTransfers.otherTransferEvents,4);
assert.equal(out.buyerFlow.topBuyRecipients[0].grossBuyTurnoverBpsFloor,11000);
assert.equal(out.source.windowEndBlockNumber,'502');

// Empty launch purchase DIRECT route is also legitimate and must not
// be mislabeled "zero insiders". The existing opening core attests route.
const openingDirect={...opening,route:'DIRECT_FACTORY_LAUNCH',
  observedOpeningTokens:'0',openingBuys:[]};
const noOpening=buildPonsV2FirstThreeBlockFlow({
  ...input,opening:openingDirect,curveLogs:[buy1,sell2,buy2],
  transferLogs:[mint,xfer1,xfer2,xfer3]
});
assert.equal(noOpening.buyerFlow.buyEvents,2);
assert.equal(noOpening.buyerFlow.knownExemptRecipientGrossBuyTurnoverBpsFloor,0);

// Negative: omitted opening buy must not falsely establish a complete census.
assert.throws(()=>buildPonsV2FirstThreeBlockFlow({...input,
  curveLogs:[buy1,sell2,buy2]}),/OPENING_RECEIPT_LOG_COUNT_MISMATCH/);
assert.throws(()=>buildPonsV2FirstThreeBlockFlow({...input,
  curveLogs:[buy(blocks[0],tx0,1,launcher,privileged,100n,199_999n),buy1,sell2,buy2]}),
  /OPENING_RECEIPT_TRADE_MISMATCH/);
assert.throws(()=>buildPonsV2FirstThreeBlockFlow({...input,
  blocks:[blocks[0],{number:503n,hash:hash1},blocks[2]]}),/BLOCK_GAP_OR_MALFORMED/);
assert.throws(()=>buildPonsV2FirstThreeBlockFlow({...input,
  blocks:[{...blocks[0],hash:hash2},blocks[1],blocks[2]]}),/OPENING_BLOCK_HASH_CHANGED/);
assert.throws(()=>buildPonsV2FirstThreeBlockFlow({...input,
  curveLogs:[buy0,buy0,buy1,sell2,buy2]}),/DUPLICATE_CURVE_LOG/);
assert.throws(()=>buildPonsV2FirstThreeBlockFlow({...input,
  curveLogs:[buy0,{...buy1,blockHash:hash2},sell2,buy2]}),
  /LOG_NONCANONICAL_OR_OUT_OF_RANGE/);
assert.throws(()=>buildPonsV2FirstThreeBlockFlow({...input,
  transferLogs:[mint,xfer0,xfer0,xfer1,xfer2,xfer3]}),/DUPLICATE_TRANSFER_LOG/);
assert.throws(()=>buildPonsV2FirstThreeBlockFlow({...input,totalSupply:0n}),
  /ZERO_SUPPLY/);

const scout=await readFile(new URL('./pons-first-three-block-flow-scout-v0.mjs',import.meta.url),'utf8');
const core=await readFile(new URL('./pons-first-three-block-flow-core-v0.mjs',import.meta.url),'utf8');
assert.doesNotMatch(scout+core,
  /\b(?:createWalletClient|privateKeyToAccount|sendTransaction|writeContract|sendRawTransaction|child_process)\b/);
assert.match(scout,/THREE_BLOCK_WINDOW_NOT_TWELVE_CONFIRMED/);
assert.match(scout,/REORG_DURING_THREE_BLOCK_READ/);
assert.match(scout,/FACTORY_CODE_HASH_DRIFT/);
console.log('PONS_FIRST_THREE_BLOCK_FLOW_V0_PASS: turnover>100% safe, exact opening reconciliation, source hash, duplicate and no-write fences');
