import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKET_PATH = 'docs/agent-packets/HISTORICAL_COMPATIBILITY_R1.json';
const OUTPUT_DIR = '.dev-spine';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

function trackedFile(path) {
  return execFileSync('git', ['show', `HEAD:${path}`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

const head = git(['rev-parse', 'HEAD']);
const status = execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' });
const packetRaw = trackedFile(PACKET_PATH);
const packet = JSON.parse(packetRaw);

const sections = [];
for (const path of packet.context_files) {
  const content = trackedFile(path);
  sections.push(`===== BEGIN FILE: ${path} =====\n${content}\n===== END FILE: ${path} =====`);
}

const trackedContent = sections.join('\n\n');
const trackedContentSha256 = createHash('sha256').update(trackedContent).digest('hex');
const metadata = {
  schema: 'dev-spine-context-pack/v1',
  repo: packet.repo,
  phase: packet.phase,
  source_sha: head,
  dirty_worktree_observed: status.length > 0,
  tracked_content_sha256: trackedContentSha256,
  context_files: packet.context_files,
  phase_state: packet.state,
  next_action: packet.next_action,
};

const output = [
  '# Sentry Forensic Gate — SHA-bound Dev Spine Context Pack',
  '',
  JSON.stringify(metadata, null, 2),
  '',
  trackedContent,
  '',
].join('\n');

mkdirSync(OUTPUT_DIR, { recursive: true });
const safePhase = packet.phase.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
const outputPath = join(OUTPUT_DIR, `context-${safePhase}-${head.slice(0, 12)}.txt`);
writeFileSync(outputPath, output, 'utf8');

console.log(`DEV_SPINE_CONTEXT_PACK=${outputPath}`);
console.log(`SOURCE_SHA=${head}`);
console.log(`TRACKED_CONTENT_SHA256=${trackedContentSha256}`);
console.log(`DIRTY_WORKTREE_OBSERVED=${status.length > 0}`);
