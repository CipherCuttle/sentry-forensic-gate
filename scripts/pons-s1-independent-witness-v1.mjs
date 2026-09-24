#!/usr/bin/env node
// Validate predownloaded, independently acquired GitHub REST payloads.
// Only the trusted main-only contents:read/actions:read workflow supplies
// external provenance; running locally on copied files proves payload shape.
import assert from 'node:assert/strict';
import { readFile, open, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { canonical } from './pons-s1-publisher-core-v1.mjs';
import { buildV1IndependentWitness } from './pons-s1-independent-witness-core-v1.mjs';

const [root,out] = process.argv.slice(2);
assert.ok(root && out,'USAGE: read-only-witness <independent-proofs-dir> <exclusive-output.json>');
assert.equal(process.env.GITHUB_REPOSITORY,'CipherCuttle/sentry-forensic-gate',
  'WITNESS_REQUIRES_TRUSTED_REPOSITORY');
assert.equal(process.env.GITHUB_REF,'refs/heads/main',
  'WITNESS_REQUIRES_MAIN_ONLY_WORKFLOW');
assert.match(process.env.PONS_S1_EXPECTED_BATCH_DIGEST??'',/^[0-9a-f]{64}$/);
assert.match(process.env.PONS_S1_ACTIVATION_SHA??'',/^[0-9a-f]{40}$/);
const id=(v,label)=>{
  assert.match(v??'',/^[1-9]\d{0,14}$/,label+'_BAD_INPUT');
  const n=Number(v);assert.ok(Number.isSafeInteger(n));return n;
};
const read = name => readFile(resolve(root,name));
const json = async name => JSON.parse(await read(name));
const batchBytes=await read('batch.json');
const frozenSourceBytes=await read('source/batch.json');
assert.ok(batchBytes.equals(frozenSourceBytes),
  'PUBLISHED_BYTES_DO_NOT_MATCH_ORIGINAL_FROZEN_SOURCE_ARTIFACT');
const protocol=await json('protocol.json');
const authority=await json('authority.json');
const batch=JSON.parse(batchBytes.toString('utf8'));
const sourceRun=await json('source-run.json');
const expectedSourceRun=id(process.env.PONS_S1_SOURCE_RUN_ID,'SOURCE_RUN');
assert.equal(sourceRun.id,expectedSourceRun,'WRONG_SOURCE_RUN_ID');
const proof={
  batchBytes,sourceBatchBytes:frozenSourceBytes,protocol,authority,
  activationSha:process.env.PONS_S1_ACTIVATION_SHA,
  expectedBatchDigest:process.env.PONS_S1_EXPECTED_BATCH_DIGEST,
  expectedReleaseId:id(process.env.PONS_S1_RELEASE_ID,'RELEASE'),
  expectedAssetId:id(process.env.PONS_S1_ASSET_ID,'ASSET'),
  release:await json('release.json'),
  asset:await json('asset.json'),
  tagRef:await json('tag.json'),
  activationCommit:await json('activation-commit.json'),
  mergePr:await json('merge-pr.json'),
  ancestry:await json('activation-to-main.json'),
  sourceRun,sourceArtifacts:await json('source-artifacts.json')
};
if (batch.batchIndex>0) {
  Object.assign(proof,{
    previousBatchBytes:await read('prior-batch.json'),
    previousRelease:await json('prior-release.json'),
    previousAsset:await json('prior-asset.json'),
    previousTagRef:await json('prior-tag.json'),
    expectedPreviousReleaseId:batch.previous?.releaseId,
    expectedPreviousAssetId:batch.previous?.assetId
  });
}
const result=buildV1IndependentWitness(proof);
const target=resolve(out);
await mkdir(dirname(target),{recursive:true});
const file=await open(target,'wx',0o600);
try{
  await file.writeFile(JSON.stringify(canonical({
    ...result,sourceAcquisition:'TRUSTED_MAIN_READ_ONLY_GITHUB_ACTIONS',
    witnessRunId:process.env.GITHUB_RUN_ID??null,
    headAtWitness:process.env.GITHUB_SHA??null
  }))+'\n');
  await file.sync();
}finally{await file.close();}
console.log(JSON.stringify({
  verdict:'PONS_S1_V1_INDEPENDENT_RELEASE_AND_IMMEDIATE_LINEAGE_WITNESS_PASS',
  batchDigest:result.batchDigest,releaseId:result.releaseId,
  assetId:result.assetId,sourceRunId:result.sourceRunId,
  scientificallyAdmissible:false,sourceQualified:false,
  collectionAuthority:false,liveMoneyAuthority:false}));
