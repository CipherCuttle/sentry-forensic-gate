// Explicitly launched read-only telemetry. No signer, private key, mempool speculation, grants or trades.
// The Nitro sequencer feed is NOT an eth_subscribe RPC endpoint; it is out of scope here.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createPublicClient, defineChain, http, keccak256, webSocket } from 'viem';
import {
  CURRENT_PONS_V2_AUTHORITY,
  DEFAULT_ROBINHOOD_RPC_URL,
  ROBINHOOD_CHAIN_ID,
  ponsV2TokenLaunchedEvent,
  ViemPonsV2LaunchAdapter
} from '../dist/index.js';
import { PonsLaunchArrivalLedger } from './pons-speed-arrival-core.mjs';

const getInt = (key, defaultValue, min, max) => {
  const value = Number(process.env[key] ?? defaultValue);
  assert.ok(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_' + key);
  return value;
};
const durationSeconds = getInt('PONS_SPEED_DURATION_SECONDS', 45, 5, 120);
const pollMs = getInt('PONS_SPEED_POLL_MS', 1_500, 750, 10_000);
const maxVerify = getInt('PONS_SPEED_VERIFY_SAMPLES', 2, 0, 5);
const httpUrl = process.env.PONS_SPEED_HTTP_URL ?? DEFAULT_ROBINHOOD_RPC_URL;
const wsUrl = process.env.PONS_SPEED_WS_URL;
assert.ok(/^https:\/\//i.test(httpUrl), 'HTTP_ENDPOINT_MUST_BE_HTTPS');
if (wsUrl !== undefined) assert.ok(/^wss:\/\//i.test(wsUrl), 'WS_ENDPOINT_MUST_BE_WSS');
const chain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_ROBINHOOD_RPC_URL] } }
});
const httpClient = createPublicClient({
  chain,
  transport: http(httpUrl, { retryCount: 0, timeout: 8_000 })
});
const wsClient = wsUrl ? createPublicClient({
  chain,
  transport: webSocket(wsUrl, { retryCount: 0, timeout: 8_000 })
}) : null;
const ledger = new PonsLaunchArrivalLedger();
let latestHead = null;
let cursor = null;
let scannedFirst = null;
let scannedLast = null;
let scanErrors = 0;
let wsErrors = 0;
let verifyStarted = 0;
const verification = [];
const factory = CURRENT_PONS_V2_AUTHORITY.factory;
const launchAdapter = new ViemPonsV2LaunchAdapter({
  authority: CURRENT_PONS_V2_AUTHORITY,
  client: httpClient
});
const print = (data) => process.stdout.write(JSON.stringify(data) + '\n');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const shortError = (error) => error instanceof Error ? error.name : 'UnknownError';

function maybeVerify(log) {
  if (verifyStarted >= maxVerify || !log?.args?.token) return;
  verifyStarted++;
  const origin = [log.blockHash?.toLowerCase(), log.transactionHash?.toLowerCase(), log.logIndex].join(':');
  const start = performance.now();
  const task = (async () => {
    try {
      const launches = await launchAdapter.catchUp(log.blockNumber, log.blockNumber);
      const matched = launches.some(entry =>
        entry.txHash?.toLowerCase() === log.transactionHash?.toLowerCase() &&
        entry.logIndex === log.logIndex
      );
      print({
        type: 'SAMPLED_EXISTING_LAUNCH_MATERIALIZATION',
        origin, matched, elapsedMs: Math.round((performance.now() - start) * 100) / 100,
        note: 'Measured after receipt; not the whole E0 quote/preflight path.'
      });
    } catch (error) {
      print({
        type: 'SAMPLED_EXISTING_LAUNCH_MATERIALIZATION',
        origin, matched: false, elapsedMs: Math.round((performance.now() - start) * 100) / 100,
        errorClass: shortError(error)
      });
    }
  })();
  verification.push(task);
}

function onLogs(source, logs) {
  for (const log of logs) {
    const monoMs = performance.now();
    const unixMs = Date.now();
    try {
      const result = ledger.observe(source, log, monoMs, unixMs);
      if (result.type !== 'DUPLICATE') print({ type: 'LAUNCH_ARRIVAL', ...result });
      // Deep-read timings use HTTP-observed logs only, never source-dependent first arrivals.
      if (source === 'HTTP' && (result.type === 'FIRST' || result.type === 'MATCHED')) maybeVerify(log);
    } catch (error) {
      ledger.errorCount++;
      print({ type: 'EVENT_REJECTED', source, errorClass: shortError(error) });
    }
  }
}

