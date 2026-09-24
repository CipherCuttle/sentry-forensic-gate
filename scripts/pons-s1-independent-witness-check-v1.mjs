#!/usr/bin/env node
// Synthetic V1 witness fixtures; never represent live source/GitHub provenance.
import assert from 'node:assert/strict';
import { BATCH_SCHEMA, AUTHORITY_SCHEMA, API, canonicalBatchBytes,
  digest, planPublication, verifyReadBack, validateBatch, sha256
} from './pons-s1-publisher-core-v1.mjs';
import { readFileSync } from 'node:fs';
import { buildV1IndependentWitness } from './pons-s1-independent-witness-core-v1.mjs';
const protocol = JSON.parse(readFileSync(
  new URL('../docs/experiments/pons-s1-single-protocol-decision-v1.json', import.meta.url)));
protocol.status = 'CANONICAL_FROZEN_ACTIVE'; // synthetic fixture ONLY
const A = 'a'.repeat(40), H = n => '0x' + n.repeat(64),
  T = n => '0x' + n.repeat(40);
const launch = Date.parse('2026-10-01T12:00:00Z');
const authority = {
  schemaVersion: AUTHORITY_SCHEMA, status:'CANONICAL_SEPARATELY_APPROVED',
  protocolDigest:digest(protocol),reviewedMergeSha:'b'.repeat(40),
  reviewedMergePr:79,originBlockNumber:'100',originBlockHash:H('1'),
  activationDigest:'e'.repeat(64),publicationAuthorized:true,
  collectionAuthorized:true,liveMoneyAuthorized:false,signingAuthorized:false,
  broadcastAuthorized:false,modelPromotionAuthorized:false,
  unattendedAuthorized:false
};
function candidate(index = 0) {
  const nonnative = {eventKey:'100:'+H('2')+':0',blockNumber:'100',
    blockHash:H('3'),transactionHash:H('2'),logIndex:0,
    token:T('4'),nativePair:false,launchTimestampMs:launch,c0:null,inclusion:null};
  const evidence = {schemaVersion:'SYNTHETIC_POINT_IN_TIME_C0',
    quoteBlock:'102',control:'WOULD_TRADE',source:'OFFLINE_FIXTURE_ONLY'};
  const native = {eventKey:'100:'+H('5')+':1',blockNumber:'100',
    blockHash:H('3'),transactionHash:H('5'),logIndex:1,
    token:T('6'),nativePair:true,launchTimestampMs:launch+1000,
    c0:{action:'WOULD_TRADE',decisionBlock:'102',decisionHash:H('7'),
      decidedAtMs:launch+20_000,evidence,evidenceSha256:digest(evidence)},
    inclusion:{blockNumber:'104',blockHash:H('8'),timestampMs:launch+40_000}};
  const census = [nonnative,native];
  const identities = census.map(x=>({eventKey:x.eventKey,blockHash:x.blockHash,
    token:x.token,nativePair:x.nativePair}));
  const digestAll = digest(identities);
  const body = {schemaVersion:BATCH_SCHEMA,phase:'FROZEN_PREOUTCOME_NO_RESULTS',
    protocolDigest:authority.protocolDigest,activationCommitSha:A,
    activationDigest:authority.activationDigest,batchIndex:index,previous:null,
    scanned:{originBlockNumber:'100',originBlockHash:H('1'),
      scanFromCursor:{blockNumber:'100',logIndex:0},
      scannedThrough:'100',scannedThroughHash:H('3'),
      nextCursor:{blockNumber:'101',logIndex:0},confirmedHeadBlock:'116',
      factoryEventsDigest:digestAll,officialEventsDigest:digestAll,
      archiveEventsDigest:digestAll},
    census,selectedEventKeys:[native.eventKey],cumulativeEligibleDecisions:1,
    capturedAtMs:launch+50_000,outcomesRead:false};
  return {...body,batchDigest:digest(body)};
}
const initial = candidate(), bytes = canonicalBatchBytes(initial);
const now = launch+60_000;
const plan = planPublication(bytes,protocol,authority,A,null,now);
assert.equal(plan.published,false);
assert.equal(plan.independentWitnessRequired,true);
assert.equal(plan.assetSha256,sha256(bytes));
assert.equal(plan.batchDigest,initial.batchDigest);
const when = '2026-10-01T12:02:00Z';
const uploaded = '2026-10-01T12:01:00Z';
const asset = {id:789,url:API+'/releases/assets/789',
  browser_download_url:'https://github.com/CipherCuttle/sentry-forensic-gate/releases/download/'+
    plan.tag+'/'+plan.assetName,name:plan.assetName,size:bytes.length,
  state:'uploaded',digest:'sha256:'+plan.assetSha256,
  created_at:uploaded,updated_at:uploaded};
