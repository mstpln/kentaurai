import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeNextPendingOfficialGame } from '../src/import/official-live-scheduled.js';
import { officialGameSourceGap } from '../src/import/official-source-gap.js';

function start(raceId, number, horseId = 1000 + number) {
  const horse = { name: `Synthetic Horse ${number}` };
  if (horseId != null) horse.id = horseId;
  return { id: `${raceId}_${number}`, number, postPosition: number, distance: 2140, horse };
}

function gameWithMissingPermanentHorseId() {
  const date = '2099-05-01';
  return {
    id: 'V85_2099-05-01_7_1',
    status: 'upcoming',
    pools: { V85: { betType: 'V85', turnover: 0 } },
    races: Array.from({ length: 8 }, (_, index) => {
      const raceId = `${date}_7_${index + 1}`;
      return {
        id: raceId,
        date,
        number: index + 1,
        distance: 2140,
        startMethod: 'auto',
        track: { id: 7, name: 'Synthetic Park' },
        starts: index === 0
          ? [start(raceId, 1), start(raceId, 2, null)]
          : [start(raceId, 1, 2000 + index)]
      };
    })
  };
}

test('official live missing-horse identity is classified narrowly for legacy errors', () => {
  assert.deepEqual(
    officialGameSourceGap(new Error('races[0].starts[1].horse.id is required')),
    { code: 'missing_horse_identity', raceIndex: 0, startIndex: 1 }
  );
  assert.equal(officialGameSourceGap(new Error('races[0].starts[1].horse.name must be a non-empty string')), null);
});

test('automatic live normalization keeps a named start when permanent horse identity is missing', async () => {
  const { env, db, objects } = createTestEnv();
  const key = 'raw/official_provider/live-gap.json';
  objects.set(key, { body: JSON.stringify(gameWithMissingPermanentHorseId()), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, metadata_json)
    VALUES ('src_live_gap', 'official_provider', 'game:V85_2099-05-01_7_1', 'https://example.invalid',
      '2099-04-30T05:15:00Z', ?, 'live-gap-hash', 'captured_unmapped', ?)`)
    .run(key, JSON.stringify({ kind: 'game', identity: 'V85_2099-05-01_7_1' }));

  let result;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    result = await normalizeNextPendingOfficialGame(env);
    if (result.status === 'completed_source') break;
  }

  assert.equal(result.status, 'completed_source');
  assert.equal(db.prepare('SELECT quality_status FROM source_records WHERE id = ?').get('src_live_gap').quality_status, 'normalized_verified_subset');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries').get().n, 9);
  const missing = db.prepare(`SELECT horse_id, declared_horse_name, source_start_id FROM race_entries
    WHERE race_id = '2099-05-01_7_1' AND start_number = 2`).get();
  assert.equal(missing.horse_id, null);
  assert.equal(missing.declared_horse_name, 'Synthetic Horse 2');
  assert.equal(missing.source_start_id, '2099-05-01_7_1_2');
  assert.deepEqual(await normalizeNextPendingOfficialGame(env), { status: 'idle', done: true });
});
