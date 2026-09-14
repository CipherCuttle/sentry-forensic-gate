import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, parseAbiItem } from 'viem';

const RPC_URL = process.env.INK_RPC_URL ?? 'https://rpc-gel.inkonchain.com';
const OUTPUT_PATH = process.env.OUTPUT_PATH ?? 'historical-full-replay-scope-r1.json';
const EXPECTED_SCOPE_PATH = process.env.EXPECTED_SCOPE_PATH ?? 'fixtures/historical-full-replay-scope-r1.json';

const CHAIN = {
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

const SENTRY_PROXY = '0xDc37e11B68052d1539fa23386eE58Ac444bf5BE1';
const FROM_BLOCK = 39_943_476n;
const TO_BLOCK = 49_271_598n;
const EXPECTED_LAUNCHES = 147;
const MAX_LOG_SPAN = 150_000n;
const MIN_LOG_SPAN = 2_000n;
const REQUEST_PACING_MS = 300;
const MAX_RATE_LIMIT_RETRIES = 6;

const deploymentEvents = [
  parseAbiItem('event TokenDeployed(address indexed token, string name, string symbol, address indexed creator, uint256 tokenId)'),
  parseAbiItem('event KrakenVerifiedTokenDeployed(address indexed token, string name, string symbol, address indexed creator, uint256 tokenId)'),
  parseAbiItem('event GoPumpMeTokenDeployed(address indexed token, string name, string symbol, address indexed creator, uint256 tokenId)'),
];

const client = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL, { retryCount: 2, timeout: 20_000 }),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lower = (value) => String(value).toLowerCase();
const json = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);

function errorText(error) {
  return [error?.shortMessage, error?.message, error?.cause?.shortMessage, error?.cause?.message]
    .filter(Boolean)
    .join(' | ');
}

function isRateLimit(error) {
  return /rate limit|too many requests|\b429\b|-32016/i.test(errorText(error));
}

function canonicalIdentity(row) {
  return {
    ordinal: Number(row.ordinal),
    event: row.event,
    blockNumber: String(row.blockNumber),
    blockHash: lower(row.blockHash),
    transactionHash: lower(row.transactionHash),
    logIndex: Number(row.logIndex),
    tokenId: String(row.tokenId),
    token: lower(row.token),
    creator: lower(row.creator),
  };
}

function identityDigest(rows) {
  const payload = rows
    .map((row) => {
      const c = canonicalIdentity(row);
      return [
        c.ordinal,
        c.event,
        c.blockNumber,
        c.blockHash,
        c.transactionHash,
        c.logIndex,
        c.tokenId,
        c.token,
        c.creator,
      ].join('|');
    })
    .join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

async function discoverLaunches() {
  const all = [];
  let cursor = FROM_BLOCK;
  let span = MAX_LOG_SPAN;

  while (cursor <= TO_BLOCK) {
    const end = cursor + span - 1n > TO_BLOCK ? TO_BLOCK : cursor + span - 1n;
    let completed = false;
    let rateLimitRetries = 0;

    while (!completed) {
      try {
        const chunk = await client.getLogs({
          address: SENTRY_PROXY,
          events: deploymentEvents,
          fromBlock: cursor,
          toBlock: end,
          strict: true,
        });
        all.push(...chunk);
        completed = true;
      } catch (error) {
        if (isRateLimit(error) && rateLimitRetries < MAX_RATE_LIMIT_RETRIES) {
          const waitMs = Math.min(8_000, 1_000 * (2 ** rateLimitRetries));
          rateLimitRetries += 1;
          await sleep(waitMs);
          continue;
        }
        if (span > MIN_LOG_SPAN) {
          span = span / 2n < MIN_LOG_SPAN ? MIN_LOG_SPAN : span / 2n;
          break;
        }
        throw error;
      }
    }

    if (!completed) continue;
    cursor = end + 1n;
    if (span < MAX_LOG_SPAN) span = span * 2n > MAX_LOG_SPAN ? MAX_LOG_SPAN : span * 2n;
    await sleep(REQUEST_PACING_MS);
  }

  const decoded = all.map((log) => ({
    event: log.eventName,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: Number(log.logIndex),
    token: log.args.token,
    creator: log.args.creator,
    tokenId: log.args.tokenId,
    name: log.args.name,
    symbol: log.args.symbol,
  }));

  const dedup = new Map();
  for (const row of decoded) {
    const key = `${row.blockNumber}:${row.tokenId}:${lower(row.token)}`;
    const prior = dedup.get(key);
    if (!prior || row.logIndex < prior.logIndex) dedup.set(key, row);
  }

  const launches = [...dedup.values()].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber ? -1 : 1
  );

  if (launches.length !== EXPECTED_LAUNCHES) {
    throw new Error(`HISTORICAL_LAUNCH_COUNT_MISMATCH:expected=${EXPECTED_LAUNCHES}:actual=${launches.length}`);
  }
  if (launches[0]?.blockNumber !== FROM_BLOCK) {
    throw new Error(`HISTORICAL_FIRST_LAUNCH_BLOCK_MISMATCH:expected=${FROM_BLOCK}:actual=${launches[0]?.blockNumber}`);
  }
  if (launches.at(-1)?.blockNumber !== TO_BLOCK) {
    throw new Error(`HISTORICAL_FINAL_LAUNCH_BLOCK_MISMATCH:expected=${TO_BLOCK}:actual=${launches.at(-1)?.blockNumber}`);
  }

  return launches.map((row, index) => ({ ordinal: index + 1, ...row }));
}