const release = {id:456,url:API+'/releases/456',tag_name:plan.tag,
  immutable:true,draft:false,published_at:when,assets:[asset]};
const tagRef = {ref:'refs/tags/'+plan.tag,url:API+'/git/refs/tags/'+plan.tag,
  object:{type:'commit',sha:A}};
const good = verifyReadBack(plan,bytes,release,asset,tagRef);
assert.equal(good.independentWitness,false);
assert.equal(good.prospectiveEvidenceAdmissible,false);

const MERGED='2026-09-30T00:00:00Z';
const ACTIVATE='2026-09-30T01:00:00Z';
const sourceRun = {id:876,repository:{full_name:'CipherCuttle/sentry-forensic-gate'},
  head_repository:{full_name:'CipherCuttle/sentry-forensic-gate'},head_sha:A,
  head_branch:'main',path:'.github/workflows/pons-s1-prospective-collector-v1.yml',
  event:'workflow_dispatch',conclusion:'success',
  created_at:'2026-10-01T12:00:30Z'};
const sourceArtifacts = {total_count:1,artifacts:[{
  id:999,name:'pons-s1-frozen-batch-'+initial.batchDigest,expired:false,
  url:API+'/actions/artifacts/999',
  created_at:'2026-10-01T12:00:55Z',
  workflow_run:{id:sourceRun.id,head_sha:A}
}]};
const activationCommit={sha:A,parents:[{sha:authority.reviewedMergeSha}],
  commit:{committer:{date:ACTIVATE}}};
const mergePr={number:79,base:{ref:'main'},merged_at:MERGED,
  merge_commit_sha:authority.reviewedMergeSha};
const ancestry={status:'ahead',merge_base_commit:{sha:A}};
const pinned={
  batchBytes:bytes,sourceBatchBytes:bytes,protocol,authority,activationSha:A,
  expectedBatchDigest:initial.batchDigest,expectedReleaseId:456,
  expectedAssetId:789,release,asset,tagRef,
  activationCommit,mergePr,ancestry,sourceRun,sourceArtifacts
};
const verified=buildV1IndependentWitness(pinned);
assert.equal(verified.schemaVersion,'PONS_S1_PAIRED_IMMUTABLE_WITNESS_V1');
assert.equal(verified.sourceQualified,false);
assert.equal(verified.scientificAdmissibility,
  'BLOCKED_PENDING_SOURCE_ATTESTATION');
assert.equal(verified.fullHistoricalLineageAttested,false);
assert.equal(verified.tradeAuthority,false);
let negative=0;
function rejects(label,patch,reason) {
  assert.throws(()=>buildV1IndependentWitness({...pinned,...patch}),reason,label);
  negative++;
}
function clone(value){return structuredClone(value);}
rejects('operator wrong digest',{expectedBatchDigest:'f'.repeat(64)},
  /BATCH_NOT_OPERATOR_PINNED/);
rejects('wrong release id',{expectedReleaseId:333},/INDEPENDENT_RELEASE_ID_MISMATCH/);
rejects('wrong asset id',{expectedAssetId:333},/INDEPENDENT_ASSET_ID_MISMATCH/);
rejects('wrong release tag',{release:{...release,tag_name:'forged'}},
  /Expected values to be strictly equal/);
rejects('draft immutable badge',{release:{...release,draft:true}},
  /RELEASE_STILL_DRAFT/);
rejects('mutable release',{release:{...release,immutable:false}},
  /RELEASE_NOT_IMMUTABLE/);
rejects('late release',{release:{...release,published_at:'2026-10-01T12:05:01Z'}},
  /RELEASE_PUBLISHED_TOO_LATE/);
rejects('asset from another API',{asset:{...asset,url:'https://evil.test/fake'}},
  /Expected values to be strictly equal/);
rejects('metadata checksum forged',{asset:{...asset,digest:'sha256:'+'f'.repeat(64)}},
  /GITHUB_ASSET_DIGEST_MISMATCH/);
rejects('wrong activation commit',{activationCommit:{...activationCommit,sha:'d'.repeat(40)}},
  /ACTIVATION_SHA_NOT_INDEPENDENT/);
rejects('wrong parent',{activationCommit:{...activationCommit,parents:[{sha:'d'.repeat(40)}]}},
  /ACTIVATION_NOT_CHILD_OF_REVIEWED_MERGE/);
