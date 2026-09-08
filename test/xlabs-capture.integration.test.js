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
  assert.equal(objects.size, 1);
  const stored = [...objects.entries()][0];
  assert.match(stored[0], /raw\/xlabs\/.*\.html$/);
  assert.equal(stored[1].body, rawHtml);
  assert.equal(stored[1].options.httpMetadata.contentType, 'text/html; charset=utf-8');

  const source = db.prepare('SELECT source_type, external_id, quality_status, rights_status, metadata_json FROM source_records').get();
  assert.equal(source.source_type, 'xlabs');
  assert.equal(source.external_id, 'date:2026-09-06');
  assert.equal(source.quality_status, 'captured_unmapped');
  assert.equal(source.rights_status, 'unknown');
  assert.equal(JSON.parse(source.metadata_json).normalizationStatus, 'not_implemented');

  const run = db.prepare('SELECT source_type, status, inserted_count, error_count FROM import_runs').get();
  assert.equal(run.source_type, 'xlabs_capture');
  assert.equal(run.status, 'success');
  assert.equal(run.inserted_count, 1);
  assert.equal(run.error_count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n, 0);
});

test('X-Labs capture rejects redirects and does not archive failed responses', async () => {
  const { env, db, objects } = createTestEnv();
  await assert.rejects(
    () => captureXlabsDate(env, '2026-09-06', {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://example.com' } })
    }),
    /HTTP 302/
  );
  assert.equal(objects.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM source_records').get().n, 0);
  const run = db.prepare('SELECT status, error_count FROM import_runs').get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
});
