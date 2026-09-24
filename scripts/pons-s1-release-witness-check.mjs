import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BATCH_SCHEMA, digest } from './pons-s1-collector-core.mjs';
import { buildGitHubImmutableWitness, canonicalBatchBytes } from './pons-s1-release-witness-core.mjs';

const launchTime = Date.parse('2026-10-01T12:00:00Z');
const body = {
  schemaVersion:BATCH_SCHEMA,
  phase:'PENDING_EXTERNAL_IMMUTABLE_SEAL',
  batchIndex:0,selectionCount:1,seenFactoryEventCount:1,
  specSha256:'a'.repeat(64),activationDigest:'b'.repeat(64),
  scannedFrom:'100',scannedThrough:'100',capturedAtMs:launchTime+20_000,
  newEvents:[{eventKey:'100:0x'+'1'.repeat(64)+':0',blockNumber:'100',
    logIndex:0,token:'0x'+'c'.repeat(40),launchTimestampMs:launchTime}],
  enrolledEventKeys:['100:0x'+'1'.repeat(64)+':0'],
  enrolledTokenAddresses:['0x'+'c'.repeat(40)],
  outcomesRead:false
};
const batch={...body,batchDigest:digest(body)};
const bytes=canonicalBatchBytes(batch);
const sum=createHash('sha256').update(bytes).digest('hex');
const tag='pons-s1-batch-'+batch.batchDigest;
const repo='CipherCuttle/sentry-forensic-gate';
const api='https://api.github.com/repos/'+repo;
const www='https://github.com/'+repo;
const uploaded='2026-10-01T12:01:00Z';
const published='2026-10-01T12:02:00Z';
const activationSha='a'.repeat(40);
const name=tag+'.json';
const asset={id:987,url:api+'/releases/assets/987',name,
  browser_download_url:www+'/releases/download/'+tag+'/'+name,
  state:'uploaded',size:bytes.length,digest:'sha256:'+sum,
  created_at:uploaded,updated_at:uploaded};
const release={id:432,url:api+'/releases/432',tag_name:tag,draft:false,
  immutable:true,published_at:published,assets:[asset]};
const tagRef={ref:'refs/tags/'+tag,url:api+'/git/refs/tags/'+tag,
  object:{type:'commit',sha:activationSha}};
const fixture={
  expectedBatchDigest:batch.batchDigest, expectedReleaseId:432,
  expectedAssetId:987,expectedActivationCommitSha:activationSha,
  release,asset,tagRef,assetBytes:bytes
};
function rejects(changes, code) {
  assert.throws(()=>buildGitHubImmutableWitness({...fixture,...changes}),code);
}
const success=buildGitHubImmutableWitness(fixture);
assert.equal(success.seal.batchDigest,batch.batchDigest);
assert.equal(success.seal.immutable,true);
assert.equal(success.witness.moneyAuthority,false);
assert.equal(success.witness.scientificAuthority,
  'NONE_UNTIL_CANONICAL_ACTIVATION_AND_INDEPENDENT_COHORT_COMPLETENESS');
rejects({release:{...release,immutable:false}},/PONS_S1_RELEASE_NOT_IMMUTABLE/);
rejects({release:{...release,immutable:'true'}},/PONS_S1_RELEASE_NOT_IMMUTABLE/);
rejects({release:{...release,draft:true}},/PONS_S1_RELEASE_NOT_PUBLISHED/);
rejects({release:{...release,tag_name:'reused-tag'}},/PONS_S1_RELEASE_TAG_MISMATCH/);
rejects({release:{...release,url:'https://evil.example/releases/432'}},
  /PONS_S1_RELEASE_REPOSITORY_MISMATCH/);
rejects({tagRef:{...tagRef,object:{type:'commit',sha:'d'.repeat(40)}}},
  /PONS_S1_RELEASE_TAG_WRONG_ACTIVATION_COMMIT/);
rejects({tagRef:{...tagRef,object:{type:'tag',sha:activationSha}}},
  /PONS_S1_RELEASE_REQUIRES_LIGHTWEIGHT_CANONICAL_TAG/);
rejects({asset:{...asset,digest:'sha256:'+'f'.repeat(64)}},
  /PONS_S1_RELEASE_ASSET_API_DIGEST_MISMATCH/);
rejects({asset:{...asset,size:bytes.length+1}},
  /PONS_S1_RELEASE_ASSET_SIZE_MISMATCH/);
rejects({release:{...release,assets:[asset,asset]}},
  /PONS_S1_RELEASE_REQUIRES_EXACT_ONE_ASSET/);
rejects({release:{...release,assets:[{...asset,digest:'sha256:'+'d'.repeat(64)}]}},
  /PONS_S1_RELEASE_ASSET_TWO_ENDPOINT_DISAGREEMENT/);
rejects({asset:{...asset,updated_at:'2026-10-01T12:03:00Z'}},
  /PONS_S1_RELEASE_ASSET_CHANGED_AFTER_PUBLICATION/);
rejects({asset:{...asset,state:'starter'}},
  /PONS_S1_RELEASE_ASSET_NOT_UPLOADED/);
rejects({asset:{...asset,url:'https://api.github.com/repos/other/releases/assets/987'}},
  /PONS_S1_ASSET_REPOSITORY_MISMATCH/);
rejects({release:{...release,published_at:'2026-10-01T12:05:00Z'}},
  /PONS_S1_RELEASE_PUBLISHED_AFTER_FIRST_OUTCOME/);
rejects({release:{...release,published_at:'2026-10-01T12:05:00+00:00'}},
  /PONS_S1_RELEASE_PUBLISHED_AT_NOT_UTC/);
rejects({assetBytes:Buffer.from(bytes.toString('utf8')+' ')},
  /PONS_S1_ASSET_NOT_VALID_BATCH_JSON|PONS_S1_ASSET_NOT_EXACT_CANONICAL_BATCH_BYTES/);
rejects({assetBytes:Buffer.from(bytes.toString('utf8').replace('"outcomesRead":false',
  '"outcomesRead":true'))},/PONS_S1_ASSET_NOT_EXACT_CANONICAL_BATCH_BYTES|PONS_S1_BATCH_DIGEST_MISMATCH|Expected values to be strictly equal/);
rejects({expectedBatchDigest:'1'.repeat(64)},/PONS_S1_BATCH_DIGEST_NOT_OPERATOR_FROZEN/);
const fakeOnly={...asset,url:api+'/releases/assets/988'};
rejects({asset:fakeOnly},/PONS_S1_ASSET_REPOSITORY_MISMATCH/);
console.log(JSON.stringify({verdict:'PONS_S1_IMMUTABLE_WITNESS_OFFLINE_PASS',
  positive:1,negative:20,providerCalls:0,realReleasePublished:false,
  liveMoneyAuthority:false,cohortActivated:false}));
