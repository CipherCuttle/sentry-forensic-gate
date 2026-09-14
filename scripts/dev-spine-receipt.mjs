import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_COMPATIBILITY_R1.json';
const OUTPUT_PATH = '.dev-spine/receipt.json';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function trackedFile(path) {
  return execFileSync('git', ['show', `HEAD:${path}`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

const packet = JSON.parse(trackedFile(PACKET_PATH));
const testedSha = git(['rev-parse', 'HEAD']);
const sourceHeadSha = process.env.DEV_SPINE_SOURCE_SHA || testedSha;
const status = execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' });
const ciStatus = String(process.env.DEV_SPINE_CI_STATUS ?? 'unknown').toLowerCase();
const repositoryVerification = ciStatus === 'success' ? 'PASS' : ciStatus === 'failure' || ciStatus === 'cancelled' ? 'FAIL' : 'UNKNOWN';

const receipt = {
  schema: 'dev-spine-receipt/v1',
  repo: packet.repo,
  phase: packet.phase,
  tested_sha: testedSha,
  source_head_sha: sourceHeadSha,
  source_matches_tested_sha: sourceHeadSha === testedSha,
  dirty_worktree_observed: status.length > 0,
  repository_verification: {
    ci_status: ciStatus,
    verdict: repositoryVerification,
  },
  phase_evidence: {
    historical_compatibility: 'NOT_EVALUATED',
    live_archive_rpc: 'NOT_RUN',
    representatives_attempted: 0,
    baseline_complete: 0,
    outcomes_24h_complete: 0,
  },
  authorization: packet.authorization,
  phase_state: packet.state,
  next_action: packet.next_action,
  verdict:
    repositoryVerification === 'PASS'
      ? 'REPO_VERIFICATION_PASS_PHASE_NOT_EVALUATED'
      : repositoryVerification === 'FAIL'
        ? 'REPO_VERIFICATION_FAIL_PHASE_NOT_EVALUATED'
        : 'REPO_VERIFICATION_UNKNOWN_PHASE_NOT_EVALUATED',
};

mkdirSync('.dev-spine', { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(`DEV_SPINE_RECEIPT=${OUTPUT_PATH}`);
console.log(`TESTED_SHA=${testedSha}`);
console.log(`SOURCE_HEAD_SHA=${sourceHeadSha}`);
console.log(`VERDICT=${receipt.verdict}`);
