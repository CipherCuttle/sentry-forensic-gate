import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { assertLedgerWithinAuthorizedEpoch } from './authority/ledgerEpochGuard.js';
import { assertAuthorizedSentryStartBlock, CURRENT_SENTRY_AUTHORITY_EPOCH } from './authority/sentryAuthority.js';
import { SqliteStore } from './db/sqliteStore.js';
import { ViemForwardOutcomeSource } from './outcome/viemSource.js';
import { syncExecutableBaseline, type ExecutableBaselineOptions } from './runtime/executableBaseline.js';
import { syncForwardOutcomes, type ForwardOutcomeOptions } from './runtime/forwardOutcomes.js';
import { syncSentryTruth, type SentryTruthOptions } from './runtime/sentryTruth.js';
import {
  DEFAULT_INK_RPC_URL,
  DEFAULT_SENTRY_LAUNCH_FACTORY,
  INK_CHAIN_ID
} from './sentry/contracts.js';
import { ViemSentryLaunchSource } from './sentry/viemSource.js';
import { ViemExecutableBaselineSource } from './tsunami/viemBaselineSource.js';
import type { Hex } from './domain.js';

const startBlockRaw = process.env.SENTRY_START_BLOCK;
if (!startBlockRaw) throw new Error('SENTRY_START_BLOCK is required; refuse to guess historical authority');
const startBlock = BigInt(startBlockRaw);
assertAuthorizedSentryStartBlock(startBlock);
if (process.env.SHADOW_ONLY !== 'true') {
  throw new Error('RESEARCH_RUNTIME_REQUIRES_SHADOW_ONLY_TRUE');
}

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
assertLedgerWithinAuthorizedEpoch(dbPath, INK_CHAIN_ID, CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock);

const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const factory = (process.env.SENTRY_LAUNCH_FACTORY as Hex | undefined) ?? DEFAULT_SENTRY_LAUNCH_FACTORY;
const truthOptions: SentryTruthOptions = {
  startBlock,
  confirmations: envBigInt('SENTRY_CONFIRMATIONS', 2n),
  maxBatchBlocks: envBigInt('SENTRY_MAX_BATCH_BLOCKS', 1000n),
  reorgLookbackBlocks: envBigInt('SENTRY_REORG_LOOKBACK_BLOCKS', 64n),
  pollIntervalMs: envInt('SENTRY_POLL_INTERVAL_MS', 1500)
};
const baselineOptions: ExecutableBaselineOptions = {
  decisionDelayBlocks: envBigInt('BASELINE_DECISION_DELAY_BLOCKS', 2n),
  confirmations: envBigInt('BASELINE_CONFIRMATIONS', 2n),
  maxLaunchesPerSync: envInt('BASELINE_MAX_LAUNCHES_PER_SYNC', 100)
};
const outcomeOptions: ForwardOutcomeOptions = {
  confirmations: envBigInt('OUTCOME_CONFIRMATIONS', 2n),
  maxOutcomesPerSync: envInt('OUTCOME_MAX_PER_SYNC', 100)
};
const cycleIntervalMs = envInt('RUNTIME_POLL_INTERVAL_MS', 5000);
if (cycleIntervalMs < 100) throw new Error('RUNTIME_POLL_INTERVAL_MS must be >= 100');

const store = new SqliteStore(dbPath, INK_CHAIN_ID);
const truthSource = new ViemSentryLaunchSource({ rpcUrl, factory });
const baselineSource = new ViemExecutableBaselineSource({ rpcUrl });
const outcomeSource = new ViemForwardOutcomeSource({ rpcUrl });
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => controller.abort());
}

try {
  do {
    const truth = await syncSentryTruth(truthSource, store, truthOptions);
    const baseline = await syncExecutableBaseline(baselineSource, store, baselineOptions);
    const outcomes = await syncForwardOutcomes(outcomeSource, store, outcomeOptions);
    console.log(JSON.stringify(jsonSafe({
      runtimeVersion: 'RESEARCH_RUNTIME_ACTIVATION_R1',
      observedAtMs: Date.now(),
      authorityEpoch: {
        version: CURRENT_SENTRY_AUTHORITY_EPOCH.version,
        fromBlock: CURRENT_SENTRY_AUTHORITY_EPOCH.fromBlock,
        implementation: CURRENT_SENTRY_AUTHORITY_EPOCH.implementation,
        upgradeTx: CURRENT_SENTRY_AUTHORITY_EPOCH.upgradeTx
      },
      truth,
      baseline,
      outcomes
    })));

    if (process.argv.includes('--once') || controller.signal.aborted) break;
    await sleep(cycleIntervalMs, controller.signal);
  } while (!controller.signal.aborted);
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
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolveSleep();
    }, { once: true });
  });
}
