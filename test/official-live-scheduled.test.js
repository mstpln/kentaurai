import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  captureUpcomingOfficialGames,
  completedNormalizationCursor,
  normalizeNextPendingOfficialGame,
  scheduledLiveDates,
  v85V86GameIdsFromCalendar
} from '../src/import/official-live-scheduled.js';

const TODAY = '2099-01-15';
const TOMORROW = '2099-01-16';
const GAME_ID = `V86_${TOMORROW}_999_1`;

function calendar(date = TOMORROW) {
  return {
    date,
    tracks: [],
    games: {
      V86: [{
        id: GAME_ID,
        status: 'bettable',
        races: Array.from({ length: 8 }, (_, index) => `${date}_999_${index + 1}`)
      }],
      V65: [{ id: `V65_${date}_999_1`, races: [] }]
    }
  };
}

function insertNormalizationRun(db, { id, sourceRecordId, cursor, status = 'success' }) {
  db.prepare(`
    INSERT INTO import_runs (id, source_type, started_at, finished_at, status, metadata_json)
    VALUES (?, 'official_provider_normalize', '2099-01-15T17:15:00.000Z', '2099-01-15T17:15:01.000Z', ?, ?)
  `).run(id, status, JSON.stringify({ sourceRecordId, stage: 'entry', cursor }));
}

test('scheduled live dates include race day in morning but exclude it in evening', () => {
  const instant = '2099-01-15T05:15:00.000Z';
  assert.deepEqual(scheduledLiveDates(instant, { includeToday: true, daysAhead: 2 }), [
    '2099-01-15', '2099-01-16', '2099-01-17'
  ]);
  assert.deepEqual(scheduledLiveDates(instant, { includeToday: false, daysAhead: 2 }), [
    '2099-01-16', '2099-01-17'
  ]);
});

test('calendar discovery selects only exact V85/V86 eight-leg games', () => {
  const payload = calendar();
  payload.games.V85 = [{
    id: `V85_${TOMORROW}_998_1`,
    races: Array.from({ length: 8 }, (_, index) => `${TOMORROW}_998_${index + 1}`)
  }];
  assert.deepEqual(v85V86GameIdsFromCalendar(payload, TOMORROW), [
    `V85_${TOMORROW}_998_1`, GAME_ID
  ]);
});

test('calendar discovery rejects malformed or cross-date game identity', () => {
  const wrongCount = calendar();
  wrongCount.games.V86[0].races.pop();
  assert.throws(() => v85V86GameIdsFromCalendar(wrongCount, TOMORROW), /exactly eight/);

  const wrongDate = calendar();
  wrongDate.games.V86[0].id = 'V86_2099-01-17_999_1';
  assert.throws(() => v85V86GameIdsFromCalendar(wrongDate, TOMORROW), /does not match/);
});

test('scheduled capture archives tomorrow calendar and V86 while evening excludes today', async () => {
  const { env, db } = createTestEnv();
  const fetchImpl = async (url) => {
    if (url.endsWith(`/calendar/day/${TOMORROW}`)) {
      return new Response(JSON.stringify(calendar()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith(`/games/${GAME_ID}`)) {
      return new Response(JSON.stringify({ id: GAME_ID }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await captureUpcomingOfficialGames(env, `${TODAY}T17:15:00.000Z`, {
    includeToday: false,
    daysAhead: 1,
    fetchImpl
  });
  assert.equal(result.mode, 'evening');
  assert.deepEqual(result.dates, [TOMORROW]);
  assert.deepEqual(result.capturedGameIds, [GAME_ID]);
  assert.equal(result.failureCount, 0);

  const records = db.prepare(`SELECT external_id, quality_status FROM source_records ORDER BY external_id`).all();
  assert.deepEqual(records.map((row) => row.external_id), [`calendar:${TOMORROW}`, `game:${GAME_ID}`]);
  assert.ok(records.every((row) => row.quality_status === 'captured_unmapped'));
  const run = db.prepare(`SELECT status, error_count FROM import_runs WHERE source_type = 'official_live_scheduled_capture'`).get();
  assert.equal(run.status, 'success');
  assert.equal(run.error_count, 0);
});

test('pending normalizer ignores calendar-only captures', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES ('src_calendar_only', 'official_provider', 'calendar:2099-01-16', '2099-01-15T17:15:00.000Z', 'captured_unmapped')`).run();
  assert.deepEqual(await normalizeNextPendingOfficialGame(env), { status: 'idle', done: true });
});

test('live normalization progress advances only after a successful entry run', async () => {
  const { env, db } = createTestEnv();
  const sourceRecordId = 'src_live_progress';
  db.prepare(`
    INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES (?, 'official_provider', 'game:V86_2099-01-16_999_1', '2099-01-15T17:15:00.000Z', 'captured_unmapped')
  `).run(sourceRecordId);
  db.prepare(`
    INSERT INTO normalized_observations
      (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status)
    VALUES ('obs_partial_entry', 'race_entry', 'entry_partial', ?, '2099-01-15T17:15:00.500Z', '{}', 'normalized_verified_subset')
  `).run(sourceRecordId);

  assert.equal(await completedNormalizationCursor(env, sourceRecordId), 0);
  insertNormalizationRun(db, { id: 'imp_failed_0', sourceRecordId, cursor: 0, status: 'failed' });
  assert.equal(await completedNormalizationCursor(env, sourceRecordId), 0);
  insertNormalizationRun(db, { id: 'imp_success_0', sourceRecordId, cursor: 0 });
  assert.equal(await completedNormalizationCursor(env, sourceRecordId), 1);
});

test('live normalization checkpoints fail closed when successful cursors are not contiguous', async () => {
  const { env, db } = createTestEnv();
  const sourceRecordId = 'src_live_gap';
  insertNormalizationRun(db, { id: 'imp_success_gap_0', sourceRecordId, cursor: 0 });
  insertNormalizationRun(db, { id: 'imp_success_gap_2', sourceRecordId, cursor: 2 });
  await assert.rejects(
    () => completedNormalizationCursor(env, sourceRecordId),
    /checkpoints are not contiguous/
  );
});
