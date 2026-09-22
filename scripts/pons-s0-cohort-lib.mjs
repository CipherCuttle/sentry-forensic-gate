import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import {
  CURRENT_PONS_V2_AUTHORITY,
  CURRENT_PONS_V2_CURVE_TEMPLATE_AUTHORITY,
  CURRENT_PONS_V2_FORWARD_OUTCOME_AUTHORITY,
  CURRENT_ROBINHOOD_USDG_CALIBRATION_AUTHORITY,
  ROBINHOOD_CHAIN_ID,
  ViemPonsV2CurveQuoteAdapter,
  ViemPonsV2ForwardOutcomeAdapter,
  ViemPonsV2LaunchAdapter,
  ViemRobinhoodUsdCalibrationAdapter,
  buildNormalizedProvenanceFact,
  derivePonsV2EventId,
  derivePonsV2LaunchId,
  sha256Hex
} from '../dist/index.js';

export const SOURCE_REPOSITORY = 'CipherCuttle/sentry-forensic-gate';
export const EXPECTED_SOURCE_COMMIT =
  '493c85b8d84565cedf6e936063549edfa02edf3a';
export const ORIGIN_RECEIPT_SCHEMA = 'PONS_S0_EXTERNAL_ORIGIN_RECEIPT_V1';
export const COHORT_PLAN_SCHEMA = 'PONS_S0_COHORT_PLAN_V1';
export const SHARD_FRAGMENT_SCHEMA = 'PONS_S0_SHARD_FRAGMENT_V1';
export const HORIZON_MS = 86_400_000;
export const DEFAULT_CONFIRMATIONS = 12n;
export const DEFAULT_COHORT_TARGET_COUNT = 96;
export const DEFAULT_SHARD_COUNT = 16;

export function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  assert.ok(
    Number.isSafeInteger(parsed) && parsed > 0,
    label + ' must be a positive safe integer'
  );
  return parsed;
}

export function sha256Utf8(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertReviewedSourceCheckout() {
  const sourceCommit =
    process.env.PONS_S0_SOURCE_COMMIT ?? EXPECTED_SOURCE_COMMIT;
  assert.equal(
    sourceCommit,
    EXPECTED_SOURCE_COMMIT,
    'PONS_S0_SOURCE_COMMIT must remain pinned to the reviewed PR-A head'
  );
  const actualSourceCommit = execFileSync(
    'git',
    ['rev-parse', 'HEAD'],
    { encoding: 'utf8' }
  ).trim();
  assert.equal(
    actualSourceCommit,
    EXPECTED_SOURCE_COMMIT,
    'materializer must execute against the exact reviewed PR-A source commit'
  );
}

export function pacedClient(rawClient, minIntervalMs) {
  let tail = Promise.resolve();
  let lastStartedAt = 0;
  const historicalCache = new Map();
  const cacheable = new Set(['getBytecode', 'getStorageAt', 'readContract', 'call']);

  const paced = (operation) => {
    const run = tail.then(async () => {
      const waitMs = Math.max(0, lastStartedAt + minIntervalMs - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      lastStartedAt = Date.now();
      return operation();
    });
    tail = run.catch(() => undefined);
    return run;
  };

  return new Proxy(rawClient, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      const method = String(property);
      if (
        typeof value !== 'function' ||
        !['getChainId','getBlockNumber','getBlock','getBytecode','getLogs','getStorageAt','readContract','call'].includes(method)
      ) {
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (...args) => {
        if (!cacheable.has(method)) return paced(() => value.apply(target, args));
        const argsJson = JSON.stringify(args, (_key, item) =>
          typeof item === 'bigint' ? item.toString() : item
        );
        if (!argsJson.includes('"blockNumber"')) {
          return paced(() => value.apply(target, args));
        }
        const key = method + ':' + argsJson;
        const existing = historicalCache.get(key);
        if (existing) return existing;
        const run = paced(() => value.apply(target, args));
        historicalCache.set(key, run);
        run.catch(() => historicalCache.delete(key));
        return run;
      };
    }
  });
}

export function compareLogs(a, b) {
  assert.ok(a.blockNumber !== null && b.blockNumber !== null);
  assert.ok(a.logIndex !== null && b.logIndex !== null);
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }
  return a.logIndex - b.logIndex;
}

export function compareLaunches(a, b) {
  if (a.blockNumber !== b.blockNumber) {
    return a.blockNumber < b.blockNumber ? -1 : 1;
  }
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
  return a.launchId.localeCompare(b.launchId);
}

export function compareBigInt(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function launchLogKey(log) {
  assert.ok(log.blockNumber !== null, 'PONS_S0_LOG_BLOCK_MISSING');
  assert.ok(log.transactionHash, 'PONS_S0_LOG_TX_HASH_MISSING');
  assert.ok(log.logIndex !== null, 'PONS_S0_LOG_INDEX_MISSING');
  return [
    log.blockNumber.toString(),
    log.transactionHash.toLowerCase(),
    String(log.logIndex)
  ].join(':');
}

export function systematicOrdinalSample(items, targetCount) {
  assert.ok(items.length > 0, 'PONS_S0_SAMPLE_EMPTY_UNIVERSE');
  const count = Math.min(items.length, targetCount);
  if (count === items.length) return [...items];
  if (count === 1) return [items[0]];
  const selected = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(
      (i * (items.length - 1)) / (count - 1)
    );
    selected.push(items[index]);
  }
  return selected;
}

