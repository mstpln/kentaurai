import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrations = [
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
  '0011_driver_statistics_indexes.sql'
];
const sql = migrations.map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')).join('\n');

test('core migrations apply cleanly and create required tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  for (const required of [
    'horses', 'drivers', 'trainers', 'tracks', 'races', 'race_entries', 'race_results',
    'xlabs_data', 'game_rounds', 'betting_snapshots', 'editorial_items', 'analysis_features',
    'ai_race_analyses', 'ai_horse_predictions', 'systems', 'post_race_reviews', 'import_runs',
    'learning_hypotheses', 'learning_observations', 'model_change_log',
    'reference_round_exports', 'reference_observations', 'normalized_observations',
    'historical_backfill_jobs', 'xlabs_backfill_jobs',
    'race_stl_classifications', 'race_type_classifications',
    'horse_start_points', 'horse_start_point_source_sync'
  ]) {
    assert.ok(names.has(required), `missing ${required}`);
  }
});

test('X-Labs backfill migration persists scope, retry scheduling and lease checkpoints', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const columns = new Set(db.prepare('PRAGMA table_info(xlabs_backfill_jobs)').all().map((r) => r.name));
  for (const required of ['scope', 'next_date', 'next_race_index', 'retry_after', 'lease_token', 'lease_until']) assert.ok(columns.has(required), `missing xlabs_backfill_jobs.${required}`);
  assert.throws(() => db.prepare(`INSERT INTO xlabs_backfill_jobs (id, scope, start_date, end_date, next_date) VALUES ('bad-scope', 'unsupported', '2099-01-01', '2099-01-01', '2099-01-01')`).run(), /CHECK constraint failed/);
});

test('reference migration adds captured factual fields without changing raw/analysis separation', () => {
  const db = new DatabaseSync(':memory:');db.exec(sql);
  const horseColumns = new Set(db.prepare('PRAGMA table_info(horses)').all().map((r) => r.name));
  const raceColumns = new Set(db.prepare('PRAGMA table_info(races)').all().map((r) => r.name));
  const analysisColumns = new Set(db.prepare('PRAGMA table_info(ai_race_analyses)').all().map((r) => r.name));
  const editorialColumns = new Set(db.prepare('PRAGMA table_info(editorial_items)').all().map((r) => r.name));
  assert.ok(horseColumns.has('career_earnings_sek'));assert.ok(horseColumns.has('record_text'));assert.ok(raceColumns.has('starters_declared'));assert.ok(analysisColumns.has('analysis_origin'));assert.ok(analysisColumns.has('method_note'));assert.ok(editorialColumns.has('race_id'));assert.ok(editorialColumns.has('game_round_id'));
});

test('track migration keeps contact facts separate from calculated race classifications', () => {
  const db = new DatabaseSync(':memory:');db.exec(sql);
  const trackColumns = new Set(db.prepare('PRAGMA table_info(tracks)').all().map((r) => r.name));const raceColumns = new Set(db.prepare('PRAGMA table_info(races)').all().map((r) => r.name));
  for (const required of ['street_address', 'postal_code', 'website_url']) assert.ok(trackColumns.has(required));assert.equal(raceColumns.has('stl_class'), false);assert.equal(raceColumns.has('race_types_json'), false);
  db.prepare("INSERT INTO tracks (id, canonical_name) VALUES ('t1','Testbanan')").run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, race_name, main_class, class_flags_json) VALUES ('r1','t1','2026-09-11',1,'Silverdivisionen - Stolopp','Silverdivisionen','["Spårtrappa"]')`).run();
  assert.equal(db.prepare("SELECT stl_class FROM race_stl_classifications WHERE race_id='r1'").get().stl_class, 'silver');
  assert.deepEqual(db.prepare("SELECT race_type FROM race_type_classifications WHERE race_id='r1' ORDER BY race_type").all().map((row) => row.race_type), ['lane_ladder', 'mares']);
  db.prepare("UPDATE races SET race_name='Gulddivisionen', main_class='Gulddivisionen', class_flags_json='[]' WHERE id='r1'").run();assert.equal(db.prepare("SELECT stl_class FROM race_stl_classifications WHERE race_id='r1'").get().stl_class, 'gold');assert.deepEqual(db.prepare("SELECT race_type FROM race_type_classifications WHERE race_id='r1'").all(), []);
});

test('official live observation migration keeps source provenance mandatory', () => {
  const db = new DatabaseSync(':memory:');db.exec(sql);const columns = new Map(db.prepare('PRAGMA table_info(normalized_observations)').all().map((r) => [r.name, r]));
  assert.equal(columns.get('source_record_id').notnull, 1);assert.equal(columns.get('observed_at').notnull, 1);assert.equal(columns.get('fields_json').notnull, 1);assert.equal(columns.get('quality_status').notnull, 1);
});

test('horse start-point migration preserves timestamped source provenance and nullable current cache', () => {
  const db = new DatabaseSync(':memory:');db.exec(sql);const historyColumns = new Map(db.prepare('PRAGMA table_info(horse_start_points)').all().map((r) => [r.name, r]));for (const required of ['horse_id', 'points', 'observed_at', 'source_record_id']) assert.ok(historyColumns.has(required));assert.equal(historyColumns.get('horse_id').notnull, 1);assert.equal(historyColumns.get('points').notnull, 1);assert.equal(historyColumns.get('observed_at').notnull, 1);assert.equal(historyColumns.get('source_record_id').notnull, 1);const horseColumns = new Map(db.prepare('PRAGMA table_info(horses)').all().map((r) => [r.name, r]));assert.equal(horseColumns.get('current_start_points').notnull, 0);assert.equal(horseColumns.get('current_start_points_observed_at').notnull, 0);assert.equal(horseColumns.get('current_start_points_source_record_id').notnull, 0);
});

test('driver statistics migration adds only query indexes', () => {
  const db = new DatabaseSync(':memory:');db.exec(sql);const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r)=>r.name));
  assert.ok(indexes.has('idx_entries_driver'));assert.ok(indexes.has('idx_betting_snapshots_entry_time'));
});

test('reference prediction schema allows a null probability for entries without a pre-race probability', () => {
  const db = new DatabaseSync(':memory:');db.exec(sql);const probabilityColumn = db.prepare('PRAGMA table_info(ai_horse_predictions)').all().find((column) => column.name === 'win_probability');assert.equal(probabilityColumn.notnull, 0);
});

test('systems schema enforces exactly three spikar', () => {
  const db = new DatabaseSync(':memory:');db.exec(sql);db.prepare(`INSERT INTO game_rounds (id, game_type, round_date) VALUES ('round-1', 'V85', '2026-09-06')`).run();assert.throws(() => db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('s1', 'round-1', 'main', 200, 400, 2, '2026-09-06T00:00:00Z')`).run(), /CHECK constraint failed/);assert.doesNotThrow(() => db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('s2', 'round-1', 'main', 200, 400, 3, '2026-09-06T00:00:00Z')`).run());
});
