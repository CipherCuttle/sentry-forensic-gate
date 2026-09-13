import Database from 'better-sqlite3';
import type { Hex, LaunchObserved } from '../domain.js';
import { canonicalJson } from '../evidence/canonical.js';
import type { DecisionReceipt, OutcomeReceipt } from '../evidence/receipts.js';
import { normalizeLaunchHex, sameLaunchAuthority } from '../sentry/identity.js';
import { flattenBaselineQuotes, type ExecutableBaselineBatch } from '../shadow/baselineTypes.js';
import type { BaselineStore } from '../shadow/baselineStore.js';
import type { ShadowEntry } from '../shadow/ports.js';
import { SCHEMA_SQL } from './schema.js';
import type { ChainCheckpoint, Store } from './store.js';

export class SqliteStore implements Store, BaselineStore {
  private readonly db: Database.Database;

  constructor(path: string, private readonly chainId: number) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);
    this.ensureCheckpointGuardColumns();
  }

  close(): void {
    this.db.close();
  }

  async putLaunch(v: LaunchObserved): Promise<'INSERTED' | 'DUPLICATE'> {
    const launch = normalizeLaunchHex(v);
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO launches (
        launch_id, event_id, chain_id, block_number, block_hash, tx_hash, log_index,
        factory, token, creator, token_id, name, symbol, launch_type, source_event, observed_at_ms
      ) VALUES (
        @launchId, @eventId, @chainId, @blockNumber, @blockHash, @txHash, @logIndex,
        @factory, @token, @creator, @tokenId, @name, @symbol, @launchType, @sourceEvent, @observedAtMs
      )
    `).run({
      launchId: launch.launchId,
      eventId: launch.eventId,
      chainId: launch.chainId,
      blockNumber: launch.blockNumber.toString(),
      blockHash: launch.blockHash,
      txHash: launch.txHash,
      logIndex: launch.logIndex,
      factory: launch.factory,
      token: launch.token,
      creator: launch.creator,
      tokenId: launch.tokenId.toString(),
      name: launch.name,
      symbol: launch.symbol,
      launchType: launch.launchType,
      sourceEvent: launch.sourceEvent,
      observedAtMs: launch.observedAtMs
    });
    if (result.changes === 1) return 'INSERTED';

    const row = this.db.prepare(`
      SELECT * FROM launches
      WHERE launch_id = ? OR (chain_id = ? AND tx_hash = ? AND token = ?)
      LIMIT 1
    `).get(launch.launchId, launch.chainId, launch.txHash, launch.token) as LaunchRow | undefined;
    if (!row || !sameLaunchAuthority(fromLaunchRow(row), launch)) {
      throw new Error(`LAUNCH_IDENTITY_CONFLICT:${launch.launchId}`);
    }
    return 'DUPLICATE';
  }

  async getLaunch(launchId: string): Promise<LaunchObserved | null> {
    const row = this.db.prepare('SELECT * FROM launches WHERE launch_id = ?').get(launchId) as LaunchRow | undefined;
    return row ? fromLaunchRow(row) : null;
  }

  async putDecision(v: DecisionReceipt): Promise<'INSERTED' | 'DUPLICATE'> {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO decisions (
        decision_id, launch_id, decision_block, gate_version, policy_digest, evidence_digest,
        hard_gate, risk_band, evidence_completeness, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      v.decisionId,
      v.launchId,
      v.decisionBlock.toString(),
      v.gateVersion,
      v.policyDigest,
      v.evidenceDigest,
      v.hardGate,
      v.riskBand,
      v.evidenceCompleteness,
      canonicalJson(v)
    );
    return result.changes === 1 ? 'INSERTED' : 'DUPLICATE';
  }

  async putShadowEntry(v: ShadowEntry): Promise<'INSERTED' | 'DUPLICATE'> {
    const shadowId = `${v.launchId}:${v.notionalUsdMicros}`;
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO shadow_entries (
        shadow_id, launch_id, notional_usd_micros, payload_json
      ) VALUES (?, ?, ?, ?)
    `).run(shadowId, v.launchId, v.notionalUsdMicros.toString(), canonicalJson(v));
    return result.changes === 1 ? 'INSERTED' : 'DUPLICATE';
  }

  async putOutcome(v: OutcomeReceipt): Promise<'INSERTED' | 'DUPLICATE'> {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO outcomes (outcome_id, launch_id, horizon_ms, observed_block, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(v.outcomeId, v.launchId, v.horizonMs, v.observedBlock.toString(), canonicalJson(v));
    return result.changes === 1 ? 'INSERTED' : 'DUPLICATE';
  }

  async listLaunchesPendingBaseline(maxLaunchBlock: bigint, limit: number): Promise<LaunchObserved[]> {
    const rows = this.db.prepare(`
      SELECT l.*
      FROM launches l
      LEFT JOIN baseline_batches b ON b.launch_id = l.launch_id
      WHERE l.chain_id = ?
        AND b.launch_id IS NULL
        AND CAST(l.block_number AS INTEGER) <= CAST(? AS INTEGER)
      ORDER BY CAST(l.block_number AS INTEGER) ASC, l.log_index ASC
      LIMIT ?
    `).all(this.chainId, maxLaunchBlock.toString(), limit) as LaunchRow[];
    return rows.map(fromLaunchRow);
  }

  async putBaselineBatch(batch: ExecutableBaselineBatch): Promise<'INSERTED' | 'DUPLICATE'> {
    const tx = this.db.transaction((): 'INSERTED' | 'DUPLICATE' => {
      const result = this.db.prepare(`
        INSERT OR IGNORE INTO baseline_batches (
          baseline_id, launch_id, policy_version, decision_block, decision_block_hash,
          status, reason, authority_digest, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batch.baselineId,
        batch.launchId,
        batch.policyVersion,
        batch.decisionBlock.toString(),
        batch.decisionBlockHash.toLowerCase(),
        batch.status,
        batch.reason ?? null,
        batch.authorityDigest,
        canonicalJson(batch)
      );

      if (result.changes === 0) {
        const existing = this.db.prepare(`
          SELECT baseline_id, authority_digest
          FROM baseline_batches
          WHERE baseline_id = ? OR launch_id = ?
          LIMIT 1
        `).get(batch.baselineId, batch.launchId) as { baseline_id: string; authority_digest: string } | undefined;
        if (!existing || existing.baseline_id !== batch.baselineId || existing.authority_digest !== batch.authorityDigest) {
          throw new Error(`BASELINE_IDENTITY_CONFLICT:${batch.launchId}`);
        }
        return 'DUPLICATE';
      }

      const insertQuote = this.db.prepare(`
        INSERT INTO baseline_quotes (
          quote_id, baseline_id, launch_id, block_number, block_hash, kind, mode,
          notional_usd_micros, pool, token_in, token_out, fee, amount_in, amount_out,
          executable, failure_reason, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const quote of flattenBaselineQuotes(batch)) {
        insertQuote.run(
          quote.quoteId,
          batch.baselineId,
          batch.launchId,
          quote.blockNumber.toString(),
          quote.blockHash.toLowerCase(),
          quote.kind,
          quote.mode,
          quote.notionalUsdMicros.toString(),
          quote.pool.toLowerCase(),
          quote.tokenIn.toLowerCase(),
          quote.tokenOut.toLowerCase(),
          quote.fee,
          quote.amountIn.toString(),
          quote.amountOut.toString(),
          quote.executable ? 1 : 0,
          quote.failureReason ?? null,
          canonicalJson(quote)
        );
      }
      return 'INSERTED';
    });
    return tx();
  }

  async getCheckpoint(): Promise<ChainCheckpoint | null> {
    const row = this.db.prepare(`
      SELECT block_number, block_hash, reorg_guard_block, reorg_guard_hash
      FROM chain_checkpoints WHERE chain_id = ?
    `).get(this.chainId) as {
      block_number: string;
      block_hash: Hex;
      reorg_guard_block: string | null;
      reorg_guard_hash: Hex | null;
    } | undefined;
    return row ? {
      blockNumber: BigInt(row.block_number),
      blockHash: row.block_hash,
      guardBlockNumber: row.reorg_guard_block === null ? null : BigInt(row.reorg_guard_block),
      guardBlockHash: row.reorg_guard_hash
    } : null;
  }

  async commitCheckpoint(checkpoint: ChainCheckpoint): Promise<void> {
    this.db.prepare(`
      INSERT INTO chain_checkpoints (
        chain_id, block_number, block_hash, reorg_guard_block, reorg_guard_hash
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chain_id) DO UPDATE SET
        block_number = excluded.block_number,
        block_hash = excluded.block_hash,
        reorg_guard_block = excluded.reorg_guard_block,
        reorg_guard_hash = excluded.reorg_guard_hash
    `).run(
      this.chainId,
      checkpoint.blockNumber.toString(),
      checkpoint.blockHash.toLowerCase(),
      checkpoint.guardBlockNumber?.toString() ?? null,
      checkpoint.guardBlockHash?.toLowerCase() ?? null
    );
  }

  async rewindFromBlock(fromBlock: bigint): Promise<void> {
    const tx = this.db.transaction(() => {
      // Invalidate evidence by the block at which the evidence itself was observed,
      // even when the launch happened before the reorg boundary and remains canonical.
      this.db.prepare(`
        DELETE FROM baseline_batches
        WHERE CAST(decision_block AS INTEGER) >= CAST(? AS INTEGER)
      `).run(fromBlock.toString());
      this.db.prepare(`
        DELETE FROM decisions
        WHERE CAST(decision_block AS INTEGER) >= CAST(? AS INTEGER)
      `).run(fromBlock.toString());
      this.db.prepare(`
        DELETE FROM quote_observations
        WHERE CAST(block_number AS INTEGER) >= CAST(? AS INTEGER)
      `).run(fromBlock.toString());
      this.db.prepare(`
        DELETE FROM outcomes
        WHERE CAST(observed_block AS INTEGER) >= CAST(? AS INTEGER)
      `).run(fromBlock.toString());
      this.db.prepare(`
        DELETE FROM shadow_entries
        WHERE CAST(json_extract(payload_json, '$.entry.blockNumber') AS INTEGER) >= CAST(? AS INTEGER)
           OR CAST(json_extract(payload_json, '$.immediateExit.blockNumber') AS INTEGER) >= CAST(? AS INTEGER)
      `).run(fromBlock.toString(), fromBlock.toString());

      this.db.prepare(`
        DELETE FROM launches WHERE chain_id = ? AND CAST(block_number AS INTEGER) >= CAST(? AS INTEGER)
      `).run(this.chainId, fromBlock.toString());
      this.db.prepare(`
        DELETE FROM chain_checkpoints
        WHERE chain_id = ? AND CAST(block_number AS INTEGER) >= CAST(? AS INTEGER)
      `).run(this.chainId, fromBlock.toString());
    });
    tx();
  }

  private ensureCheckpointGuardColumns(): void {
    const columns = this.db.pragma('table_info(chain_checkpoints)') as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('reorg_guard_block')) {
      this.db.exec('ALTER TABLE chain_checkpoints ADD COLUMN reorg_guard_block TEXT');
    }
    if (!names.has('reorg_guard_hash')) {
      this.db.exec('ALTER TABLE chain_checkpoints ADD COLUMN reorg_guard_hash TEXT');
    }
  }
}

type LaunchRow = {
  launch_id: string;
  event_id: string;
  chain_id: number;
  block_number: string;
  block_hash: Hex;
  tx_hash: Hex;
  log_index: number;
  factory: Hex;
  token: Hex;
  creator: Hex;
  token_id: string;
  name: string;
  symbol: string;
  launch_type: LaunchObserved['launchType'];
  source_event: LaunchObserved['sourceEvent'];
  observed_at_ms: number;
};

function fromLaunchRow(row: LaunchRow): LaunchObserved {
  return {
    launchId: row.launch_id,
    eventId: row.event_id,
    chainId: row.chain_id,
    blockNumber: BigInt(row.block_number),
    blockHash: row.block_hash,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    factory: row.factory,
    token: row.token,
    creator: row.creator,
    tokenId: BigInt(row.token_id),
    name: row.name,
    symbol: row.symbol,
    launchType: row.launch_type,
    sourceEvent: row.source_event,
    observedAtMs: row.observed_at_ms
  };
}
