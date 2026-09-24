// PONS S1 paired immutable-release V1 witness: pure validation only.
// Network provenance requires the trusted main-only read-only Actions workflow.
import assert from 'node:assert/strict';
import { API, REPO, canonicalBatchBytes, digest, sha256,
  validateBatch, verifyReadBack
} from './pons-s1-publisher-core-v1.mjs';

export const WITNESS_SCHEMA = 'PONS_S1_PAIRED_IMMUTABLE_WITNESS_V1';
const HASH40 = /^[0-9a-f]{40}$/;
const HASH64 = /^[0-9a-f]{64}$/;
const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
const pos = (n, label) => assert.ok(Number.isSafeInteger(n) && n > 0, label);
function time(value,label) {
  assert.match(value,UTC,label+'_UTC_REQUIRED');
  const ms=Date.parse(value);
  assert.ok(Number.isSafeInteger(ms) && ms>0,label+'_INVALID');
  // GitHub timestamps are typically whole seconds. Never interpret the
  // beginning of that second as proof an outcome was still unknown.
  const upper=ms+(/\.\d+Z$/.test(value) ? 1 : 1000);
  return {ms,upper};
}
function parseExact(bytes,label) {
  assert.ok(Buffer.isBuffer(bytes),label+'_RAW_BUFFER_REQUIRED');
  assert.ok(bytes.length>0 && bytes.length<5_000_000,label+'_BOUNDS');
  let object;
  try {object=JSON.parse(bytes.toString('utf8'));}
  catch {throw new Error(label+'_INVALID_JSON');}
  assert.ok(bytes.equals(canonicalBatchBytes(object)),label+'_NONCANONICAL_BYTES');
  return object;
}
function releaseEnvelope(input,bytes,batch,tag,deadlineMs,activationSha,expectedReleaseId,expectedAssetId){
  const {release,asset,tagRef}=input;
  const name=tag+'.json', assetSha=sha256(bytes);
  const plan={tag,assetName:name,batchDigest:batch.batchDigest,
    activationCommitSha:activationSha,assetSha256:assetSha,deadlineMs};
  // Reuse the exact source-qualified publisher's invariant code, but obtain
  // metadata+bytes independently in the read-only job; never reuse its
  // self-reported readback receipt.
  const checked=verifyReadBack(plan,bytes,release,asset,tagRef);
  pos(expectedReleaseId,'EXPECTED_RELEASE_ID');
  pos(expectedAssetId,'EXPECTED_ASSET_ID');
  assert.equal(release.id,expectedReleaseId,'INDEPENDENT_RELEASE_ID_MISMATCH');
  assert.equal(asset.id,expectedAssetId,'INDEPENDENT_ASSET_ID_MISMATCH');
  assert.equal(release?.assets?.length,1,'RELEASE_NOT_SINGLETON');
  assert.equal(release.assets[0].id,asset.id,'RELEASE_ASSET_NOT_MATCHED');
  assert.equal(asset?.url,API+'/releases/assets/'+expectedAssetId);
  const created=time(asset.created_at,'ASSET_CREATED');
  const published=time(release.published_at,'RELEASE_PUBLISHED');
  assert.ok(created.ms>=batch.capturedAtMs-30_000,
    'ASSET_PRECEDES_BATCH_CAPTURE_BEYOND_CLOCK_SKEW');
  assert.ok(published.upper<deadlineMs,'RELEASE_AFTER_EARLIEST_OUTCOME');
  return {...checked,createdAt:created,publishedAt:published,
    assetSha256:assetSha};
}
function verifyCanonicalGitHubProof({authority,activationSha,activationCommit,
  mergePr,ancestry,sourceRun,sourceArtifacts},batch,deadlineMs,releaseCreatedMs){
  const repoUrl='https://github.com/'+REPO;
  assert.match(activationSha,HASH40);
  assert.equal(activationCommit?.sha,activationSha,'ACTIVATION_SHA_NOT_INDEPENDENT');
  assert.equal(activationCommit?.parents?.length,1,'ACTIVATION_PARENT_AMBIGUOUS');
  assert.equal(activationCommit.parents[0].sha,authority.reviewedMergeSha,
    'ACTIVATION_NOT_CHILD_OF_REVIEWED_MERGE');
  assert.equal(mergePr?.number,authority.reviewedMergePr,'REVIEWED_PR_ID_MISMATCH');
  assert.ok(mergePr.merged_at,'REVIEWED_PR_NOT_MERGED');
  assert.equal(mergePr.merge_commit_sha,authority.reviewedMergeSha,
    'REVIEWED_MERGE_COMMIT_MISMATCH');
  assert.equal(mergePr.base?.ref,'main','REVIEWED_MERGE_WRONG_BASE');
  assert.ok(['ahead','identical'].includes(ancestry?.status),
    'ACTIVATION_NOT_REACHABLE_FROM_MAIN');
  assert.equal(ancestry.merge_base_commit?.sha,activationSha,
    'ACTIVATION_NOT_CURRENT_MAIN_ANCESTOR');
  const merged=time(mergePr.merged_at,'MERGE_TIME');
  const activated=time(activationCommit.commit?.committer?.date,'ACTIVATION_COMMIT_TIME');
  assert.ok(activated.ms>=merged.ms,'ACTIVATION_PREDATES_REVIEWED_MERGE');
  assert.equal(sourceRun?.repository?.full_name,REPO,'SOURCE_RUN_WRONG_REPOSITORY');
  assert.equal(sourceRun?.head_repository?.full_name,REPO,
    'SOURCE_RUN_WRONG_HEAD_REPOSITORY');
  assert.equal(sourceRun?.head_sha,activationSha,'SOURCE_RUN_WRONG_ACTIVATION');
  assert.equal(sourceRun?.head_branch,'main','SOURCE_RUN_NOT_MAIN');
  assert.equal(sourceRun?.event,'workflow_dispatch','SOURCE_RUN_NOT_MANUAL');
  assert.equal(sourceRun?.conclusion,'success','SOURCE_RUN_NOT_SUCCESS');
  assert.equal(sourceRun?.path,
    '.github/workflows/pons-s1-prospective-collector-v1.yml',
    'SOURCE_RUN_UNREVIEWED_COLLECTOR');
  pos(sourceRun.id,'SOURCE_RUN_ID');
  assert.ok(Array.isArray(sourceArtifacts?.artifacts),'SOURCE_ARTIFACTS_UNAVAILABLE');
  assert.ok(sourceArtifacts.total_count<=100 &&
    sourceArtifacts.total_count===sourceArtifacts.artifacts.length,
    'SOURCE_ARTIFACT_LIST_INCOMPLETE');
  const wanted='pons-s1-frozen-batch-'+batch.batchDigest;
  const candidates=sourceArtifacts.artifacts.filter(a=>a.name===wanted);
  assert.equal(candidates.length,1,'SOURCE_ARTIFACT_MISSING_OR_DUPLICATE');
  const artifact=candidates[0];
  pos(artifact.id,'SOURCE_ARTIFACT_ID');
  assert.equal(artifact.expired,false,'SOURCE_ARTIFACT_EXPIRED');
  assert.equal(artifact.workflow_run?.id,sourceRun.id,
    'ARTIFACT_NOT_FROM_VERIFIED_SOURCE_RUN');
  assert.equal(artifact.workflow_run?.head_sha,activationSha,
    'ARTIFACT_NOT_FROM_ACTIVATION');
  assert.equal(artifact.url,API+'/actions/artifacts/'+artifact.id,
    'ARTIFACT_WRONG_REPOSITORY');
  const artifactCreated=time(artifact.created_at,'SOURCE_ARTIFACT_CREATED');
  assert.ok(artifactCreated.ms>=batch.capturedAtMs-30_000,
    'SOURCE_ARTIFACT_PRECEDES_CAPTURE');
  assert.ok(artifactCreated.upper<=releaseCreatedMs+1000,
    'SOURCE_ARTIFACT_CREATED_AFTER_RELEASE_ASSET');
  assert.ok(artifactCreated.upper<deadlineMs,
    'SOURCE_ARTIFACT_CREATED_AFTER_OUTCOME');
  const runCreated=time(sourceRun.created_at,'SOURCE_RUN_CREATED');
  assert.ok(runCreated.ms>=merged.ms,'SOURCE_RUN_PREDATES_VERIFIED_MERGE');
  assert.ok(runCreated.ms<=artifactCreated.ms+1000,
    'SOURCE_RUN_CREATED_AFTER_ARTIFACT');
  return {sourceRunId:sourceRun.id,sourceArtifactId:artifact.id,
    sourceArtifactCreatedAt:artifact.created_at,
    activationCommitSha:activationSha,reviewedMergeSha:authority.reviewedMergeSha,
    githubRepository:repoUrl};
}
function independentlyVerifyPrior(input,protocol,authority,activationSha,currentCaptureMs){
  const {previousBatchBytes,previousRelease,previousAsset,previousTagRef,
    expectedPreviousReleaseId,expectedPreviousAssetId}=input;
  const previousBatch=parseExact(previousBatchBytes,'PREVIOUS_BATCH');
  assert.equal(previousBatch.schemaVersion,
    'PONS_S1_PAIRED_PREOUTCOME_DECISION_BATCH_V1','PREVIOUS_WRONG_SCHEMA');
  assert.equal(previousBatch.phase,'FROZEN_PREOUTCOME_NO_RESULTS',
    'PREVIOUS_NOT_PREOUTCOME');
  assert.equal(previousBatch.outcomesRead,false,'PREVIOUS_OUTCOMES_PEEKED');
  assert.ok(Array.isArray(previousBatch.census),'PREVIOUS_CENSUS_MISSING');
  assert.equal(previousBatch.protocolDigest,authority.protocolDigest,
    'PREVIOUS_PROTOCOL_MISMATCH');
  assert.equal(previousBatch.activationCommitSha,activationSha,
    'PREVIOUS_ACTIVATION_MISMATCH');
  const payload={...previousBatch};delete payload.batchDigest;
  assert.equal(previousBatch.batchDigest,digest(payload),'PREVIOUS_BATCH_DIGEST_MISMATCH');
  const deadlines=previousBatch.census.flatMap(row=>row.nativePair ? [
    row.launchTimestampMs+300_000,
    ...(row.inclusion?[row.inclusion.timestampMs+300_000]:[])
  ] : []);
  const priorDeadline=deadlines.length?Math.min(...deadlines):
    previousBatch.capturedAtMs+600_000;
  const priorTag='pons-s1-paired-v1-batch-'+previousBatch.batchDigest;
  const priorProof=releaseEnvelope(
    {release:previousRelease,asset:previousAsset,tagRef:previousTagRef},
    previousBatchBytes,previousBatch,priorTag,priorDeadline,activationSha,
    expectedPreviousReleaseId,expectedPreviousAssetId);
  assert.ok(priorProof.publishedAt.upper<=currentCaptureMs,
    'PREVIOUS_IMMUTABLE_BATCH_PUBLISHED_AFTER_CURRENT_CAPTURE');
  return {batch:previousBatch,assetSha256:priorProof.assetSha256,
    releaseId:priorProof.releaseId,assetId:priorProof.assetId,
    publishedAtMs:priorProof.publishedAt.upper,
    independentLiveGitHubCheck:true};
}
export function buildV1IndependentWitness(input){
  const {batchBytes,sourceBatchBytes,protocol,authority,activationSha,expectedBatchDigest,
    expectedReleaseId,expectedAssetId,release,asset,tagRef,
    activationCommit,mergePr,ancestry,sourceRun,sourceArtifacts}=input;
  assert.match(expectedBatchDigest,HASH64,'EXPECTED_DIGEST_REQUIRED');
  assert.match(activationSha,HASH40,'EXPECTED_ACTIVATION_SHA_REQUIRED');
  const batch=parseExact(batchBytes,'BATCH');
  assert.ok(Buffer.isBuffer(sourceBatchBytes)&&sourceBatchBytes.equals(batchBytes),
    'SOURCE_ARTIFACT_RAW_BYTES_DIFFER_FROM_IMMUTABLE_RELEASE');
  assert.equal(batch.batchDigest,expectedBatchDigest,'BATCH_NOT_OPERATOR_PINNED');
  const prior=batch.batchIndex>0?
    independentlyVerifyPrior(input,protocol,authority,activationSha,batch.capturedAtMs):
    null;
  const structural=validateBatch(batch,protocol,authority,activationSha,
    prior,batch.capturedAtMs);
  const tag='pons-s1-paired-v1-batch-'+expectedBatchDigest;
  const envelope=releaseEnvelope({release,asset,tagRef},batchBytes,batch,
    tag,structural.deadline,activationSha,expectedReleaseId,expectedAssetId);
  const origin=verifyCanonicalGitHubProof({
    authority,activationSha,activationCommit,mergePr,ancestry,sourceRun,
    sourceArtifacts},batch,structural.deadline,envelope.createdAt.ms);
  return {schemaVersion:WITNESS_SCHEMA,repository:REPO,
    batchDigest:batch.batchDigest,protocolDigest:batch.protocolDigest,
    releaseId:envelope.releaseId,assetId:envelope.assetId,
    assetSha256:envelope.assetSha256,releaseTag:tag,
    publishedAtUtc:release.published_at,
    earliestPreOutcomeDeadlineMs:structural.deadline,
    deadlineKind:structural.deadlineKind,
    cumulativeEligibleDecisions:batch.cumulativeEligibleDecisions,
    witnessedFactoryRows:batch.census.length,
    priorImmediateReleaseIndependentlyChecked:batch.batchIndex>0,
    verifiedActivation:origin.activationCommitSha,
    verifiedMerge:origin.reviewedMergeSha,
    sourceRunId:origin.sourceRunId,
    sourceArtifactId:origin.sourceArtifactId,
    sourceArtifactCreatedAt:origin.sourceArtifactCreatedAt,
    releaseApiSha256:digest(release),assetApiSha256:digest(asset),
    tagApiSha256:digest(tagRef),
    sourceRunApiSha256:digest(sourceRun),
    authority:'READ_ONLY_EXTERNAL_RELEASE_AND_IMMEDIATE_LINEAGE_WITNESS',
    limitations:'NOT_INDEPENDENT_CHAIN_COMPLETENESS_OR_C0_TRUTH_OR_REAL_FILL',
    sourceQualified:false,scientificAdmissibility:'BLOCKED_PENDING_SOURCE_ATTESTATION',
    independentOnlyWhenInputsAcquiredByTrustedMainReadOnlyWorkflow:true,
    fullHistoricalLineageAttested:false,
    prospectiveCollectionAuthorizedByThisWitness:false,
    tradeAuthority:false,modelPromotionAuthorized:false};
}
