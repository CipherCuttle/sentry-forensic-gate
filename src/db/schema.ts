export const SCHEMA_SQL = String.raw`
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS launches (
  launch_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  block_number TEXT NOT NULL,
  block_hash TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  factory TEXT NOT NULL,
  token TEXT NOT NULL,
  creator TEXT NOT NULL,
  token_id TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  launch_type TEXT NOT NULL,
  source_event TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  UNIQUE(chain_id, tx_hash, token)
);

CREATE INDEX IF NOT EXISTS idx_launches_block_number
  ON launches(chain_id, block_number);

CREATE TABLE IF NOT EXISTS provenance_facts (
  fact_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  launch_id TEXT NOT NULL UNIQUE REFERENCES launches(launch_id) ON DELETE CASCADE,
  creator TEXT NOT NULL,
  observed_block TEXT NOT NULL,
  observed_block_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  source_event_id TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provenance_facts_creator_order
  ON provenance_facts(chain_id, creator, observed_block, log_index);

CREATE TABLE IF NOT EXISTS provenance_edges (
  edge_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  evidence_class TEXT NOT NULL,
  observed_block TEXT NOT NULL,
  observed_block_hash TEXT NOT NULL,
  source_fact_ids_json TEXT NOT NULL,
  derivation_version TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_provenance_edges_order
  ON provenance_edges(chain_id, observed_block, edge_id);

CREATE TABLE IF NOT EXISTS decisions (
  decision_id TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL REFERENCES launches(launch_id) ON DELETE CASCADE,
  decision_block TEXT NOT NULL,
  gate_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  evidence_digest TEXT NOT NULL,
  hard_gate TEXT NOT NULL,
  risk_band TEXT NOT NULL,
  evidence_completeness REAL NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quote_observations (
  quote_id TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL REFERENCES launches(launch_id) ON DELETE CASCADE,
  block_number TEXT NOT NULL,
  direction TEXT NOT NULL,
  notional_usd_micros TEXT NOT NULL,
  amount_in TEXT NOT NULL,
  amount_out TEXT NOT NULL,
  executable INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shadow_entries (
  shadow_id TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL REFERENCES launches(launch_id) ON DELETE CASCADE,
  notional_usd_micros TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(launch_id, notional_usd_micros)
);

CREATE TABLE IF NOT EXISTS baseline_batches (
  baseline_id TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL UNIQUE REFERENCES launches(launch_id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  decision_block TEXT NOT NULL,
  decision_block_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  authority_digest TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_baseline_batches_decision_block
  ON baseline_batches(decision_block);

CREATE TABLE IF NOT EXISTS baseline_quotes (
  quote_id TEXT PRIMARY KEY,
  baseline_id TEXT NOT NULL REFERENCES baseline_batches(baseline_id) ON DELETE CASCADE,
  launch_id TEXT NOT NULL REFERENCES launches(launch_id) ON DELETE CASCADE,
  block_number TEXT NOT NULL,
  block_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  notional_usd_micros TEXT NOT NULL,
  pool TEXT NOT NULL,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  fee INTEGER NOT NULL,
  amount_in TEXT NOT NULL,
  amount_out TEXT NOT NULL,
  executable INTEGER NOT NULL,
  failure_reason TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE(baseline_id, kind, notional_usd_micros)
);
CREATE INDEX IF NOT EXISTS idx_baseline_quotes_block
  ON baseline_quotes(block_number);

CREATE TABLE IF NOT EXISTS outcomes (
  outcome_id TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL REFERENCES launches(launch_id) ON DELETE CASCADE,
  horizon_ms INTEGER NOT NULL,
  observed_block TEXT NOT NULL,
  policy_version TEXT,
  payload_json TEXT NOT NULL,
  UNIQUE(launch_id, horizon_ms, policy_version)
);

CREATE TABLE IF NOT EXISTS chain_checkpoints (
  chain_id INTEGER PRIMARY KEY,
  block_number TEXT NOT NULL,
  block_hash TEXT NOT NULL,
  reorg_guard_block TEXT,
  reorg_guard_hash TEXT
);
`;
