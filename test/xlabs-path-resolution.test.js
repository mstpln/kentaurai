import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { resolveCapturedXlabsRequestPath } from '../src/routes/xlabs-path-resolution.js';

function seedParent(db, objects, html = '<html></html>') {
  const key = 'raw/xlabs/parent.html';
  objects.set(key, { body: html, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs','date:test','https://kmtid.atgx.se/260906/','2099-01-01T00:00:00Z',?,'hash_parent','captured_unmapped','unknown','{}')`).run(key);
}

function seedScript(db, objects, id, scriptName, body, fetchedAt) {
  const key = `raw/xlabs_script/${id}.js`;
  objects.set(key, { body, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES (?, 'xlabs_script', ?, ?, ?, ?, ?, 'captured_unmapped', 'unknown', ?)`)
    .run(id, `src_parent:${scriptName}`, `https://kmtid.atgx.se/260906/js/${scriptName}`, fetchedAt, key, `hash_${id}`,
      JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName }));
}

test('resolves a static path from deduplicated sibling context', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects);
  seedScript(db, objects, 'src_calc', 'calculate.js', `$.getJSON(path + fileName);`, '2099-01-01T00:00:10Z');
  seedScript(db, objects, 'src_main_old', 'main.js', `const path = '/old/';`, '2099-01-01T00:00:01Z');
  seedScript(db, objects, 'src_main_new', 'main.js', `const path = '/data/';`, '2099-01-01T00:00:09Z');

  const result = await resolveCapturedXlabsRequestPath(env, 'src_calc');
  assert.equal(result.status, 'resolved_static');
  assert.equal(result.resolvedBaseUrl, 'https://kmtid.atgx.se/data/');
  assert.equal(result.contextSummary.parentIncluded, true);
  assert.deepEqual(result.contextSummary.uniqueSiblingSources, ['main.js']);
  assert.equal(result.assignments.some((x) => x.resolvedBaseUrl === 'https://kmtid.atgx.se/old/'), false);
  assert.equal(result.rawContentReturned, false);
  assert.equal(result.normalizedRowsWritten, 0);
});

test('always includes the parent page even when many duplicate siblings exist', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects, `<html><script>var path = '/from-parent/';</script></html>`);
  seedScript(db, objects, 'src_calc', 'calculate.js', `$.getJSON(path + fileName);`, '2099-01-01T00:01:00Z');
  for (let i = 0; i < 60; i += 1) {
    seedScript(db, objects, `src_dup_${i}`, 'main.js', `const somethingElse = ${i};`, `2099-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(59 - (i % 60)).padStart(2, '0')}Z`);
  }

  const result = await resolveCapturedXlabsRequestPath(env, 'src_calc');
  assert.equal(result.status, 'resolved_static');
  assert.equal(result.resolvedBaseUrl, 'https://kmtid.atgx.se/from-parent/');
  assert.equal(result.contextSummary.parentIncluded, true);
});

test('reports conflicting static path assignments instead of guessing', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects, `<html><script>var path = '/parent/';</script></html>`);
  seedScript(db, objects, 'src_calc', 'calculate.js', `$.getJSON(path + fileName);`, '2099-01-01T00:00:10Z');
  seedScript(db, objects, 'src_main', 'main.js', `const path = '/main/';`, '2099-01-01T00:00:09Z');

  const result = await resolveCapturedXlabsRequestPath(env, 'src_calc');
  assert.equal(result.status, 'conflict');
  assert.equal(result.resolvedBaseUrl, null);
  assert.equal(result.assignments.length >= 2, true);
});

test('ignores path assignments that exist only in comments', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects, `<html><script>// var path = '/fake/';\nconst ok = true;</script></html>`);
  seedScript(db, objects, 'src_calc', 'calculate.js', `$.getJSON(path + fileName);`, '2099-01-01T00:00:10Z');

  const result = await resolveCapturedXlabsRequestPath(env, 'src_calc');
  assert.equal(result.status, 'not_found');
  assert.equal(result.assignments.length, 0);
});

test('does not resolve an off-host static path', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects, `<html><script>var path = 'https://example.com/private?token=secret';</script></html>`);
  seedScript(db, objects, 'src_calc', 'calculate.js', `$.getJSON(path + fileName);`, '2099-01-01T00:00:10Z');

  const result = await resolveCapturedXlabsRequestPath(env, 'src_calc');
  assert.equal(result.status, 'rejected_static');
  assert.equal(result.resolvedBaseUrl, null);
  assert.equal(result.assignments[0].parts[0].value, '[redacted_url]');
});

test('reports a valid static path plus dynamic assignment as ambiguous', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects, `<html><script>var path = '/parent/';</script></html>`);
  seedScript(db, objects, 'src_calc', 'calculate.js', `$.getJSON(path + fileName);`, '2099-01-01T00:00:10Z');
  seedScript(db, objects, 'src_main', 'main.js', `path = choosePath();`, '2099-01-01T00:00:09Z');

  const result = await resolveCapturedXlabsRequestPath(env, 'src_calc');
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.resolvedBaseUrl, null);
});