export async function loadIndexedLaunchLogs(input) {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(input.path);
  const sha256 = sha256Bytes(raw);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw new Error(
      'PONS_S0_LAUNCH_INDEX_MALFORMED:' +
      (error instanceof Error ? error.message : String(error))
    );
  }
  assert.equal(
    parsed.schema,
    'ROBINHOOD_RPC_PONS_S0_LAUNCH_INDEX_V1',
    'PONS_S0_LAUNCH_INDEX_SCHEMA_MISMATCH'
  );
  assert.equal(
    String(parsed.factory).toLowerCase(),
    CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase(),
    'PONS_S0_LAUNCH_INDEX_FACTORY_MISMATCH'
  );
  assert.equal(
    BigInt(parsed.scannedFromBlock),
    input.authorityFromBlock,
    'PONS_S0_LAUNCH_INDEX_START_MISMATCH'
  );
  const scannedThroughBlock = BigInt(parsed.scannedThroughBlock);
  const observedHeadBlock = BigInt(
    parsed.observedHeadBlock
  );
  assert.ok(
    scannedThroughBlock >= input.matureThroughBlock,
    'PONS_S0_LAUNCH_INDEX_RANGE_TOO_SHORT'
  );
  assert.ok(
    observedHeadBlock >= input.matureThroughBlock,
    'PONS_S0_LAUNCH_INDEX_BEHIND_MATURITY_BOUNDARY'
  );
  assert.ok(
    Array.isArray(parsed.logs),
    'PONS_S0_LAUNCH_INDEX_LOGS_MISSING'
  );

  const logs = parsed.logs
    .map((item) => {
      assert.ok(
        item && typeof item === 'object' && !Array.isArray(item),
        'PONS_S0_LAUNCH_INDEX_LOG_INVALID'
      );
      const blockNumber = BigInt(item.blockNumber);
      const logIndex = Number(item.logIndex);
      assert.ok(
        Number.isSafeInteger(logIndex) && logIndex >= 0,
        'PONS_S0_LAUNCH_INDEX_LOG_INDEX_INVALID'
      );
      assert.match(
        String(item.blockHash),
        /^0x[0-9a-fA-F]{64}$/,
        'PONS_S0_LAUNCH_INDEX_BLOCK_HASH_INVALID'
      );
      assert.match(
        String(item.transactionHash),
        /^0x[0-9a-fA-F]{64}$/,
        'PONS_S0_LAUNCH_INDEX_TX_INVALID'
      );
      assert.match(
        String(item.token),
        /^0x[0-9a-fA-F]{40}$/,
        'PONS_S0_LAUNCH_INDEX_TOKEN_INVALID'
      );
      assert.match(
        String(item.deployer),
        /^0x[0-9a-fA-F]{40}$/,
        'PONS_S0_LAUNCH_INDEX_DEPLOYER_INVALID'
      );
      return {
        blockNumber,
        blockHash: String(item.blockHash).toLowerCase(),
        transactionHash: String(item.transactionHash).toLowerCase(),
        logIndex,
        args: {
          token: String(item.token).toLowerCase(),
          deployer: String(item.deployer).toLowerCase()
        }
      };
    })
    .filter((log) =>
      log.blockNumber >= input.authorityFromBlock &&
      log.blockNumber <= input.matureThroughBlock
    )
    .sort(compareLogs);

  return {
    sha256,
    scannedThroughBlock,
    observedHeadBlock,
    logs
  };
}

export async function rawLaunchLogToProvenanceFact(
  log,
  client,
  blockHashCache
) {
  assert.ok(log.blockNumber !== null, 'PONS_S0_LOG_BLOCK_MISSING');
  assert.ok(log.transactionHash, 'PONS_S0_LOG_TX_HASH_MISSING');
  assert.ok(log.logIndex !== null, 'PONS_S0_LOG_INDEX_MISSING');
  const args = log.args ?? {};
  assert.equal(
    typeof args.token,
    'string',
    'PONS_S0_LOG_TOKEN_MISSING'
  );
  assert.equal(
    typeof args.deployer,
    'string',
    'PONS_S0_LOG_DEPLOYER_MISSING'
  );

  const blockKey = log.blockNumber.toString();
  let blockHash = log.blockHash ?? blockHashCache.get(blockKey);
  if (!blockHash) {
    const block = await client.getBlock({
      blockNumber: log.blockNumber
    });
    assert.ok(
      block.hash,
      'PONS_S0_RELEVANT_LOG_BLOCK_HASH_MISSING:' + blockKey
    );
    blockHash = block.hash.toLowerCase();
  }
  blockHashCache.set(blockKey, blockHash);

  const factory = CURRENT_PONS_V2_AUTHORITY.factory.toLowerCase();
  const txHash = log.transactionHash.toLowerCase();
  const token = args.token.toLowerCase();
  const creator = args.deployer.toLowerCase();
  const [launchId, eventId] = await Promise.all([
    derivePonsV2LaunchId({
      chainId: ROBINHOOD_CHAIN_ID,
      factory,
      txHash,
      token
    }),
    derivePonsV2EventId({
      chainId: ROBINHOOD_CHAIN_ID,
      factory,
      txHash,
      logIndex: log.logIndex
    })
  ]);
  return buildNormalizedProvenanceFact({
    chainId: ROBINHOOD_CHAIN_ID,
    launchId,
    creator,
    blockNumber: log.blockNumber,
    blockHash,
    logIndex: log.logIndex,
    eventId
  });
}

export function progress(phase, extra) {
  writeSync(
    2,
    JSON.stringify({
      progress: 'PONS_S0_MATERIALIZATION_PROGRESS',
      phase,
      ...extra
    }) + '\n'
  );
}

export function encodeJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') {
      return { $bigint: item.toString() };
    }
    return item;
  });
}

export function decodeJson(text) {
  return JSON.parse(text, (_key, item) => {
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      Object.keys(item).length === 1 &&
      typeof item.$bigint === 'string'
    ) {
      return BigInt(item.$bigint);
    }
    return item;
  });
}

export function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)])
    );
  }
  return value;
}