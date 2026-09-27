CREATE TABLE runtime_controls (
  control_key TEXT PRIMARY KEY,
  control_value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

INSERT INTO runtime_controls (control_key, control_value, updated_at, updated_by)
VALUES ('automatic_workflows_enabled', '1', datetime('now'), 'migration')
ON CONFLICT(control_key) DO NOTHING;
