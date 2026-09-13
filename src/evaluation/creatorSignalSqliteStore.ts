import Database from 'better-sqlite3';
import type { Hex } from '../domain.js';
import type { ProvenanceFact } from '../graph/provenance.js';
import { SqliteStore } from '../db/sqliteStore.js';
import type { CreatorSignalLaunchProvenanceSnapshot } from '../runtime/creatorSignalEval.js';

interface SnapshotRow {
  chain_id: number;
  launch_id: string;
  block_number: string;
  block_hash: Hex;
  provenance_payload: string | null;
}

interface ProvenancePayload {
  factId: string;
  kind: ProvenanceFact['kind'];
  chainId: number;
  launchId: string;
  creator: Hex;
  observedBlock: string;
  observedBlockHash: Hex;
  logIndex: number;
  sourceEventId: string;
  evidenceDigest: string;
}

/**
 * Creator-signal evaluator store with an atomic launch/provenance universe read.
 *
 * The truth ingester persists launches and provenance facts as separate writes.
 * A single LEFT JOIN statement guarantees the evaluator sees one SQLite snapshot:
 * a launch is therefore either joined to its fact or returned explicitly as
 * missing provenance; it cannot fall between two autocommit reads.
 */
export class CreatorSignalSqliteStore extends SqliteStore {
  private readonly snapshotDb: Database.Database;

  constructor(path: string, private readonly snapshotChainId: number) {
    super(path, snapshotChainId);
    this.snapshotDb = new Database(path, { readonly: true });
    this.snapshotDb.pragma('query_only = ON');
  }

  async readLaunchProvenanceSnapshot(): Promise<CreatorSignalLaunchProvenanceSnapshot> {
    const rows = this.snapshotDb.prepare(`
      SELECT
        l.chain_id,
        l.launch_id,
        l.block_number,
        l.block_hash,
        p.payload_json AS provenance_payload
      FROM launches l
      LEFT JOIN provenance_facts p
        ON p.chain_id = l.chain_id
       AND p.launch_id = l.launch_id
      WHERE l.chain_id = ?
      ORDER BY CAST(l.block_number AS INTEGER), l.log_index, l.launch_id
    `).all(this.snapshotChainId) as SnapshotRow[];

    const missingProvenance: CreatorSignalLaunchProvenanceSnapshot['missingProvenance'] = [];
    const facts: ProvenanceFact[] = [];

    for (const row of rows) {
      if (row.provenance_payload === null) {
        missingProvenance.push({
          chainId: row.chain_id,
          launchId: row.launch_id,
          blockNumber: BigInt(row.block_number),
          blockHash: row.block_hash
        });
        continue;
      }
      facts.push(reviveProvenanceFact(row.provenance_payload));
    }

    return { missingProvenance, facts };
  }

  override close(): void {
    this.snapshotDb.close();
    super.close();
  }
}

function reviveProvenanceFact(payload: string): ProvenanceFact {
  const raw = JSON.parse(payload) as ProvenancePayload;
  return {
    ...raw,
    observedBlock: BigInt(raw.observedBlock)
  };
}
