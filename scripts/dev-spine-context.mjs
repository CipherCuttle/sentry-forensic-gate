import fs from 'node:fs';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_ALL_HORIZON_COMPATIBILITY_R1.json';

const packet = JSON.parse(fs.readFileSync(PACKET_PATH, 'utf8'));
const dirtyRaw = process.env.DEV_SPINE_DIRTY;
const dirty = dirtyRaw === 'true' ? true : dirtyRaw === 'false' ? false : null;

const context = {
  schema: 'dev-spine-context/v1',
  repo: packet.repo,
  head: process.env.DEV_SPINE_TESTED_SHA ?? 'UNKNOWN',
  source_head: process.env.DEV_SPINE_SOURCE_SHA ?? process.env.DEV_SPINE_TESTED_SHA ?? 'UNKNOWN',
  branch: process.env.DEV_SPINE_BRANCH ?? 'UNKNOWN',
  dirty,
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
console.log(`SOURCE_HEAD=${context.source_head}`);
console.log(`BRANCH=${context.branch}`);
console.log(`DIRTY=${context.dirty ?? 'UNKNOWN'}`);
console.log('');
console.log(`ACTIVE_PHASE=${context.phase}`);
console.log(`PHASE_STATE=${context.phase_state}`);
for (const [key, value] of Object.entries(context.authorization)) console.log(`AUTH_${key.toUpperCase()}=${value}`);
console.log(`REPRESENTATIVE_FIXTURES=${context.representative_fixture_status}`);
console.log('');
console.log('AUTHORITY_ENTRY_POINTS:');
for (const path of context.authority_docs) console.log(`  ${path}`);
console.log('');
console.log(`NEXT_ACTION=${context.next_action}`);
