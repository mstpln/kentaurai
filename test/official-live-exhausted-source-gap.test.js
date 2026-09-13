import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeNextPendingOfficialGame, selectPendingOfficialGameSource } from '../src/import/official-live-scheduled.js';

function start(raceId, number, horseId = 1000 + number) {
  const horse = { name: `Synthetic Horse ${number}` };
  if (horseId != null) horse.id = horseId;
  return { id: `${raceId}_${number}`, number, postPosition: number, distance: 2140, horse };
}

function game() {
  const date = '2099-05-02';
  return {
    id: 'V85_2099-05-02_7_1',
    status: 'upcoming',
    pools: { V85: { betType: 'V85', turnover: 0 } },
    races: Array.from({ length: 8 }, (_, index) => {
      const raceId = `${date}_7_${index + 1}`;
      return {
        id: raceId, date, number: index + 1, distance: 2140, startMethod: 'auto',
        track: { id: 7, name: 'Synthetic Park' },
        starts: index === 0 ? [start(raceId, 1), start(raceId, 2, null)] : [start(raceId, 1, 2000 + index)]
      };
    })
  };
}

function seedSource(db, objects, { sourceId = 'src_exhausted_gap', quality = 'captured_unmapped', metadata = null } = {}) {
  const key = `raw/official_provider/${sourceId}.json`;
  objects.set(key, { body: JSON.stringify(game()), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, metadata_json)
    VALUES (?, 'official_provider', 'game:V85_2099-05-02_7_1', 'https://example.invalid',
      '2099-05-01T05:15:00Z', ?, 'exhausted-gap-hash', ?, ?)`)
    .run(sourceId, key, quality, JSON.stringify(metadata || { kind: 'game', identity: 'V85_2099-05-02_7_1' }));
  return sourceId;
}

function seedFailedAutoRun(db, index, sourceId, message) {
  db.prepare(`INSERT INTO import_runs
    (id, source_type, started_at, finished_at, status, error_count, error_json, metadata_json)
    VALUES (?, 'official_live_normalize_auto', ?, ?, 'failed', 1, ?, ?)`)
    .run(
      `failed_${index}_${sourceId}`,
      `2099-05-01T05:1${index}:00Z`,
      `2099-05-01T05:1${index}:01Z`,
      JSON.stringify({ message }),
      JSON.stringify({ sourceRecordId: sourceId, externalId: 'game:V85_2099-05-02_7_1', cursor: 0 })
    );
}

async function normalizeToCompletion(env) {
  let result;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    result = await normalizeNextPendingOfficialGame(env);
    if (result.status === 'completed_source') return result;
  }
  return result;
}

test('an exhausted pre-fix missing-horse source is recoverable and normalizes to completion', async () => {
  const { env, db, objects } = createTestEnv();
  const sourceId = seedSource(db, objects);
  for (let index = 0; index < 3; index += 1) seedFailedAutoRun(db, index, sourceId, 'races[0].starts[1].horse.id is required');
  assert.equal((await selectPendingOfficialGameSource(env)).id, sourceId);
  assert.equal((await normalizeToCompletion(env)).status, 'completed_source');
  assert.equal(db.prepare('SELECT quality_status FROM source_records WHERE id = ?').get(sourceId).quality_status, 'normalized_verified_subset');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries WHERE horse_id IS NULL').get().n, 1);
});

test('an existing captured missing-horse source gap is selected directly for recovery', async () => {
  const { env, db, objects } = createTestEnv();
  const sourceId = seedSource(db, objects, {
    sourceId: 'src_source_gap',
    quality: 'captured_source_gap',
    metadata: { kind: 'game', identity: 'V85_2099-05-02_7_1', normalizationStatus: 'source_gap', sourceGap: { code: 'missing_horse_identity', raceIndex: 0, startIndex: 1 } }
  });
  assert.equal((await selectPendingOfficialGameSource(env)).id, sourceId);
  assert.equal((await normalizeToCompletion(env)).status, 'completed_source');
  const source = db.prepare('SELECT quality_status, metadata_json FROM source_records WHERE id = ?').get(sourceId);
  assert.equal(source.quality_status, 'normalized_verified_subset');
  assert.equal(JSON.parse(source.metadata_json).normalizationStatus, 'normalized_recovered');
});

test('an exhausted unrelated validation failure remains suppressed', async () => {
  const { env, db, objects } = createTestEnv();
  const sourceId = seedSource(db, objects, { sourceId: 'src_unrelated_failure' });
  for (let index = 0; index < 3; index += 1) seedFailedAutoRun(db, index, sourceId, 'official game status is unsupported');
  assert.equal(await selectPendingOfficialGameSource(env), null);
});
