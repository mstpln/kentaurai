PRAGMA foreign_keys = ON;

ALTER TABLE editorial_items ADD COLUMN change_since_last INTEGER
  CHECK(change_since_last IS NULL OR change_since_last IN (0,1));

ALTER TABLE editorial_items ADD COLUMN change_summary TEXT;
