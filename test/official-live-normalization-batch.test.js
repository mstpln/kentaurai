import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeNextPendingOfficialGame } from '../src/import/official-live-scheduled.js';

function start(raceId, number, horseId) {
  return {
    id: `${raceId}_${number}`,
    number,
    postPosition: number,
    distance: 2140,
    horse: { id: horseId, name: `Synthetic Horse ${horseId}` }
  };
}

function game() {
  const date = '2099-06-12';
  return {
    id: 'V85_2099-06-12_42_1',
    status: 'upcoming',
    pools: { V85: { betType: 'V85', turnover: 0 } },
    races: Array.from({ length: 8 }, (_, index) => {
      const raceId = `${date}_42_${index + 1}`;
      return {
        id: raceId,
        date,
        number: index + 1,
        distance: 2140,
        startMethod: 'auto',
        track: { id: 42, name: 'Synthetic Park' },
        starts: index === 0
          ? [start(raceId, 1, 4201), start(raceId, 2, 4202)]
          : [start(raceId, 1, 4300 + index)]
      };
    })
  };
}

function seedSource(db, objects) {
  const sourceId = 'src_live_batch';
  const key = `raw/official_provider/${sourceId}.json`;
  objects.set(key, { body: JSON.stringify(game()), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, metadata_json)
    VALUES (?, 'official_provider', 'game:V85_2099-06-12_42_1', 'https://example.invalid',
      '2099-06-12T05:15:00Z', ?, 'batch-hash', 'captured_unmapped', ?)`)
    .run(sourceId, key, JSON.stringify({ kind: 'game', identity: 'V85_2099-06-12_42_1' }));
  return sourceId;
}

test('one scheduled live normalization call processes a bounded batch of entries', async () => {
  const { env, db, objects } = createTestEnv();
  const sourceId = seedSource(db, objects);

  const first = await normalizeNextPendingOfficialGame(env);
  assert.equal(first.status, 'running_source');
  assert.equal(first.steps, 8);
  assert.equal(first.cursor, 0);
  assert.equal(first.nextCursor, 8);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries').get().n, 8);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM import_runs WHERE source_type = 'official_live_normalize_auto' AND status = 'success'`).get().n, 8);

  const second = await normalizeNextPendingOfficialGame(env);
  assert.equal(second.status, 'completed_source');
  assert.equal(second.cursor, 8);
  assert.equal(second.steps, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries').get().n, 9);
  assert.equal(db.prepare('SELECT quality_status FROM source_records WHERE id = ?').get(sourceId).quality_status, 'normalized_verified_subset');
});

test('live normalization batch can be deliberately limited for precise recovery work', async () => {
  const { env, db, objects } = createTestEnv();
  seedSource(db, objects);

  const result = await normalizeNextPendingOfficialGame(env, { maxSteps: 2 });
  assert.equal(result.status, 'running_source');
  assert.equal(result.steps, 2);
  assert.equal(result.nextCursor, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries').get().n, 2);
});
