import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalIdentity(row) {
  return {
    ordinal: Number(row.ordinal),
    event: row.event,
    blockNumber: String(row.blockNumber),
    blockHash: String(row.blockHash).toLowerCase(),
    transactionHash: String(row.transactionHash).toLowerCase(),
    logIndex: Number(row.logIndex),
    tokenId: String(row.tokenId),
    token: String(row.token).toLowerCase(),
    creator: String(row.creator).toLowerCase(),
  };
}

export function identityDigest(rows) {
  const payload = rows.map((row) => {
    const c = canonicalIdentity(row);
    return [c.ordinal, c.event, c.blockNumber, c.blockHash, c.transactionHash, c.logIndex, c.tokenId, c.token, c.creator].join('|');
  }).join('\n');
  return sha256(payload);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function loadFrozenScopeManifest(indexPath = 'fixtures/historical-full-replay-scope-r1.json') {
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  invariant(index.schema === 'historical-full-replay-scope-r1/index-v1', 'unexpected frozen scope index schema');
  invariant(index.encoding === 'gzip+base64-chunks', 'unexpected frozen scope encoding');
  invariant(index.sourceRange?.fromBlock === '39943476' && index.sourceRange?.toBlock === '49271598', 'frozen scope range drift');
  invariant(index.sourceRange?.expectedLaunches === 147 && index.sourceRange?.observedLaunches === 147, 'frozen scope index must describe 147 launches');
  invariant(index.uniqueIdentityCount === 147, 'frozen scope index unique count must remain 147');
  invariant(/^[0-9a-f]{64}$/.test(index.launchIdentitySha256 ?? ''), 'frozen scope identity digest missing');
  invariant(/^[0-9a-f]{64}$/.test(index.payloadSha256 ?? ''), 'frozen scope payload digest missing');
  invariant(/^[0-9a-f]{64}$/.test(index.compressedPayloadSha256 ?? ''), 'frozen scope compressed payload digest missing');
  invariant(Array.isArray(index.payloadChunks) && index.payloadChunks.length === 5, 'frozen scope must contain exactly five payload chunks');
  invariant(new Set(index.payloadChunks).size === index.payloadChunks.length, 'frozen scope payload chunk paths must be unique');
  for (const [i, path] of index.payloadChunks.entries()) {
    const expected = `fixtures/historical-full-replay-scope-r1.part-${String(i + 1).padStart(3, '0')}.b64`;
    invariant(path === expected, `frozen scope payload chunk path drift: ${path}`);
    invariant(fs.existsSync(path) && fs.statSync(path).isFile(), `frozen scope payload chunk missing: ${path}`);
  }

  const base64 = index.payloadChunks.map((path) => fs.readFileSync(path, 'utf8').trim()).join('');
  const compressed = Buffer.from(base64, 'base64');
  invariant(compressed.toString('base64') === base64, 'frozen scope payload base64 is not canonical');
  invariant(sha256(compressed) === index.compressedPayloadSha256, 'frozen scope compressed payload digest mismatch');
  const raw = gunzipSync(compressed);
  invariant(sha256(raw) === index.payloadSha256, 'frozen scope payload digest mismatch');

  const manifest = JSON.parse(raw.toString('utf8'));
  invariant(manifest.schema === 'historical-full-replay-scope-r1/v1', 'unexpected frozen scope manifest schema');
  invariant(manifest.sourceRange?.fromBlock === '39943476' && manifest.sourceRange?.toBlock === '49271598', 'frozen scope manifest range drift');
  invariant(manifest.sourceRange?.expectedLaunches === 147 && manifest.sourceRange?.observedLaunches === 147, 'frozen scope manifest must contain 147 launches');
  invariant(manifest.uniqueIdentityCount === 147, 'frozen scope manifest unique count must remain 147');
  invariant(Array.isArray(manifest.launches) && manifest.launches.length === 147, 'frozen scope manifest launch list must contain 147 rows');
  const rows = manifest.launches.map(canonicalIdentity);
  invariant(new Set(rows.map((row) => JSON.stringify(row))).size === 147, 'frozen scope manifest contains duplicate identities');
  const digest = identityDigest(rows);
  invariant(digest === manifest.launchIdentitySha256, 'frozen scope manifest claimed identity digest mismatch');
  invariant(digest === index.launchIdentitySha256, 'frozen scope index identity digest mismatch');
  invariant(rows[0].blockNumber === '39943476', 'frozen scope first launch block drift');
  invariant(rows.at(-1).blockNumber === '49271598', 'frozen scope final launch block drift');
  return { index, manifest: { ...manifest, launches: rows } };
}
