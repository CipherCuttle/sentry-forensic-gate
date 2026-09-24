// Synthetic only. Fixture does not constitute a real GitHub source release.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildC0Observation} from './pons-s1-c0-observer-core-v1.mjs';
import {verifyIndependentC0SourceSeal,REPO} from './pons-s1-c0-source-witness-core-v1.mjs';
import {AUTHORITY_SCHEMA,INCLUSION_RULE,canonical,digest,sha256} from './pons-s1-publisher-core-v1.mjs';

const H=c=>'0x'+c.repeat(64),A=c=>'0x'+c.repeat(40);
const origin=Date.parse('2026-10-01T12:00:00Z'),completed=origin+40_000;
const log={address:A('f'),blockNumber:100n,blockHash:H('a'),transactionHash:H('b'),
  logIndex:1,removed:false,args:{token:A('1'),curve:A('2'),deployer:A('3'),
  pairToken:A('0'),launchConfigId:1n,graduationThreshold:2n}};
const event={eventKey:'100:'+H('b')+':1',blockNumber:'100',blockHash:H('a'),
  transactionHash:H('b'),logIndex:1,token:A('1'),nativePair:true,launchTimestampMs:origin};
const points={launch:{number:'100',hash:H('a'),timestampMs:origin},
  decision:{number:'102',hash:H('c'),timestampMs:origin+20_000},
  observed:{number:'104',hash:H('d'),timestampMs:origin+40_000}};
const launch={chainId:4663,ecosystem:'ROBINHOOD',launchProtocol:'PONS',
  launchId:'SYNTHETIC',eventId:'SYNTHETIC',factory:A('f'),txHash:H('b'),
  blockNumber:100n,blockHash:H('a'),logIndex:1,token:A('1'),
  creator:A('3'),name:'synthetic',symbol:'SYN',sourceEventName:'TokenLaunched',
  observedAtMs:completed,sourceAuthority:{schema:'SYNTHETIC_ONLY',payload:{}}};
const baseline={baselineId:'synthetic',authorityDigest:'synthetic',
  launchId:'SYNTHETIC',policyVersion:'EXECUTABLE_BASELINE_R1',
  decisionBlock:102n,decisionBlockHash:H('c'),status:'COMPLETE',
  legs:[250000n,500000n,1000000n,2000000n,5000000n].map(notionalUsdMicros=>({
    notionalUsdMicros,entry:{executable:true},reverse:{executable:true}})),
  reverseSemantics:'INDEPENDENT_SAME_STATE_NOT_SEQUENTIAL',
  chainId:4663,ecosystem:'ROBINHOOD',launchProtocol:'PONS',
  observedAtMs:completed,market:null,sourceAuthority:{schema:'SYNTHETIC_ONLY',payload:{}}};
const control={policyVersion:'BUY_EVERY_EXECUTABLE_CONTROL_R1',
  decision:'ELIGIBLE',hypotheticalAction:'WOULD_TRADE',
  reasons:[],capacityUsdMicros:5000000n,
  capacitySemantics:'INDEPENDENT_PROBE_CAPACITY_NOT_SEQUENTIAL',
  mode:'SHADOW_ONLY',liveMoneyAuthority:false};
const obs=buildC0Observation({event,officialLog:log,archiveLog:structuredClone(log),
  officialFactoryBlockLogs:[log],archiveFactoryBlockLogs:[structuredClone(log)],
  officialPoints:points,archivePoints:structuredClone(points),expectedFactory:A('f'),
  launch,baseline,control,decisionBlock:points.decision,observedHead:points.observed,
  capturedAtMs:completed,officialRuntimeHash:H('e'),archiveRuntimeHash:H('e')});
const sourceBytes=Buffer.from(JSON.stringify(canonical(obs))+'\n');
const activationSha='a'.repeat(40),reviewedMergeSha='b'.repeat(40);
const protocol=JSON.parse(readFileSync(
  new URL('../docs/experiments/pons-s1-single-protocol-decision-v1.json',import.meta.url)));
protocol.status='CANONICAL_FROZEN_ACTIVE';protocol.timing.syntheticInclusionRule=INCLUSION_RULE;
const authority={schemaVersion:AUTHORITY_SCHEMA,status:'CANONICAL_SEPARATELY_APPROVED',
  protocolDigest:digest(protocol),reviewedMergeSha,reviewedMergePr:83,
  originBlockNumber:'100',originBlockHash:H('a'),activationDigest:'e'.repeat(64),
  publicationAuthorized:true,collectionAuthorized:true,liveMoneyAuthorized:false,
  signingAuthorized:false,broadcastAuthorized:false,modelPromotionAuthorized:false,
  unattendedAuthorized:false};
const expectedSourceDigest=obs.sourceObservationDigest;
const tag='pons-s1-c0-source-v1-'+expectedSourceDigest;
const artifactName='pons-s1-c0-source-'+expectedSourceDigest;
const base='https://api.github.com/repos/'+REPO;
const sourceRun={id:1001,repository:{full_name:REPO},
  head_repository:{full_name:REPO},head_sha:activationSha,head_branch:'main',
  event:'workflow_dispatch',status:'completed',conclusion:'success',run_attempt:1,
  path:'.github/workflows/pons-s1-prospective-collector-v1.yml',
  created_at:'2026-10-01T12:00:01Z'};
const artifact={id:2002,name:artifactName,expired:false,
  workflow_run:{id:1001,head_sha:activationSha},
  url:base+'/actions/artifacts/2002',created_at:'2026-10-01T12:01:00Z'};
const asset={id:3003,name:tag+'.json',url:base+'/releases/assets/3003',
  size:sourceBytes.length,digest:'sha256:'+sha256(sourceBytes),
  created_at:'2026-10-01T12:01:30Z'};
