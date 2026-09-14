import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_COMPATIBILITY_R1.json';
const OUTPUT_DIR = '.dev-spine';

function fail(message) {
  console.error(`DEV_SPINE_PACK=FAIL ${message}`);
  process.exit(1);
}

const testedSha = process.env.DEV_SPINE_TESTED_SHA;
const sourceHeadSha = process.env.DEV_SPINE_SOURCE_SHA ?? testedSha;
const dirtyRaw = process.env.DEV_SPINE_DIRTY;
if (!testedSha || !sourceHeadSha) fail('tested/source SHA must be supplied by the Spine adapter');
if (dirtyRaw !== 'false') fail('context pack requires an explicitly clean worktree');

const packetRaw = fs.readFileSync(PACKET_PATH, 'utf8');
const packet = JSON.parse(packetRaw);
const sections = [];
for (const path of packet.context_files) {
  if (!fs.existsSync(path)) fail(`context file missing: ${path}`);
  const content = fs.readFileSync(path, 'utf8');
  sections.push(`===== BEGIN FILE: ${path} =====\n${content}\n===== END FILE: ${path} =====`);
}

const contextContent = sections.join('\n\n');
const contextContentSha256 = createHash('sha256').update(contextContent).digest('hex');
const metadata = {
  schema: 'dev-spine-context-pack/v1',
  repo: packet.repo,
  phase: packet.phase,
  tested_sha: testedSha,
  source_head_sha: sourceHeadSha,
  source_matches_tested_sha: sourceHeadSha === testedSha,
  clean_worktree_asserted: true,
  context_content_sha256: contextContentSha256,
  context_files: packet.context_files,
  phase_state: packet.state,
  next_action: packet.next_action,
};

const output = [
  '# Sentry Forensic Gate — SHA-bound Dev Spine Context Pack',
  '',
  JSON.stringify(metadata, null, 2),
  '',
  contextContent,
  '',
].join('\n');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const safePhase = packet.phase.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
const outputPath = join(OUTPUT_DIR, `context-${safePhase}-${testedSha.slice(0, 12)}.txt`);
fs.writeFileSync(outputPath, output, 'utf8');

console.log(`DEV_SPINE_CONTEXT_PACK=${outputPath}`);
console.log(`TESTED_SHA=${testedSha}`);
console.log(`SOURCE_HEAD_SHA=${sourceHeadSha}`);
console.log(`CONTEXT_CONTENT_SHA256=${contextContentSha256}`);
console.log('CLEAN_WORKTREE_ASSERTED=true');
