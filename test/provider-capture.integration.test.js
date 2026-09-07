import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  buildCalendarUrl,
  buildGameUrl,
  captureCalendar,
  validateIsoDate
} from '../src/provider/official.js';

function jsonResponse(payload, init = {}) {
  const body = JSON.stringify(payload);
  const headers = { 'content-type': init.contentType ?? 'application/json' };
  if (init.contentLength != null) headers['content-length'] = String(init.contentLength);
  return new Response(body, { status: init.status ?? 200, headers });
}

test('official provider URL builders only accept expected inputs', () => {
  const env = {};
  assert.equal(
    buildCalendarUrl(env, '2026-09-07'),
    'https://www.atg.se/services/racinginfo/v1/api/calendar/day/2026-09-07'
  );
  assert.equal(
    buildGameUrl(env, 'V85_2026-09-07_5_1'),
    'https://www.atg.se/services/racinginfo/v1/api/games/V85_2026-09-07_5_1'
  );
  assert.equal(
    buildGameUrl(env, 'V86_live-round_ABC123'),
    'https://www.atg.se/services/racinginfo/v1/api/games/V86_live-round_ABC123'
  );
  assert.throws(() => validateIsoDate('2026-02-30'), /valid calendar date/);
  assert.throws(() => buildGameUrl(env, '../../secret'), /unsupported format/);
  assert.throws(() => buildGameUrl(env, `V85_${'a'.repeat(200)}`), /unsupported format/);
  assert.throws(
    () => buildCalendarUrl({ OFFICIAL_PROVIDER_BASE_URL: 'https://user:pass@www.atg.se/api' }, '2026-09-07'),
    /must not contain credentials/
  );
  assert.throws(
    () => buildCalendarUrl({ OFFICIAL_PROVIDER_BASE_URL: 'http://www.atg.se/api' }, '2026-09-07'),
    /must use https/
  );
  assert.throws(
    () => buildCalendarUrl({ OFFICIAL_PROVIDER_BASE_URL: 'https://example.com/api' }, '2026-09-07'),
    /must use an atg\.se host/
  );
});

test('official calendar capture archives the exact JSON and records a successful run', async () => {
  const { env, db, objects } = createTestEnv();
  const rawBody = '{\n  "games": { "V85": [{"id":"synthetic"}] },\n  "tracks": [{"id":5,"name":"Synthetic Track"}]\n}\n';
  const seen = [];
  const result = await captureCalendar(env, '2026-09-07', {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(rawBody, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      });
    }
  });

  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /calendar\/day\/2026-09-07$/);
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(result.kind, 'calendar');
  assert.equal(result.identity, '2026-09-07');
  assert.equal(result.shape.hasGamesObject, true);
  assert.equal(result.shape.hasTracksArray, true);
  assert.equal(result.reused, false);
  assert.equal(objects.size, 1);
  assert.equal([...objects.values()][0].body, rawBody);

  const source = db.prepare('SELECT source_type, external_id, quality_status, rights_status FROM source_records').get();
  assert.equal(source.source_type, 'official_provider');
  assert.equal(source.external_id, 'calendar:2026-09-07');
  assert.equal(source.quality_status, 'captured_unmapped');
  assert.equal(source.rights_status, 'unknown');

  const run = db.prepare('SELECT source_type, status, inserted_count, error_count, error_json FROM import_runs').get();
  assert.equal(run.source_type, 'official_provider_capture');
  assert.equal(run.status, 'success');
  assert.equal(run.inserted_count, 1);
  assert.equal(run.error_count, 0);
  assert.equal(run.error_json, null);
  assert.equal(result.importRunId != null, true);
});

test('official provider capture requires private raw storage and logs the failed attempt', async () => {
  const { env, db } = createTestEnv();
  delete env.RAW_BUCKET;
  await assert.rejects(
    () => captureCalendar(env, '2026-09-07', { fetchImpl: async () => jsonResponse({}) }),
    /RAW_BUCKET is not configured/
  );
  const run = db.prepare('SELECT status, error_count, error_json FROM import_runs').get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
  assert.match(run.error_json, /RAW_BUCKET is not configured/);
});

test('official provider capture rejects non-JSON responses, archives nothing, and logs failure', async () => {
  const { env, db, objects } = createTestEnv();
  await assert.rejects(
    () => captureCalendar(env, '2026-09-07', {
      fetchImpl: async () => new Response('<html>blocked</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    }),
    /did not return JSON/
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM source_records').get().n, 0);
  assert.equal(objects.size, 0);
  const run = db.prepare('SELECT status, error_count FROM import_runs').get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
});

test('official provider capture rejects HTTP failures without archiving them', async () => {
  const { env, db } = createTestEnv();
  await assert.rejects(
    () => captureCalendar(env, '2026-09-07', {
      fetchImpl: async () => jsonResponse({ error: 'nope' }, { status: 503 })
    }),
    /HTTP 503/
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM source_records').get().n, 0);
  assert.equal(db.prepare("SELECT status FROM import_runs").get().status, 'failed');
});

test('official provider capture rejects redirects without archiving them', async () => {
  const { env, db, objects } = createTestEnv();
  await assert.rejects(
    () => captureCalendar(env, '2026-09-07', {
      fetchImpl: async (_url, init) => {
        assert.equal(init.redirect, 'manual');
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/redirected' }
        });
      }
    }),
    /HTTP 302/
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM source_records').get().n, 0);
  assert.equal(objects.size, 0);
  assert.equal(db.prepare("SELECT status FROM import_runs").get().status, 'failed');
});

test('official provider capture rejects an oversized declared response before archiving it', async () => {
  const { env, db, objects } = createTestEnv();
  await assert.rejects(
    () => captureCalendar(env, '2026-09-07', {
      fetchImpl: async () => jsonResponse({ ok: true }, { contentLength: 9 * 1024 * 1024 })
    }),
    /exceeded size limit/
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM source_records').get().n, 0);
  assert.equal(objects.size, 0);
  assert.equal(db.prepare("SELECT status FROM import_runs").get().status, 'failed');
});
