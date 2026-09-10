import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeNextPendingOfficialGame, selectPendingOfficialGameSource } from '../src/import/official-live-scheduled.js';
import { OFFICIAL_SOURCE_GAP_QUALITY } from '../src/import/official-source-gap.js';

function start(raceId, number, horseId = 1000 + number) {
  return {
    id: `${raceId}_${number}`,
    number,
    postPosition: number,
    distance: 2140,
    horse: { id: horseId, name: `Synthetic Horse ${number}` },
    pools: { V85: { betDistribution: 100 } }
  };
}

function malformedGame() {
  const date = '2099-05-02';
  return {
    id: 'V85_2099-05-02_7_1',
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

function seedSource(env, db, objects, sourceId = 'src_exhausted_gap') {
  const externalId = 'game:V85_2099-05-02_7_1';
  const key = 'raw/official_provider/exhausted-live-gap.json';
  objects.set(key, { body: JSON.stringify(malformedGame()), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, metadata_json)
    VALUES (?, 'official_provider', ?, 'https://www.atg.se/services/racinginfo/v1/api/games/V85_2099-05-02_7_1',
      '2099-05-01T05:15:00Z', ?, 'exhausted-gap-hash', 'captured_unmapped', ?)`)
    .run(sourceId, externalId, key, JSON.stringify({ kind: 'game', identity: 'V85_2099-05-02_7_1' }));
  return { sourceId, externalId };
}

function seedFailedAutoRun(db, index, sourceId, message) {
  db.prepare(`INSERT INTO import_runs
    (id, source_type, started_at, finished_at, status, error_count, error_json, metadata_json)
    VALUES (?, 'official_live_normalize_auto', ?, ?, 'failed', 1, ?, ?)`)
    .run(
      `failed_${index}`,
      `2099-05-01T05:1${index}:00Z`,
      `2099-05-01T05:1${index}:01Z`,
      JSON.stringify({ message }),
      JSON.stringify({ sourceRecordId: sourceId, externalId: 'game:V85_2099-05-02_7_1', cursor: 0 })
    );
}

test('an exhausted pre-fix missing-horse source is selected once for source-gap quarantine', async () => {
  const { env, db, objects } = createTestEnv();
  const { sourceId } = seedSource(env, db, objects);
  for (let index = 0; index < 3; index += 1) {
    seedFailedAutoRun(db, index, sourceId, 'races[0].starts[1].horse.id is required');
  }

  const selected = await selectPendingOfficialGameSource(env);
  assert.equal(selected.id, sourceId);

  const result = await normalizeNextPendingOfficialGame(env);
  assert.equal(result.status, 'source_gap');
  assert.equal(result.sourceRecordId, sourceId);
  assert.deepEqual(result.sourceGap.gap, { code: 'missing_horse_identity', raceIndex: 0, startIndex: 1 });

  const source = db.prepare('SELECT quality_status, metadata_json FROM source_records WHERE id = ?').get(sourceId);
  assert.equal(source.quality_status, OFFICIAL_SOURCE_GAP_QUALITY);
  assert.equal(JSON.parse(source.metadata_json).normalizationStatus, 'source_gap');

  const next = await selectPendingOfficialGameSource(env);
  assert.equal(next, null);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM import_runs WHERE source_type='official_live_normalize_auto'`).get().n, 4);
});

test('an exhausted unrelated validation failure remains suppressed', async () => {
  const { env, db, objects } = createTestEnv();
  const { sourceId } = seedSource(env, db, objects, 'src_unrelated_failure');
  for (let index = 0; index < 3; index += 1) {
    seedFailedAutoRun(db, index, sourceId, 'official game status is unsupported');
  }

  const selected = await selectPendingOfficialGameSource(env);
  assert.equal(selected, null);
  const source = db.prepare('SELECT quality_status FROM source_records WHERE id = ?').get(sourceId);
  assert.equal(source.quality_status, 'captured_unmapped');
});
