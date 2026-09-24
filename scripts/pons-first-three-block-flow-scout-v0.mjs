// Exact published launch, first THREE source-bound canonical blocks; no signer, writes or strategy actions.
import assert from 'node:assert/strict';
import {
  createPublicClient, decodeEventLog, defineChain, getAddress, http, keccak256
} from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY, DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID, ponsV2FactoryReadAbi, ponsV2TokenLaunchedEvent
} from '../dist/index.js';
import {
  attestPonsV2OpeningAllocation, PONS_V2_FACTORY_FORWARDER_ABI,
  PONS_V2_TOTAL_SUPPLY_ABI
} from './pons-opening-allocation-core-v0.mjs';
import {
  buildPonsV2FirstThreeBlockFlow, ERC20_TRANSFER_EVENT,
  PONS_V2_CURVE_SELL_EVENT
} from './pons-first-three-block-flow-core-v0.mjs';
import { PONS_V2_CURVE_BUY_EVENT } from './pons-opening-allocation-core-v0.mjs';

const txHash = process.env.PONS_FIRST_FLOW_TX_HASH;
const expectedToken = process.env.PONS_FIRST_FLOW_TOKEN;
const rpcUrl = process.env.PONS_FIRST_FLOW_RPC_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
assert.match(txHash??'',/^0x[0-9a-fA-F]{64}$/,'PONS_FIRST_FLOW_TX_HASH_REQUIRED');
if(expectedToken)getAddress(expectedToken);
assert.ok(/^https:\/\//.test(rpcUrl),'PONS_FIRST_FLOW_HTTPS_REQUIRED');
const chain=defineChain({id:ROBINHOOD_CHAIN_ID,name:'Robinhood Chain',
  nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
  rpcUrls:{default:{http:[DEFAULT_ROBINHOOD_RPC_URL]}}});
const client=createPublicClient({chain,transport:http(rpcUrl,{retryCount:0,timeout:10_000})});
const factory=CURRENT_PONS_V2_AUTHORITY.factory;
const same=(x,y)=>typeof x==='string'&&typeof y==='string'&&x.toLowerCase()===y.toLowerCase();

async function main(){
  assert.equal(await client.getChainId(),4663,'WRONG_CHAIN');
  const [tx,receipt]=await Promise.all([
    client.getTransaction({hash:txHash}),client.getTransactionReceipt({hash:txHash})
  ]);
  assert.equal(receipt.status,'success','LAUNCH_TX_REVERTED');
  assert.equal(tx.blockNumber,receipt.blockNumber,'TX_RECEIPT_BLOCK_MISMATCH');
  const launchBlock=receipt.blockNumber;
  assert.ok(launchBlock>=CURRENT_PONS_V2_AUTHORITY.fromBlock,'BEFORE_REVIEWED_EPOCH');
  if(CURRENT_PONS_V2_AUTHORITY.throughBlock!==undefined)
    assert.ok(launchBlock<=CURRENT_PONS_V2_AUTHORITY.throughBlock,'AFTER_REVIEWED_EPOCH');
  const head=await client.getBlockNumber();
  assert.ok(head>=launchBlock+14n,'THREE_BLOCK_WINDOW_NOT_TWELVE_CONFIRMED');
  const [factoryCode,blocks]=await Promise.all([
    client.getBytecode({address:factory,blockNumber:launchBlock}),
    Promise.all([0n,1n,2n].map(offset=>client.getBlock({blockNumber:launchBlock+offset})))
  ]);
  assert.ok(factoryCode&&factoryCode!=='0x','MISSING_FACTORY_CODE');
  assert.equal(keccak256(factoryCode).toLowerCase(),
    CURRENT_PONS_V2_AUTHORITY.factoryRuntimeCodeHash.toLowerCase(),'FACTORY_CODE_HASH_DRIFT');
  assert.equal(blocks[0].hash?.toLowerCase(),receipt.blockHash?.toLowerCase(),'LAUNCH_REORG');
  const launches=[];
  for(const log of receipt.logs){
    if(!same(log.address,factory))continue;
    try {
      const decoded=decodeEventLog({
        abi:[ponsV2TokenLaunchedEvent],topics:log.topics,data:log.data,strict:true
      });
      if(decoded.eventName!=='TokenLaunched')continue;
      if(expectedToken&&!same(decoded.args.token,expectedToken))continue;
      launches.push({...log,args:decoded.args});
    }catch{ /* other factory event */ }
  }
  assert.equal(launches.length,1,'EXACTLY_ONE_SOURCE_BOUND_LAUNCH_REQUIRED');
  const launchLog=launches[0];
  const [forwarder,record,supply,curveCode,tokenCode]=await Promise.all([
    client.readContract({address:factory,abi:PONS_V2_FACTORY_FORWARDER_ABI,
      functionName:'launchForwarder',blockNumber:launchBlock}),
    client.readContract({address:factory,abi:ponsV2FactoryReadAbi,
      functionName:'getLaunchedToken',args:[launchLog.args.token],blockNumber:launchBlock}),
    client.readContract({address:launchLog.args.token,abi:PONS_V2_TOTAL_SUPPLY_ABI,
      functionName:'totalSupply',blockNumber:launchBlock}),
    client.getBytecode({address:launchLog.args.curve,blockNumber:launchBlock}),
    client.getBytecode({address:launchLog.args.token,blockNumber:launchBlock})
  ]);
  assert.ok(curveCode&&curveCode!=='0x'&&tokenCode&&tokenCode!=='0x','TOKEN_OR_CURVE_CODE_MISSING');
  const opening=attestPonsV2OpeningAllocation({
    transaction:tx,receipt,launchLog,factory,forwarder,factoryRecord:record,totalSupply:supply
  });
  const through=launchBlock+2n;
  const [curveLogs,transferLogs]=await Promise.all([
    client.getLogs({address:opening.curve,
      events:[PONS_V2_CURVE_BUY_EVENT,PONS_V2_CURVE_SELL_EVENT],
      fromBlock:launchBlock,toBlock:through,strict:true}),
    client.getLogs({address:opening.token,event:ERC20_TRANSFER_EVENT,
      fromBlock:launchBlock,toBlock:through,strict:true})
  ]);
  const after=await Promise.all(blocks.map(block=>client.getBlock({blockNumber:block.number})));
  for(let i=0;i<3;i++){
    assert.equal(after[i].hash?.toLowerCase(),blocks[i].hash?.toLowerCase(),'REORG_DURING_THREE_BLOCK_READ');
  }
  const result=buildPonsV2FirstThreeBlockFlow({opening,blocks,curveLogs,transferLogs,totalSupply:supply});
  result.source.primaryNativeEthPair=same(opening.pairToken,'0x0000000000000000000000000000000000000000');
  result.source.confirmationsAtCollection=(head-through).toString();
  result.source.openingRoute=opening.route;
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
main().catch(error=>{
  // Transport exception messages can embed credential-bearing endpoint URLs.
  process.stderr.write('PONS_FIRST_FLOW_READ_ONLY_FAILED_CLOSED:'+
    (error instanceof Error?error.name:'UnknownError')+'\n');
  process.exitCode=1;
});
