import assert from 'node:assert/strict';
import {SCHEMA,OFFICIAL,CANDIDATE,checkProviders,scanRange,
  selectLatestNative,checkQuoteParity,validateDiagnostic}
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
  quoteParity:true,inclusion12:true,state:'REAL_DUAL_RPC_QUOTE_REHEARSAL_ONLY'};
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
console.log(JSON.stringify({verdict:'PONS_S1_DUAL_RPC_OFFLINE_PASS',
  adversarialNegatives:neg,actualRPC:false,noMoney:true}));
