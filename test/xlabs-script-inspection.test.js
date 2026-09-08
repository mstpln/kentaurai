import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import { inspectCapturedXlabsScript, inspectXlabsScriptText } from '../src/routes/xlabs-script-inspection.js';

function seedScript({ db, objects, script = '', scriptName = 'main.js' }) {
  const key = `raw/xlabs_script/2099-01-01/${scriptName}`;
  objects.set(key, { body: script, options: {} });
  db.prepare(`
    INSERT INTO source_records
      (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_script','xlabs_script',?,'https://kmtid.atgx.se/260906/js/' || ?,'2099-01-01T00:00:00Z',?,'hash_script','captured_unmapped','unknown',?)
  `).run(`src_parent:${scriptName}`, scriptName, key, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName }));
  db.prepare(`
    INSERT INTO source_records
      (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs','date:2099-01-01','https://kmtid.atgx.se/260906/','2099-01-01T00:00:00Z','raw/xlabs/parent.html','hash_parent','captured_unmapped','unknown','{}')
  `).run();
}

test('script text inspection identifies request mechanisms and sanitized endpoint candidates', () => {
  const inspection = inspectXlabsScriptText(`
    fetch('/api/races?token=secret');
    $.getJSON('data/starts.json?x=1');
    $.ajax({ url: '/results.php?auth=private' });
    var xhr = new XMLHttpRequest();
    const horse = race.start.horse;
  `, { documentBaseUrl: 'https://kmtid.atgx.se/260906/' });

  assert.equal(inspection.networkCounts.fetch, 1);
  assert.equal(inspection.networkCounts.xhr, 1);
  assert.equal(inspection.networkCounts.jqueryAjax, 1);
  assert.equal(inspection.networkCounts.jqueryGetJson, 1);
  assert.ok(inspection.literalNetworkReferences.some((x) => x.resolvedUrl === 'https://kmtid.atgx.se/api/races'));
  assert.ok(inspection.literalNetworkReferences.some((x) => x.resolvedUrl === 'https://kmtid.atgx.se/260906/data/starts.json'));
  assert.ok(inspection.literalNetworkReferences.some((x) => x.resolvedUrl === 'https://kmtid.atgx.se/results.php'));
  assert.equal(JSON.stringify(inspection).includes('token=secret'), false);
  assert.equal(JSON.stringify(inspection).includes('auth=private'), false);
  assert.ok(inspection.keywordCounts.race > 0);
  assert.ok(inspection.keywordCounts.horse > 0);
});

test('captured script inspection reads only private xlabs_script records and writes no normalized rows', async () => {
  const { env, db, objects } = createTestEnv();
  seedScript({ db, objects, script: `$.getJSON('/api/races.json?secret=1');`, scriptName: 'main.js' });

  const result = await inspectCapturedXlabsScript(env, 'src_script');
  assert.equal(result.sourceRecordId, 'src_script');
  assert.equal(result.scriptName, 'main.js');
  assert.equal(result.parentSourceRecordId, 'src_parent');
  assert.equal(result.sourceUrl, 'https://kmtid.atgx.se/260906/js/main.js');
  assert.equal(result.normalizedRowsWritten, 0);
  assert.equal(result.mapperStatus, 'not_implemented');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n, 0);
});

test('script inspection route remains behind ADMIN_TOKEN', async () => {
  const { env } = createTestEnv();
  env.ADMIN_TOKEN = 'synthetic-admin-token';
  const response = await worker.fetch(new Request('https://example.test/v1/xlabs/inspect-script', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source_record_id: 'src_script' })
  }), env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});
