import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeNextPendingOfficialGame } from '../src/import/official-live-scheduled.js';
import { OFFICIAL_SOURCE_GAP_QUALITY, officialGameSourceGap } from '../src/import/official-source-gap.js';

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
  const date = '2099-05-01';
  const races = Array.from({ length: 8 }, (_, index) => {
    const raceId = `${date}_7_${index + 1}`;
    const starts = index === 0
      ? [start(raceId, 1), start(raceId, 2, null)]
      : [start(raceId, 1, 2000 + index)];
    return {
      id: raceId,
      date,
      number: index + 1,
      distance: 2140,
      startMethod: 'auto',
      track: { id: 7, name: 'Synthetic Park' },
      starts
    };
  });
  return {
    id: 'V85_2099-05-01_7_1',
    status: 'upcoming',
    pools: { V85: { betType: 'V85', turnover: 0 } },
    races
  };
}

test('official live missing-horse identity is classified narrowly', () => {
  assert.deepEqual(
    officialGameSourceGap(new Error('races[0].starts[1].horse.id is required')),
    { code: 'missing_horse_identity', raceIndex: 0, startIndex: 1 }
  );
  assert.equal(officialGameSourceGap(new Error('races[0].starts[1].horse.name must be a non-empty string')), null);
});

test('automatic live normalization quarantines an unidentifiable source instead of retrying it', async () => {
  const { env, db, objects } = createTestEnv();
  const sourceId = 'src_live_gap';
  const externalId = 'game:V85_2099-05-01_7_1';
  const key = 'raw/official_provider/live-gap.json';
  objects.set(key, { body: JSON.stringify(malformedGame()), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, metadata_json)
    VALUES (?, 'official_provider', ?, 'https://www.atg.se/services/racinginfo/v1/api/games/V85_2099-05-01_7_1',
      '2099-04-30T05:15:00Z', ?, 'live-gap-hash', 'captured_unmapped', ?)`)
    .run(sourceId, externalId, key, JSON.stringify({ kind: 'game', identity: 'V85_2099-05-01_7_1' }));

  const result = await normalizeNextPendingOfficialGame(env);
  assert.equal(result.status, 'source_gap');
  assert.equal(result.done, true);
  assert.equal(result.sourceRecordId, sourceId);
  assert.deepEqual(result.sourceGap.gap, {
    code: 'missing_horse_identity',
    raceIndex: 0,
    startIndex: 1
  });

  const source = db.prepare('SELECT quality_status, metadata_json FROM source_records WHERE id = ?').get(sourceId);
  assert.equal(source.quality_status, OFFICIAL_SOURCE_GAP_QUALITY);
  const metadata = JSON.parse(source.metadata_json);
  assert.equal(metadata.normalizationStatus, 'source_gap');
  assert.deepEqual(metadata.sourceGap, {
    code: 'missing_horse_identity',
    raceIndex: 0,
    startIndex: 1
  });

  const autoRuns = db.prepare(`SELECT status, error_count FROM import_runs WHERE source_type='official_live_normalize_auto'`).all();
  assert.equal(autoRuns.length, 1);
  assert.equal(autoRuns[0].status, 'success');
  assert.equal(autoRuns[0].error_count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_rounds').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_entries').get().n, 0);

  const next = await normalizeNextPendingOfficialGame(env);
  assert.deepEqual(next, { status: 'idle', done: true });
});