const chainId = await client.getChainId();
if (chainId !== CHAIN.id) throw new Error(`CHAIN_ID_MISMATCH:${chainId}`);

const launches = await discoverLaunches();
const launchIdentitySha256 = identityDigest(launches);
const canonicalLaunches = launches.map(canonicalIdentity);
const uniqueIdentityCount = new Set(canonicalLaunches.map((row) => JSON.stringify(row))).size;
if (uniqueIdentityCount !== EXPECTED_LAUNCHES) {
  throw new Error(`HISTORICAL_SCOPE_IDENTITY_DUPLICATE:expected=${EXPECTED_LAUNCHES}:actual=${uniqueIdentityCount}`);
}

let fixtureMatch = null;
let fixtureDigest = null;
if (existsSync(EXPECTED_SCOPE_PATH)) {
  const expected = JSON.parse(readFileSync(EXPECTED_SCOPE_PATH, 'utf8'));
  fixtureDigest = expected.launchIdentitySha256 ?? null;
  const expectedRows = Array.isArray(expected.launches) ? expected.launches.map(canonicalIdentity) : [];
  fixtureMatch = expected.launchIdentitySha256 === launchIdentitySha256
    && expectedRows.length === canonicalLaunches.length
    && JSON.stringify(expectedRows) === JSON.stringify(canonicalLaunches);
  if (!fixtureMatch) throw new Error('HISTORICAL_SCOPE_FIXTURE_MISMATCH');
}

const receipt = {
  schema: 'historical-full-replay-scope-r1/v1',
  status: 'SCOPE_DISCOVERY_COMPLETE_NO_REPLAY_AUTHORITY',
  providerOrigin: new URL(RPC_URL).origin,
  chainId,
  sentryProxy: SENTRY_PROXY,
  sourceRange: {
    fromBlock: FROM_BLOCK,
    toBlock: TO_BLOCK,
    expectedLaunches: EXPECTED_LAUNCHES,
    observedLaunches: launches.length,
  },
  launchIdentitySha256,
  uniqueIdentityCount,
  fixturePath: EXPECTED_SCOPE_PATH,
  fixturePresent: existsSync(EXPECTED_SCOPE_PATH),
  fixtureDigest,
  fixtureMatch,
  launches,
};

writeFileSync(OUTPUT_PATH, `${json(receipt)}\n`, 'utf8');
console.log(json({
  observedLaunches: launches.length,
  firstLaunchBlock: launches[0].blockNumber,
  finalLaunchBlock: launches.at(-1).blockNumber,
  launchIdentitySha256,
  fixturePresent: receipt.fixturePresent,
  fixtureMatch,
}));
console.log(`RECEIPT_PATH=${OUTPUT_PATH}`);
