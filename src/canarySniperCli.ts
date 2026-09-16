import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Hex } from './domain.js';
import {
  assertAuthorizedExecutableStartBlock,
  CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH
} from './authority/executableInfraAuthority.js';
import { assertLedgerWithinAuthorizedEpoch } from './authority/ledgerEpochGuard.js';
import { assertAuthorizedSentryStartBlock } from './authority/sentryAuthority.js';
import { CanaryStore } from './canary/store.js';
import { syncCanarySniper, type CanaryCycleOptions } from './canary/cycle.js';
import { ViemCanaryExecutor } from './canary/viemCanaryExecutor.js';
import { SqliteStore } from './db/sqliteStore.js';
import { ViemForwardOutcomeSource } from './outcome/viemSource.js';
import { syncExecutableBaseline, type ExecutableBaselineOptions } from './runtime/executableBaseline.js';
import { syncForwardOutcomes, type ForwardOutcomeOptions } from './runtime/forwardOutcomes.js';
import { syncSentryTruth, type SentryTruthOptions } from './runtime/sentryTruth.js';
import { DEFAULT_INK_RPC_URL, DEFAULT_SENTRY_LAUNCH_FACTORY, INK_CHAIN_ID } from './sentry/contracts.js';
import { ViemSentryLaunchSource } from './sentry/viemSource.js';
import { ViemExecutableBaselineSource } from './tsunami/viemBaselineSource.js';

if (process.env.CANARY_SNIPER_R0_ENABLED !== 'true') throw new Error('CANARY_SNIPER_R0_REQUIRES_EXPLICIT_ENABLE');
const live = process.env.CANARY_LIVE === 'true';
const startBlockRaw = process.env.SENTRY_START_BLOCK;
if (!startBlockRaw) throw new Error('SENTRY_START_BLOCK is required; refuse to guess historical authority');
const startBlock = BigInt(startBlockRaw);
assertAuthorizedSentryStartBlock(startBlock);
assertAuthorizedExecutableStartBlock(startBlock);

const dbPath = resolve(process.env.DB_PATH ?? './data/sentry-forensic-gate.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
assertLedgerWithinAuthorizedEpoch(dbPath, INK_CHAIN_ID, CURRENT_EXECUTABLE_INFRA_AUTHORITY_EPOCH.fromBlock);
const rpcUrl = process.env.INK_RPC_URL ?? DEFAULT_INK_RPC_URL;
const factory = (process.env.SENTRY_LAUNCH_FACTORY as Hex | undefined) ?? DEFAULT_SENTRY_LAUNCH_FACTORY;

const truthOptions: SentryTruthOptions = {
  startBlock,
  confirmations: envBigInt('SENTRY_CONFIRMATIONS', 0n),
  maxBatchBlocks: envBigInt('SENTRY_MAX_BATCH_BLOCKS', 1000n),
  reorgLookbackBlocks: envBigInt('SENTRY_REORG_LOOKBACK_BLOCKS', 64n),
  pollIntervalMs: envInt('SENTRY_POLL_INTERVAL_MS', 500)
};
const baselineOptions: ExecutableBaselineOptions = {
  decisionDelayBlocks: envBigInt('BASELINE_DECISION_DELAY_BLOCKS', 2n),
  confirmations: envBigInt('BASELINE_CONFIRMATIONS', 0n),
  maxLaunchesPerSync: envInt('BASELINE_MAX_LAUNCHES_PER_SYNC', 100)
};
const outcomeOptions: ForwardOutcomeOptions = {
  confirmations: envBigInt('OUTCOME_CONFIRMATIONS', 2n),
  maxOutcomesPerSync: envInt('OUTCOME_MAX_PER_SYNC', 20)
};
const canaryOptions: CanaryCycleOptions = {
  live,
  candidateMaxAgeBlocks: envBigInt('CANARY_CANDIDATE_MAX_AGE_BLOCKS', 10n),
  candidateScanLimit: envInt('CANARY_CANDIDATE_SCAN_LIMIT', 25),
  buyLimit: 1,
  slippageBps: envInt('CANARY_SLIPPAGE_BPS', 1000),
  deadlineSeconds: envInt('CANARY_DEADLINE_SECONDS', 30)
};
const cycleIntervalMs = envInt('CANARY_POLL_INTERVAL_MS', 500);
if (cycleIntervalMs < 250) throw new Error('CANARY_POLL_INTERVAL_MS must be >= 250');

const store = new SqliteStore(dbPath, INK_CHAIN_ID);
const canaryStore = new CanaryStore(dbPath);
const truthSource = new ViemSentryLaunchSource({ rpcUrl, factory });
const baselineSource = new ViemExecutableBaselineSource({ rpcUrl });
const outcomeSource = new ViemForwardOutcomeSource({ rpcUrl });
const privateKey = process.env.CANARY_PRIVATE_KEY as Hex | undefined;
const executor = live
  ? new ViemCanaryExecutor({
      privateKey: requirePrivateKey(privateKey),
      rpcUrl,
      caps: {
        maxQuoteAgeBlocks: envBigInt('CANARY_MAX_QUOTE_AGE_BLOCKS', 1n),
        maxGas: envBigInt('CANARY_MAX_GAS', 500_000n),
        maxFeePerGas: envBigInt('CANARY_MAX_FEE_PER_GAS_WEI', 10_000_000_000n),
        maxPriorityFeePerGas: envBigInt('CANARY_MAX_PRIORITY_FEE_PER_GAS_WEI', 1_000_000_000n)
      }
    })
  : null;

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());

try {
  do {
    const truth = await syncSentryTruth(truthSource, store, truthOptions);
    const baseline = await syncExecutableBaseline(baselineSource, store, baselineOptions);
    const outcomes = await syncForwardOutcomes(outcomeSource, store, outcomeOptions);
    const canary = await syncCanarySniper({ store, canaryStore, baselineSource, executor, options: canaryOptions });
    console.log(JSON.stringify(jsonSafe({
      runtimeVersion: 'CANARY_SNIPER_R0',
      live,
      observedAtMs: Date.now(),
      truth,
      baseline,
      outcomes,
      canary
    })));
    if (canary.action === 'BLOCKED_SETUP') throw new Error(`CANARY_SETUP_BLOCKED:${canary.reason ?? 'UNKNOWN'}`);
    if (process.argv.includes('--once') || controller.signal.aborted) break;
    await sleep(cycleIntervalMs, controller.signal);
  } while (!controller.signal.aborted);
} finally {
  canaryStore.close();
  store.close();
}

function requirePrivateKey(value: Hex | undefined): Hex {
  if (!value) throw new Error('CANARY_LIVE_REQUIRES_PRIVATE_KEY');
  return value;
}
function envBigInt(name: string, fallback: bigint): bigint { const raw = process.env[name]; return raw ? BigInt(raw) : fallback; }
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
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolveSleep) => {
    const timer = setTimeout(resolveSleep, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); resolveSleep(); }, { once: true });
  });
}
