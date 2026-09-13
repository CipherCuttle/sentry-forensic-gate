import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteStore } from './db/sqliteStore.js';
import { buildCreatorSignalEvaluation } from './runtime/creatorSignalEval.js';
import { ViemForwardOutcomeSource } from './outcome/viemSource.js';
import { DEFAULT_INK_RPC_URL, INK_CHAIN_ID } from './sentry/contracts.js';

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
const store = new SqliteStore(dbPath, INK_CHAIN_ID);
const source = new ViemForwardOutcomeSource({ rpcUrl: process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL });

try {
  const receipt = await buildCreatorSignalEvaluation(source, store);
  console.log(JSON.stringify(jsonSafe(receipt)));
} finally {
  store.close();
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}
