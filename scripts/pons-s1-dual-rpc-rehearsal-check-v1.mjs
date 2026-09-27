import assert from 'node:assert/strict';
import {SCHEMA,OFFICIAL,CANDIDATE,checkProviders,scanRange,
  selectLatestNative,checkQuoteParity,validateDiagnostic,
  newC0StageTrace,observeC0Adapter,safeC0Report}
  from './pons-s1-dual-rpc-rehearsal-core-v1.mjs';
const H=c=>'0x'+c.repeat(64),A=c=>'0x'+c.repeat(40);
const row=(n,pair=A('0'))=>({address:A('f'),blockNumber:BigInt(n),
  blockHash:H('a'),transactionHash:H('b'),logIndex:0,removed:false,
  args:{token:A('1'),curve:A('2'),deployer:A('3'),pairToken:pair,
    launchConfigId:1n,graduationThreshold:2n}});
assert.equal(checkProviders(OFFICIAL,CANDIDATE).backendIndependenceQualified,false);
const range=scanRange(26900000n,26900001n,26841846n);
assert.equal(range.from,26899741n);assert.equal(range.through,26899996n);
assert.equal(range.through-range.from+1n,256n);
const source=selectLatestNative([row(100),row(101,A('9'))],
  [row(100),row(101,A('9'))],A('f'));
assert.equal(source.allCount,2);assert.equal(source.nativeCount,1);
assert.equal(source.row.blockNumber,'100');
const leg=n=>({notionalUsdMicros:n,
  calibration:{baseAmount:10n},entry:{executable:true,amountOut:7n},
  reverse:{executable:true,amountOut:9n}});
const ladder=[250000n,500000n,1000000n,2000000n,5000000n];
const good={status:'COMPLETE',decisionBlock:102n,
  decisionBlockHash:H('a'),legs:ladder.map(leg)};
assert.equal(checkQuoteParity(good,structuredClone(good)).matchingNotionals,5);
const receipt={schemaVersion:SCHEMA,chainId:4663,
  secondProvider:'BLOCKREQ_PUBLIC_CANDIDATE',
  backendQualified:false,studyActivated:false,cohortEnrolled:false,
  sourcePublished:false,walletUsed:false,outcomesRead:false,
  scientificallyAdmissible:false,
  quoteParity:true,inclusion12:true,historicArchiveStateSample:true,
  state:'REAL_DUAL_RPC_QUOTE_REHEARSAL_ONLY'};
assert.equal(validateDiagnostic(receipt).edge,'UNPROVEN');
let neg=0;function bad(fn,pattern){assert.throws(fn,pattern);neg++;}
bad(()=>checkProviders(CANDIDATE,OFFICIAL),/OFFICIAL_RPC_PIN/);
bad(()=>checkProviders(OFFICIAL,OFFICIAL),/CANDIDATE_RPC_PIN/);
bad(()=>scanRange(26900000n,26899800n,26841846n),/HEAD_LAG/);
bad(()=>scanRange(26841850n,26841850n,26841846n),/NOT_ENOUGH/);
bad(()=>selectLatestNative([row(100)],[],A('f')),/DISAGREEMENT/);
bad(()=>selectLatestNative([row(100)],[row(100,A('9'))],A('f')),/DISAGREEMENT/);
bad(()=>checkQuoteParity({...good,status:'UNVERIFIED'},good),/OFFICIAL_BASELINE_UNVERIFIED/);
bad(()=>checkQuoteParity(good,{...good,legs:[]}),/SECOND_NOT_FIVE_NOTIONALS/);
bad(()=>checkQuoteParity(good,{...good,legs:good.legs.map(l=>({
  ...l,notionalUsdMicros:1000000n}))}),/SECOND_FROZEN_LADDER_DRIFT/);
bad(()=>checkQuoteParity(good,{...good,
  legs:good.legs.map(l=>({...l,entry:{...l.entry,amountOut:8n}}))}),
  /FROZEN_QUOTE_PARITY_FAILURE/);
for(const key of ['backendQualified','studyActivated','cohortEnrolled',
  'sourcePublished','walletUsed','outcomesRead','scientificallyAdmissible'])
  bad(()=>validateDiagnostic({...receipt,[key]:true}),/FORBIDDEN_PROMOTION/);
bad(()=>validateDiagnostic({...receipt,quoteParity:false}),/QUOTE_PARITY_REQUIRED/);
bad(()=>validateDiagnostic({...receipt,inclusion12:false}),/INCLUSION_FINALITY_REQUIRED/);
bad(()=>validateDiagnostic({...receipt,historicArchiveStateSample:false}),
  /HISTORIC_SAMPLE_REQUIRED/);
assert.equal(validateDiagnostic({...receipt,
  state:'RECENT_C0_ARCHIVE_UNVERIFIED',
  historicArchiveStateSample:false}).edge,'UNPROVEN');
bad(()=>validateDiagnostic({...receipt,
  state:'RECENT_C0_ARCHIVE_UNVERIFIED',historicArchiveStateSample:true}),
  /UNQUALIFIED_ARCHIVE_MUST_REMAIN_FALSE/);

const trace=newC0StageTrace();
const fakeAdapter={
  async calibrateUsd({notionalUsdMicros}){
    assert.equal(notionalUsdMicros,1000000n);
    const error=new Error('SECRET_API_KEY=must-not-escape');
    error.name='HttpRequestError';
    error.status=429;
    throw error;
  }
};
await assert.rejects(()=>observeC0Adapter(fakeAdapter,trace)
  .calibrateUsd({notionalUsdMicros:1000000n}),/SECRET_API_KEY/);
const safe=safeC0Report(trace,'ERROR');
assert.deepEqual(safe,{state:'ERROR',failedStage:'USD_CALIBRATION',
  lastCompletedStage:null,failureClass:'RPC_RATE_LIMIT',
  notionalUsdMicros:'1000000'});
assert.ok(!JSON.stringify(safe).includes('SECRET_API_KEY'));
const failed={...receipt,state:'C0_STAGE_FAIL',quoteParity:false,inclusion12:false,
  c0Official:safe,c0Candidate:{state:'COMPLETE',failedStage:null,
    lastCompletedStage:'ENTRY_QUOTE',failureClass:null,
    notionalUsdMicros:'1000000'}};
assert.equal(validateDiagnostic(failed).edge,'UNPROVEN');
bad(()=>validateDiagnostic({...failed,
  c0Official:{...safe,failureClass:'SECRET_API_KEY'}}),
  /BAD_C0_FAILURE_CLASS/);
bad(()=>validateDiagnostic({...failed,c0Official:{...safe,
  failedStage:'UNTRUSTED_DYNAMIC_STAGE'}}),/BAD_C0_DIAGNOSTIC_STAGE/);
bad(()=>validateDiagnostic({...failed,quoteParity:true}),
  /C0_ERROR_CANNOT_PROVE_QUOTE_PARITY/);
bad(()=>validateDiagnostic({...failed,
  c0Official:{...safe,state:'COMPLETE'}}),
  /C0_FAILURE_MUST_BE_OBSERVED/);

console.log(JSON.stringify({verdict:'PONS_S1_DUAL_RPC_OFFLINE_PASS',
  adversarialNegatives:neg,actualRPC:false,noMoney:true}));
