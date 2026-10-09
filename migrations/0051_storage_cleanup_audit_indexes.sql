CREATE INDEX idx_horse_profile_snapshots_source_record
  ON horse_profile_snapshots(source_record_id, observed_at, id);

CREATE INDEX idx_horse_stat_snapshots_source_record
  ON horse_stat_snapshots(source_record_id, observed_at, id);

CREATE INDEX idx_horse_record_snapshots_source_record
  ON horse_record_snapshots(source_record_id, observed_at, id);

CREATE INDEX idx_person_stat_snapshots_source_record
  ON person_stat_snapshots(source_record_id, observed_at, id);

CREATE INDEX idx_official_snapshot_source_sync_status_source
  ON official_snapshot_source_sync(status, source_record_id);
