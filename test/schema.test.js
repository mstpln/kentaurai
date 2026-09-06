import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migration1 = readFileSync(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
const migration2 = readFileSync(new URL('../migrations/0002_reference_round.sql', import.meta.url), 'utf8');
const migration3 = readFileSync(new URL('../migrations/0003_nullable_reference_prediction.sql', import.meta.url), 'utf8');
const sql = `${migration1}\n${migration2}\n${migration3}`;

test('core migrations apply cleanly and create required tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  for (const required of [
    'horses', 'drivers', 'trainers', 'tracks', 'races', 'race_entries', 'race_results',
    'xlabs_data', 'game_rounds', 'betting_snapshots', 'editorial_items', 'analysis_features',
    'ai_race_analyses', 'ai_horse_predictions', 'systems', 'post_race_reviews', 'import_runs',
    'learning_hypotheses', 'learning_observations', 'model_change_log',
    'reference_round_exports', 'reference_observations'
  ]) {
    assert.ok(names.has(required), `missing ${required}`);
  }
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
