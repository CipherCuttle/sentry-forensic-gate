import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  encodeAbiParameters, encodeEventTopics, encodeFunctionData, getAddress,
  zeroAddress
} from 'viem';
import {
  attestPonsV2OpeningAllocation, PONS_V2_DIRECT_LAUNCH_ABI,
  PONS_V2_FORWARDER_LAUNCH_ABI, PONS_V2_CURVE_BUY_EVENT
} from './pons-opening-allocation-core-v0.mjs';

const addr = digit => getAddress('0x' + digit.repeat(40));
const factory=addr('1'), forwarder=addr('2'), token=addr('3'), curve=addr('4');
const launcher=addr('5'), feeRecipient=addr('6'), atomicRecipient=addr('7'), extra=addr('8');
const txHash='0x'+'a'.repeat(64), blockHash='0x'+'b'.repeat(64), pair=zeroAddress;
const params={
  name:'DUMMY',symbol:'TEST',logo:'',description:'',
  socials:{twitter:'',telegram:'',discord:'',website:'',farcaster:''},
  creatorFeeRecipient:feeRecipient,creatorTaxBps:0,buybackEnabled:false,
  expectedEconomics:'0x'+'c'.repeat(64),salt:'0x'+'d'.repeat(64)
};
const event={address:factory,blockNumber:500n,blockHash,transactionHash:txHash,logIndex:0,
  args:{token,curve,deployer:launcher,pairToken:pair,launchConfigId:1n,graduationThreshold:100n}};
const record={exists:true,token,curve,deployer:launcher,creatorFeeRecipient:feeRecipient,pairToken:pair};
const directTx={hash:txHash,blockNumber:500n,from:launcher,to:factory,
  input:encodeFunctionData({abi:PONS_V2_DIRECT_LAUNCH_ABI,functionName:'launchToken',
    args:[params,1n,pair,[extra]]})};
const mkReceipt=logs=>({transactionHash:txHash,status:'success',blockNumber:500n,blockHash,
  logs:[event,...logs]});
const evidence=(tx, receipt=mkReceipt([]), changes={})=>attestPonsV2OpeningAllocation({
  transaction:tx,receipt,launchLog:event,factory,forwarder,factoryRecord:record,totalSupply:1_000_000n,...changes
});
const direct=evidence(directTx);
assert.equal(direct.route,'DIRECT_FACTORY_LAUNCH');
assert.equal(direct.observedOpeningTokens,'0');
assert.equal(direct.observedOpeningSupplyShareBpsFloor,0);
assert.equal(direct.declaredExtraExemptions,1);
assert.equal(direct.observedExemptAddresses.length,3);
assert.equal(direct.openingSameTransactionBuyLogs,0);
assert.deepEqual(direct.openingBuys,[]);

const directNoExtra={...directTx,input:encodeFunctionData({
  abi:PONS_V2_DIRECT_LAUNCH_ABI,functionName:'launchToken',args:[params,1n,pair]
})};
assert.equal(evidence(directNoExtra).declaredExtraExemptions,0);

const topics=encodeEventTopics({abi:[PONS_V2_CURVE_BUY_EVENT],eventName:'CurveBuy',
  args:{buyer:launcher,recipient:atomicRecipient}});
const data=encodeAbiParameters([
  {name:'quoteIn',type:'uint256'}, {name:'tokensOut',type:'uint256'},
  {name:'fee',type:'uint256'},{name:'tax',type:'uint256'}
],[123n,200_000n,1n,0n]);
const buyLog={address:curve,blockHash,transactionHash:txHash,logIndex:1,topics,data};
const atomicTx={...directTx,to:forwarder,input:encodeFunctionData({
  abi:PONS_V2_FORWARDER_LAUNCH_ABI,functionName:'launchAndBuy',
  args:[params,1n,pair,123n,1n,atomicRecipient,[extra]]
})};
const atomic=evidence(atomicTx,mkReceipt([buyLog]));
assert.equal(atomic.route,'VERIFIED_FACTORY_FORWARDER_ATOMIC_BUY');
assert.equal(atomic.openingSameTransactionBuyLogs,1);
assert.equal(atomic.observedOpeningSupplyShareBpsFloor,2000);
assert.equal(atomic.openingBuys[0].tokensOut,'200000');
assert.ok(atomic.openingBuys[0].exemptionReasons.includes('ATOMIC_BUY_RECIPIENT'));
assert.equal(atomic.declaredExtraExemptions,1);

// All reported opening allocations must be source-bound, never inferred
// from social signals or from an unrelated CurveBuy in a different receipt.
assert.throws(()=>evidence(atomicTx,mkReceipt([])),/ATOMIC_ROUTE_WITHOUT_RECIPIENT_BUY/);
assert.throws(()=>evidence(atomicTx,mkReceipt([buyLog]),{totalSupply:199_999n}),
  /OPENING_BUYS_EXCEED_SUPPLY/);
assert.throws(()=>evidence(directTx,mkReceipt([]),{factoryRecord:{...record,curve:addr('9')}}),
  /FACTORY_LAUNCH_RECORD_MISMATCH/);
assert.throws(()=>evidence({...directTx,to:addr('9')}),/UNKNOWN_LAUNCH_ROUTE/);
assert.throws(()=>evidence({...directTx,from:addr('9')}),/DIRECT_LAUNCHER_MISMATCH/);
assert.throws(()=>evidence({...directTx,input:'0xdeadbeef'}),/UNKNOWN_CALLDATA/);
assert.throws(()=>evidence(directTx,{...mkReceipt([]),status:'reverted'}),
  /LAUNCH_TX_NOT_SUCCESS/);
assert.throws(()=>evidence(directTx,mkReceipt([]),{launchLog:{...event,blockHash:'0x'+'e'.repeat(64)}}),
  /LAUNCH_LOG_BLOCK_MISMATCH/);
assert.throws(()=>evidence(directTx,mkReceipt([]),{launchLog:{...event,logIndex:5}}),
  /LAUNCH_LOG_NOT_IN_RECEIPT/);
const overLimit=Array.from({length:33},()=>extra);
const tooMany={...directTx,input:encodeFunctionData({
  abi:PONS_V2_DIRECT_LAUNCH_ABI,functionName:'launchToken',args:[params,1n,pair,overLimit]
})};
assert.throws(()=>evidence(tooMany),/INVALID_EXEMPTION_LIST/);

const source=(await Promise.all(['pons-opening-allocation-scout-v0.mjs',
  'pons-opening-allocation-core-v0.mjs'].map(n=>readFile(new URL(n,import.meta.url),'utf8')))).join('\n');
assert.doesNotMatch(source, /\b(?:createWalletClient|privateKeyToAccount|sendTransaction|writeContract|sendRawTransaction|child_process)\b/);
assert.match(source,/REORG_DURING_ATTESTATION/);
assert.match(source,/FACTORY_CODE_HASH_DRIFT/);
console.log('PONS_OPENING_ALLOCATION_V0_OFFLINE_PASS: direct and atomic decode, exclusions, proof binding, fail-closed, no-write surface');
