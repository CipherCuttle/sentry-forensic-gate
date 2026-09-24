import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FEASIBILITY_SCHEMA,REAL_TIMELINE_SCHEMA,FROZEN_RESERVE_MS,
  auditS1Preactivation,evaluateCandidateEndToEndTiming,illustrativePairedMde}
  from './pons-s1-feasibility-core-v1.mjs';
const e=JSON.parse(readFileSync(new URL(
  '../docs/experiments/pons-s1-preactivation-feasibility-v1.json',
  import.meta.url),'utf8'));
const actual=auditS1Preactivation(e);
assert.equal(actual.schemaVersion,FEASIBILITY_SCHEMA);
assert.equal(actual.verdict,'BLOCKED_NOT_READY_FOR_ACTIVATION');
assert.equal(actual.pilot.observedConfirmationElapsedMs,8311);
assert.equal(actual.pilot.confirmedSlackMs,290826);
assert.equal(actual.timing.state,'NOT_MEASURED');
assert.equal(actual.sampleCap,200);
assert.ok(actual.sevenDayEligibleRateNeeded>28);
assert.equal(actual.powerQualified,false);
assert.equal(actual.missingRealEvidence.length,9);
assert.equal(actual.sensitivity[0].effectiveN,200);
assert.ok(actual.sensitivity[2].effectiveN<54);
const t=Date.parse('2026-10-01T12:00:00Z');
const cand={
  schemaVersion:REAL_TIMELINE_SCHEMA,chainId:4663,
  deadlineReserveMs:FROZEN_RESERVE_MS,launchTimestampMs:t,
  launchDiscoveredAtMs:t+5000,dualFactoryVerifiedAtMs:t+18000,
  c0QuoteCompletedAtMs:t+35000,inclusionTwelveConfirmedAtMs:t+90000,
  originalArtifactCreatedAtUtc:'2026-10-01T12:01:00Z',
  immutableSourceAssetCreatedAtUtc:'2026-10-01T12:01:10Z',
  immutableSourceReleasePublishedAtUtc:'2026-10-01T12:01:20Z',
  immutableBatchAssetCreatedAtUtc:'2026-10-01T12:01:35Z',
  immutableBatchReleasePublishedAtUtc:'2026-10-01T12:01:40Z',
  independentWitnessArtifactCreatedAtUtc:'2026-10-01T12:02:00Z'
};
assert.equal(evaluateCandidateEndToEndTiming(cand).state,
  'CANDIDATE_WINDOW_OBSERVED_REQUIRES_INDEPENDENT_PROOF');
assert.equal(evaluateCandidateEndToEndTiming(cand).scientificallyAdmissible,false);
assert.equal(evaluateCandidateEndToEndTiming({...cand,
  independentWitnessArtifactCreatedAtUtc:'2026-10-01T12:04:00Z'}).state,
  'REHEARSAL_DEADLINE_FAILED');
let hostile=0;
function bad(name,patch,pattern){
  assert.throws(()=>evaluateCandidateEndToEndTiming({...cand,...patch}),
    pattern,name);hostile++;
}
bad('wrong chain',{chainId:1},/WRONG_CHAIN/);
bad('reserve drift',{deadlineReserveMs:0},/RESERVE_NOT_FROZEN/);
bad('lookahead',{dualFactoryVerifiedAtMs:t+40000},/NONCAUSAL_C0_TIMELINE/);
bad('finality spoof',{inclusionTwelveConfirmedAtMs:t+20000},
  /INCLUSION_CONFIRMED_BEFORE_C0/);
bad('publication preceding C0',{
  originalArtifactCreatedAtUtc:'2026-10-01T12:00:10Z'},
  /NONCAUSAL_EXTERNAL_PUBLICATION/);
bad('source release preceding original',{
  immutableSourceReleasePublishedAtUtc:'2026-10-01T12:00:20Z'},
  /NONCAUSAL_EXTERNAL_PUBLICATION/);
bad('batch asset before finality',{
  immutableBatchAssetCreatedAtUtc:'2026-10-01T12:01:21Z',
  immutableBatchReleasePublishedAtUtc:'2026-10-01T12:01:22Z'},
  /BATCH_ASSET_BEFORE_INCLUSION_FINALITY/);
bad('missing source asset',{immutableSourceAssetCreatedAtUtc:null},
  /SOURCE_ASSET_UTC_REQUIRED/);
bad('source upload after publication',{
  immutableSourceAssetCreatedAtUtc:'2026-10-01T12:01:30Z'},
  /NONCAUSAL_EXTERNAL_PUBLICATION/);
bad('batch upload after publication',{
  immutableBatchAssetCreatedAtUtc:'2026-10-01T12:01:45Z'},
  /NONCAUSAL_EXTERNAL_PUBLICATION/);
bad('witness before batch',{
  independentWitnessArtifactCreatedAtUtc:'2026-10-01T12:01:20Z'},
  /NONCAUSAL_EXTERNAL_PUBLICATION/);
bad('invalid date',{
  originalArtifactCreatedAtUtc:'2026-13-01T12:01:00Z'},
  /ORIGINAL_ARTIFACT/);
bad('missing witness',{
  independentWitnessArtifactCreatedAtUtc:null},
  /WITNESS_ARTIFACT_UTC_REQUIRED/);
assert.throws(()=>illustrativePairedMde({n:200,clusters:7,icc:1.1}),
  /ICC_OUT_OF_RANGE/);hostile++;
assert.throws(()=>auditS1Preactivation({...e,
  pilot:{...e.pilot,actualC0QuotesMeasured:true}}),
  /SINGLE_PROVIDER_PROXY_CANNOT_PROVE_actualC0QuotesMeasured/);hostile++;
assert.throws(()=>auditS1Preactivation({...e,
  powerCalibration:{...e.powerCalibration,pairedNetUsdSd:0.02}}),
  /UNREVIEWED_PAIRED_VARIANCE_MUST_REMAIN_UNKNOWN/);hostile++;
assert.throws(()=>auditS1Preactivation({...e,
  authority:{...e.authority,liveMoneyAuthorized:true}}));hostile++;
console.log(JSON.stringify({verdict:'PONS_S1_PREACTIVATION_FEASIBILITY_OFFLINE_PASS',
  syntheticCandidate:1,deadlineRejection:1,hostileNegative:hostile,
  realChainPilotFromExistingRun:actual.pilot.githubRunId,
  realEndToEndMeasured:false,actualEconomicEdge:'UNPROVEN',
  activationAuthorized:false}));
