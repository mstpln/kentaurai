CREATE TABLE automation_controls (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
  updated_at TEXT NOT NULL,
  updated_via TEXT NOT NULL
);

INSERT INTO automation_controls (id, enabled, updated_at, updated_via)
VALUES ('automatic_workflows', 1, '1970-01-01T00:00:00.000Z', 'migration');
