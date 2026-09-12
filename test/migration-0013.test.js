import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

function migration(name) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
}

const BEFORE_0013 = [
  '0001_core.sql',
  '0002_reference_round.sql',
  '0003_nullable_reference_prediction.sql',
  '0004_official_live_observations.sql',
  '0005_historical_backfill.sql',
  '0006_xlabs_backfill.sql',
  '0007_official_first_prize.sql',
  '0008_track_contact_metadata.sql',
  '0009_track_contact_provenance.sql',
  '0010_horse_start_points.sql',
  '0011_driver_statistics_indexes.sql',
  '0012_trainer_statistics_indexes.sql'
];

test('0013 preserves existing systems and dependent rows while widening spike storage', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of BEFORE_0013) db.exec(migration(name));

  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track-1', 'Synthetic Track')`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date) VALUES ('round-1', 'V85', '2026-09-06')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number) VALUES ('race-1', 'track-1', '2026-09-06', 1)`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse-1', 'Synthetic Horse')`).run();
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched) VALUES ('entry-1', 'race-1', 'horse-1', 1, 0)`).run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system-1', 'round-1', 'main', 100, 200, 3, '2026-09-06T10:00:00Z')`).run();
  db.prepare(`INSERT INTO system_selections (system_id, leg_number, race_entry_id, is_spike) VALUES ('system-1', 1, 'entry-1', 1)`).run();
  db.prepare(`INSERT INTO post_race_reviews (id, game_round_id, race_id, race_entry_id, system_id, created_at) VALUES ('review-1', 'round-1', 'race-1', 'entry-1', 'system-1', '2026-09-06T15:00:00Z')`).run();

  db.exec(migration('0013_combined_analysis_systems.sql'));

  assert.equal(db.prepare(`SELECT spike_count FROM systems WHERE id = 'system-1'`).get().spike_count, 3);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM system_selections WHERE system_id = 'system-1'`).get().n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM post_race_reviews WHERE system_id = 'system-1'`).get().n, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  assert.doesNotThrow(() => db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at, notes) VALUES ('system-2', 'round-1', 'main', 100, 200, 2, '2026-09-06T10:00:00Z', 'Synthetic two-spike reason')`).run());
});
