import { execFileSync } from 'node:child_process';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_COMPATIBILITY_R1.json';

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
const head = git(['rev-parse', 'HEAD']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const status = execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' });

const context = {
  schema: 'dev-spine-context/v1',
  repo: packet.repo,
  head,
  branch,
  dirty: status.length > 0,
  phase: packet.phase,
  phase_state: packet.state,
  objective: packet.objective,
  authorization: packet.authorization,
  authority: packet.authority,
  authority_docs: packet.authority_docs,
  representative_fixture_status: packet.known_historical_state?.representative_fixture_status ?? 'UNKNOWN',
  next_action: packet.next_action,
};

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
  process.exit(0);
}

console.log(`REPO=${context.repo}`);
console.log(`HEAD=${context.head}`);
console.log(`BRANCH=${context.branch}`);
console.log(`DIRTY=${context.dirty}`);
console.log('');
console.log(`ACTIVE_PHASE=${context.phase}`);
console.log(`PHASE_STATE=${context.phase_state}`);
for (const [key, value] of Object.entries(context.authorization)) {
  console.log(`AUTH_${key.toUpperCase()}=${value}`);
}
console.log(`REPRESENTATIVE_FIXTURES=${context.representative_fixture_status}`);
console.log('');
console.log('AUTHORITY_ENTRY_POINTS:');
for (const path of context.authority_docs) console.log(`  ${path}`);
console.log('');
console.log(`NEXT_ACTION=${context.next_action}`);
