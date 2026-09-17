import fs from 'node:fs';
import path from 'node:path';

const INPUT_DIR = process.env.INPUT_DIR ?? 'replay-shards';
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'historical-full-replay-r1-live-receipt.json';
const SCOPE_DIGEST = 'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211';
const MAP_DIGEST = 'c5346e572255385acd1744552633d5ad533d86d3821a8d857a432471e6022275';
const BASELINE_POLICY = 'HISTORICAL_EXECUTABLE_BASELINE_REDSTONE_ASOF_R1';
const OUTCOME_POLICY = 'HISTORICAL_FORWARD_OUTCOMES_REDSTONE_ASOF_R1';
const EXPECTED_HORIZONS = [60000,300000,1800000,7200000,86400000];
const EXPECTED_NOTIONALS = ['250000','500000','1000000','2000000','5000000'];

function invariant(condition, message) { if (!condition) throw new Error(message); }
const files = fs.readdirSync(INPUT_DIR).filter((name) => name.endsWith('.json')).sort();
invariant(files.length === 11, `expected 11 shard receipts:actual=${files.length}`);

const shardReceipts = files.map((name) => JSON.parse(fs.readFileSync(path.join(INPUT_DIR,name),'utf8')));
for (const receipt of shardReceipts) {
  invariant(receipt.schema === 'historical-full-replay-r1-shard-receipt/v1', `unexpected shard schema:${receipt.schema}`);
  invariant(receipt.verdict === 'HISTORICAL_FULL_REPLAY_SHARD_ACCOUNTING_PASS', `shard accounting fail:${receipt.shard?.startOrdinal}-${receipt.shard?.endOrdinal}`);
  invariant(receipt.shadowOnly === true, 'shard must remain shadow-only');
  invariant(receipt.sourceScopeIdentitySha256 === SCOPE_DIGEST && receipt.authorityMapSha256 === MAP_DIGEST, 'shard frozen identity drift');
  invariant(receipt.baselinePolicyVersion === BASELINE_POLICY && receipt.outcomePolicyVersion === OUTCOME_POLICY, 'shard policy drift');
}

const rows = shardReceipts.flatMap((receipt) => receipt.rows);
rows.sort((a,b) => a.ordinal - b.ordinal);
invariant(rows.length === 147, `full replay launch accounting mismatch:${rows.length}`);
invariant(rows.every((row,index) => row.ordinal === index + 1), 'full replay ordinal coverage drift');
invariant(new Set(rows.map((row) => row.ordinal)).size === 147, 'full replay duplicate ordinals');

let baselineComplete = 0;
let baselineUnverified = 0;
let outcomesComplete = 0;
let outcomesUnverified = 0;
let outcomesNotAttemptedBaselineUnverified = 0;
let horizonCellsAccounted = 0;
const statusCounts = {};

