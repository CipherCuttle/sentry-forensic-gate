#!/usr/bin/env node
// Re-fetch THIS PR-only rehearsal's immutable-within-retention Actions artifact
// from GitHub. This is an external timestamp diagnostic, not a scientific seal.
import assert from 'node:assert/strict';
import {readFile,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {evaluateC0ChainTiming} from './pons-s1-c0-timing-core-v1.mjs';
const [root,out]=process.argv.slice(2);
assert.ok(root&&out,'USAGE: timing-artifact-witness <proof-dir> <exclusive-result.json>');
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request');
assert.equal(process.env.GITHUB_REPOSITORY,'CipherCuttle/sentry-forensic-gate');
const expectedId=Number(process.env.GITHUB_RUN_ID);
assert.ok(Number.isSafeInteger(expectedId)&&expectedId>0);
const sha=process.env.PONS_S1_PR_HEAD_SHA;
assert.match(sha??'',/^[a-f0-9]{40}$/);
const json=async name=>JSON.parse(await readFile(resolve(root,name),'utf8'));
const run=await json('workflow-run.json'), artifacts=await json('artifacts.json');
const original=await json('original/timing.json');
assert.equal(run.id,expectedId,'WRONG_GITHUB_REHEARSAL_RUN');
assert.equal(run.event,'pull_request','NON_PR_REHEARSAL');
assert.equal(run.head_sha,sha,'WRONG_REHEARSAL_COMMIT');
assert.equal(run.repository?.full_name,process.env.GITHUB_REPOSITORY,'WRONG_REPO');
assert.equal(run.path,'.github/workflows/pons-s1-c0-timing-rehearsal-v1.yml',
  'UNREVIEWED_REHEARSAL_WORKFLOW');
assert.equal(artifacts.total_count,artifacts.artifacts.length,'ARTIFACT_PAGE_INCOMPLETE');
const name='pons-s1-timing-rehearsal-'+String(expectedId);
const matching=artifacts.artifacts.filter(a=>a.name===name);
assert.equal(matching.length,1,'REHEARSAL_ARTIFACT_NOT_SINGLETON');
const artifact=matching[0];
assert.equal(artifact.workflow_run?.id,expectedId,'ARTIFACT_FROM_DIFFERENT_RUN');
assert.equal(artifact.workflow_run?.head_sha,sha,'ARTIFACT_FROM_DIFFERENT_SHA');
assert.equal(artifact.expired,false,'ARTIFACT_EXPIRED');
assert.ok(artifact.id>0,'ARTIFACT_ID_MISSING');
assert.ok(artifact.size_in_bytes>0,'ARTIFACT_EMPTY');
assert.equal(artifact.url,'https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+
  '/actions/artifacts/'+artifact.id,'ARTIFACT_WRONG_REPO');
assert.equal(original.provenance,'REAL_OFFICIAL_PUBLIC_RPC_SINGLE_PROVIDER_PR_ONLY');
assert.equal(original.anyFutureOutcomeRead,false);
assert.equal(original.actualC0DecisionMade,false);
assert.equal(original.anyNetworkWrites,false);
assert.equal(original.genuineProspectiveSample,false);
const recomputed=evaluateC0ChainTiming({
  chainId:original.chainId,launch:original.firstObservedBlock,
  decision:original.decisionBlock,mature:original.baselineMatureBlock,
  completed:original.dummyCompletionHead,inclusion:original.inclusionBlock,
  confirmed:original.confirmedBlock});
assert.equal(original.confirmedSlackMs,recomputed.confirmedSlackMs,
  'CHAIN_TIMING_REPORT_DRIFT');
const withUpload=evaluateC0ChainTiming({
  chainId:original.chainId,launch:original.firstObservedBlock,
  decision:original.decisionBlock,mature:original.baselineMatureBlock,
  completed:original.dummyCompletionHead,inclusion:original.inclusionBlock,
  confirmed:original.confirmedBlock,
  sourceArtifactCreatedAt:artifact.created_at});
const result={...withUpload,
  sourceArtifactId:artifact.id,sourceArtifactCreatedAt:artifact.created_at,
  verifiedRunId:expectedId,verifiedPrHead:sha,
  githubExternalTimestampForThisPrOnly:true,
  trustedMainImmutableC0SourceSeal:false,
  actualPreoutcomeC0Acquisition:false,
  actualReleasePublication:false,
  independentProviderAttestation:false,
  rehearsalOnly:true,scientificAdmissibility:'BLOCKED'};
const fd=await open(resolve(out),'wx',0o600);
try{await fd.writeFile(JSON.stringify(result)+'\n');await fd.sync();}finally{await fd.close();}
console.log(JSON.stringify({verdict:result.diagnosticVerdict,
  verifiedGitHubArtifactId:artifact.id,
  artifactWindowWithReserve:result.artifactWindowWithReserve,
  actualProspectiveC0:false,scientificallyAdmissible:false}));
