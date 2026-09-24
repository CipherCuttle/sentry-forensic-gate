#!/usr/bin/env node
// Main-only publisher transport CLI. GitHub API acquisition happens in the
// narrowly scoped workflow, not in this script. Missing authority fails closed.
import assert from 'node:assert/strict';
import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { API, BATCH_SCHEMA, canonicalBatchBytes, digest, planPublication,
  sha256, verifyReadBack
} from './pons-s1-publisher-core-v1.mjs';

const [mode, root, outputFile] = process.argv.slice(2);
assert.ok(['prepare','verify'].includes(mode),
  'USAGE: publisher-v1 prepare|verify <proof-directory> <exclusive-output-file>');
assert.ok(root && outputFile && resolve(root) !== resolve(outputFile));
const json = async name => JSON.parse(await readFile(resolve(root,name),'utf8'));
const optional = async name => {
  try {return await json(name);} catch(e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};
const bytes = await readFile(resolve(root,'batch.json'));
const protocol = await json('protocol.json');
const authority = await json('authority.json');
const activation = process.env.PONS_S1_ACTIVATION_SHA ?? '';
assert.match(activation,/^[a-f0-9]{40}$/,'ACTIVATION_INPUT_INVALID');
assert.equal(process.env.GITHUB_REPOSITORY, 'CipherCuttle/sentry-forensic-gate',
  'WRONG_REPOSITORY');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main',
  'MAIN_ONLY_PUBLICATION');
const sourceRun = await json('source-run.json');
const activationCommit = await json('activation-commit.json');
const mergePr = await json('merge-pr.json');
const ancestry = await json('activation-to-main.json');
assert.equal(sourceRun.repository?.full_name, 'CipherCuttle/sentry-forensic-gate');
assert.equal(sourceRun.path,
  '.github/workflows/pons-s1-prospective-collector-v1.yml',
  'UNREVIEWED_COLLECTOR_WORKFLOW');
assert.equal(sourceRun.event,'workflow_dispatch');
assert.equal(sourceRun.head_branch,'main','SOURCE_RUN_NOT_ON_CANONICAL_MAIN');
assert.equal(sourceRun.conclusion,'success');
assert.equal(sourceRun.head_sha,activation,'SOURCE_RUN_NOT_PINNED_TO_ACTIVATION');
assert.equal(activationCommit.sha,activation);
assert.ok(Array.isArray(activationCommit.parents) &&
  activationCommit.parents.length === 1, 'ACTIVATION_PARENT_AMBIGUOUS');
assert.equal(activationCommit.parents[0].sha, authority.reviewedMergeSha,
  'ACTIVATION_NOT_CHILD_OF_REVIEWED_MERGE');
assert.equal(mergePr.number,authority.reviewedMergePr);
if (mergePr.merged !== undefined) assert.equal(mergePr.merged,true);
assert.ok(mergePr.merged_at,'REVIEWED_PR_NOT_MERGED');
assert.equal(mergePr.merge_commit_sha,authority.reviewedMergeSha,
  'DIFFERENT_REVIEWED_MERGE');
assert.equal(mergePr.base?.ref,'main');
assert.equal(ancestry.merge_base_commit?.sha,activation,
  'ACTIVATION_NOT_MAIN_ANCESTOR');
assert.ok(['ahead','identical'].includes(ancestry.status),
  'MAIN_NOT_DESCENDED_FROM_ACTIVATION');
// The activation checkout must be the source run's approved commit. This job
// deliberately cannot manufacture activation or unlock collection.
const batch = JSON.parse(bytes.toString('utf8'));
let prior = null;
if (batch.batchIndex > 0) {
  const previousBytes = await readFile(resolve(root,'prior-batch.json'));
  const previousBatch = JSON.parse(previousBytes.toString('utf8'));
  assert.equal(previousBatch.schemaVersion,BATCH_SCHEMA,'PRIOR_LEGACY_BATCH');
  assert.ok(previousBytes.equals(canonicalBatchBytes(previousBatch)));
  const {batchDigest,...payload} = previousBatch;
  assert.equal(previousBatch.batchDigest,digest(payload),'PRIOR_BATCH_TAMPERED');
  const previousPointer = batch.previous;
  assert.equal(previousBatch.batchDigest,previousPointer?.batchDigest);
  const priorDeadlines=previousBatch.census.flatMap(row => row.nativePair ? [
    row.launchTimestampMs+300_000,
    ...(row.inclusion ? [row.inclusion.timestampMs+300_000] : [])
  ] : []);
  const earliest=priorDeadlines.length ? Math.min(...priorDeadlines) :
    previousBatch.capturedAtMs+600_000;
  const prevTag='pons-s1-paired-v1-batch-'+previousBatch.batchDigest;
  const priorPlan={tag:prevTag,batchDigest:previousBatch.batchDigest,
    assetName:prevTag+'.json',
    activationCommitSha:activation,assetSha256:sha256(previousBytes),
    deadlineMs:earliest};
  const priorReadBack=verifyReadBack(priorPlan,previousBytes,
    await json('prior-release.json'),await json('prior-asset.json'),
    await json('prior-tag.json'));
  assert.equal(priorReadBack.releaseId,previousPointer.releaseId);
  assert.equal(priorReadBack.assetId,previousPointer.assetId);
  assert.equal(priorReadBack.assetSha256,previousPointer.assetSha256);
  prior={batch:previousBatch,assetSha256:priorReadBack.assetSha256,
    releaseId:priorReadBack.releaseId,assetId:priorReadBack.assetId,
    publishedAtMs:Date.parse(priorReadBack.publishedAtUtc),
    independentLiveGitHubCheck:true};
} else {
  assert.equal(batch.previous,null);
  const unexpected=await optional('prior-release.json');
  assert.equal(unexpected,null,'GENESIS_WITH_INJECTED_PRIOR');
}
const plan=planPublication(bytes,protocol,authority,activation,prior,
  mode==='verify' ? batch.capturedAtMs : Date.now());
if (mode==='verify') {
  const frozenPlan=await json('frozen-plan.json');
  assert.deepEqual(frozenPlan,plan,'FROZEN_PLAN_CHANGED');
  const downloaded = await readFile(resolve(root,'downloaded-batch.json'));
  assert.ok(downloaded.equals(bytes), 'DOWNLOAD_NOT_EXACT_FROZEN_BYTES');
  const result=verifyReadBack(plan,downloaded,
    await json('release.json'),await json('asset.json'),
    await json('tag.json'));
  await exclusive(outputFile,{...result,runId:process.env.GITHUB_RUN_ID??null,
    proofStatus:'SELF_READBACK_NOT_INDEPENDENT_WITNESS'});
  console.log(JSON.stringify({verdict:'SELF_READBACK_VERIFIED_NOT_SCIENTIFIC',
    releaseId:result.releaseId,assetId:result.assetId,immutable:true,
    independentWitness:false,cohortActivation:false}));
} else {
  await exclusive(outputFile,plan);
  console.log(JSON.stringify({verdict:'FROZEN_TRANSPORT_PREFLIGHT_ONLY',
    batchDigest:plan.batchDigest,assetSha256:plan.assetSha256,
    deadlineMs:plan.deadlineMs,publicationAuthorizedByCanonicalManifest:true,
    independentWitness:false,noMoney:true}));
}
async function exclusive(file, value) {
  const f = await open(resolve(file),'wx',0o600);
  try {await f.writeFile(JSON.stringify(value)+'\n');await f.sync();}
  finally {await f.close();}
}
