#!/usr/bin/env node
// Synthetic-only offline qualification. No provider, release, activation or money.
import assert from 'node:assert/strict';
import { BATCH_SCHEMA, AUTHORITY_SCHEMA, API, canonicalBatchBytes,
  digest, planPublication, verifyReadBack, validateBatch, sha256
} from './pons-s1-publisher-core-v1.mjs';
import { readFileSync } from 'node:fs';
const protocol = JSON.parse(readFileSync(
  new URL('../docs/experiments/pons-s1-single-protocol-decision-v1.json', import.meta.url)));
protocol.status = 'CANONICAL_FROZEN_ACTIVE'; // synthetic fixture ONLY
const A = 'a'.repeat(40), H = n => '0x' + n.repeat(64),
  T = n => '0x' + n.repeat(40);
const launch = Date.parse('2026-10-01T12:00:00Z');
const authority = {
  schemaVersion: AUTHORITY_SCHEMA, status:'CANONICAL_SEPARATELY_APPROVED',
  protocolDigest:digest(protocol),reviewedMergeSha:'b'.repeat(40),
  reviewedMergePr:79,originBlockNumber:'100',originBlockHash:H('1'),
  activationDigest:'e'.repeat(64),publicationAuthorized:true,
  collectionAuthorized:true,liveMoneyAuthorized:false,signingAuthorized:false,
  broadcastAuthorized:false,modelPromotionAuthorized:false,
  unattendedAuthorized:false
};
function candidate(index = 0) {
  const nonnative = {eventKey:'100:'+H('2')+':0',blockNumber:'100',
    blockHash:H('3'),transactionHash:H('2'),logIndex:0,
    token:T('4'),nativePair:false,launchTimestampMs:launch,c0:null,inclusion:null};
  const evidence = {schemaVersion:'SYNTHETIC_POINT_IN_TIME_C0',
    quoteBlock:'102',control:'WOULD_TRADE',source:'OFFLINE_FIXTURE_ONLY'};
  const native = {eventKey:'100:'+H('5')+':1',blockNumber:'100',
    blockHash:H('3'),transactionHash:H('5'),logIndex:1,
    token:T('6'),nativePair:true,launchTimestampMs:launch+1000,
    c0:{action:'WOULD_TRADE',decisionBlock:'102',decisionHash:H('7'),
      decidedAtMs:launch+20_000,evidence,evidenceSha256:digest(evidence)},
    inclusion:{blockNumber:'104',blockHash:H('8'),timestampMs:launch+40_000}};
  const census = [nonnative,native];
  const identities = census.map(x=>({eventKey:x.eventKey,blockHash:x.blockHash,
    token:x.token,nativePair:x.nativePair}));
  const digestAll = digest(identities);
  const body = {schemaVersion:BATCH_SCHEMA,phase:'FROZEN_PREOUTCOME_NO_RESULTS',
    protocolDigest:authority.protocolDigest,activationCommitSha:A,
    activationDigest:authority.activationDigest,batchIndex:index,previous:null,
    scanned:{originBlockNumber:'100',originBlockHash:H('1'),
      scanFromCursor:{blockNumber:'100',logIndex:0},
      scannedThrough:'100',scannedThroughHash:H('3'),
      nextCursor:{blockNumber:'101',logIndex:0},confirmedHeadBlock:'116',
      factoryEventsDigest:digestAll,officialEventsDigest:digestAll,
      archiveEventsDigest:digestAll},
    census,selectedEventKeys:[native.eventKey],cumulativeEligibleDecisions:1,
    capturedAtMs:launch+30_000,outcomesRead:false};
  return {...body,batchDigest:digest(body)};
}
const initial = candidate(), bytes = canonicalBatchBytes(initial);
const now = launch+60_000;
const plan = planPublication(bytes,protocol,authority,A,null,now);
assert.equal(plan.published,false);
assert.equal(plan.independentWitnessRequired,true);
assert.equal(plan.assetSha256,sha256(bytes));
assert.equal(plan.batchDigest,initial.batchDigest);
const when = '2026-10-01T12:02:00Z';
const uploaded = '2026-10-01T12:01:00Z';
const asset = {id:789,url:API+'/releases/assets/789',
  browser_download_url:'https://github.com/CipherCuttle/sentry-forensic-gate/releases/download/'+
    plan.tag+'/'+plan.assetName,name:plan.assetName,size:bytes.length,
  state:'uploaded',digest:'sha256:'+plan.assetSha256,
  created_at:uploaded,updated_at:uploaded};
const release = {id:456,url:API+'/releases/456',tag_name:plan.tag,
  immutable:true,draft:false,published_at:when,assets:[asset]};
const tagRef = {ref:'refs/tags/'+plan.tag,url:API+'/git/refs/tags/'+plan.tag,
  object:{type:'commit',sha:A}};
