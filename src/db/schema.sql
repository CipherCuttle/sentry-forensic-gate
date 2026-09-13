PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS launches (
  launch_id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  block_number TEXT NOT NULL,
  block_hash TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  factory TEXT NOT NULL,
  token TEXT NOT NULL,
  creator TEXT NOT NULL,
  launch_type TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL,
  UNIQUE(chain_id, tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS decisions (
  decision_id TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL REFERENCES launches(launch_id),
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
  launch_id TEXT NOT NULL REFERENCES launches(launch_id),
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
  launch_id TEXT NOT NULL REFERENCES launches(launch_id),
  notional_usd_micros TEXT NOT NULL,
  entry_quote_id TEXT NOT NULL,
  reverse_quote_id TEXT NOT NULL,
  UNIQUE(launch_id, notional_usd_micros)
);

CREATE TABLE IF NOT EXISTS graph_edges (
  edge_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  observed_block TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_digest TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  outcome_id TEXT PRIMARY KEY,
  launch_id TEXT NOT NULL REFERENCES launches(launch_id),
  horizon_ms INTEGER NOT NULL,
  observed_block TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(launch_id, horizon_ms)
);

CREATE TABLE IF NOT EXISTS runtime_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
