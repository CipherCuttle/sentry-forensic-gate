import assert from 'node:assert/strict';

export const BINRAT_KILL_FAST_SCHEMA='BINRAT_KILL_FAST_V1';
export const FUNDING_OBSERVATION_SCHEMA='BINRAT_KILL_FAST_FUNDING_OBSERVATION_V1';
export const DEFAULT_HORIZON_MS=86_400_000;
export const MIN_CONTROL_ROWS=20;
export const MIN_SIGNAL_ROWS=5;
export const MIN_ADVERSE_ENRICHMENT=0.15;
export const MIN_WINNER_GAIN_RETENTION=0.80;
export const MIN_RETAINED_VALUE_LIFT=0.10;

const ADVERSE=new Set(['CATASTROPHIC_LOSS','EXIT_FAILURE','LIQUIDITY_COLLAPSE']);
const WIN=new Set(['NORMAL_WIN','FAT_TAIL_WIN']);

export function evaluateKillFast(input){
  const horizonMs=input.horizonMs??DEFAULT_HORIZON_MS;
  assert.ok(Number.isSafeInteger(horizonMs)&&horizonMs>0,'KILL_FAST_HORIZON_INVALID');
  const features=input.features.map(validateFeature);
  assertUnique(features.map(row=>row.launch.launchId),'KILL_FAST_DUPLICATE_FEATURE');
  const allOutcomes=input.outcomes.map(validateOutcome);
  assertUnique(allOutcomes.map(row=>row.launchId+':'+row.horizonMs),'KILL_FAST_DUPLICATE_OUTCOME');
  const outcomes=allOutcomes
    .filter(row=>row.horizonMs===horizonMs&&row.status==='COMPLETE');
  const outcomeByLaunch=new Map(outcomes.map(row=>[row.launchId,row]));
  const control=features
    .filter(feature=>feature.policyComparison?.receipts?.buyEveryExecutableControl?.hypotheticalAction==='WOULD_TRADE')
    .filter(feature=>outcomeByLaunch.has(feature.launch.launchId))
    .map(feature=>({feature,outcome:outcomeByLaunch.get(feature.launch.launchId)}));

  const creatorVetoed=control.filter(({feature})=>
    feature.policyComparison?.receipts?.r1?.hypotheticalAction!=='WOULD_TRADE');
  const creatorRetained=control.filter(row=>!creatorVetoed.includes(row));
  const creatorDiagnostic=compareVeto(control,creatorVetoed,creatorRetained);

  const fundingObservations=(input.fundingObservations??[]).map(validateFundingObservation);
  assertUnique(fundingObservations.map(row=>row.launchId),'KILL_FAST_DUPLICATE_FUNDING_LAUNCH');
  assertFundingBindings(features,fundingObservations);
  const fundingIndex=buildPointInTimeFundingIndex(fundingObservations);
  const fundingVetoed=control.filter(({feature})=>fundingIndex.recurrentLaunchIds.has(feature.launch.launchId));
  const fundingRetained=control.filter(row=>!fundingVetoed.includes(row));
  const fundingDiagnostic=fundingObservations.length
    ? compareVeto(control,fundingVetoed,fundingRetained)
    : null;

  const currentPolicyVerdict=creatorDiagnostic.vetoed.count<MIN_SIGNAL_ROWS
    ? 'KILL_CREATOR_MEMORY_V0_NO_DISCRIMINATION'
    : vetoVerdict(creatorDiagnostic);

  const fundingPolicyVerdict=fundingDiagnostic===null
    ? 'NOT_EVALUATED'
    : vetoVerdict(fundingDiagnostic);

  return {
    schemaVersion:BINRAT_KILL_FAST_SCHEMA,
    mode:'OFFLINE_DIAGNOSTIC_ONLY',
    horizonMs,
    liveMoneyAuthority:false,
    signingAuthority:false,
    broadcastAuthority:false,
    modelPromotionAuthority:false,
    inputCounts:{
      features:features.length,
      completeOutcomesAtHorizon:outcomes.length,
      controlWithOutcome:control.length,
      fundingObservations:fundingObservations.length
    },
    control:metrics(control),
    creatorMemoryV0:{
      verdict:currentPolicyVerdict,
      ...creatorDiagnostic
    },
    fundingRecurrenceV0:fundingDiagnostic===null?{
      verdict:fundingPolicyVerdict,
      status:'NOT_SUPPLIED'
    }:{
      verdict:fundingPolicyVerdict,
      status:'DIAGNOSTIC',
      recurrentSourceCount:fundingIndex.recurrentSourceCount,
      ...fundingDiagnostic
    },
    programVerdict:programVerdict({
      controlCount:control.length,
      creatorVerdict:currentPolicyVerdict,
      fundingVerdict:fundingPolicyVerdict,
      horizonMs
    }),
    boundaries:{
      retrospectiveCannotProveEdge:true,
      noParameterSearch:true,
      noOutcomeMayEnterFeatureInput:true,
      exactAddressOrFundingSourceIsNotHumanIdentity:true,
      nextPromotionIfAny:'SHORT_HORIZON_SHADOW_ONLY'
    }
  };
}