const good = verifyReadBack(plan,bytes,release,asset,tagRef);
assert.equal(good.independentWitness,false);
assert.equal(good.prospectiveEvidenceAdmissible,false);
let negatives = 0;
function rejected(name, operation, expression) {
  assert.throws(operation, expression, name);
  negatives++;
}
function mutate(change, should, clock=now) {
  const b=structuredClone(initial);
  change(b);
  const {batchDigest,...payload}=b;
  b.batchDigest=digest(payload);
  rejected('invalid fixture',()=>planPublication(canonicalBatchBytes(b),
    protocol,authority,A,null,clock),should);
}
rejected('old 96 launch protocol',()=>planPublication(bytes,
  {...protocol,status:'DRAFT_RECONCILED_NOT_ACTIVE'},authority,A,null,now),
  /DRAFT_PROTOCOL_CANNOT_PUBLISH/);
rejected('unauthorized',()=>planPublication(bytes,protocol,
  {...authority,publicationAuthorized:false},A,null,now),/PUBLICATION_NOT_AUTHORIZED/);
rejected('old v0 batch',()=>planPublication(canonicalBatchBytes(
  {...initial,schemaVersion:'PONS_S1_PRE_OUTCOME_BATCH_V0'}),protocol,authority,A,null,now),
  /LEGACY_BATCH_FORBIDDEN/);
rejected('noncanonical asset bytes',()=>planPublication(Buffer.concat([bytes,Buffer.from(' ')]),
  protocol,authority,A,null,now),/BATCH_BYTES_NOT_CANONICAL_EXACT/);
rejected('changed raw bytes',()=>verifyReadBack(plan,Buffer.from('forged'),
  release,asset,tagRef),/ASSET_CHANGED_AFTER_FREEZE/);
mutate(b=>{b.outcomesRead=true},/OUTCOME_PEEK_FORBIDDEN/);
mutate(b=>{b.census[1].c0=null},/C0_OBJECT_REQUIRED|C0_EXACT_FIELDS_REQUIRED/);
mutate(b=>{b.census[1].c0.action='REJECT'},/REJECT_CANNOT_INFER_ENTRY/);
mutate(b=>{b.census[1].c0.action='UNKNOWN_PREOUTCOME_C0'},
  /UNKNOWN_C0_CANNOT_INFER_ENTRY/);
mutate(b=>{b.census[1].c0.evidence.futureOutcome='profit'},
  /C0_EVIDENCE_DIGEST_MISMATCH|POST_OUTCOME_EVIDENCE_FORBIDDEN/);
mutate(b=>{b.census[1].c0.evidenceSha256='f'.repeat(64)},
  /C0_EVIDENCE_DIGEST_MISMATCH/);
mutate(b=>{b.census[1].c0.decisionBlock='103'},/Expected values to be strictly equal/);
mutate(b=>{b.scanned.confirmedHeadBlock='113'},/C0_NOT_TWELVE_CONFIRMED/);
mutate(b=>{b.scanned.officialEventsDigest='f'.repeat(64)},
  /OFFICIAL_SOURCE_DIGEST_MISMATCH/);
mutate(b=>{b.selectedEventKeys=[]},/SELECTED_MUST_MATCH_ALL_CONSECUTIVE_C0_DECISIONS/);
mutate(b=>{b.census.pop()},/SELECTED_MUST_MATCH|FACTORY_CENSUS_DIGEST_MISMATCH/);
mutate(b=>{b.cumulativeEligibleDecisions=2},/HIDDEN_ELIGIBLE_DECISION/);
mutate(b=>{b.census[0].nativePair=true},/C0_OBJECT_REQUIRED/);
mutate(b=>{b.capturedAtMs=launch+300_000},/CAPTURED_AFTER_FIRST_OUTCOME/);
rejected('late attempted publication',()=>planPublication(bytes,protocol,
  authority,A,null,launch+230_000),/INSUFFICIENT_PREOUTCOME_PUBLICATION_BUDGET/);
rejected('mutable release',()=>verifyReadBack(plan,bytes,
  {...release,immutable:false},asset,tagRef),/RELEASE_NOT_IMMUTABLE/);
rejected('draft release',()=>verifyReadBack(plan,bytes,
  {...release,draft:true},asset,tagRef),/RELEASE_STILL_DRAFT/);
rejected('extra asset',()=>verifyReadBack(plan,bytes,
  {...release,assets:[asset,asset]},asset,tagRef),/SINGLETON_ASSET_REQUIRED/);
rejected('digest forged',()=>verifyReadBack(plan,bytes,release,
  {...asset,digest:'sha256:'+'f'.repeat(64)},tagRef),/GITHUB_ASSET_DIGEST_MISMATCH/);
