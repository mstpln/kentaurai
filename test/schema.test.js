import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration1 = readFileSync(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
const migration2 = readFileSync(new URL('../migrations/0002_reference_round.sql', import.meta.url), 'utf8');
const migration3 = readFileSync(new URL('../migrations/0003_nullable_reference_prediction.sql', import.meta.url), 'utf8');
const migration4 = readFileSync(new URL('../migrations/0004_official_live_observations.sql', import.meta.url), 'utf8');
const migration5 = readFileSync(new URL('../migrations/0005_historical_backfill.sql', import.meta.url), 'utf8');
const migration6 = readFileSync(new URL('../migrations/0006_xlabs_backfill.sql', import.meta.url), 'utf8');
const migration7 = readFileSync(new URL('../migrations/0007_official_first_prize.sql', import.meta.url), 'utf8');
const migration8 = readFileSync(new URL('../migrations/0008_track_contact_metadata.sql', import.meta.url), 'utf8');
const sql = `${migration1}\n${migration2}\n${migration3}\n${migration4}\n${migration5}\n${migration6}\n${migration7}\n${migration8}`;

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
    'historical_backfill_jobs', 'xlabs_backfill_jobs'
  ]) {
    assert.ok(names.has(required), `missing ${required}`);
  }
});

test('X-Labs backfill migration persists scope, retry scheduling and lease checkpoints', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const columns = new Set(db.prepare('PRAGMA table_info(xlabs_backfill_jobs)').all().map((r) => r.name));
  for (const required of ['scope', 'next_date', 'next_race_index', 'retry_after', 'lease_token', 'lease_until']) {
    assert.ok(columns.has(required), `missing xlabs_backfill_jobs.${required}`);
  }
  assert.throws(() => db.prepare(`
    INSERT INTO xlabs_backfill_jobs (id, scope, start_date, end_date, next_date)
    VALUES ('bad-scope', 'unsupported', '2099-01-01', '2099-01-01', '2099-01-01')
  `).run(), /CHECK constraint failed/);
});

test('reference migration adds captured factual fields without changing raw/analysis separation', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const horseColumns = new Set(db.prepare('PRAGMA table_info(horses)').all().map((r) => r.name));
  const raceColumns = new Set(db.prepare('PRAGMA table_info(races)').all().map((r) => r.name));
  const analysisColumns = new Set(db.prepare('PRAGMA table_info(ai_race_analyses)').all().map((r) => r.name));
  const editorialColumns = new Set(db.prepare('PRAGMA table_info(editorial_items)').all().map((r) => r.name));
  assert.ok(horseColumns.has('career_earnings_sek'));
  assert.ok(horseColumns.has('record_text'));
  assert.ok(raceColumns.has('starters_declared'));
  assert.ok(analysisColumns.has('analysis_origin'));
  assert.ok(analysisColumns.has('method_note'));
  assert.ok(editorialColumns.has('race_id'));
  assert.ok(editorialColumns.has('game_round_id'));
});

test('track contact migration adds nullable factual address and website fields only', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const trackColumns = new Set(db.prepare('PRAGMA table_info(tracks)').all().map((r) => r.name));
  const raceColumns = new Set(db.prepare('PRAGMA table_info(races)').all().map((r) => r.name));
  for (const required of ['street_address', 'postal_code', 'website_url']) assert.ok(trackColumns.has(required));
  assert.equal(raceColumns.has('stl_class'), false);
  assert.equal(raceColumns.has('race_types_json'), false);
});

test('official live observation migration keeps source provenance mandatory', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const columns = new Map(db.prepare('PRAGMA table_info(normalized_observations)').all().map((r) => [r.name, r]));
  assert.equal(columns.get('source_record_id').notnull, 1);
  assert.equal(columns.get('observed_at').notnull, 1);
  assert.equal(columns.get('fields_json').notnull, 1);
  assert.equal(columns.get('quality_status').notnull, 1);
});

test('reference prediction schema allows a null probability for entries without a pre-race probability', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const probabilityColumn = db.prepare('PRAGMA table_info(ai_horse_predictions)').all()
    .find((column) => column.name === 'win_probability');
  assert.equal(probabilityColumn.notnull, 0);
});

test('systems schema enforces exactly three spikar', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  db.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date)
    VALUES ('round-1', 'V85', '2026-09-06')
  `).run();

  assert.throws(
    () => db.prepare(`
      INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at)
      VALUES ('s1', 'round-1', 'main', 200, 400, 2, '2026-09-06T00:00:00Z')
    `).run(),
    /CHECK constraint failed/
  );

  assert.doesNotThrow(() => db.prepare(`
    INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at)
    VALUES ('s2', 'round-1', 'main', 200, 400, 3, '2026-09-06T00:00:00Z')
  `).run());
});
