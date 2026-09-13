import type { Hex, LaunchObserved } from '../domain.js';
import type { Store } from '../db/store.js';
import { buildProvenanceFact, projectProvenanceEdges } from '../graph/provenance.js';
import type { LaunchSource } from '../sentry/ports.js';

export interface SentryTruthOptions {
  startBlock: bigint;
  confirmations: bigint;
  maxBatchBlocks: bigint;
  reorgLookbackBlocks: bigint;
  pollIntervalMs: number;
}

export interface SyncReport {
  headBlock: bigint;
  targetBlock: bigint | null;
  startBlock: bigint | null;
  endBlock: bigint | null;
  inserted: number;
  duplicates: number;
  batches: number;
  reorgRewindFrom: bigint | null;
}

export async function syncSentryTruth(source: LaunchSource, store: Store, options: SentryTruthOptions): Promise<SyncReport> {
  validateOptions(options);
  const headBlock = await source.getHeadBlockNumber();
  if (headBlock < options.confirmations) return emptyReport(headBlock);
  const targetBlock = headBlock - options.confirmations;
  if (targetBlock < options.startBlock) return { ...emptyReport(headBlock), targetBlock };
  await source.assertAuthority(targetBlock);

  let checkpoint = await store.getCheckpoint();
  let fromBlock = checkpoint ? checkpoint.blockNumber + 1n : options.startBlock;
  let reorgRewindFrom: bigint | null = null;

  if (checkpoint) {
    const canonicalHash = await source.getBlockHash(checkpoint.blockNumber);
    if (!sameHex(canonicalHash, checkpoint.blockHash)) {
      if (checkpoint.guardBlockNumber === null || checkpoint.guardBlockHash === null) {
        throw new Error(`REORG_DEPTH_UNVERIFIABLE:checkpoint=${checkpoint.blockNumber}`);
      }
      const canonicalGuardHash = await source.getBlockHash(checkpoint.guardBlockNumber);
      if (!sameHex(canonicalGuardHash, checkpoint.guardBlockHash)) {
        throw new Error(`REORG_DEPTH_EXCEEDED:checkpoint=${checkpoint.blockNumber}:guard=${checkpoint.guardBlockNumber}`);
      }
      reorgRewindFrom = maxBigInt(options.startBlock, checkpoint.guardBlockNumber + 1n);
      await store.rewindFromBlock(reorgRewindFrom);
      checkpoint = await store.getCheckpoint();
      fromBlock = checkpoint ? checkpoint.blockNumber + 1n : reorgRewindFrom;
    }
  }

  // Existing databases may have launches without v0.4 facts, and a prior process may
  // have persisted all facts before failing to replace the derived edge projection.
  // Repair both cases before the no-new-blocks return. Launches remain the authority;
  // edges are always disposable/rebuildable from durable provenance facts.
  await ensureProvenanceProjection(store);

  if (fromBlock > targetBlock) {
    return { headBlock, targetBlock, startBlock: null, endBlock: null, inserted: 0, duplicates: 0, batches: 0, reorgRewindFrom };
  }

  const initialFrom = fromBlock;
  let inserted = 0;
  let duplicates = 0;
  let batches = 0;
  let finalBlock: bigint | null = null;

  while (fromBlock <= targetBlock) {
    const toBlock = minBigInt(targetBlock, fromBlock + options.maxBatchBlocks - 1n);
    await source.assertAuthority(fromBlock);
    await source.assertAuthority(toBlock);

    const boundaryHashBefore = await source.getBlockHash(toBlock);
    const launches = await source.catchUp(fromBlock, toBlock);
    await assertLaunchBlocksStillCanonical(source, launches);
    const boundaryHashAfterRead = await source.getBlockHash(toBlock);
    if (!sameHex(boundaryHashBefore, boundaryHashAfterRead)) throw new Error(`REORG_DURING_READ:block=${toBlock}`);

    for (const launch of launches) {
      const result = await store.putLaunch(launch);
      if (result === 'INSERTED') inserted += 1;
      else duplicates += 1;
      await store.putProvenanceFact(await buildProvenanceFact(launch));
    }
    const provenanceFacts = await store.listProvenanceFacts();
    await store.replaceProvenanceEdges(await projectProvenanceEdges(provenanceFacts));

    const guardBlockNumber = toBlock > options.reorgLookbackBlocks ? toBlock - options.reorgLookbackBlocks : 0n;
    const guardBlockHash = await source.getBlockHash(guardBlockNumber);
    const boundaryHashBeforeCommit = await source.getBlockHash(toBlock);
    if (!sameHex(boundaryHashBefore, boundaryHashBeforeCommit)) {
      await store.rewindFromBlock(fromBlock);
      throw new Error(`REORG_DURING_COMMIT:block=${toBlock}`);
    }

    try { await source.assertAuthority(targetBlock); }
    catch (error) { await store.rewindFromBlock(fromBlock); throw error; }

    await store.commitCheckpoint({ blockNumber: toBlock, blockHash: boundaryHashBeforeCommit, guardBlockNumber, guardBlockHash });
    finalBlock = toBlock;
    batches += 1;
    fromBlock = toBlock + 1n;
  }

  return { headBlock, targetBlock, startBlock: initialFrom, endBlock: finalBlock, inserted, duplicates, batches, reorgRewindFrom };
}

export async function runSentryTruth(source: LaunchSource, store: Store, options: SentryTruthOptions, signal?: AbortSignal, onSync?: (report: SyncReport) => void): Promise<void> {
  while (!signal?.aborted) {
    const report = await syncSentryTruth(source, store, options);
    onSync?.(report);
    await sleep(options.pollIntervalMs, signal);
  }
}

async function ensureProvenanceProjection(store: Store): Promise<void> {
  const missing = await store.listLaunchesMissingProvenance();
  for (const launch of missing) {
    await store.putProvenanceFact(await buildProvenanceFact(launch));
  }
  const facts = await store.listProvenanceFacts();
  await store.replaceProvenanceEdges(await projectProvenanceEdges(facts));
}

async function assertLaunchBlocksStillCanonical(source: LaunchSource, launches: LaunchObserved[]): Promise<void> {
  const hashes = new Map<bigint, Hex>();
  for (const launch of launches) {
    let canonical = hashes.get(launch.blockNumber);
    if (!canonical) { canonical = await source.getBlockHash(launch.blockNumber); hashes.set(launch.blockNumber, canonical); }
    if (!sameHex(canonical, launch.blockHash)) throw new Error(`REORG_DURING_SYNC:block=${launch.blockNumber}`);
  }
}

function validateOptions(options: SentryTruthOptions): void {
  if (options.startBlock < 0n) throw new Error('startBlock must be >= 0');
  if (options.confirmations < 0n) throw new Error('confirmations must be >= 0');
  if (options.maxBatchBlocks < 1n) throw new Error('maxBatchBlocks must be >= 1');
  if (options.reorgLookbackBlocks < 1n) throw new Error('reorgLookbackBlocks must be >= 1');
  if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs < 100) throw new Error('pollIntervalMs must be >= 100');
}

function emptyReport(headBlock: bigint): SyncReport {
  return { headBlock, targetBlock: null, startBlock: null, endBlock: null, inserted: 0, duplicates: 0, batches: 0, reorgRewindFrom: null };
}

function sameHex(a: Hex, b: Hex): boolean { return a.toLowerCase() === b.toLowerCase(); }
function minBigInt(a: bigint, b: bigint): bigint { return a < b ? a : b; }
function maxBigInt(a: bigint, b: bigint): bigint { return a > b ? a : b; }

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
