import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('./pons-s0-historical-cohort.mjs', import.meta.url),
  'utf8'
);

for (const exact of [
  "const FROM_BLOCK = 63_500_000n;",
  "const THROUGH_BLOCK_EXCLUSIVE = 67_500_000n;",
  "const BUCKET_BLOCKS = 50_000n;",
  "const LOG_CHUNK_BLOCKS = 5_000n;",
  "const HORIZON_MS = 86_400_000;",
  "candidateRule: 'FIRST_NATIVE_PAIR_TOKEN_LAUNCHED_EVENT_PER_BUCKET'",
  "creatorFeaturePolicy: 'EXPLICIT_NULL_NO_HISTORICAL_CREATOR_BACKFILL_V1'",
  "creatorFeature: null",
  "buildPortableBaselineBatch(",
  "buildPortableForwardOutcome(",
  "buildPonsS0FeaturePacket(",
  "buildPonsS0OutcomePacket(",
  "buildPonsS0ResearchExportBundle(",
  "PONS_S0_HISTORICAL_COHORT_MATERIALIZED",
  "SENTRY_SOURCE_COMMIT must be the exact 40-character source commit"
]) {
  assert.ok(source.includes(exact), `missing frozen cohort invariant: ${exact}`);
}

for (const forbidden of [
  'PONS_S0_COHORT_FROM_BLOCK',
  'PONS_S0_COHORT_THROUGH_BLOCK',
  'PONS_S0_COHORT_BUCKET_BLOCKS',
  'createWalletClient',
  'privateKeyToAccount',
  'sendTransaction',
  'writeContract',
  'signTransaction',
  'signTypedData',
  'PONS_E0_PRIVATE_KEY'
]) {
  assert.equal(
    source.includes(forbidden),
    false,
    `historical cohort materializer must not contain: ${forbidden}`
  );
}

const selectionPosition = source.indexOf("const selectionReceipt =");
const featurePosition = source.indexOf("const featurePackets =");
const outcomeBuildPosition = source.indexOf("buildPortableForwardOutcome(");
assert.ok(selectionPosition >= 0 && featurePosition > selectionPosition);
assert.ok(outcomeBuildPosition > featurePosition);

assert.match(
  source,
  /RPC_URL === 'https:\/\/rpc\.nodeflare\.app\/robinhood\/public'[\s\S]*?'NODEFLARE_PUBLIC_ARCHIVE'/
);

console.log(JSON.stringify({
  verdict: 'PONS_S0_HISTORICAL_COHORT_CONTRACT_PASS',
  fixedWindow: {
    fromBlockInclusive: '63500000',
    throughBlockExclusive: '67500000',
    bucketBlocks: '50000',
    expectedBuckets: 80
  },
  selectionOutcomeIndependent: true,
  creatorHistoryExplicitNull: true,
  archiveProviderDefault: 'NODEFLARE_PUBLIC_ARCHIVE',
  walletAuthority: false,
  signingAuthority: false,
  broadcastAuthority: false,
  liveMoneyAuthority: false,
  edge: 'UNPROVEN'
}, null, 2));
