#!/usr/bin/env node
// Candidate external C0 witness. Main-only GitHub API downloads are performed
// by a separately reviewed read-only workflow, not this local parser.
import assert from 'node:assert/strict';
import {readFile,mkdir,open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {canonical} from './pons-s1-publisher-core-v1.mjs';
import {verifyIndependentC0SourceSeal} from './pons-s1-c0-source-witness-core-v1.mjs';
const [root,out]=process.argv.slice(2);
assert.ok(root&&out,'USAGE: c0-witness <independent-download-directory> <exclusive-receipt.json>');
assert.equal(process.env.GITHUB_REPOSITORY,'CipherCuttle/sentry-forensic-gate');
assert.equal(process.env.GITHUB_REF,'refs/heads/main','C0_EXTERNAL_WITNESS_MAIN_ONLY');
const hex=(s,rx,l)=>{assert.match(s??'',rx,l);return s};
const id=(s,l)=>{assert.match(s??'',/^[1-9]\d{0,14}$/,l);return Number(s)};
const read=name=>readFile(resolve(root,name));
const json=async name=>JSON.parse(await read(name));
const output=verifyIndependentC0SourceSeal({
  sourceBytes:await read('source.json'),
  originalSourceBytes:await read('original/source.json'),
  expectedSourceDigest:hex(process.env.PONS_S1_C0_SOURCE_DIGEST,/^[0-9a-f]{64}$/,'PINNED_C0_DIGEST_REQUIRED'),
  expectedSourceRunId:id(process.env.PONS_S1_SOURCE_RUN_ID,'SOURCE_RUN_ID'),
  expectedArtifactId:id(process.env.PONS_S1_SOURCE_ARTIFACT_ID,'SOURCE_ARTIFACT_ID'),
  expectedReleaseId:id(process.env.PONS_S1_SOURCE_RELEASE_ID,'SOURCE_RELEASE_ID'),
  expectedAssetId:id(process.env.PONS_S1_SOURCE_RELEASE_ASSET_ID,'SOURCE_ASSET_ID'),
  activationSha:hex(process.env.PONS_S1_ACTIVATION_SHA,/^[0-9a-f]{40}$/,'ACTIVATION_SHA'),
  sourceRun:await json('source-run.json'),
  sourceArtifacts:await json('source-artifacts.json'),
  sourceRelease:await json('source-release.json'),
  sourceAsset:await json('source-asset.json'),
  sourceTagRef:await json('source-tag.json'),
  authority:await json('authority.json'),
  protocol:await json('protocol.json'),
  activationCommit:await json('activation-commit.json'),
  mergePr:await json('merge-pr.json'),
  ancestry:await json('activation-to-main.json')
});
await mkdir(dirname(resolve(out)),{recursive:true});
const fd=await open(resolve(out),'wx',0o600);
try{await fd.writeFile(JSON.stringify(canonical({...output,
  acquisition:'INDEPENDENT_CANONICAL_MAIN_READ_ONLY_GITHUB_RETRIEVAL',
  witnessRunId:process.env.GITHUB_RUN_ID??null}))+'\n');await fd.sync();}
finally{await fd.close();}
console.log(JSON.stringify({verdict:output.verdict,
  sourceObservationDigest:output.sourceObservationDigest,sourceQualified:false,
  scientificallyAdmissible:false,noMoney:true}));