const release={id:4004,tag_name:tag,draft:false,immutable:true,
  published_at:'2026-10-01T12:02:00Z',assets:[asset]};
const full={
  sourceBytes,originalSourceBytes:Buffer.from(sourceBytes),
  expectedSourceDigest,expectedSourceRunId:1001,expectedArtifactId:2002,
  expectedReleaseId:4004,expectedAssetId:3003,activationSha,
  sourceRun,sourceArtifacts:{total_count:1,artifacts:[artifact]},
  sourceRelease:release,sourceAsset:asset,
  sourceTagRef:{ref:'refs/tags/'+tag,object:{type:'commit',sha:activationSha}},
  authority,protocol,
  activationCommit:{sha:activationSha,parents:[{sha:reviewedMergeSha}]},
  mergePr:{number:83,merged_at:'2026-09-30T12:00:00Z',
    merge_commit_sha:reviewedMergeSha,base:{ref:'main'}},
  ancestry:{status:'ahead',merge_base_commit:{sha:activationSha}}
};
const good=verifyIndependentC0SourceSeal(full);
assert.equal(good.sourceObservationDigest,expectedSourceDigest);
assert.equal(good.immutableAfterPublicationVerified,true);
assert.equal(good.sourceQualified,false);
assert.equal(good.scientificallyAdmissible,false);
let negative=0;
const reject=(name,patch,pattern)=>{
  assert.throws(()=>verifyIndependentC0SourceSeal({...full,...patch}),pattern,name);negative++;
};
reject('wrong pinned source digest',{expectedSourceDigest:'0'.repeat(64)},
  /SOURCE_DIGEST_NOT_OPERATOR_PINNED/);
reject('untrusted raw bytes',{sourceBytes:Buffer.concat([sourceBytes,Buffer.from(' ')])},
  /SOURCE_NONCANONICAL_BYTES/);
reject('original changed',{originalSourceBytes:Buffer.from('{}\n')},
  /STORED_SOURCE_EVIDENCE_OR_C0_RECEIPT_TAMPERED|SOURCE_OBSERVATION_MISSING/);
reject('wrong artifact id',{expectedArtifactId:7},/SOURCE_ARTIFACT_ID_WRONG/);
reject('artifact deleted',{sourceArtifacts:{total_count:1,artifacts:[
  {...artifact,expired:true}]}},/SOURCE_ARTIFACT_EXPIRED/);
reject('source artifact after outcome',{sourceArtifacts:{total_count:1,artifacts:[
  {...artifact,created_at:'2026-10-01T12:05:00Z'}]}},
  /SOURCE_ARTIFACT_AFTER_FIRST_FIVE_MINUTE_OUTCOME/);
reject('artifact duplicate',{sourceArtifacts:{total_count:2,artifacts:[artifact,artifact]}},
  /SOURCE_ARTIFACT_NOT_SINGLETON/);
reject('incomplete source artifact page',{sourceArtifacts:{total_count:2,artifacts:[artifact]}},
  /SOURCE_ARTIFACT_LIST_INCOMPLETE/);
reject('wrong artifact source SHA',{sourceArtifacts:{total_count:1,artifacts:[
  {...artifact,workflow_run:{id:1001,head_sha:'f'.repeat(40)}}]}},
  /SOURCE_ARTIFACT_DIFFERENT_SHA/);
reject('PR source instead of main',{sourceRun:{...sourceRun,head_branch:'some-pr'}},
  /SOURCE_NOT_MAIN/);
reject('source workflow rerun',{sourceRun:{...sourceRun,run_attempt:2}},
  /SOURCE_RUN_RERUN_NOT_A_FRESH_SEAL/);
reject('unreviewed source workflow',{sourceRun:{...sourceRun,path:'.github/workflows/test.yml'}},
  /SOURCE_WRONG_REVIEWED_WORKFLOW/);
reject('mutable release',{sourceRelease:{...release,immutable:false}},
  /SOURCE_RELEASE_NOT_IMMUTABLE/);
reject('release after outcome',{sourceRelease:{
  ...release,published_at:'2026-10-01T12:05:00Z'}},
  /SOURCE_RELEASE_AFTER_FIRST_FIVE_MINUTE_OUTCOME/);
reject('wrong released asset SHA',{sourceAsset:{...asset,digest:'sha256:'+'f'.repeat(64)}},
  /SOURCE_RELEASE_BYTES_DIGEST_WRONG/);
reject('wrong release tag',{sourceTagRef:{...full.sourceTagRef,
  object:{type:'commit',sha:'f'.repeat(40)}}},/SOURCE_TAG_WRONG_ACTIVATION/);
reject('missing canonical activation',{activationCommit:{
  sha:activationSha,parents:[{sha:'f'.repeat(40)}]}},
  /ACTIVATION_NOT_CHILD_OF_REVIEWED_MERGE/);
reject('wrong reviewed PR',{mergePr:{...full.mergePr,number:99}},
  /WRONG_REVIEWED_PR/);
reject('outcome-contaminated protocol',{protocol:{...protocol,status:'DRAFT_RECONCILED_NOT_ACTIVE'}},
  /DRAFT_PROTOCOL_CANNOT_PUBLISH/);
reject('incorrect ancestry',{ancestry:{status:'behind',merge_base_commit:{sha:activationSha}}},
  /ACTIVATION_NOT_MAIN_ANCESTOR/);
console.log(JSON.stringify({verdict:'PONS_S1_C0_EXTERNAL_WITNESS_OFFLINE_PASS',
  syntheticPositive:1,adversarialNegative:negative,realGitHubRelease:false,
  independentLiveCaptureAttested:false,scientificAdmissibility:'BLOCKED',
  liveMoneyAuthority:false}));
