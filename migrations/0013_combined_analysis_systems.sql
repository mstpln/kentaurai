PRAGMA defer_foreign_keys = ON;

CREATE TABLE systems_v2 (
  id TEXT PRIMARY KEY,
  game_round_id TEXT NOT NULL REFERENCES game_rounds(id),
  model_version_id TEXT REFERENCES model_versions(id),
  system_type TEXT NOT NULL DEFAULT 'main',
  budget_sek REAL NOT NULL,
  row_count INTEGER NOT NULL,
  line_price_sek REAL,
  spike_count INTEGER NOT NULL,
  estimated_hit_probability REAL,
  estimated_market_ownership REAL,
  value_metric REAL,
  risk_profile TEXT,
  created_at TEXT NOT NULL,
  metrics_json TEXT,
  notes TEXT,
  CHECK(spike_count IN (2, 3))
);

INSERT INTO systems_v2 (
  id, game_round_id, model_version_id, system_type, budget_sek, row_count,
  line_price_sek, spike_count, estimated_hit_probability,
  estimated_market_ownership, value_metric, risk_profile, created_at,
  metrics_json, notes
)
SELECT
  id, game_round_id, model_version_id, system_type, budget_sek, row_count,
  line_price_sek, spike_count, estimated_hit_probability,
  estimated_market_ownership, value_metric, risk_profile, created_at,
  NULL, NULL
FROM systems;

DROP TABLE systems;
ALTER TABLE systems_v2 RENAME TO systems;
