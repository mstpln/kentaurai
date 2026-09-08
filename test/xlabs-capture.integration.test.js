import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { buildXlabsDateUrl, captureXlabsDate, validateXlabsDate } from '../src/provider/xlabs.js';

test('X-Labs date URL is conservative and host locked', () => {
  assert.equal(buildXlabsDateUrl({}, '2026-09-06'), 'https://kmtid.atgx.se/260906');
  assert.throws(() => validateXlabsDate('2026-02-30'), /valid calendar date/);
  assert.throws(() => buildXlabsDateUrl({ XLABS_BASE_URL: 'http://kmtid.atgx.se' }, '2026-09-06'), /must use https/);
  assert.throws(() => buildXlabsDateUrl({ XLABS_BASE_URL: 'https://example.com' }, '2026-09-06'), /must use kmtid\.atgx\.se/);
  assert.throws(() => buildXlabsDateUrl({ XLABS_BASE_URL: 'https://user:pass@kmtid.atgx.se' }, '2026-09-06'), /must not contain credentials/);
  assert.throws(() => buildXlabsDateUrl({ XLABS_BASE_URL: 'https://kmtid.atgx.se:444' }, '2026-09-06'), /standard https port/);
});

test('X-Labs capture archives exact HTML without inventing normalized fields', async () => {
  const { env, db, objects } = createTestEnv();
  const rawHtml = '<!doctype html>\n<html><body><div data-synthetic="true">Synthetic X-Labs page</div></body></html>\n';
  const seen = [];
  const result = await captureXlabsDate(env, '2026-09-06', {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(rawHtml, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    }
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://kmtid.atgx.se/260906');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(result.normalizationStatus, 'not_implemented');
  assert.equal(result.redirectCount, 0);
  assert.equal(result.url, 'https://kmtid.atgx.se/260906');
  assert.equal(objects.size, 1);
  const stored = [...objects.entries()][0];
  assert.match(stored[0], /raw\/xlabs\/.*\.html$/);
  assert.equal(stored[1].body, rawHtml);
  assert.equal(stored[1].options.httpMetadata.contentType, 'text/html; charset=utf-8');

  const source = db.prepare('SELECT source_type, external_id, source_url, quality_status, rights_status, metadata_json FROM source_records').get();
  assert.equal(source.source_type, 'xlabs');
  assert.equal(source.external_id, 'date:2026-09-06');
  assert.equal(source.source_url, 'https://kmtid.atgx.se/260906');
  assert.equal(source.quality_status, 'captured_unmapped');
  assert.equal(source.rights_status, 'unknown');
  const metadata = JSON.parse(source.metadata_json);
  assert.equal(metadata.normalizationStatus, 'not_implemented');
  assert.equal(metadata.requestedUrl, 'https://kmtid.atgx.se/260906');
  assert.equal(metadata.redirectCount, 0);

  const run = db.prepare('SELECT source_type, status, inserted_count, error_count FROM import_runs').get();
  assert.equal(run.source_type, 'xlabs_capture');
  assert.equal(run.status, 'success');
  assert.equal(run.inserted_count, 1);
  assert.equal(run.error_count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n, 0);
});

test('X-Labs capture follows a bounded same-host HTTPS redirect and archives the final page', async () => {
  const { env, db, objects } = createTestEnv();
  const rawHtml = '<html><body>redirected synthetic page</body></html>';
  const seen = [];
  const result = await captureXlabsDate(env, '2026-09-06', {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (seen.length === 1) {
        return new Response(null, {
          status: 301,
          headers: { location: '/260906/' }
        });
      }
      return new Response(rawHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    }
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[0].url, 'https://kmtid.atgx.se/260906');
  assert.equal(seen[1].url, 'https://kmtid.atgx.se/260906/');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(seen[1].init.redirect, 'manual');
  assert.equal(result.requestedUrl, 'https://kmtid.atgx.se/260906');
  assert.equal(result.url, 'https://kmtid.atgx.se/260906/');
  assert.equal(result.redirectCount, 1);
  assert.equal(objects.size, 1);
  assert.equal([...objects.values()][0].body, rawHtml);
  const source = db.prepare('SELECT source_url, metadata_json FROM source_records').get();
  assert.equal(source.source_url, 'https://kmtid.atgx.se/260906/');
  assert.equal(JSON.parse(source.metadata_json).redirectCount, 1);
});

test('X-Labs capture rejects cross-host redirects and does not archive failed responses', async () => {
  const { env, db, objects } = createTestEnv();
  await assert.rejects(
    () => captureXlabsDate(env, '2026-09-06', {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://example.com/path' } })
    }),
    /must stay on kmtid\.atgx\.se/
  );
  assert.equal(objects.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_records').get().n, 0);
  const run = db.prepare('SELECT status, error_count FROM import_runs').get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
});

test('X-Labs capture rejects insecure redirects', async () => {
  const { env, db, objects } = createTestEnv();
  await assert.rejects(
    () => captureXlabsDate(env, '2026-09-06', {
      fetchImpl: async () => new Response(null, { status: 301, headers: { location: 'http://kmtid.atgx.se/260906/' } })
    }),
    /redirect must use https/
  );
  assert.equal(objects.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_records').get().n, 0);
});

test('X-Labs capture rejects redirects to non-standard ports', async () => {
  const { env, db, objects } = createTestEnv();
  await assert.rejects(
    () => captureXlabsDate(env, '2026-09-06', {
      fetchImpl: async () => new Response(null, { status: 301, headers: { location: 'https://kmtid.atgx.se:444/260906/' } })
    }),
    /standard https port/
  );
  assert.equal(objects.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_records').get().n, 0);
});

test('X-Labs capture stops redirect loops at the bounded redirect limit', async () => {
  const { env, db, objects } = createTestEnv();
  let calls = 0;
  await assert.rejects(
    () => captureXlabsDate(env, '2026-09-06', {
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 301, headers: { location: '/loop' } });
      }
    }),
    /exceeded redirect limit/
  );
  assert.equal(calls, 4);
  assert.equal(objects.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_records').get().n, 0);
});

test('X-Labs capture requires private raw storage and records the failed attempt', async () => {
  const { env, db } = createTestEnv();
  delete env.RAW_BUCKET;
  await assert.rejects(
    () => captureXlabsDate(env, '2026-09-06', {
      fetchImpl: async () => new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      })
    }),
    /RAW_BUCKET is not configured/
  );
  const run = db.prepare('SELECT source_type, status, error_count, error_json FROM import_runs').get();
  assert.equal(run.source_type, 'xlabs_capture');
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
  assert.match(run.error_json, /RAW_BUCKET is not configured/);
});
