import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

const EXPECTED_INDEX_PATH = 'fixtures/historical-full-replay-authority-map-r1.json';
const EXPECTED_CHUNKS = [
  'fixtures/historical-full-replay-authority-map-r1.part-001.b64',
  'fixtures/historical-full-replay-authority-map-r1.part-002.b64',
  'fixtures/historical-full-replay-authority-map-r1.part-003.b64',
  'fixtures/historical-full-replay-authority-map-r1.part-004.b64',
  'fixtures/historical-full-replay-authority-map-r1.part-005.b64',
];
const SCOPE_DIGEST = 'b5184624928e9dc36fd75558bf599074e9eb67e03658fe9b3f3e00668b5b8211';
const MAP_DIGEST = 'c5346e572255385acd1744552633d5ad533d86d3821a8d857a432471e6022275';
const PAYLOAD_SHA = '839c8ebd16589387b2e08888484962f0cf8d1389837f9045a7a9a4ef1eb97623';
const COMPRESSED_SHA = 'b140ffbfd3460de5a03c749d011ec8101323cc21f71af8c3c14826d5882b0893';

function invariant(condition, message) { if (!condition) throw new Error(message); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function authorityMapDigest(rows) {
  return sha256(rows.map((row) => [
    row.ordinal,row.event,row.blockNumber,row.blockHash,row.transactionHash,row.logIndex,row.tokenId,row.token,row.creator,row.implementation,
  ].join('|')).join('\n'));
}

export function loadFrozenAuthorityMap(indexPath = EXPECTED_INDEX_PATH) {
  const indexRaw = fs.readFileSync(indexPath);
  const index = JSON.parse(indexRaw.toString('utf8'));
  invariant(index.schema === 'historical-full-replay-authority-map-r1/index-v1', 'authority map index schema drift');
  invariant(index.encoding === 'gzip+base64-chunks', 'authority map index encoding drift');
  invariant(index.sourceScopeIdentitySha256 === SCOPE_DIGEST, 'authority map index source scope drift');
  invariant(index.launchCount === 147 && index.cohortCount === 9, 'authority map index count drift');
  invariant(index.authorityMapSha256 === MAP_DIGEST, 'authority map index digest drift');
  invariant(index.payloadSha256 === PAYLOAD_SHA, 'authority map payload sha drift');
  invariant(index.compressedPayloadSha256 === COMPRESSED_SHA, 'authority map compressed sha drift');
  invariant(JSON.stringify(index.payloadChunks) === JSON.stringify(EXPECTED_CHUNKS), 'authority map chunk path drift');
  invariant(new Set(index.payloadChunks).size === EXPECTED_CHUNKS.length, 'authority map chunk paths must be unique');

  const base64 = index.payloadChunks.map((path) => {
    const text = fs.readFileSync(path, 'utf8').trim();
    invariant(/^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0, `authority map chunk base64 invalid:${path}`);
    invariant(Buffer.from(text, 'base64').toString('base64') === text, `authority map chunk base64 noncanonical:${path}`);
    return text;
  }).join('');
  const compressed = Buffer.from(base64, 'base64');
  invariant(sha256(compressed) === COMPRESSED_SHA, 'authority map compressed payload digest mismatch');
  const raw = gunzipSync(compressed);
  invariant(sha256(raw) === PAYLOAD_SHA, 'authority map raw payload digest mismatch');
  const manifest = JSON.parse(raw.toString('utf8'));
  invariant(manifest.schema === 'historical-full-replay-authority-map-r1/v1', 'authority map payload schema drift');
  invariant(manifest.sourceScopeIdentitySha256 === SCOPE_DIGEST, 'authority map payload source scope drift');
  invariant(manifest.launchCount === 147 && manifest.cohortCount === 9, 'authority map payload count drift');
  invariant(Array.isArray(manifest.rows) && manifest.rows.length === 147, 'authority map payload must contain 147 rows');
  invariant(manifest.rows.every((row,index) => row.ordinal === index + 1), 'authority map ordinal sequence drift');
  invariant(new Set(manifest.rows.map((row) => [row.blockNumber,row.blockHash,row.transactionHash,row.logIndex,row.tokenId,row.token,row.creator].join('|'))).size === 147, 'authority map duplicate launch identity');
  invariant(authorityMapDigest(manifest.rows) === MAP_DIGEST, 'authority map canonical digest mismatch');
  invariant(manifest.authorityMapSha256 === MAP_DIGEST, 'authority map claimed digest mismatch');
  return { index, manifest, indexRaw, raw, compressed };
}
