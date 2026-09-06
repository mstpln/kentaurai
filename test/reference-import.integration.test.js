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
