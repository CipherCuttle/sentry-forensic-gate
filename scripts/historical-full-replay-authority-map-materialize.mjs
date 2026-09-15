import fs from 'node:fs';
import { loadFrozenAuthorityMap } from './historical-full-replay-authority-map-fixture.mjs';

const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'historical-full-replay-authority-map-r1-decoded.json';
const frozen = loadFrozenAuthorityMap();
fs.writeFileSync(OUTPUT_PATH, frozen.raw);
console.log(`AUTHORITY_MAP_MATERIALIZED=${OUTPUT_PATH}`);
console.log(`AUTHORITY_MAP_SHA256=${frozen.index.authorityMapSha256}`);
console.log(`LAUNCH_COUNT=${frozen.manifest.launchCount}`);
