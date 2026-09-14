import fs from 'node:fs';
import path from 'node:path';

const allowedFileExtensions = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.yml', '.yaml', '.sql', '.example'
]);
const allowedExactFiles = new Set(['.gitignore', 'mise.toml']);
const skippedDirs = new Set(['.git', 'node_modules', 'dist']);

function assertSupportedSurfaces(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      assertSupportedSurfaces(full);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`UNSUPPORTED_FILE_SURFACE:${path.relative(process.cwd(), full)}`);
    }
    const relative = path.relative(process.cwd(), full);
    const extension = path.extname(entry.name).toLowerCase();
    if (!allowedFileExtensions.has(extension) && !allowedExactFiles.has(relative)) {
      throw new Error(`UNSUPPORTED_FILE_SURFACE:${relative}`);
    }
  }
}

assertSupportedSurfaces(process.cwd());

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const scripts = pkg.scripts ?? {};
const localNames = new Set(Object.keys(scripts));

for (const [name, script] of Object.entries(scripts)) {
  if (typeof script !== 'string') throw new Error(`INVALID_PACKAGE_SCRIPT:${name}`);
  for (const segment of script.split(/\s*&&\s*/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens[0] === 'node' && tokens.length === 2 && /^(?:scripts|dist)\/[A-Za-z0-9_./-]+\.(?:m?js|cjs)$/.test(tokens[1])) continue;
    if (tokens[0] === 'pnpm' && tokens.length === 2 && localNames.has(tokens[1])) continue;
    if (segment.trim() === 'tsc -p tsconfig.json') continue;
    throw new Error(`UNSUPPORTED_PACKAGE_SCRIPT:${name}`);
  }
}

console.log('research-boundary package/surface check: PASS');