rejected('wrong tag target',()=>verifyReadBack(plan,bytes,release,
  asset,{...tagRef,object:{type:'commit',sha:'f'.repeat(40)}}),
  /Expected values to be strictly equal/);
rejected('late publish',()=>verifyReadBack(plan,bytes,
  {...release,published_at:'2026-10-01T12:05:00Z'},
  {...asset,updated_at:'2026-10-01T12:04:00Z'},tagRef),
  /RELEASE_PUBLISHED_TOO_LATE|TWO_ENDPOINTS_DISAGREE/);
rejected('missing lineage',()=>{
  const b=candidate(1);
  const {batchDigest,...payload}=b; b.batchDigest=digest(payload);
  return validateBatch(b,protocol,authority,A,null,now);
},/PRIOR_POINTER_OBJECT_REQUIRED|PRIOR_POINTER_EXACT_FIELDS_REQUIRED/);
// Positive synthetic second batch: prior is independently rechecked in an
// actual runner; the synthetic fixture alone is NOT a provenance claim.
const second = candidate(1), nextEvidence = second.census[1].c0.evidence;
for (const row of second.census) {
  row.blockNumber='101';row.eventKey='101:'+row.transactionHash+':'+row.logIndex;
  row.launchTimestampMs+=10_000;
}
second.census[1].c0.decisionBlock='103';
second.census[1].c0.decidedAtMs+=10_000;
second.census[1].inclusion.timestampMs+=10_000;
second.scanned.scanFromCursor={blockNumber:'101',logIndex:0};
second.scanned.scannedThrough='101';
second.scanned.nextCursor={blockNumber:'102',logIndex:0};
second.scanned.confirmedHeadBlock='117';
second.scanned.factoryEventsDigest=digest(second.census.map(x=>({
  eventKey:x.eventKey,blockHash:x.blockHash,token:x.token,nativePair:x.nativePair})));
second.scanned.officialEventsDigest=second.scanned.factoryEventsDigest;
second.scanned.archiveEventsDigest=second.scanned.factoryEventsDigest;
second.selectedEventKeys=[second.census[1].eventKey];
const prior = {batch:initial,assetSha256:plan.assetSha256,releaseId:456,
  assetId:789,publishedAtMs:Date.parse(when),independentLiveGitHubCheck:true};
second.previous={batchDigest:initial.batchDigest,assetSha256:plan.assetSha256,
  releaseId:456,assetId:789,cumulativeEligibleDecisions:1,
  nextCursor:initial.scanned.nextCursor};
second.cumulativeEligibleDecisions=2;
second.capturedAtMs=launch+125_000;
{const {batchDigest,...body}=second; second.batchDigest=digest(body);}
const secondPlan=planPublication(canonicalBatchBytes(second),protocol,
  authority,A,prior,launch+130_000);
assert.equal(secondPlan.published,false);
rejected('tampered prior digest',()=>validateBatch(second,protocol,authority,
  A,{...prior,assetSha256:'f'.repeat(64)},launch+130_000),/Expected values to be strictly equal/);
rejected('forged lineage not independently checked',()=>validateBatch(second,
  protocol,authority,A,{...prior,independentLiveGitHubCheck:false},launch+130_000),
  /PREVIOUS_IMMUTABLE_RELEASE_PROOF_REQUIRED/);
rejected('previous seal later than current capture',()=>validateBatch(second,
  protocol,authority,A,{...prior,publishedAtMs:launch+126_000},launch+130_000),
  /PREVIOUS_SEAL_AFTER_CURRENT_CAPTURE/);
// A 16-block empty source scan must still be independently committed before
// the next cursor is trusted; it has no synthetic five-minute price outcome.
const empty = candidate();
empty.census=[];
empty.selectedEventKeys=[];
empty.cumulativeEligibleDecisions=0;
empty.scanned.factoryEventsDigest=digest([]);
empty.scanned.officialEventsDigest=empty.scanned.factoryEventsDigest;
empty.scanned.archiveEventsDigest=empty.scanned.factoryEventsDigest;
{const {batchDigest,...body}=empty;empty.batchDigest=digest(body);}
const emptyPlan=planPublication(canonicalBatchBytes(empty),protocol,authority,A,null,now);
assert.equal(emptyPlan.deadlineKind,'EMPTY_OR_NONNATIVE_OPERATIONAL_EXPIRY');
assert.equal(emptyPlan.deadlineMs,empty.capturedAtMs+600_000);
console.log(JSON.stringify({verdict:'PONS_S1_PAIRED_PUBLISHER_OFFLINE_PASS',
  syntheticPositive:4,syntheticNegative:negatives,noNetwork:true,
  actualPublication:false,actualActivation:false,independentWitness:false,
  liveMoneyAuthority:false}));
