import test from 'node:test';
import assert from 'node:assert/strict';
import { importReferenceRound } from '../src/import/reference-round-safe.js';
import { createTestEnv } from './helpers/d1.js';
import { buildReferenceRound } from './helpers/reference-fixture.js';

test('reference round import is idempotent and reports a no-op reimport accurately', async () => {
  const { env, db, objects } = createTestEnv();
  const payload = buildReferenceRound();

  const first = await importReferenceRound(env, structuredClone(payload));
  const before = {
    entries: db.prepare('SELECT count(*) AS n FROM race_entries').get().n,
    analyses: db.prepare('SELECT count(*) AS n FROM ai_race_analyses').get().n,
    systems: db.prepare('SELECT count(*) AS n FROM systems').get().n,
    exports: db.prepare('SELECT count(*) AS n FROM reference_round_exports').get().n,
    sourceRecords: db.prepare('SELECT count(*) AS n FROM source_records').get().n
  };

  const second = await importReferenceRound(env, structuredClone(payload));
  const after = {
    entries: db.prepare('SELECT count(*) AS n FROM race_entries').get().n,
    analyses: db.prepare('SELECT count(*) AS n FROM ai_race_analyses').get().n,
    systems: db.prepare('SELECT count(*) AS n FROM systems').get().n,
    exports: db.prepare('SELECT count(*) AS n FROM reference_round_exports').get().n,
    sourceRecords: db.prepare('SELECT count(*) AS n FROM source_records').get().n
  };

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.deepEqual(second.counts, { inserted: 0, updated: 0, skipped: 1, errors: 0 });
  assert.deepEqual(after, before);
  assert.equal(objects.size, 1);
});

test('reference import preserves a scratched entry with no pre-race probability as null', async () => {
  const { env, db } = createTestEnv();
  const payload = buildReferenceRound();

  payload.races[0].race.field_size = 2;
  payload.races[0].race.starters_declared = 2;
  payload.races[0].entries.push({
    start_number: 2,
    horse: { name: 'Scratched Horse', external_id: 9999 },
    driver: { name: 'Driver X', external_id: 9998 },
    trainer: { name: 'Trainer X', external_id: 9997 },
    start_position: { start_number: 2, actual_lane: 2, tier: 1, handicap_m: 0 },
    scratched: true,
    scratch_reason: 'synthetic',
    equipment_today: {},
    market: { betting_snapshots: [], odds_snapshots: [] },
    recent_starts: [],
    historical_stats_used: {},
    editorial_signals: [],
    source_refs: ['src-001']
  });
  payload.analysis_snapshot.legs[0].horses.push({
    horse_name: 'Scratched Horse',
    start_number: 2,
    own_win_probability: null,
    uncertainty_low: null,
    uncertainty_high: null,
    rank: null,
    abcd: null,
    value_assessment: null,
    spike_candidate: false,
    data_quality: 'synthetic',
    scenario_notes: null,
    reasoning_summary: null,
    scratched: true
  });

  await importReferenceRound(env, payload);

  const row = db.prepare(`
    SELECT p.win_probability
    FROM ai_horse_predictions p
    JOIN race_entries re ON re.id = p.race_entry_id
    WHERE re.start_number = 2 AND re.race_id = 'race-1'
  `).get();
  assert.ok(row);
  assert.equal(row.win_probability, null);
});

test('reference reimport rejects changed content under the same identity and timestamp', async () => {
  const { env } = createTestEnv();
  const payload = buildReferenceRound();
  await importReferenceRound(env, structuredClone(payload));

  const changed = structuredClone(payload);
  changed.round.notes = 'changed payload';
  await assert.rejects(
    () => importReferenceRound(env, changed),
    /reference export conflict/
  );
});


test('reference import reuses one existing canonical track instead of creating a name-based duplicate', async () => {
  const { env, db } = createTestEnv();
  const payload = buildReferenceRound();
  payload.round.track = 'Canonical Track';
  for (const wrapper of payload.races) wrapper.race.track = 'Canonical Track';

  db.prepare(`
    INSERT INTO tracks (id, canonical_name, country_code)
    VALUES ('track_official__999', 'Canonical Track', 'SE')
  `).run();
  db.prepare(`
    INSERT INTO track_external_ids (track_id, source_type, external_id)
    VALUES ('track_official__999', 'official', '999')
  `).run();

  await importReferenceRound(env, payload);

  assert.deepEqual(
    db.prepare("SELECT id FROM tracks WHERE canonical_name = 'Canonical Track' ORDER BY id").all(),
    [{ id: 'track_official__999' }]
  );
  assert.equal(
    db.prepare("SELECT primary_track_id FROM game_rounds WHERE id = 'synthetic-round'").get().primary_track_id,
    'track_official__999'
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM races WHERE track_id <> 'track_official__999'").get().n,
    0
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM tracks WHERE id = 'track_canonical-track'").get().n,
    0
  );
});

test('reference import fails closed when a canonical track name is ambiguous', async () => {
  const { env, db } = createTestEnv();
  const payload = buildReferenceRound();
  payload.round.track = 'Ambiguous Track';
  for (const wrapper of payload.races) wrapper.race.track = 'Ambiguous Track';

  db.prepare("INSERT INTO tracks (id, canonical_name) VALUES ('track_a', 'Ambiguous Track')").run();
  db.prepare("INSERT INTO tracks (id, canonical_name) VALUES ('track_b', 'Ambiguous Track')").run();

  await assert.rejects(
    () => importReferenceRound(env, payload),
    /ambiguous track identity for "Ambiguous Track": track_a, track_b/
  );

  assert.equal(
    db.prepare("SELECT count(*) AS n FROM tracks WHERE canonical_name = 'Ambiguous Track'").get().n,
    2
  );
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM tracks WHERE id = 'track_ambiguous-track'").get().n,
    0
  );
});
