import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OWNER = 'CipherCuttle';
const REPO = 'sentry-forensic-gate';
const RUN_ID = 35001582697;
const EXPECTED_HEAD = '75588056de53b94f92b5cf3b40e89e2b5521031a';
const ARTIFACT_ID = 10410898359;
const ARTIFACT_NAME = 'historical-full-replay-r1-evidence';
const ARTIFACT_DIGEST = 'sha256:ebeb0ff5d6c3fecc9dac2dde4397e8592f72a3501aa3b9980662c3bd8c71fb6a';
const RECEIPT_NAME = 'historical-full-replay-r1-live-receipt.json';
const RECEIPT_SHA256 = '916c9f4bc637a90e329abfaa3346debda83d28f3e642cac6c36ddd2122ab3825';
const SCOPE_SHA256 = 'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211';
const MAP_SHA256 = 'c5346e572255385acd1744552633d5ad533d86d3821a8d857a432471e6022275';
const BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
const EXPECTED_HORIZONS = [60_000, 300_000, 1_800_000, 7_200_000, 86_400_000];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
async function github(pathname, { binary = false } = {}) {
  const token = process.env.GITHUB_TOKEN;
  invariant(token, 'GITHUB_TOKEN is required');
  const response = await fetch(`https://api.github.com${pathname}`, {
    redirect: 'follow',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sentry-forensic-gate-fast-vet-authorization'
    }
  });
  invariant(response.ok, `GitHub API ${pathname} failed: ${response.status}`);
  if (binary) return Buffer.from(await response.arrayBuffer());
  return response.json();
}

const run = await github(`/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}`);
invariant(run.id === RUN_ID, 'predecessor run id drift');
invariant(run.head_sha === EXPECTED_HEAD, `predecessor run head drift:${run.head_sha}`);
invariant(run.status === 'completed' && run.conclusion === 'success', `predecessor run not successful:${run.status}/${run.conclusion}`);
invariant(run.name === 'historical-full-replay-r1-stage-b', `unexpected predecessor workflow:${run.name}`);

const artifact = await github(`/repos/${OWNER}/${REPO}/actions/artifacts/${ARTIFACT_ID}`);
invariant(artifact.id === ARTIFACT_ID, 'artifact id drift');
invariant(artifact.name === ARTIFACT_NAME, `artifact name drift:${artifact.name}`);
invariant(artifact.expired === false, 'predecessor artifact expired');
invariant(artifact.digest === ARTIFACT_DIGEST, `artifact GitHub digest drift:${artifact.digest}`);
invariant(artifact.workflow_run?.id === RUN_ID, 'artifact does not belong to pinned run');
invariant(artifact.workflow_run?.head_sha === EXPECTED_HEAD, 'artifact workflow head drift');

const archive = await github(`/repos/${OWNER}/${REPO}/actions/artifacts/${ARTIFACT_ID}/zip`, { binary: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-vet-auth-predecessor-'));
try {
  const zipPath = path.join(tmp, 'artifact.zip');
  const outDir = path.join(tmp, 'unzipped');
  fs.writeFileSync(zipPath, archive);
  fs.mkdirSync(outDir);
  execFileSync('unzip', ['-q', zipPath, '-d', outDir], { stdio: 'inherit' });
  const files = fs.readdirSync(outDir, { recursive: true }).filter((entry) => {
    const full = path.join(outDir, entry.toString());
    return fs.existsSync(full) && fs.statSync(full).isFile();
  }).map(String).sort();
  invariant(JSON.stringify(files) === JSON.stringify([RECEIPT_NAME]), `unexpected artifact contents:${JSON.stringify(files)}`);

  const receiptBytes = fs.readFileSync(path.join(outDir, RECEIPT_NAME));
  invariant(sha256(receiptBytes) === RECEIPT_SHA256, 'predecessor receipt SHA-256 drift');
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  invariant(receipt.schema === 'historical-full-replay-r1-live-receipt/v1', `receipt schema drift:${receipt.schema}`);
  invariant(receipt.phase === 'HISTORICAL_FULL_REPLAY_R1' && receipt.stage === 'STAGE_B_FULL_147_X_5_REPLAY', 'receipt phase/stage drift');
  invariant(receipt.verdict === 'HISTORICAL_FULL_REPLAY_R1_ACCOUNTING_PASS', `receipt verdict drift:${receipt.verdict}`);
  invariant(receipt.shadowOnly === true, 'receipt must remain shadow-only');
  invariant(receipt.sourceMode === 'LIVE_ARCHIVE_RPC_REVIEWED_HISTORICAL_PIPELINES', `receipt source mode drift:${receipt.sourceMode}`);
  invariant(receipt.sourceScopeIdentitySha256 === SCOPE_SHA256, 'receipt scope identity drift');
  invariant(receipt.authorityMapSha256 === MAP_SHA256, 'receipt authority map drift');
  invariant(receipt.baselinePolicyVersion === BASELINE_POLICY, 'receipt baseline policy drift');
  invariant(receipt.outcomePolicyVersion === OUTCOME_POLICY, 'receipt outcome policy drift');
  invariant(receipt.expectedLaunches === 147 && receipt.launchesAccounted === 147, 'receipt launch accounting drift');
  invariant(receipt.baselineComplete === 147 && receipt.baselineUnverified === 0, 'receipt baseline accounting drift');
  invariant(receipt.expectedHorizonCells === 735 && receipt.horizonCellsAccounted === 735, 'receipt horizon accounting drift');
  invariant(receipt.outcomesComplete === 735 && receipt.outcomesUnverified === 0 && receipt.outcomesNotAttemptedBaselineUnverified === 0, 'receipt outcome accounting drift');
  invariant(Array.isArray(receipt.rows) && receipt.rows.length === 147, 'receipt row count drift');
  for (const [index, row] of receipt.rows.entries()) {
    invariant(row.baseline?.status === 'COMPLETE', `row ${index + 1} baseline not COMPLETE`);
    invariant(Array.isArray(row.baseline?.legs) && row.baseline.legs.length === 5, `row ${index + 1} baseline leg count drift`);
    invariant(Array.isArray(row.outcomes) && row.outcomes.length === 5, `row ${index + 1} outcome count drift`);
    const horizons = row.outcomes.map((outcome) => outcome.horizonMs).sort((a, b) => a - b);
    invariant(JSON.stringify(horizons) === JSON.stringify(EXPECTED_HORIZONS), `row ${index + 1} outcome horizons drift`);
    for (const outcome of row.outcomes) invariant(outcome.status === 'COMPLETE', `row ${index + 1} outcome not COMPLETE`);
  }
  console.log(`FAST_VET_AUTH_PREDECESSOR_PROVENANCE=PASS run=${RUN_ID} head=${EXPECTED_HEAD} artifact=${ARTIFACT_ID} receipt_sha256=${RECEIPT_SHA256}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
