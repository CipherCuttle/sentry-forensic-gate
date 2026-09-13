import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH } from './authority/executableInfraAuthority.js';
import { assertLedgerWithinAuthorizedEpoch } from './authority/ledgerEpochGuard.js';
import { SqliteStore } from './db/sqliteStore.js';
import {
  CREATOR_OUTCOME_HORIZON_MS,
  CREATOR_OUTCOME_JOIN_V0,
  projectCreatorOutcomeFeatures
} from './forensic/creatorOutcome.js';
import { INK_CHAIN_ID } from './sentry/contracts.js';

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
assertLedgerWithinAuthorizedEpoch(dbPath, INK_CHAIN_ID, CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock);
const store = new SqliteStore(dbPath, INK_CHAIN_ID);

try {
  const receipts = await projectCreatorOutcomeFeatures(
    await store.listBaselineDecisionPoints(),
    await store.listProvenanceFacts(),
    await store.listOutcomes()
  );
  console.log(JSON.stringify(jsonSafe({
    derivationVersion: CREATOR_OUTCOME_JOIN_V0,
    horizonMs: CREATOR_OUTCOME_HORIZON_MS,
    receiptCount: receipts.length,
    receipts
  })));
} finally {
  store.close();
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, v]) => [key, jsonSafe(v)]));
  }
  return value;
}
