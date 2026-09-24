// Outcome-blind, PR-only audit. Single-RPC block timing cannot promote S1.
import assert from 'node:assert/strict';
export const FEASIBILITY_SCHEMA='PONS_S1_PREACTIVATION_FEASIBILITY_V1';
export const REAL_TIMELINE_SCHEMA='PONS_S1_END_TO_END_REHEARSAL_CANDIDATE_V1';
export const EARLIEST_FIVE_MINUTE_MS=300_000;
export const FROZEN_RESERVE_MS=90_000;
const SHA=/^[a-f0-9]{40}$/;
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const integer=(v,label)=>assert.ok(Number.isSafeInteger(v)&&v>0,label+'_MUST_BE_POSITIVE_INTEGER');
function externalUpper(utc,label){
  assert.match(String(utc??''),UTC,label+'_UTC_REQUIRED');
  const value=Date.parse(utc);
  integer(value,label);
  assert.equal(new Date(value).toISOString().slice(0,19),
    utc.slice(0,19),label+'_UTC_INVALID_CALENDAR_DATE');
  // Conservative end of reported GitHub timestamp interval.
  return value+(/\.\d+Z$/.test(utc)?1:1000);
}
const missingRealEvidence=[
  'INDEPENDENT_ARCHIVE_RPC_AUTHENTICITY_AND_QUOTE_PARITY',
  'REAL_FACTORY_CENSUS_AND_ACTUAL_DUAL_RPC_C0_QUOTE_TIMING',
  'REVIEWED_POINT_IN_TIME_INCLUSION_LATENCY_MAPPING',
  'FULL_SOURCE_SIDECAR_AND_NATIVE_UNKNOWN_BATCH_COMMITMENT',
  'ORIGINAL_PREOUTCOME_ARTIFACT_AND_IMMUTABLE_SOURCE_RELEASE',
  'ORIGINAL_PREOUTCOME_PAIRED_BATCH_RELEASE_AND_INDEPENDENT_WITNESS',
  'COMPLETE_CURVE_V4_ENTRY_EXIT_ROUTE_AND_EXECUTION_COSTS',
  'INDEPENDENT_OUTCOME_BLIND_RATE_EFFECT_AND_CLUSTER_POWER_REVIEW',
  'REVIEWED_CANONICAL_PROTOCOL_AND_SEPARATE_ACTIVATION_AUTHORITY'
];
// Candidate timestamp JSON is NOT independent authentication or actual fills.
export function evaluateCandidateEndToEndTiming(t){
  if(t===null)return {state:'NOT_MEASURED',deadlineWithReserve:null,
    causalTimelineQualified:false,scientificallyAdmissible:false};
  assert.equal(t?.schemaVersion,REAL_TIMELINE_SCHEMA,'WRONG_TIMELINE_SCHEMA');
  assert.equal(t.chainId,4663,'WRONG_CHAIN');
  assert.equal(t.deadlineReserveMs,FROZEN_RESERVE_MS,'RESERVE_NOT_FROZEN');
  const ms=['launchTimestampMs','launchDiscoveredAtMs',
    'dualFactoryVerifiedAtMs','c0QuoteCompletedAtMs',
    'inclusionTwelveConfirmedAtMs'];
  for(const k of ms)integer(t[k],k);
  assert.ok(t.launchTimestampMs<=t.launchDiscoveredAtMs &&
    t.launchDiscoveredAtMs<=t.dualFactoryVerifiedAtMs &&
    t.dualFactoryVerifiedAtMs<=t.c0QuoteCompletedAtMs,
    'NONCAUSAL_C0_TIMELINE');
  assert.ok(t.c0QuoteCompletedAtMs<=t.inclusionTwelveConfirmedAtMs,
    'INCLUSION_CONFIRMED_BEFORE_C0');
  const originalUpper=externalUpper(t.originalArtifactCreatedAtUtc,'ORIGINAL_ARTIFACT');
  const sourceAssetUpper=externalUpper(t.immutableSourceAssetCreatedAtUtc,'SOURCE_ASSET');
  const sourceUpper=externalUpper(t.immutableSourceReleasePublishedAtUtc,'SOURCE_RELEASE');
  const batchAssetUpper=externalUpper(t.immutableBatchAssetCreatedAtUtc,'BATCH_ASSET');
  const batchUpper=externalUpper(t.immutableBatchReleasePublishedAtUtc,'BATCH_RELEASE');
  const witnessUpper=externalUpper(t.independentWitnessArtifactCreatedAtUtc,'WITNESS_ARTIFACT');
  assert.ok(t.c0QuoteCompletedAtMs<=originalUpper &&
    originalUpper<=sourceAssetUpper && sourceAssetUpper<=sourceUpper &&
    sourceUpper<=batchAssetUpper && batchAssetUpper<=batchUpper &&
    batchUpper<=witnessUpper,'NONCAUSAL_EXTERNAL_PUBLICATION');
  assert.ok(t.inclusionTwelveConfirmedAtMs<=batchAssetUpper,
    'BATCH_ASSET_BEFORE_INCLUSION_FINALITY');
  const deadline=t.launchTimestampMs+EARLIEST_FIVE_MINUTE_MS;
  const completeUpper=Math.max(t.inclusionTwelveConfirmedAtMs,witnessUpper);
  const slack=deadline-completeUpper;
  return {state:slack>FROZEN_RESERVE_MS?
      'CANDIDATE_WINDOW_OBSERVED_REQUIRES_INDEPENDENT_PROOF':
      'REHEARSAL_DEADLINE_FAILED',
    deadlineWithReserve:slack>FROZEN_RESERVE_MS,
    launchDeadlineMs:deadline,latestCriticalPathUpperMs:completeUpper,
    worstCaseSlackMs:slack,reserveMs:FROZEN_RESERVE_MS,
    causalTimelineQualified:false,scientificallyAdmissible:false};
}
// Illustrative ONLY: no qualified S1 native-C0 rate/variance/ICC estimate.
export function illustrativePairedMde({n=200,clusters=7,icc=0}={}){
  integer(n,'SAMPLE_CAP');integer(clusters,'TIME_CLUSTERS');
  assert.ok(clusters<=n,'MORE_CLUSTERS_THAN_OBSERVATIONS');
  assert.ok(typeof icc==='number'&&Number.isFinite(icc)&&icc>=0&&icc<=1,
    'ICC_OUT_OF_RANGE');
  const designEffect=1+(n/clusters-1)*icc;
  const effectiveN=n/designEffect;
  return {assumption:'EQUAL_SIZE_TIME_CLUSTERS_GAUSSIAN_APPROXIMATION_ONLY',
    n,clusters,icc,designEffect,effectiveN,
    illustrativeStandardizedMde:
      (2.5758293035489004+0.8416212335729143)/Math.sqrt(effectiveN),
    alphaIllustrativeTwoSided:0.01,powerIllustrative:0.8,
    jointEndpointPowerEstablished:false,economicEffectUsdEstablished:false};
}
export function auditS1Preactivation(e){
  assert.equal(e?.schemaVersion,FEASIBILITY_SCHEMA,'WRONG_FEASIBILITY_SCHEMA');
  const p=e.pilot;
  assert.equal(p?.evidenceClass,
    'PR_ONLY_SINGLE_OFFICIAL_RPC_BLOCK_CADENCE_PROXY','PILOT_WRONG_PROVENANCE');
  assert.equal(p.chainId,4663);
  integer(p.githubRunId,'GITHUB_RUN_ID');
  assert.match(p.headSha??'',SHA,'PILOT_HEAD_SHA');
  integer(p.observedConfirmationElapsedMs,'PILOT_CONFIRMATION_ELAPSED');
  integer(p.confirmedSlackMs,'PILOT_CONFIRMATION_SLACK');
  assert.equal(p.externalArtifactWindowWithReserve,true,
    'PILOT_EXTERNAL_TIMESTAMP_MISSING');
  for(const key of ['actualC0QuotesMeasured','independentArchiveRpcMeasured',
    'immutableSourceReleaseMeasured','batchReleaseMeasured',
    'independentSourceWitnessMeasured','scientificallyAdmissible']){
    assert.equal(p[key],false,'SINGLE_PROVIDER_PROXY_CANNOT_PROVE_'+key);
  }
  assert.equal(e.powerCalibration?.qualifiedProspectiveArrivalRate,null,
    'UNREVIEWED_ENROLLMENT_RATE_MUST_REMAIN_UNKNOWN');
  assert.equal(e.powerCalibration?.pairedNetUsdSd,null,
    'UNREVIEWED_PAIRED_VARIANCE_MUST_REMAIN_UNKNOWN');
  assert.equal(e.powerCalibration?.absoluteNetUsdSd,null,
    'UNREVIEWED_ABSOLUTE_VARIANCE_MUST_REMAIN_UNKNOWN');
  assert.equal(e.powerCalibration?.meaningfulEconomicEffectUsd,null,
    'UNREVIEWED_EFFECT_THRESHOLD_MUST_REMAIN_UNKNOWN');
  assert.equal(e.authority?.collectionAuthorized,false);
  assert.equal(e.authority?.mergeAuthorized,false);
  assert.equal(e.authority?.liveMoneyAuthorized,false);
  const timing=evaluateCandidateEndToEndTiming(e.actualEndToEndRehearsal);
  const sensitivity=[0,0.05,0.10].map(icc=>
    illustrativePairedMde({n:200,clusters:7,icc}));
  return {schemaVersion:FEASIBILITY_SCHEMA,
    verdict:'BLOCKED_NOT_READY_FOR_ACTIVATION',
    pilot:{githubRunId:p.githubRunId,
      observedConfirmationElapsedMs:p.observedConfirmationElapsedMs,
      confirmedSlackMs:p.confirmedSlackMs,
      externalArtifactWindowWithReserve:p.externalArtifactWindowWithReserve,
      actualC0Measured:false},
    timing,sevenDayEligibleRateNeeded:200/7,sampleCap:200,sensitivity,
    powerQualified:false,independentEndToEndEvidenceQualified:false,
    missingRealEvidence,scientificState:'EDGE_UNPROVEN',
    mergeAuthority:false,collectionAuthority:false,liveMoneyAuthority:false};
}