async function requireReviewedFactory(client, source) {
  assert.equal(await client.getChainId(), ROBINHOOD_CHAIN_ID, source + '_CHAIN_ID_MISMATCH');
  const code = await client.getBytecode({ address: factory });
  assert.ok(code && code !== '0x', source + '_FACTORY_CODE_MISSING');
  assert.equal(keccak256(code).toLowerCase(),
    CURRENT_PONS_V2_AUTHORITY.factoryRuntimeCodeHash.toLowerCase(),
    source + '_FACTORY_CODE_HASH_DRIFT');
}

async function pollOnce() {
  const before = performance.now();
  const head = await httpClient.getBlockNumber();
  if (latestHead !== null && head < latestHead) {
    throw new Error('HTTP_HEAD_REGRESSED');
  }
  latestHead = head;
  if (cursor === null) {
    cursor = head > 1n ? head - 1n : CURRENT_PONS_V2_AUTHORITY.fromBlock;
  }
  // Re-read the newest one or two blocks even when head is unchanged:
  // a provider can expose a header before it exposes every corresponding log.
  if (head < cursor) cursor = head;
  const fromBlock = cursor > CURRENT_PONS_V2_AUTHORITY.fromBlock + 1n ?
    cursor - 1n : cursor;
  const toBlock = fromBlock + 63n < head ? fromBlock + 63n : head;
  const logs = await httpClient.getLogs({
    address: factory,
    event: ponsV2TokenLaunchedEvent,
    fromBlock,
    toBlock,
    strict: true
  });
  const fetchedAt = performance.now();
  onLogs('HTTP', logs);
  scannedFirst ??= fromBlock;
  scannedLast = toBlock;
  cursor = toBlock + 1n;
  print({
    type: 'HTTP_POLL',
    firstBlock: fromBlock.toString(),
    lastBlock: toBlock.toString(),
    count: logs.length,
    elapsedMs: Math.round((fetchedAt - before) * 100) / 100,
    source: 'READ_ONLY'
  });
}

async function main() {
  await requireReviewedFactory(httpClient, 'HTTP');
  if (wsClient) await requireReviewedFactory(wsClient, 'WS');
  print({
    type: 'BENCHMARK_START',
    chainId: ROBINHOOD_CHAIN_ID,
    authorityId: CURRENT_PONS_V2_AUTHORITY.authorityId,
    factory,
    configuredSources: wsClient ? ['HTTP', 'WS'] : ['HTTP'],
    durationSeconds,
    pollMs,
    verifySamples: maxVerify,
    noTransactions: true,
    note: 'Do not infer sequencing priority, fill time or subsecond latency from block timestamps.'
  });
  let unwatch;
  if (wsClient) {
    unwatch = wsClient.watchContractEvent({
      address: factory,
      abi: [ponsV2TokenLaunchedEvent],
      eventName: 'TokenLaunched',
      strict: true,
      poll: false,
      onLogs: logs => onLogs('WS', logs),
      onError: error => {
        wsErrors++;
        ledger.errorCount++;
        print({ type: 'WS_SUBSCRIPTION_ERROR', errorClass: shortError(error) });
      }
    });
  }

  let httpProviderFailed = false;
  try {
    const end = performance.now() + durationSeconds * 1_000;
    while (performance.now() < end) {
      try {
        await pollOnce();
      } catch (error) {
        scanErrors++;
        ledger.errorCount++;
        httpProviderFailed = true;
        print({ type: 'HTTP_SCAN_ERROR', errorClass: shortError(error) });
      }
      await sleep(Math.min(pollMs, Math.max(0, end - performance.now())));
    }
  } finally {
    if (unwatch) await unwatch();
    await Promise.allSettled(verification);
    const result = ledger.summary();
    print({
      type: 'BENCHMARK_VERDICT',
      ...result,
      scannedFirst: scannedFirst?.toString() ?? null,
      scannedLast: scannedLast?.toString() ?? null,
      lastObservedHead: latestHead?.toString() ?? null,
      httpScanErrors: scanErrors,
      wsSubscriptionErrors: wsErrors,
      verificationSamples: verifyStarted,
      verdict: httpProviderFailed || wsErrors > 0 ? 'INCONCLUSIVE_PROVIDER_ERRORS' :
        wsClient && result.pairedSameBlockHash === 0 ? 'INCONCLUSIVE_NO_PAIRED_LAUNCHES' :
        !wsClient ? 'HTTP_ONLY_NO_WS_COMPARISON' : 'PAIRED_ARRIVAL_TELEMETRY_ONLY'
    });
    if (httpProviderFailed || wsErrors > 0) process.exitCode = 1;
  }
}

main().catch(error => {
  // Provider exceptions may embed credential-bearing URLs. Do NOT log error.message or the endpoint.
  print({ type: 'BENCHMARK_BLOCKED', errorClass: shortError(error), noTransactions: true });
  process.exitCode = 1;
});
