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
  const headers = {
    'content-type': init.contentType ?? 'application/json'
  };
  if (init.contentLength != null) headers['content-length'] = String(init.contentLength);
  return new Response(body, {
    status: init.status ?? 200,
    headers
  });
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
  assert.throws(() => validateIsoDate('2026-02-30'), /valid calendar date/);
  assert.throws(() => buildGameUrl(env, '../../secret'), /unsupported format/);
  assert.throws(
    () => buildCalendarUrl({ OFFICIAL_PROVIDER_BASE_URL: 'https://user:pass@example.com/api' }, '2026-09-07'),
    /must not contain credentials/
  );
  assert.throws(
    () => buildCalendarUrl({ OFFICIAL_PROVIDER_BASE_URL: 'http://example.com/api' }, '2026-09-07'),
    /must use https/
  );
});

test('official calendar capture archives the exact JSON before mapping it', async () => {
  const { env, db, objects } = createTestEnv();
  const payload = {
    games: { V85: [{ id: 'synthetic' }] },
    tracks: [{ id: 5, name: 'Synthetic Track' }]
  };
  const seen = [];
  const result = await captureCalendar(env, '2026-09-07', {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return jsonResponse(payload);
    }
  });

  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /calendar\/day\/2026-09-07$/);
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(result.kind, 'calendar');
  assert.equal(result.identity, '2026-09-07');
  assert.equal(result.shape.hasGamesObject, true);
  assert.equal(result.shape.hasTracksArray, true);
  assert.equal(objects.size, 1);

  const source = db.prepare('SELECT source_type, external_id, quality_status, rights_status FROM source_records').get();
  assert.equal(source.source_type, 'official_provider');
  assert.equal(source.external_id, 'calendar:2026-09-07');
  assert.equal(source.quality_status, 'captured_unmapped');
  assert.equal(source.rights_status, 'official_source');
});

test('official provider capture rejects non-JSON responses without archiving them', async () => {
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
});
