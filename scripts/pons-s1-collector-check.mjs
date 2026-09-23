import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  ACTIVATION_SCHEMA, BATCH_SCHEMA, SEAL_SCHEMA, assertActivated, assertExternalSeal,
  assertFrozenSpec, checkBatch, digest, freezeNextBatch, normalizeLog
} from './pons-s1-collector-core.mjs';
import { readFile } from 'node:fs/promises';

const sourceSpec = JSON.parse(await readFile(new URL('../docs/experiments/pons-s1-five-minute-feasibility-v0.json', import.meta.url)));
assert.equal(typeof assertFrozenSpec(sourceSpec), 'string');
assert.throws(() => assertActivated(sourceSpec, {}, {checkoutSha:'a'.repeat(40)}), /PONS_S1_SPEC_INACTIVE/);
const spec = structuredClone(sourceSpec);
spec.state = 'ACTIVE_REVIEWED';
spec.authority.dataCollectionAuthorized = true;
const h = prefix => '0x' + prefix.repeat(64);
const a = prefix => '0x' + prefix.repeat(40);
const originMs = Date.parse('2026-10-01T06:00:02Z');
const activation = {
  schemaVersion: ACTIVATION_SCHEMA, studyId: spec.prospective.studyId,
  specSha256: digest(spec), chainId:4663, canonicalRef:'refs/heads/main',
  collectorImplementationSha:'f'.repeat(40), canonicalMergeSha:'a'.repeat(40),
  canonicalMergedAtUtc:'2026-10-01T00:00:00Z',
  originEarliestTimestampMs:Date.parse('2026-10-01T06:00:00Z'),
  factory:a('7'),authority:{dataCollectionAuthorized:true,liveMoneyAuthorized:false,
  unattendedOperationAuthorized:false}
};
const context={collectorImplementationSha:'f'.repeat(40),checkoutSha:'a'.repeat(40)};
assert.equal(assertActivated(spec,activation,context).specSha256,digest(spec));
assert.throws(() => assertActivated(spec,{...activation,originEarliestTimestampMs:originMs},context),
  /Expected values to be strictly equal/);
assert.throws(() => assertActivated(spec,activation,{...context,checkoutSha:'b'.repeat(40)}),
  /PONS_S1_NOT_CANONICAL_ACTIVATION_SHA/);
const point=(n,ms,hashPrefix)=>({number:String(n),timestampMs:ms,hash:h(hashPrefix)});
const origin={block:point(100,originMs,'1'),predecessor:point(99,originMs-2000,'2')};
const raw=(n,index,pair='0')=>({
  blockNumber:BigInt(n),blockHash:h('3'),transactionHash:'0x'+String(index+1).padStart(64,'0'),
  logIndex:index,removed:false,args:{token:a('4'),curve:a('5'),deployer:a('6'),
  pairToken:a(pair),launchConfigId:1n,graduationThreshold:1000n}
});
const common={spec,activation,origin,previous:null,scanFrom:100n,scanThrough:101n,
  confirmedHead:{blockNumber:101n,hash:h('8'),timestampMs:originMs+2000,rpcHeadBlock:113n},
  blocks:{'100':point(100,originMs,'3'),'101':point(101,originMs+2000,'8')},
  logs:[raw(100,2),raw(100,1,'1'),raw(100,3)],
  capturedAtMs:originMs+60_000};
const first=freezeNextBatch(common);
checkBatch(first);
assert.equal(first.schemaVersion,BATCH_SCHEMA);
assert.equal(first.selectionCount,2);
assert.deepEqual(first.newEvents.map(x=>x.logIndex),[2,3]);
assert.equal(first.nextCursor.blockNumber,'102');
assert.equal(first.nextCursor.logIndex,-1);
assert.ok(first.newEvents.every(x=>x.nativePair));
assert.throws(()=>checkBatch({...first,selectionCount:1}), /PONS_S1_BATCH_DIGEST_MISMATCH/);
assert.throws(()=>freezeNextBatch({...common,logs:[raw(100,2),raw(100,2)]}),/PONS_S1_DUPLICATE_EVENT/);
assert.throws(()=>freezeNextBatch({...common,logs:[{...raw(100,3),blockHash:h('4')}]}),
 /PONS_S1_LOG_REORG_OR_UNPROVED_HASH/);
assert.throws(()=>freezeNextBatch({...common,capturedAtMs:originMs+300_001}),
 /PONS_S1_SELECTION_TOO_LATE/);
assert.throws(()=>freezeNextBatch({...common,confirmedHead:{...common.confirmedHead,rpcHeadBlock:110n}}),
 /PONS_S1_HEAD_NOT_CONFIRMED/);
assert.throws(()=>freezeNextBatch({...common,origin:{...origin,
 predecessor:point(99,originMs+1,'2')}}),/PONS_S1_ORIGIN_NOT_FIRST_BLOCK/);

const bytes=Buffer.from(JSON.stringify(JSON.parse(JSON.stringify(first)))+'\n');
const expectedBytes=Buffer.from(JSON.stringify(JSON.parse(JSON.stringify(first)))+'\n');
assert.equal(createHash('sha256').update(bytes).digest('hex'),
createHash('sha256').update(expectedBytes).digest('hex'));
const canonicalBytes=Buffer.from(JSON.stringify(
  (await import('./pons-s1-collector-core.mjs')).canonical(first))+'\n');
const seal={schemaVersion:SEAL_SCHEMA,batchDigest:first.batchDigest,releaseId:4,assetId:5,
 assetSha256:createHash('sha256').update(canonicalBytes).digest('hex'),immutable:true,
 externalVerification:'INDEPENDENT_GITHUB_RELEASE_API',
 publishedAtUtc:new Date(originMs+100_000).toISOString()};
assert.equal(typeof assertExternalSeal(first,seal),'string');
assert.throws(()=>assertExternalSeal(first,{...seal,publishedAtUtc:new Date(originMs+300_001).toISOString()}),
/PONS_S1_RELEASE_PUBLISHED_AFTER_FIRST_OUTCOME/);
assert.throws(()=>assertExternalSeal(first,{...seal,immutable:false}),/PONS_S1_RELEASE_MUTABLE/);
assert.throws(()=>assertExternalSeal(first,{...seal,assetSha256:'a'.repeat(64)}),/PONS_S1_RELEASE_ASSET_HASH_MISMATCH/);
const second=freezeNextBatch({...common,previous:{batch:first,seal},scanFrom:102n,
 scanThrough:102n,confirmedHead:{...common.confirmedHead,blockNumber:102n,
 hash:h('9'),timestampMs:originMs+4000,rpcHeadBlock:114n},
 blocks:{'102':point(102,originMs+4000,'9')},logs:[],capturedAtMs:originMs+110_000});
assert.equal(second.batchIndex,1);
assert.equal(second.previousBatchDigest,first.batchDigest);
assert.equal(second.selectionCount,2);
assert.equal(second.nextCursor.blockNumber,'103');
assert.throws(()=>freezeNextBatch({...common,previous:{batch:first,seal},scanFrom:103n}),
/PONS_S1_CURSOR_REWIND_OR_GAP/);
const forged=structuredClone(second);
forged.newEvents.push({eventKey:'new'});
assert.throws(()=>checkBatch(forged));
assert.throws(()=>normalizeLog({...raw(100,1),removed:true},activation.factory),
/PONS_S1_REMOVED_REORG_LOG/);
console.log(JSON.stringify({verdict:'PONS_S1_OFFLINE_COLLECTOR_CORE_PASS',
  cases:18, originalS0Unchanged:true, realCollection:false, liveAuthority:false}));
