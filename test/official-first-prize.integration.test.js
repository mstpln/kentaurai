import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createTestEnv } from './helpers/d1.js';

function insertRace(db, id) {
  db.prepare('INSERT INTO races (id, race_date, race_number) VALUES (?, ?, ?)')
    .run(id, '2099-03-01', 1);
}

function insertSource(db, id) {
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, fetched_at, quality_status)
    VALUES (?, 'official_provider', ?, '2099-03-01T10:00:00Z', 'captured_unmapped')`)
    .run(id, `race:${id}`);
}

function insertRaceObservation(db, observationId, raceId, sourceId, prizeText) {
  db.prepare(`INSERT INTO normalized_observations
    (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status)
    VALUES (?, 'race', ?, ?, '2099-03-01T10:00:00Z', ?, 'normalized_verified_subset')`)
    .run(observationId, raceId, sourceId, JSON.stringify({ prizeText }));
}

test('official race observation maps the first advertised prize amount', () => {
  const { db } = createTestEnv();
  insertRace(db, 'race_prize_60k');
  insertSource(db, 'source_prize_60k');
  insertRaceObservation(
    db,
    'obs_prize_60k',
    'race_prize_60k',
    'source_prize_60k',
    'Pris: 60.000-30.000-17.000-13.000 kr (4 prisplacerade).'
  );
  assert.equal(db.prepare('SELECT first_prize_sek FROM races WHERE id = ?').get('race_prize_60k').first_prize_sek, 60000);
});

test('official first-prize mapping supports million-level Swedish thousands formatting', () => {
  const { db } = createTestEnv();
  insertRace(db, 'race_prize_1m');
  insertSource(db, 'source_prize_1m');
  insertRaceObservation(
    db,
    'obs_prize_1m',
    'race_prize_1m',
    'source_prize_1m',
    'Pris: 1.000.000-500.000-250.000 kr (3 prisplacerade).'
  );
  assert.equal(db.prepare('SELECT first_prize_sek FROM races WHERE id = ?').get('race_prize_1m').first_prize_sek, 1000000);
});

test('unknown or malformed prize text stays null', () => {
  const { db } = createTestEnv();
  insertRace(db, 'race_prize_unknown');
  insertSource(db, 'source_prize_unknown');
  insertRaceObservation(db, 'obs_prize_unknown', 'race_prize_unknown', 'source_prize_unknown', 'Bonuspris enligt särskilda villkor.');
  assert.equal(db.prepare('SELECT first_prize_sek FROM races WHERE id = ?').get('race_prize_unknown').first_prize_sek, null);
});

test('later conflicting official prize observations do not overwrite the first stored fact', () => {
  const { db } = createTestEnv();
  insertRace(db, 'race_prize_conflict');
  insertSource(db, 'source_prize_conflict_1');
  insertRaceObservation(
    db,
    'obs_prize_conflict_1',
    'race_prize_conflict',
    'source_prize_conflict_1',
    'Pris: 80.000-40.000-20.000 kr (3 prisplacerade).'
  );
  assert.equal(db.prepare('SELECT first_prize_sek FROM races WHERE id = ?').get('race_prize_conflict').first_prize_sek, 80000);

  insertSource(db, 'source_prize_conflict_2');
  insertRaceObservation(
    db,
    'obs_prize_conflict_2',
    'race_prize_conflict',
    'source_prize_conflict_2',
    'Pris: 90.000-45.000-22.500 kr (3 prisplacerade).'
  );
  assert.equal(db.prepare('SELECT first_prize_sek FROM races WHERE id = ?').get('race_prize_conflict').first_prize_sek, 80000);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM normalized_observations WHERE entity_id = 'race_prize_conflict' AND entity_type = 'race'`).get().n, 2);
});

test('migration repairs already-normalized official race observations without refetching', () => {
  const db = new DatabaseSync(':memory:');
  for (const migration of [
    '../migrations/0001_core.sql',
    '../migrations/0002_reference_round.sql',
    '../migrations/0003_nullable_reference_prediction.sql',
    '../migrations/0004_official_live_observations.sql',
    '../migrations/0005_historical_backfill.sql',
    '../migrations/0006_xlabs_backfill.sql'
  ]) {
    db.exec(readFileSync(new URL(migration, import.meta.url), 'utf8'));
  }

  insertRace(db, 'race_prize_existing');
  insertSource(db, 'source_prize_existing');
  insertRaceObservation(
    db,
    'obs_prize_existing',
    'race_prize_existing',
    'source_prize_existing',
    'Pris: 125.000-62.500-34.000-21.000 kr (4 prisplacerade).'
  );
  assert.equal(db.prepare('SELECT first_prize_sek FROM races WHERE id = ?').get('race_prize_existing').first_prize_sek, null);

  db.exec(readFileSync(new URL('../migrations/0007_official_first_prize.sql', import.meta.url), 'utf8'));
  assert.equal(db.prepare('SELECT first_prize_sek FROM races WHERE id = ?').get('race_prize_existing').first_prize_sek, 125000);
});