function programVerdict({controlCount,creatorVerdict,fundingVerdict,horizonMs}){
  if(controlCount<MIN_CONTROL_ROWS) return 'INCONCLUSIVE_INSUFFICIENT_CONTROL_COVERAGE';
  if(fundingVerdict==='PROMOTE_VETO_TO_SHORT_SHADOW') return 'PROMOTE_ONE_SHORT_HORIZON_SHADOW_TEST';
  if(fundingVerdict.startsWith('KILL_')&&horizonMs<=300_000) return 'KILL_INTELLIGENCE_TO_EXECUTION_SELECTOR_V0';
  if(creatorVerdict.startsWith('KILL_')) return 'KILL_CURRENT_AUTOBUY_POLICY_TEST_FUNDER_AT_5M_ONLY';
  return 'INCONCLUSIVE';
}

function vetoVerdict(diag){
  if(diag.control.count<MIN_CONTROL_ROWS) return 'INCONCLUSIVE_CONTROL_COVERAGE';
  if(diag.vetoed.count<MIN_SIGNAL_ROWS) return 'INCONCLUSIVE_SIGNAL_COVERAGE';
  if(diag.retained.count<MIN_SIGNAL_ROWS) return 'KILL_VETO_TOO_BROAD';
  const enrichment=diag.vetoed.adverseRate-diag.retained.adverseRate;
  const winnerRetention=diag.winnerGainRetention;
  const valueLift=diag.retained.meanTerminalValueUsdMicros/diag.control.meanTerminalValueUsdMicros-1;
  if(
    enrichment>=MIN_ADVERSE_ENRICHMENT &&
    winnerRetention!==null &&
    winnerRetention>=MIN_WINNER_GAIN_RETENTION &&
    valueLift>=MIN_RETAINED_VALUE_LIFT
  ) return 'PROMOTE_VETO_TO_SHORT_SHADOW';
  return 'KILL_VETO_NO_MATERIAL_SEPARATION';
}

function compareVeto(control,vetoed,retained){
  const c=metrics(control),v=metrics(vetoed),r=metrics(retained);
  const totalPositiveGain=positiveGain(control);
  const retainedPositiveGain=positiveGain(retained);
  return {
    control:c,
    vetoed:v,
    retained:r,
    vetoRate:c.count?v.count/c.count:null,
    adverseEnrichment:
      v.adverseRate===null||r.adverseRate===null?null:v.adverseRate-r.adverseRate,
    winnerGainRetention:totalPositiveGain>0?retainedPositiveGain/totalPositiveGain:null,
    retainedValueLift:
      c.meanTerminalValueUsdMicros>0?r.meanTerminalValueUsdMicros/c.meanTerminalValueUsdMicros-1:null
  };
}

function metrics(rows){
  const values=rows.map(({outcome})=>Number(outcome.grossExecutableValueUsdMicros));
  const returns=rows.map(({outcome})=>Number(outcome.grossExecutableReturnBps));
  const sorted=[...returns].sort((a,b)=>a-b);
  const classes={};
  for(const {outcome} of rows) classes[outcome.classification]=(classes[outcome.classification]??0)+1;
  const adverse=rows.filter(({outcome})=>ADVERSE.has(outcome.classification)).length;
  const wins=rows.filter(({outcome})=>WIN.has(outcome.classification)).length;
  return {
    count:rows.length,
    adverse,
    adverseRate:rows.length?adverse/rows.length:null,
    wins,
    classes,
    meanReturnBps:rows.length?returns.reduce((a,b)=>a+b,0)/rows.length:null,
    medianReturnBps:sorted.length?sorted[Math.floor((sorted.length-1)/2)]:null,
    meanTerminalValueUsdMicros:rows.length?values.reduce((a,b)=>a+b,0)/rows.length:null,
    totalTerminalValueUsdMicros:values.reduce((a,b)=>a+b,0)
  };
}

function positiveGain(rows){
  return rows.reduce((sum,{outcome})=>
    sum+Math.max(0,Number(outcome.grossExecutableValueUsdMicros)-Number(outcome.entryNotionalUsdMicros)),0);
}

