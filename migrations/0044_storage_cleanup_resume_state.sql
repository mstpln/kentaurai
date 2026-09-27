CREATE TABLE storage_cleanup_state (
  target TEXT PRIMARY KEY CHECK (target IN ('horse_profile','horse_stat','horse_record','person_stat','raw_object')),
  cursor TEXT,
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0,1)),
  pages INTEGER NOT NULL DEFAULT 0 CHECK (pages >= 0),
  rows_scanned INTEGER NOT NULL DEFAULT 0 CHECK (rows_scanned >= 0),
  rows_removable INTEGER NOT NULL DEFAULT 0 CHECK (rows_removable >= 0),
  rows_removed INTEGER NOT NULL DEFAULT 0 CHECK (rows_removed >= 0),
  references_rewritten INTEGER NOT NULL DEFAULT 0 CHECK (references_rewritten >= 0),
  canonical_objects_created INTEGER NOT NULL DEFAULT 0 CHECK (canonical_objects_created >= 0),
  legacy_objects_deleted INTEGER NOT NULL DEFAULT 0 CHECK (legacy_objects_deleted >= 0),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
