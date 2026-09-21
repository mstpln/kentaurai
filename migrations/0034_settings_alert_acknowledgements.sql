CREATE TABLE IF NOT EXISTS settings_alert_acknowledgements (
  alert_key TEXT PRIMARY KEY,
  acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
