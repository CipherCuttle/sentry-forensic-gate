import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { assertLedgerWithinAuthorizedEpoch } from '../dist/authority/ledgerEpochGuard.js';

const earliest = 52_267_792n;
const dir = await mkdtemp(join(tmpdir(), 'sentry-ledger-epoch-'));
const dbPath = join(dir, 'ledger.sqlite');

try {
  // Missing DB is valid for a first activation.
  assert.doesNotThrow(() => assertLedgerWithinAuthorizedEpoch(dbPath, 57073, earliest));

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE launches (chain_id INTEGER NOT NULL, block_number TEXT NOT NULL);
    CREATE TABLE chain_checkpoints (chain_id INTEGER PRIMARY KEY, block_number TEXT NOT NULL);
  `);
  db.close();

  assert.doesNotThrow(() => assertLedgerWithinAuthorizedEpoch(dbPath, 57073, earliest));

  let writer = new Database(dbPath);
  writer.prepare('INSERT INTO launches (chain_id, block_number) VALUES (?, ?)').run(57073, earliest.toString());
  writer.close();
  assert.doesNotThrow(() => assertLedgerWithinAuthorizedEpoch(dbPath, 57073, earliest));

  writer = new Database(dbPath);
  writer.prepare('DELETE FROM launches').run();
  writer.prepare('INSERT INTO launches (chain_id, block_number) VALUES (?, ?)').run(57073, (earliest - 1n).toString());
  writer.close();
  assert.throws(
    () => assertLedgerWithinAuthorizedEpoch(dbPath, 57073, earliest),
    /SENTRY_LEDGER_PRE_EPOCH_LAUNCH/
  );

  writer = new Database(dbPath);
  writer.prepare('DELETE FROM launches').run();
  writer.prepare('INSERT INTO chain_checkpoints (chain_id, block_number) VALUES (?, ?)').run(57073, (earliest - 1n).toString());
  writer.close();
  assert.throws(
    () => assertLedgerWithinAuthorizedEpoch(dbPath, 57073, earliest),
    /SENTRY_LEDGER_PRE_EPOCH_CHECKPOINT/
  );

  console.log('sentry ledger epoch check ok');
} finally {
  await rm(dir, { recursive: true, force: true });
}
