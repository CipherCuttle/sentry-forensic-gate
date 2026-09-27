import assert from 'node:assert/strict';
import {ARCHIVE_SCHEMA,PROVIDER,OFFICIAL,HISTORIC_OFFSETS,
  assertArchiveEndpoint,historicBlockHeights,recentRange,
  classifyArchiveFailure,createArchiveReceipt,
  validateArchiveReceipt} from './pons-s1-archive-provider-core-v1.mjs';
import {selectLatestNative} from './pons-s1-dual-rpc-rehearsal-core-v1.mjs';

// Entirely offline: no RPC endpoint connection, GitHub environment, key,
// wallet, prospective enrollment or chain write.
let rejected=0;
function bad(fn,pattern){
  assert.throws(fn,pattern);rejected++;
}
const sample='https://robinhood-mainnet.g.alchemy.com/v2/FAKE_KEY_123456';
assert.equal(assertArchiveEndpoint(sample),true);
for(const url of [
  'https://rpc.mainnet.chain.robinhood.com',
  'http://robinhood-mainnet.g.alchemy.com/v2/FAKE_KEY_123456',
  'https://localhost/v2/FAKE_KEY_123456',
  'https://robinhood-mainnet.g.alchemy.com.evil.invalid/v2/FAKE_KEY_123456',
  'https://robinhood-mainnet.g.alchemy.com/v2/FAKE_KEY_123456?leak=yes',
  'https://robinhood-mainnet.g.alchemy.com/v2/FAKE_KEY_123456#leak',
  'https://user:password@robinhood-mainnet.g.alchemy.com/v2/FAKE_KEY_123456',
  'https://robinhood-mainnet.g.alchemy.com/v2/%0AFAKE_KEY_123456',
  'https://robinhood-testnet.g.alchemy.com/v2/FAKE_KEY_123456',
  'https://robinhood-mainnet.g.alchemy.com/v2/',
  null
])bad(()=>assertArchiveEndpoint(url),/CONFIG_INVALID/);
assert.equal(ARCHIVE_SCHEMA,'PONS_S1_ARCHIVE_PROVIDER_SAMPLE_V1');
assert.equal(PROVIDER,'ALCHEMY_ROBINHOOD_MAINNET_CANDIDATE');
assert.equal(OFFICIAL,'https://rpc.mainnet.chain.robinhood.com');
assert.deepEqual([...HISTORIC_OFFSETS],[1000n,10000n]);
assert.deepEqual(historicBlockHeights(26841846n),
  [26842846n,26851846n]);
const range=recentRange(26900000n,26900001n,26841846n);
assert.equal(range.from,26899981n);
assert.equal(range.through,26899996n);
assert.equal(range.through-range.from+1n,16n);
bad(()=>recentRange(26900000n,26899800n,26841846n),
  /RECENT_HEAD_LAG/);
bad(()=>recentRange(26841848n,26841848n,26841846n),
  /HEIGHT_UNAVAILABLE/);
const fakeRpc=new Error('SECRET_API_KEY=never-write-this');
fakeRpc.name='HttpRequestError';fakeRpc.status=429;
assert.equal(classifyArchiveFailure(fakeRpc),'RPC_RATE_LIMIT');
assert.ok(!classifyArchiveFailure(fakeRpc).includes('SECRET'));
const timeout=new Error('SECRET_API_KEY=never-write-this');
timeout.name='TimeoutError';
assert.equal(classifyArchiveFailure(timeout),'RPC_TIMEOUT');
const base=createArchiveReceipt({fromBlock:26841846n,runId:'12345'});
bad(()=>historicBlockHeights(26841847n),/FACTORY_EPOCH_NOT_PINNED/);
assert.equal(base.moneyAuthorized,false);
assert.equal(base.backendIndependenceQualified,false);
assert.equal(base.state,'NOT_RUN');
assert.equal(validateArchiveReceipt(base).qualification,false);
const empty=selectLatestNative([],[],
  '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e');
assert.equal(empty.allCount,0);
assert.equal(empty.nativeCount,0);
const complete={...base,
  testedHistoricalSamples:2,officialHistoricHeadersCompared:2,
  recentFactoryEvents:0,recentNativeEvents:0,
  factoryTranscriptDigest:empty.digest,
  recentSourcesAgree:true,historicStateSamplesPassed:true,
  sampledArchiveReadCapacity:true,
  state:'ARCHIVE_SAMPLE_HEADERS_MATCHED_ONLY',
  finishedAtUtc:'2026-09-27T12:00:00.000Z'};
assert.equal(validateArchiveReceipt(complete).qualification,false);
assert.equal(validateArchiveReceipt({...complete,
  officialHistoricHeadersCompared:1,
  state:'ARCHIVE_SAMPLE_ONLY_REFERENCE_UNAVAILABLE'}).qualification,false);
bad(()=>validateArchiveReceipt({...complete,
  officialHistoricHeadersCompared:1}),
  /HISTORIC_REFERENCE_HEADERS_REQUIRED/);
bad(()=>validateArchiveReceipt({...complete,
  state:'ARCHIVE_SAMPLE_ONLY_REFERENCE_UNAVAILABLE'}),
  /MISSING_REFERENCE_MUST_REMAIN_EXPLICIT/);
bad(()=>validateArchiveReceipt({...complete,
  backendIndependenceQualified:true}),/FORBIDDEN_PROMOTION/);
bad(()=>validateArchiveReceipt({...complete,
  moneyAuthorized:true}),/FORBIDDEN_PROMOTION/);
bad(()=>validateArchiveReceipt({...complete,
  scientificallyAdmissible:true}),/FORBIDDEN_PROMOTION/);
bad(()=>validateArchiveReceipt({...complete,
  secretRpcUrl:sample}),/RECEIPT_FIELD_INJECTION/);
bad(()=>validateArchiveReceipt({...complete,
  factoryTranscriptDigest:'0x'+empty.digest}),/factoryTranscriptDigest/);
bad(()=>validateArchiveReceipt({...complete,
  recentSourcesAgree:false}),/RECENT_PARITY_REQUIRED/);
bad(()=>validateArchiveReceipt({...complete,
  state:'ARCHIVE_UNVERIFIED'}),/UNVERIFIED_CANNOT_PROMOTE_CAPABILITY/);
bad(()=>validateArchiveReceipt({...complete,
  historicalSampleBlocks:['26842847','26851846']}),
  /SAMPLE_HEIGHTS_NOT_PINNED/);
bad(()=>validateArchiveReceipt({...complete,
  failureStage:'https://secret.example/v2/KEY'}),/UNSAFE_FAILURE_STAGE/);
bad(()=>validateArchiveReceipt({...complete,
  failureClass:'SECRET_API_KEY=never-write-this'}),/UNSAFE_FAILURE_CLASS/);
console.log(JSON.stringify({verdict:'PONS_S1_ARCHIVE_PROBE_OFFLINE_PASS',
  adversarialNegatives:rejected,actualRpc:false,credentialsUsed:false,
  moneyAuthorized:false}));
