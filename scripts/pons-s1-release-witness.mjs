import assert from 'node:assert/strict';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { canonical } from './pons-s1-collector-core.mjs';
import { buildGitHubImmutableWitness } from './pons-s1-release-witness-core.mjs';

const [releaseFile,assetMetadataFile,tagRefFile,batchAssetFile,outputFile]=process.argv.slice(2);
if (!releaseFile||!assetMetadataFile||!tagRefFile||!batchAssetFile||!outputFile)
  throw new Error('USAGE: release-witness <release.json> <asset.json> <tagref.json> <asset.bin> <output.json>');
const uint=(value,label)=> {
  assert.match(value??'',/^[1-9]\d{0,14}$/,label+'_INVALID');
  return Number(value);
};
const expectedBatchDigest=process.env.PONS_S1_EXPECTED_BATCH_DIGEST;
const expectedActivationCommitSha=process.env.PONS_S1_EXPECTED_ACTIVATION_SHA;
assert.match(expectedBatchDigest??'',/^[a-f0-9]{64}$/,'PONS_S1_BATCH_DIGEST_INPUT_MISSING');
assert.match(expectedActivationCommitSha??'',/^[a-f0-9]{40}$/,'PONS_S1_ACTIVATION_SHA_INPUT_MISSING');
const [releaseBytes,assetBytesMetadata,tagBytes,batchBytes]=await Promise.all([
  readFile(releaseFile),readFile(assetMetadataFile),readFile(tagRefFile),
  readFile(batchAssetFile)
]);
const result=buildGitHubImmutableWitness({
  expectedBatchDigest,expectedActivationCommitSha,
  expectedReleaseId:uint(process.env.PONS_S1_EXPECTED_RELEASE_ID,'PONS_S1_RELEASE_ID'),
  expectedAssetId:uint(process.env.PONS_S1_EXPECTED_ASSET_ID,'PONS_S1_ASSET_ID'),
  release:JSON.parse(releaseBytes),asset:JSON.parse(assetBytesMetadata),
  tagRef:JSON.parse(tagBytes),assetBytes:batchBytes
});
const output={
  ...result,
  provenance:{
    releaseMetadataInputSha256:(await import('./pons-s1-collector-core.mjs')).sha256Bytes(releaseBytes),
    assetMetadataInputSha256:(await import('./pons-s1-collector-core.mjs')).sha256Bytes(assetBytesMetadata),
    tagMetadataInputSha256:(await import('./pons-s1-collector-core.mjs')).sha256Bytes(tagBytes),
    source:'GITHUB_API_PAYLOADS_NOT_INDEPENDENTLY_ATTESTED_BY_THIS_LOCAL_SCRIPT',
    workflowRunId:process.env.GITHUB_RUN_ID??null
  }
};
const destination=resolve(outputFile);
await mkdir(dirname(destination),{recursive:true});
const handle=await open(destination,'wx',0o600);
try {await handle.writeFile(JSON.stringify(canonical(output))+'\n');await handle.sync();}
finally {await handle.close();}
console.log(JSON.stringify({
  verdict:'PONS_S1_GITHUB_IMMUTABLE_RELEASE_PAYLOAD_VALIDATED',
  batchDigest:result.batch.batchDigest,releaseId:result.seal.releaseId,
  assetId:result.seal.assetId,publishedAtUtc:result.seal.publishedAtUtc,
  apiSourceIndependentOnlyWhenFetchedByTrustedReadOnlyWorkflow:true,
  collectionAuthority:false,sciencePromotion:false,liveMoneyAuthority:false
}));
