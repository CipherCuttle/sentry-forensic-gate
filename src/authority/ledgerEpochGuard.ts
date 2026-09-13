import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';

export function assertLedgerWithinAuthorizedEpoch(
  dbPath: string,
  chainId: number,
  earliestAuthorizedBlock: bigint
): void {
  if (!existsSync(dbPath)) return;

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  try {
    if (tableExists(db, 'launches')) {
      const row = db.prepare(`
        SELECT MIN(CAST(block_number AS INTEGER)) AS min_block
        FROM launches
        WHERE chain_id = ?
      `).get(chainId) as { min_block: number | null };
      if (row.min_block !== null && BigInt(row.min_block) < earliestAuthorizedBlock) {
        throw new Error(
          `SENTRY_LEDGER_PRE_EPOCH_LAUNCH:minBlock=${row.min_block}:earliestAuthorized=${earliestAuthorizedBlock}`
        );
      }
    }

    if (tableExists(db, 'chain_checkpoints')) {
      const row = db.prepare(`
        SELECT block_number
        FROM chain_checkpoints
        WHERE chain_id = ?
      `).get(chainId) as { block_number: string } | undefined;
      if (row && BigInt(row.block_number) < earliestAuthorizedBlock) {
        throw new Error(
          `SENTRY_LEDGER_PRE_EPOCH_CHECKPOINT:block=${row.block_number}:earliestAuthorized=${earliestAuthorizedBlock}`
        );
      }
    }
  } finally {
    db.close();
  }
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}
