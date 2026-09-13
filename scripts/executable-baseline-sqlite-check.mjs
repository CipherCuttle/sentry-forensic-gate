import assert from 'node:assert/strict';
import { SqliteStore } from '../dist/db/sqliteStore.js';
import { buildBaselineBatch, syncExecutableBaseline } from '../dist/runtime/executableBaseline.js';

const launch = {
  chainId: 57073, blockNumber: 20n, blockHash: '0x20', observedAtMs: 1,
  launchId: 'sql-launch', eventId: 'sql-event', factory: '0xfac', txHash: '0xsqltx', logIndex: 0,
  token: '0xaaa', creator: '0xccc', tokenId: 9n, name: 'SQL', symbol: 'SQL', launchType: 'STANDARD', sourceEvent: 'TokenDeployed'
};
const market = {
  launchId: launch.launchId, launchedToken: launch.token, baseToken: '0xbbb', token0: launch.token, token1: '0xbbb',
  fee: 10000, pool: '0xpool', positionLiquidity: 10n, activeLiquidity: 9n, sqrtPriceX96Before: 1n
};
class Source {
  async getHeadBlockNumber(){ return 22n; }
  async getBlockHash(block){ return block === 22n ? '0x22' : `0x${block}`; }
  async assertAuthority(){}
  async resolveMarket(){ return market; }
  async calibrateUsd({notionalUsdMicros}){ return {kind:'USDT0_NOMINAL_PEG_V0',notionalUsdMicros,baseToken:market.baseToken,baseAmount:notionalUsdMicros,baseDecimals:6}; }
  async quoteEntry({launch,decisionBlockHash,decisionBlock,notionalUsdMicros,amountIn}){ return {quoteId:`e-${notionalUsdMicros}`,launchId:launch.launchId,blockNumber:decisionBlock,blockHash:decisionBlockHash,observedAtMs:2,kind:'ENTRY',mode:'EXACT_INPUT',notionalUsdMicros,pool:market.pool,tokenIn:market.baseToken,tokenOut:market.launchedToken,fee:market.fee,amountIn,amountOut:amountIn*2n,executable:true}; }
  async quoteIndependentReverse({launch,decisionBlockHash,decisionBlock,notionalUsdMicros,amountIn}){ return {quoteId:`r-${notionalUsdMicros}`,launchId:launch.launchId,blockNumber:decisionBlock,blockHash:decisionBlockHash,observedAtMs:3,kind:'INDEPENDENT_REVERSE_EXIT',mode:'EXACT_INPUT',notionalUsdMicros,pool:market.pool,tokenIn:market.launchedToken,tokenOut:market.baseToken,fee:market.fee,amountIn,amountOut:amountIn/2n,executable:true}; }
}
const options={decisionDelayBlocks:2n,maxLaunchesPerSync:10,notionalsUsdMicros:[1_000_000n]};
const store=new SqliteStore(':memory:',57073);
assert.equal(await store.putLaunch(launch),'INSERTED');
assert.equal((await store.listLaunchesPendingBaseline(20n,10)).length,1);
const report=await syncExecutableBaseline(new Source(),store,options);
assert.equal(report.complete,1);
assert.equal((await store.listLaunchesPendingBaseline(20n,10)).length,0);

// Atomic duplicate/conflict semantics.
const batch=await buildBaselineBatch(new Source(),launch,2n,[1_000_000n]);
assert.equal(await store.putBaselineBatch(batch),'DUPLICATE');
await assert.rejects(store.putBaselineBatch({...batch,authorityDigest:'bad'}),/BASELINE_IDENTITY_CONFLICT/);

// Reorg only at the quote block: baseline evidence disappears, launch remains and becomes pending again.
await store.rewindFromBlock(22n);
assert.notEqual(await store.getLaunch(launch.launchId),null);
assert.equal((await store.listLaunchesPendingBaseline(20n,10)).length,1);
store.close();
console.log('executable-baseline-sqlite-check: PASS');