rejects('unmerged reviewed PR',{mergePr:{...mergePr,merged_at:null}},
  /REVIEWED_PR_NOT_MERGED/);
rejects('main ancestry forged',{ancestry:{...ancestry,merge_base_commit:{sha:'c'.repeat(40)}}},
  /ACTIVATION_NOT_CURRENT_MAIN_ANCESTOR/);
rejects('wrong source branch',{sourceRun:{...sourceRun,head_branch:'other'}},
  /SOURCE_RUN_NOT_MAIN/);
rejects('source wrong activation',{sourceRun:{...sourceRun,head_sha:'c'.repeat(40)}},
  /SOURCE_RUN_WRONG_ACTIVATION/);
rejects('source not reviewed workflow',{sourceRun:{...sourceRun,path:'unreviewed.yml'}},
  /SOURCE_RUN_UNREVIEWED_COLLECTOR/);
rejects('source run failed',{sourceRun:{...sourceRun,conclusion:'failure'}},
  /SOURCE_RUN_NOT_SUCCESS/);
rejects('missing source artifact',{sourceArtifacts:{total_count:0,artifacts:[]}},
  /SOURCE_ARTIFACT_MISSING_OR_DUPLICATE/);
rejects('duplicate source artifact',{sourceArtifacts:{total_count:2,
  artifacts:[sourceArtifacts.artifacts[0],sourceArtifacts.artifacts[0]]}},
  /SOURCE_ARTIFACT_MISSING_OR_DUPLICATE/);
rejects('source artifact expired',{sourceArtifacts:{...sourceArtifacts,
  artifacts:[{...sourceArtifacts.artifacts[0],expired:true}]}},
  /SOURCE_ARTIFACT_EXPIRED/);
rejects('artifact created too late',{sourceArtifacts:{...sourceArtifacts,
  artifacts:[{...sourceArtifacts.artifacts[0],
    created_at:'2026-10-01T12:05:02Z'}]}},
  /SOURCE_ARTIFACT_CREATED_AFTER_RELEASE_ASSET|SOURCE_ARTIFACT_CREATED_AFTER_OUTCOME/);
rejects('asset created before frozen batch',{asset:{...asset,
  created_at:'2026-10-01T11:58:00Z'}},
  /TWO_ENDPOINTS_DISAGREE|ASSET_PRECEDES_BATCH_CAPTURE/);
rejects('forged source artifact bytes',
  {sourceBatchBytes:Buffer.concat([bytes,Buffer.from(' ')])},
  /SOURCE_ARTIFACT_RAW_BYTES_DIFFER_FROM_IMMUTABLE_RELEASE/);
rejects('raw bytes altered',{batchBytes:Buffer.concat([bytes,Buffer.from(' ')])},
  /BATCH_NONCANONICAL_BYTES/);
// Fail at schema guard even if attacker recomputes the local hash, tag and
// GitHub checksum: the old V0 protocol is never accepted by the V1 witness.
{
  const old=clone(initial);old.schemaVersion='PONS_S1_PRE_OUTCOME_BATCH_V0';
  const {batchDigest,...p}=old;old.batchDigest=digest(p);
  const oldBytes=canonicalBatchBytes(old);
  const oldTag='pons-s1-paired-v1-batch-'+old.batchDigest;
  const oldAsset={...asset,name:oldTag+'.json',size:oldBytes.length,
    digest:'sha256:'+sha256(oldBytes),
    browser_download_url:'https://github.com/CipherCuttle/sentry-forensic-gate/releases/download/'+oldTag+'/'+oldTag+'.json'};
  const oldRelease={...release,tag_name:oldTag,assets:[oldAsset]};
  assert.throws(()=>buildV1IndependentWitness({...pinned,
    batchBytes:oldBytes,sourceBatchBytes:oldBytes,
    expectedBatchDigest:old.batchDigest,
    release:oldRelease,asset:oldAsset,
    tagRef:{...tagRef,ref:'refs/tags/'+oldTag,
      url:API+'/git/refs/tags/'+oldTag},
    sourceArtifacts:{total_count:1,artifacts:[{
      ...sourceArtifacts.artifacts[0],name:'pons-s1-frozen-batch-'+old.batchDigest
    }]}
  }),/LEGACY_BATCH_FORBIDDEN/);
  negative++;
}
console.log(JSON.stringify({verdict:'PONS_S1_V1_INDEPENDENT_WITNESS_OFFLINE_PASS',
  positive:1,negative,noNetwork:true,realReleaseRead:false,
  fullChainAncestry:false,sourceQualified:false,
  collectionAuthorized:false,liveMoneyAuthority:false}));