for (const row of rows) {
  const baseline = row.baseline;
  invariant(baseline && typeof baseline === 'object', `full baseline receipt required:ordinal=${row.ordinal}`);
  invariant(baseline.baselineId === row.baselineId, `baseline id drift:ordinal=${row.ordinal}`);
  invariant(baseline.policyVersion === BASELINE_POLICY && baseline.policyVersion === row.baselinePolicyVersion, `baseline policy drift:ordinal=${row.ordinal}`);
  invariant(baseline.status === row.baselineStatus, `baseline status drift:ordinal=${row.ordinal}`);
  invariant(typeof baseline.decisionBlock === 'string' && typeof baseline.decisionBlockHash === 'string', `baseline decision point missing:ordinal=${row.ordinal}`);
  invariant(typeof baseline.authorityDigest === 'string' && baseline.authorityDigest.length > 0, `baseline authority digest missing:ordinal=${row.ordinal}`);

  if (row.baselineStatus === 'COMPLETE') {
    baselineComplete += 1;
    invariant(baseline.market && typeof baseline.market === 'object', `complete baseline market missing:ordinal=${row.ordinal}`);
    invariant(Array.isArray(baseline.legs) && baseline.legs.length === 5, `complete baseline must retain five quote legs:ordinal=${row.ordinal}`);
    invariant(JSON.stringify(baseline.legs.map((leg) => String(leg.notionalUsdMicros))) === JSON.stringify(EXPECTED_NOTIONALS), `baseline notional set/order drift:ordinal=${row.ordinal}`);
    invariant(baseline.legs.every((leg) => leg.calibration && leg.entry), `baseline quote evidence missing:ordinal=${row.ordinal}`);
  } else if (row.baselineStatus === 'UNVERIFIED') {
    baselineUnverified += 1;
    invariant(Array.isArray(baseline.legs) && baseline.legs.length === 0, `unverified baseline quote legs drift:ordinal=${row.ordinal}`);
    invariant(typeof baseline.reason === 'string' && baseline.reason.length > 0, `unverified baseline reason missing:ordinal=${row.ordinal}`);
  } else throw new Error(`unexpected baseline status:ordinal=${row.ordinal}:status=${row.baselineStatus}`);

  invariant(Array.isArray(row.outcomes) && row.outcomes.length === 5, `launch must account for five horizons:ordinal=${row.ordinal}`);
  const actualHorizons = row.outcomes.map((cell) => cell.horizonMs);
  invariant(JSON.stringify(actualHorizons) === JSON.stringify(EXPECTED_HORIZONS), `horizon set/order drift:ordinal=${row.ordinal}`);
  horizonCellsAccounted += row.outcomes.length;
  for (const cell of row.outcomes) {
    statusCounts[cell.status] = (statusCounts[cell.status] ?? 0) + 1;
    if (cell.status === 'COMPLETE') outcomesComplete += 1;
    else if (cell.status === 'UNVERIFIED') outcomesUnverified += 1;
    else if (cell.status === 'NOT_ATTEMPTED_BASELINE_UNVERIFIED') outcomesNotAttemptedBaselineUnverified += 1;
    else throw new Error(`unexpected horizon status:ordinal=${row.ordinal}:status=${cell.status}`);
  }
  if (row.baselineStatus === 'UNVERIFIED') {
    invariant(row.outcomes.every((cell) => cell.status === 'NOT_ATTEMPTED_BASELINE_UNVERIFIED'), `unverified baseline horizon accounting drift:ordinal=${row.ordinal}`);
  } else {
    invariant(row.outcomes.every((cell) => cell.status === 'COMPLETE' || cell.status === 'UNVERIFIED'), `complete baseline horizon accounting drift:ordinal=${row.ordinal}`);
  }
}

invariant(baselineComplete + baselineUnverified === 147, 'baseline accounting must equal 147');
invariant(horizonCellsAccounted === 735, `horizon cell accounting must equal 735:actual=${horizonCellsAccounted}`);
invariant(outcomesComplete + outcomesUnverified + outcomesNotAttemptedBaselineUnverified === 735, 'horizon status accounting must equal 735');

const receipt = {
  schema: 'historical-full-replay-r1-live-receipt/v1',
  phase: 'HISTORICAL_FULL_REPLAY_R1',
  stage: 'STAGE_B_FULL_147_X_5_REPLAY',
  sourceMode: 'LIVE_ARCHIVE_RPC_REVIEWED_HISTORICAL_PIPELINES',
  shadowOnly: true,
  sourceScopeIdentitySha256: SCOPE_DIGEST,
  authorityMapSha256: MAP_DIGEST,
  baselinePolicyVersion: BASELINE_POLICY,
  outcomePolicyVersion: OUTCOME_POLICY,
  expectedLaunches: 147,
  expectedHorizonCells: 735,
  launchesAccounted: rows.length,
  baselineComplete,
  baselineUnverified,
  horizonCellsAccounted,
  outcomesComplete,
  outcomesUnverified,
  outcomesNotAttemptedBaselineUnverified,
  horizonStatusCounts: statusCounts,
  economicCompleteRequiredForPass: false,
  rows,
  verdict: 'HISTORICAL_FULL_REPLAY_R1_ACCOUNTING_PASS'
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  verdict:receipt.verdict,
  launchesAccounted:receipt.launchesAccounted,
  baselineComplete,
  baselineUnverified,
  horizonCellsAccounted,
  outcomesComplete,
  outcomesUnverified,
  outcomesNotAttemptedBaselineUnverified,
  horizonStatusCounts:statusCounts
}, null, 2));
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
