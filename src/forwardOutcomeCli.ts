import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteStore } from './db/sqliteStore.js';
import { ViemForwardOutcomeSource } from './outcome/viemSource.js';
import { runForwardOutcomes, syncForwardOutcomes, type ForwardOutcomeOptions } from './runtime/forwardOutcomes.js';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from './sentry/contracts.js';

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });

const options: ForwardOutcomeOptions = {
  confirmations: envBigInt('OUTCOME_CONFIRMATIONS', 2n),
  maxOutcomesPerSync: envInt('OUTCOME_MAX_PER_SYNC', 100),
  pollIntervalMs: envInt('OUTCOME_POLL_INTERVAL_MS', 1500)
};

const source = new ViemForwardOutcomeSource({ rpcUrl: process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL });
const store = new SqliteStore(dbPath, INK_CHAIN_ID);
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());

try {
  if (process.argv.includes('--once')) {
    console.log(JSON.stringify(jsonSafe(await syncForwardOutcomes(source, store, options))));
  } else {
    await runForwardOutcomes(source, store, options, controller.signal, (report) => {
      if (report.processed > 0 || report.pendingMaturity > 0) console.log(JSON.stringify(jsonSafe(report)));
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
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, jsonSafe(v)]));
  }
  return value;
}
