// Pure diagnostic only: measured real chain block arrival is not simulated
// execution, C0 evidence or proof a five-minute GitHub release can be made.
import assert from 'node:assert/strict';
export const TIMING_SCHEMA='PONS_S1_READ_ONLY_CHAIN_TIMING_REHEARSAL_V1';
const hash=/^0x[0-9a-f]{64}$/i;
const positive=(n,label)=>assert.ok(Number.isSafeInteger(n)&&n>0,label+'_BAD_TIME');
const height=(s,label)=>{assert.match(s,/^(0|[1-9]\d*)$/,label+'_DECIMAL');return BigInt(s)};
function point(p,label){
  assert.ok(p&&typeof p==='object',label+'_MISSING');
  const h=height(p.blockNumber,label);
  assert.match(p.blockHash??'',hash,label+'_HASH');
  positive(p.timestampMs,label+'_BLOCK_TIME');
  positive(p.firstObservedAtMs,label+'_WALL_TIME');
  return h;
}
export function evaluateC0ChainTiming(input){
  const {chainId,launch,decision,mature,completed,inclusion,confirmed,
    sourceArtifactCreatedAt=null,deadlineReserveMs=90_000}=input;
  assert.equal(chainId,4663,'WRONG_CHAIN');
  assert.equal(deadlineReserveMs,90_000,'DEADLINE_BUFFER_MUST_REMAIN_FROZEN');
  const lh=point(launch,'LAUNCH'),dh=point(decision,'DECISION'),
    mh=point(mature,'MATURE'),ch=point(completed,'COMPLETION'),
    ih=point(inclusion,'INCLUSION'),fh=point(confirmed,'CONFIRMED');
  assert.equal(dh,lh+2n,'DECISION_NOT_LAUNCH_PLUS_TWO');
  assert.equal(mh,dh+2n,'C0_NOT_MATURE_AFTER_TWO_CONFIRMATIONS');
  assert.ok(ch>=mh,'C0_COMPLETED_BEFORE_MATURITY');
  assert.equal(ih,ch+2n,'INCLUSION_NOT_POST_C0_PLUS_TWO');
  assert.equal(fh,ih+12n,'INCLUSION_MISSING_TWELVE_CONFIRMATIONS');
  assert.ok(launch.timestampMs<=decision.timestampMs &&
    decision.timestampMs<=mature.timestampMs &&
    mature.timestampMs<=completed.timestampMs &&
    completed.timestampMs<=inclusion.timestampMs &&
    inclusion.timestampMs<=confirmed.timestampMs,'NONMONOTONIC_CHAIN_TIME');
  assert.ok(launch.firstObservedAtMs<=mature.firstObservedAtMs&&
    mature.firstObservedAtMs<=completed.firstObservedAtMs &&
    completed.firstObservedAtMs<=inclusion.firstObservedAtMs &&
    inclusion.firstObservedAtMs<=confirmed.firstObservedAtMs,
    'NONMONOTONIC_OBSERVER_TIME');
  const deadline=launch.timestampMs+300_000;
  const confirmedSlackMs=deadline-confirmed.firstObservedAtMs;
  let upper=null;
  if(sourceArtifactCreatedAt!==null){
    assert.match(sourceArtifactCreatedAt,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/,
      'SOURCE_ARTIFACT_UTC_REQUIRED');
    const start=Date.parse(sourceArtifactCreatedAt);
    positive(start,'SOURCE_ARTIFACT_CREATED');
    upper=start+(/\.\d+Z$/.test(sourceArtifactCreatedAt)?1:1000);
    assert.ok(upper>=confirmed.firstObservedAtMs-30_000,
      'ARTIFACT_PRECEDES_CHAIN_CONFIRMATION');
  }
  return {
    schemaVersion:TIMING_SCHEMA,chainId,launchBlock:launch.blockNumber,
    initialObservationDelayMs:launch.firstObservedAtMs-launch.timestampMs,
    observedConfirmationElapsedMs:confirmed.firstObservedAtMs-launch.firstObservedAtMs,
    deadlineMs:deadline,confirmedObservedAtMs:confirmed.firstObservedAtMs,
    confirmedSlackMs,confirmedWithReserve:confirmedSlackMs>deadlineReserveMs,
    externalRehearsalArtifactCreatedUpperMs:upper,
    artifactArrivedBeforeLaunchFiveMinutes:upper===null?null:upper<deadline,
    artifactWindowWithReserve:upper===null?null:upper+deadlineReserveMs<deadline,
    inclusionRequiresActualPostQuoteC0:true,
    realC0QuoteAcquisitionMeasured:false,independentArchiveRpcMeasured:false,
    releaseWriteLatencyMeasured:false,independentSourceWitnessLatencyMeasured:false,
    studyActivated:false,scientificAdmissibility:'BLOCKED',
    diagnosticVerdict:upper===null?'REAL_CHAIN_CONFIRMATIONS_ONLY_NO_PUBLICATION_PROOF':
      upper+deadlineReserveMs<deadline && confirmedSlackMs>deadlineReserveMs?
      'REHEARSAL_ARTIFACT_WINDOW_OBSERVED_NOT_PRODUCTION_FEASIBILITY':
      'REHEARSAL_DEADLINE_INFEASIBLE_IN_OBSERVED_WINDOW'
  };
}
