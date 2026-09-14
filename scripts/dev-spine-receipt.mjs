import fs from 'node:fs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_OUTCOME_ALL_HORIZONS_R1.json';
const OUTPUT_PATH = '.dev-spine/receipt.json';

function fail(message) {
  console.error(`DEV_SPINE_RECEIPT=FAIL ${message}`);
  process.exit(1);
}

const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
const testedSha = process.env.DEV_SPINE_TESTED_SHA;
const sourceHeadSha = process.env.DEV_SPINE_SOURCE_SHA ?? testedSha;
const dirtyRaw = process.env.DEV_SPINE_DIRTY;
if (!testedSha || !sourceHeadSha) fail('tested/source SHA must be supplied by the Spine adapter');
if (dirtyRaw !== 'true' && dirtyRaw !== 'false') fail('dirty state must be explicitly supplied by the Spine adapter');
const dirty = dirtyRaw === 'true';

const ciStatus = String(process.env.DEV_SPINE_CI_STATUS ?? 'unknown').toLowerCase();
const repositoryVerification = ciStatus === 'success' ? 'PASS' : ciStatus === 'failure' || ciStatus === 'cancelled' ? 'FAIL' : 'UNKNOWN';

const receipt = {
  schema: 'dev-spine-receipt/v1',
  repo: packet.repo,
  phase: packet.phase,
  tested_sha: testedSha,
  source_head_sha: sourceHeadSha,
  source_matches_tested_sha: sourceHeadSha === testedSha,
  dirty_worktree_observed: dirty,
  repository_verification: {
    ci_status: ciStatus,
    verdict: repositoryVerification,
  },
  phase_evidence: {
    live_archive_rpc: 'NOT_EVALUATED_BY_GENERIC_CI',
    representatives_expected: 9,
    horizons_per_representative: 5,
    outcomes_expected: 45,
    representative_gate: 'NOT_EVALUATED_BY_GENERIC_CI',
  },
  authorization: packet.authorization,
  phase_state: packet.state,
  next_action: packet.next_action,
  verdict:
    repositoryVerification === 'PASS' && !dirty
      ? 'REPO_VERIFICATION_PASS_PHASE_GATE_SEPARATE'
      : repositoryVerification === 'FAIL'
        ? 'REPO_VERIFICATION_FAIL_PHASE_GATE_SEPARATE'
        : 'REPO_VERIFICATION_UNKNOWN_PHASE_GATE_SEPARATE',
};

fs.mkdirSync('.dev-spine', { recursive: true });
fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(`DEV_SPINE_RECEIPT=${OUTPUT_PATH}`);
console.log(`TESTED_SHA=${testedSha}`);
console.log(`SOURCE_HEAD_SHA=${sourceHeadSha}`);
console.log(`DIRTY_WORKTREE_OBSERVED=${dirty}`);
console.log(`VERDICT=${receipt.verdict}`);
