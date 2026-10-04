import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateKillFast, DEFAULT_HORIZON_MS } from './binrat-kill-fast-core-v1.mjs';

const root=resolve(new URL('..',import.meta.url).pathname);
const featurePath=process.env.BINRAT_KILL_FAST_FEATURES ??
  resolve(root,'docs/evidence/pons-s0-real-cohort-v1/features.jsonl');
const outcomePath=process.env.BINRAT_KILL_FAST_OUTCOMES ??
  resolve(root,'docs/evidence/pons-s0-real-cohort-v1/outcomes.jsonl');
const fundingPath=process.env.BINRAT_KILL_FAST_FUNDING ?? null;
const horizonMs=Number(process.env.BINRAT_KILL_FAST_HORIZON_MS ?? DEFAULT_HORIZON_MS);

const features=parseJsonl(await readFile(featurePath,'utf8'));
const outcomes=parseJsonl(await readFile(outcomePath,'utf8'));
const fundingObservations=fundingPath?parseJsonl(await readFile(fundingPath,'utf8')):[];

const receipt=evaluateKillFast({features,outcomes,fundingObservations,horizonMs});
process.stdout.write(JSON.stringify(receipt,null,2)+'\n');

function parseJsonl(text){
  return text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>JSON.parse(line));
}
