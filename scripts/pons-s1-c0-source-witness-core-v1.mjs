// Independent C0 source seal verification candidate. Pure validation only.
// Only a separately trusted main-only read-only workflow can acquire real
// GitHub REST payloads. Passing local fixtures does NOT establish provenance.
import assert from 'node:assert/strict';
import { sha256, canonical, checkAuthority } from './pons-s1-publisher-core-v1.mjs';
import { replayStoredC0Observation } from './pons-s1-c0-observer-core-v1.mjs';

export const C0_WITNESS_SCHEMA='PONS_S1_C0_EXTERNAL_SOURCE_WITNESS_V1';
export const REPO='CipherCuttle/sentry-forensic-gate';
const API='https://api.github.com/repos/'+REPO;
const HEX40=/^[0-9a-f]{40}$/;
const HEX64=/^[0-9a-f]{64}$/;
const UTC=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
const pos=(v,label)=>assert.ok(Number.isSafeInteger(v)&&v>0,label+'_POSITIVE_INTEGER');
function clock(iso,label){
  assert.match(iso??'',UTC,label+'_UTC_REQUIRED');
  const ms=Date.parse(iso);
  assert.ok(Number.isSafeInteger(ms)&&ms>0,label+'_BAD_DATE');
  // GitHub whole-second timestamps might represent any instant that second.
  return {ms,upper:ms+(/\.\d+Z$/.test(iso)?1:1000)};
}
function exactSource(raw){
  assert.ok(Buffer.isBuffer(raw),'RAW_SOURCE_BYTES_REQUIRED');
  assert.ok(raw.length>0&&raw.length<5_000_000,'SOURCE_BYTES_UNBOUNDED');
  const stored=JSON.parse(raw.toString('utf8'));
  const exact=Buffer.from(JSON.stringify(canonical(stored))+'\n');
  assert.ok(raw.equals(exact),'SOURCE_NONCANONICAL_BYTES');
  const replay=replayStoredC0Observation(stored);
  assert.equal(stored.evidence.noOutcomeReads,true,'OUTCOME_ACCESS_FORBIDDEN');
  assert.equal(stored.evidence.liveMoneyAuthority,false,'MONEY_AUTHORITY_FORBIDDEN');
  assert.equal(stored.receipt.sourceCapturedBeforeOutcome,true,'UNSEALED_LOCAL_C0_FLAG');
  return {stored,replay,sha256:sha256(raw)};
}
export function verifyIndependentC0SourceSeal(input){
  const {sourceBytes,originalSourceBytes,expectedSourceDigest,expectedArtifactId,
    expectedReleaseId,expectedAssetId,activationSha,sourceRun,sourceArtifacts,
    sourceRelease,sourceAsset,sourceTagRef,authority,protocol,
    activationCommit,mergePr,ancestry}=input;
  assert.match(expectedSourceDigest??'',HEX64,'EXPECTED_C0_DIGEST');
  assert.match(activationSha??'',HEX40,'APPROVED_ACTIVATION_SHA');
  checkAuthority(protocol,authority,activationSha);
  assert.equal(activationCommit?.sha,activationSha,'ACTIVATION_NOT_FETCHED_INDEPENDENTLY');
  assert.equal(activationCommit?.parents?.length,1,'ACTIVATION_PARENT_AMBIGUOUS');
  assert.equal(activationCommit.parents[0]?.sha,authority.reviewedMergeSha,
    'ACTIVATION_NOT_CHILD_OF_REVIEWED_MERGE');
  assert.equal(mergePr?.number,authority.reviewedMergePr,'WRONG_REVIEWED_PR');
  assert.ok(mergePr?.merged_at,'REVIEWED_PR_NOT_MERGED');
  assert.equal(mergePr.merge_commit_sha,authority.reviewedMergeSha,'REVIEWED_MERGE_SHA_WRONG');
  assert.equal(mergePr.base?.ref,'main','REVIEWED_MERGE_NOT_TO_MAIN');
  assert.ok(['ahead','identical'].includes(ancestry?.status),
    'ACTIVATION_NOT_MAIN_ANCESTOR');
  assert.equal(ancestry?.merge_base_commit?.sha,activationSha,
    'ACTIVATION_MERGE_BASE_WRONG');
  pos(expectedArtifactId,'EXPECTED_SOURCE_ARTIFACT_ID');
  pos(expectedReleaseId,'EXPECTED_RELEASE_ID');
  pos(expectedAssetId,'EXPECTED_RELEASE_ASSET_ID');
  const {stored,replay,sha256:assetDigest}=exactSource(sourceBytes);
  const other=exactSource(originalSourceBytes);
  assert.ok(sourceBytes.equals(originalSourceBytes),'ORIGINAL_ARTIFACT_VERSUS_IMMUTABLE_RELEASE_BYTES');
  assert.equal(replay.sourceObservationDigest,expectedSourceDigest,'SOURCE_DIGEST_NOT_OPERATOR_PINNED');
  assert.equal(other.replay.sourceObservationDigest,expectedSourceDigest,
    'ORIGINAL_SOURCE_DIGEST_MISMATCH');
  const e=stored.evidence;
  const deadline=e.event.launchTimestampMs+300_000;
  assert.ok(Number.isSafeInteger(deadline)&&deadline>0,'INVALID_LAUNCH_DEADLINE');
  assert.ok(e.capturedAtMs<deadline,'LOCAL_CAPTURE_AFTER_LAUNCH_FIVE_MINUTES');
  assert.equal(e.chainId,4663);
  const tag='pons-s1-c0-source-v1-'+expectedSourceDigest;
  const artifactName='pons-s1-c0-source-'+expectedSourceDigest;
  assert.equal(sourceRun?.id, input.expectedSourceRunId,'SOURCE_RUN_NOT_PINNED');
  assert.equal(sourceRun?.repository?.full_name,REPO,'SOURCE_WRONG_REPO');
  assert.equal(sourceRun?.head_repository?.full_name,REPO,'SOURCE_WRONG_HEAD_REPO');
  assert.equal(sourceRun?.head_sha,activationSha,'SOURCE_NOT_CANONICAL_ACTIVATION');
  assert.equal(sourceRun?.head_branch,'main','SOURCE_NOT_MAIN');
  assert.equal(sourceRun?.event,'workflow_dispatch','SOURCE_NOT_MANUAL');
  assert.equal(sourceRun?.status,'completed','SOURCE_RUN_UNFINISHED');
  assert.equal(sourceRun?.conclusion,'success','SOURCE_RUN_NOT_SUCCESS');
  assert.equal(sourceRun?.run_attempt,1,'SOURCE_RUN_RERUN_NOT_A_FRESH_SEAL');
  assert.equal(sourceRun?.path,'.github/workflows/pons-s1-prospective-collector-v1.yml',
    'SOURCE_WRONG_REVIEWED_WORKFLOW');
  pos(sourceRun?.id,'SOURCE_RUN_ID');
  const runCreated=clock(sourceRun.created_at,'SOURCE_RUN_CREATED');
  assert.ok(Array.isArray(sourceArtifacts?.artifacts),'SOURCE_ARTIFACT_LIST_REQUIRED');
  assert.ok(sourceArtifacts.total_count>=0&&sourceArtifacts.total_count<=100&&
    sourceArtifacts.total_count===sourceArtifacts.artifacts.length,
    'SOURCE_ARTIFACT_LIST_INCOMPLETE');
  const matches=sourceArtifacts.artifacts.filter(a=>a.name===artifactName);
  assert.equal(matches.length,1,'SOURCE_ARTIFACT_NOT_SINGLETON');
  const artifact=matches[0];
  assert.equal(artifact.id,expectedArtifactId,'SOURCE_ARTIFACT_ID_WRONG');
  assert.equal(artifact.expired,false,'SOURCE_ARTIFACT_EXPIRED');
  assert.equal(artifact.workflow_run?.id,sourceRun.id,'SOURCE_ARTIFACT_DIFFERENT_RUN');
  assert.equal(artifact.workflow_run?.head_sha,activationSha,'SOURCE_ARTIFACT_DIFFERENT_SHA');
  assert.equal(artifact.url,API+'/actions/artifacts/'+expectedArtifactId,
    'SOURCE_ARTIFACT_WRONG_REPO');
  const artifactCreated=clock(artifact.created_at,'SOURCE_ARTIFACT_CREATED');
  assert.ok(runCreated.ms<=artifactCreated.ms,'ARTIFACT_BEFORE_SOURCE_RUN');
  assert.ok(artifactCreated.ms>=e.capturedAtMs-30_000,'ARTIFACT_BEFORE_C0_CLOCK');
  assert.ok(artifactCreated.upper<deadline,'SOURCE_ARTIFACT_AFTER_FIRST_FIVE_MINUTE_OUTCOME');
  assert.equal(sourceRelease?.id,expectedReleaseId,'SOURCE_RELEASE_ID_WRONG');
  assert.equal(sourceRelease?.tag_name,tag,'SOURCE_RELEASE_TAG_WRONG');
  assert.equal(sourceRelease?.draft,false,'SOURCE_RELEASE_STILL_DRAFT');
  assert.equal(sourceRelease?.immutable,true,'SOURCE_RELEASE_NOT_IMMUTABLE');
  assert.equal(sourceRelease?.assets?.length,1,'SOURCE_RELEASE_NOT_SINGLETON');
  assert.equal(sourceRelease.assets[0]?.id,expectedAssetId,'SOURCE_RELEASE_ASSET_ID_WRONG');
  assert.equal(sourceTagRef?.ref,'refs/tags/'+tag,'SOURCE_RELEASE_TAG_REF_WRONG');
  assert.equal(sourceTagRef?.object?.type,'commit','SOURCE_TAG_NOT_LIGHTWEIGHT');
  assert.equal(sourceTagRef?.object?.sha,activationSha,'SOURCE_TAG_WRONG_ACTIVATION');
  assert.equal(sourceAsset?.id,expectedAssetId,'SOURCE_ASSET_ID_WRONG');
  assert.equal(sourceAsset?.name,tag+'.json','SOURCE_ASSET_NAME_WRONG');
  assert.equal(sourceAsset?.url,API+'/releases/assets/'+expectedAssetId,
    'SOURCE_ASSET_WRONG_REPOSITORY');
  assert.equal(sourceAsset?.size,sourceBytes.length,'SOURCE_ASSET_SIZE_WRONG');
  assert.equal(sourceAsset?.digest,'sha256:'+assetDigest,'SOURCE_RELEASE_BYTES_DIGEST_WRONG');
  assert.equal(sourceRelease.assets[0]?.digest,sourceAsset.digest,
    'SOURCE_RELEASE_ASSET_DIGEST_MISMATCH');
  const assetCreated=clock(sourceAsset.created_at,'RELEASE_ASSET_CREATED');
  const published=clock(sourceRelease.published_at,'SOURCE_RELEASE_PUBLISHED');
  assert.ok(artifactCreated.upper<=assetCreated.ms+1000,
    'ORIGINAL_SOURCE_ARTIFACT_POSTDATES_RELEASE_ASSET');
  assert.ok(assetCreated.upper<=published.upper+1000,
    'RELEASE_PUBLISHED_BEFORE_ASSET');
  assert.ok(published.upper<deadline,'SOURCE_RELEASE_AFTER_FIRST_FIVE_MINUTE_OUTCOME');
  assert.ok(published.upper>=artifactCreated.ms,'SOURCE_RELEASE_PREDATES_ORIGINAL_ARTIFACT');
  return {
    schemaVersion:C0_WITNESS_SCHEMA,sourceObservationDigest:expectedSourceDigest,
    rawSourceAssetSha256:assetDigest,eventKey:e.eventKey,
    launchBlock:e.launchBlock,observedC0CompletionHead:e.observedHeadBlock,
    c0Action:stored.receipt.action,sourceRunId:sourceRun.id,
    sourceArtifactId:artifact.id,originalArtifactCreatedAt:artifact.created_at,
    immutableReleaseId:sourceRelease.id,immutableReleaseAssetId:sourceAsset.id,
    immutableReleasePublishedAt:sourceRelease.published_at,
    reviewedMergeSha:authority.reviewedMergeSha,protocolDigest:authority.protocolDigest,
    earliestLaunchOutcomeMs:deadline,tag,activationSha,
    independentExternalPreoutcomeSealMetadataVerified:true,
    independentOnlyWhenFetchedByTrustedMainReadOnlyWorkflow:true,
    immutableAfterPublicationVerified:true,
    sourceProviderIndependenceVerified:false,
    fullFactoryCensusVerifiedBeyondTheSingleLaunchBlock:false,
    v1BatchDigestCommitsThisSidecar:false,
    scientificallyAdmissible:false,
    sourceQualified:false,liveMoneyAuthority:false,
    verdict:'EXTERNAL_C0_SEAL_METADATA_CONSISTENT_V2_COHORT_BINDING_STILL_BLOCKED'
  };
}