function buildPointInTimeFundingIndex(rows){
  const ordered=[...rows].sort((a,b)=>
    BigInt(a.launchBlock)<BigInt(b.launchBlock)?-1:
    BigInt(a.launchBlock)>BigInt(b.launchBlock)?1:
    a.launchId.localeCompare(b.launchId));
  const priorBySource=new Map();
  const recurrentLaunchIds=new Set();
  const recurrentSources=new Set();
  for(const row of ordered){
    if(row.sourceAddress===null) continue;
    const source=row.sourceAddress.toLowerCase();
    const prior=priorBySource.get(source)??[];
    const distinctDeployers=new Set(prior.map(item=>item.deployer.toLowerCase()));
    const distinctLaunches=new Set(prior.map(item=>item.launchId));
    if(
      distinctDeployers.size>=1 &&
      distinctLaunches.size>=1 &&
      !distinctDeployers.has(row.deployer.toLowerCase())
    ){
      recurrentLaunchIds.add(row.launchId);
      recurrentSources.add(source);
    }
    prior.push(row);
    priorBySource.set(source,prior);
  }
  return {recurrentLaunchIds,recurrentSourceCount:recurrentSources.size};
}

function assertUnique(values,code){
  assert.equal(new Set(values).size,values.length,code);
}

function assertFundingBindings(features,rows){
  const featureByLaunch=new Map(features.map(feature=>[feature.launch.launchId,feature]));
  for(const row of rows){
    const feature=featureByLaunch.get(row.launchId);
    if(!feature) continue;
    assert.equal(row.deployer.toLowerCase(),feature.launch.creator.toLowerCase(),
      'KILL_FAST_FUNDING_DEPLOYER_MISMATCH');
    assert.equal(BigInt(row.launchBlock),BigInt(feature.launch.blockNumber),
      'KILL_FAST_FUNDING_BLOCK_MISMATCH');
  }
}

function validateFeature(feature){
  assert.equal(feature.schemaVersion,'PONS_S0_FEATURE_PACKET_V1','KILL_FAST_FEATURE_SCHEMA');
  assert.equal(feature.boundaries?.containsTargetLaunchFutureOutcome,false,'KILL_FAST_FEATURE_LOOKAHEAD');
  assert.equal(feature.boundaries?.liveMoneyAuthority,false,'KILL_FAST_FEATURE_LIVE_AUTHORITY');
  assert.match(feature.launch?.launchId??'',/^[0-9a-f]{64}$/,'KILL_FAST_FEATURE_LAUNCH_ID');
  assert.match(String(feature.launch?.blockNumber??''),/^(0|[1-9]\\d*)$/,'KILL_FAST_FEATURE_BLOCK');
  assert.match(feature.launch?.creator??'',/^0x[0-9a-f]{40}$/,'KILL_FAST_FEATURE_CREATOR');
  return feature;
}

function validateOutcome(outcome){
  assert.equal(outcome.schemaVersion,'PONS_S0_OUTCOME_PACKET_V1','KILL_FAST_OUTCOME_SCHEMA');
  assert.equal(outcome.boundaries?.forbiddenAsFeatureInput,true,'KILL_FAST_OUTCOME_FEATURE_LEAK');
  assert.equal(outcome.boundaries?.liveMoneyAuthority,false,'KILL_FAST_OUTCOME_LIVE_AUTHORITY');
  assert.match(outcome.launchId??'',/^[0-9a-f]{64}$/,'KILL_FAST_OUTCOME_LAUNCH_ID');
  return outcome;
}

function validateFundingObservation(row){
  assert.equal(row.schemaVersion,FUNDING_OBSERVATION_SCHEMA,'KILL_FAST_FUNDING_SCHEMA');
  assert.match(row.launchId,/^[0-9a-f]{64}$/,'KILL_FAST_FUNDING_LAUNCH_ID');
  assert.match(row.deployer,/^0x[0-9a-f]{40}$/,'KILL_FAST_FUNDING_DEPLOYER');
  assert.match(String(row.launchBlock),/^(0|[1-9]\d*)$/,'KILL_FAST_FUNDING_BLOCK');
  if(row.sourceAddress!==null) assert.match(row.sourceAddress,/^0x[0-9a-f]{40}$/,'KILL_FAST_FUNDING_SOURCE');
  assert.equal(row.postOutcomeEvidence,false,'KILL_FAST_FUNDING_LOOKAHEAD');
  assert.equal(row.liveMoneyAuthority,false,'KILL_FAST_FUNDING_LIVE_AUTHORITY');
  return row;
}
