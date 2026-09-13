import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH } from './authority/executableInfraAuthority.js';
import { assertLedgerWithinAuthorizedEpoch } from './authority/ledgerEpochGuard.js';
import { SqliteStore } from './db/sqliteStore.js';
import { runExecutableBaseline, syncExecutableBaseline, type ExecutableBaselineOptions } from './runtime/executableBaseline.js';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from './sentry/contracts.js';
import { ViemExecutableBaselineSource } from './tsunami/viemBaselineSource.js';

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
assertLedgerWithinAuthorizedEpoch(dbPath, INK_CHAIN_ID, CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock);

const options: ExecutableBaselineOptions = {
  decisionDelayBlocks: envBigInt('BASELINE_DECISION_DELAY_BLOCKS', 2n),
  confirmations: envBigInt('BASELINE_CONFIRMATIONS', 2n),
  maxLaunchesPerSync: envInt('BASELINE_MAX_LAUNCHES_PER_SYNC', 100),
  pollIntervalMs: envInt('BASELINE_POLL_INTERVAL_MS', 1500)
};

const source = new ViemExecutableBaselineSource({
  rpcUrl: process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL
});
const store = new SqliteStore(dbPath, INK_CHAIN_ID);
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());

try {
  if (process.argv.includes('--once')) {
    console.log(JSON.stringify(jsonSafe(await syncExecutableBaseline(source, store, options))));
  } else {
    await runExecutableBaseline(source, store, options, controller.signal, (report) => {
      if (report.processed > 0) console.log(JSON.stringify(jsonSafe(report)));
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
