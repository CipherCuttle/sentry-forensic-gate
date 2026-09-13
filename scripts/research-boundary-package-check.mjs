import fs from 'node:fs';

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

console.log('research-boundary package check: PASS');
