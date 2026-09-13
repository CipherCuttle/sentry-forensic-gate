import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteStore } from './db/sqliteStore.js';
import { runSentryTruth, syncSentryTruth, type SentryTruthOptions } from './runtime/sentryTruth.js';
import {
  DEFAULT_INK_RPC_URL,
  DEFAULT_SENTRY_LAUNCH_FACTORY,
  INK_CHAIN_ID
} from './sentry/contracts.js';
import { ViemSentryLaunchSource } from './sentry/viemSource.js';
import type { Hex } from './domain.js';

const startBlockRaw = process.env.SENTRY_START_BLOCK;
if (!startBlockRaw) throw new Error('SENTRY_START_BLOCK is required; refuse to guess historical authority');

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

const options: SentryTruthOptions = {
  startBlock: BigInt(startBlockRaw),
  confirmations: envBigInt('SENTRY_CONFIRMATIONS', 2n),
  maxBatchBlocks: envBigInt('SENTRY_MAX_BATCH_BLOCKS', 1000n),
  reorgLookbackBlocks: envBigInt('SENTRY_REORG_LOOKBACK_BLOCKS', 64n),
  pollIntervalMs: envInt('SENTRY_POLL_INTERVAL_MS', 1500)
};

const source = new ViemSentryLaunchSource({
  rpcUrl: process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL,
  factory: (process.env.SENTRY_LAUNCH_FACTORY as Hex | undefined) ?? DEFAULT_SENTRY_LAUNCH_FACTORY
});
const store = new SqliteStore(dbPath, INK_CHAIN_ID);

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}

try {
  if (process.argv.includes('--once')) {
    const report = await syncSentryTruth(source, store, options);
    console.log(JSON.stringify(jsonSafe(report)));
  } else {
    await runSentryTruth(source, store, options, controller.signal, (report) => {
      if (report.batches > 0 || report.reorgRewindFrom !== null) console.log(JSON.stringify(jsonSafe(report)));
    });
  }
} finally {
  store.close();
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = process.env[name];
  return raw ? BigInt(raw) : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}
