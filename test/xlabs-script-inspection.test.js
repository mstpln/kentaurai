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

test('dynamic getJSON request traces safe latest variable definition', () => {
  const inspection = inspectXlabsScriptText(`
    const endpoint = '/data/' + selectedDate + '/races.json?token=secret';
    $.getJSON(endpoint, function (payload) { return payload; });
  `, { documentBaseUrl: 'https://kmtid.atgx.se/260906/' });

  assert.equal(inspection.networkCounts.jqueryGetJson, 1);
  assert.equal(inspection.literalNetworkReferences.length, 0);
  assert.equal(inspection.requestArgumentShapes.length, 1);
  const shape = inspection.requestArgumentShapes[0];
  assert.equal(shape.kind, 'jquery_get_json');
  assert.equal(shape.expressionType, 'dynamic');
  assert.deepEqual(shape.identifiers, ['endpoint']);
  assert.equal(shape.definitions.length, 1);
  assert.equal(shape.definitions[0].identifier, 'endpoint');
  assert.deepEqual(shape.definitions[0].identifiers, ['selectedDate']);
  assert.deepEqual(shape.definitions[0].literals, [
    { kind: 'string', value: '/data/' },
    { kind: 'string', value: '/races.json' }
  ]);
  assert.equal(JSON.stringify(shape).includes('token=secret'), false);
});

test('dynamic request follows a second safe definition level', () => {
  const inspection = inspectXlabsScriptText(`
    const datePath = '/260906/';
    const endpoint = datePath + 'data.json?secret=1';
    $.getJSON(endpoint);
  `, { documentBaseUrl: 'https://kmtid.atgx.se/260906/' });

  const shape = inspection.requestArgumentShapes[0];
  assert.deepEqual(shape.identifiers, ['endpoint']);
  assert.equal(shape.definitions.length, 2);
  assert.equal(shape.definitions[0].identifier, 'endpoint');
  assert.deepEqual(shape.definitions[0].identifiers, ['datePath']);
  assert.deepEqual(shape.definitions[0].literals, [{ kind: 'string', value: 'data.json' }]);
  assert.equal(shape.definitions[1].identifier, 'datePath');
  assert.equal(shape.definitions[1].expressionType, 'literal');
  assert.deepEqual(shape.definitions[1].literals, [{ kind: 'url', value: 'https://kmtid.atgx.se/260906/' }]);
  assert.equal(JSON.stringify(shape).includes('secret=1'), false);
});

test('dynamic concatenated request reports sanitized literal components and identifiers', () => {
  const inspection = inspectXlabsScriptText(`
    $.getJSON('/data/' + selectedDate + '/races.json?auth=private');
  `, { documentBaseUrl: 'https://kmtid.atgx.se/260906/' });

  const shape = inspection.requestArgumentShapes[0];
  assert.equal(shape.kind, 'jquery_get_json');
  assert.equal(shape.expressionType, 'dynamic');
  assert.deepEqual(shape.identifiers, ['selectedDate']);
  assert.deepEqual(shape.literals, [
    { kind: 'string', value: '/data/' },
    { kind: 'string', value: '/races.json' }
  ]);
  assert.deepEqual(shape.definitions, []);
  assert.equal(JSON.stringify(shape).includes('auth=private'), false);
});

test('literal request still returns a sanitized resolved URL shape', () => {
  const inspection = inspectXlabsScriptText(`$.getJSON('/data/races.json?secret=1');`, {
    documentBaseUrl: 'https://kmtid.atgx.se/260906/'
  });
  const shape = inspection.requestArgumentShapes[0];
  assert.equal(shape.expressionType, 'literal');
  assert.deepEqual(shape.identifiers, []);
  assert.deepEqual(shape.literals, [{ kind: 'url', value: 'https://kmtid.atgx.se/data/races.json' }]);
  assert.deepEqual(shape.definitions, []);
  assert.equal(JSON.stringify(shape).includes('secret=1'), false);
});

test('dynamic absolute URL components strip credentials and query data', () => {
  const inspection = inspectXlabsScriptText(`
    const endpoint = 'https://user:pass@kmtid.atgx.se/data/?token=secret' + selectedDate;
    $.getJSON(endpoint);
  `, { documentBaseUrl: 'https://kmtid.atgx.se/260906/' });
  const serialized = JSON.stringify(inspection.requestArgumentShapes[0]);
  assert.equal(serialized.includes('user:pass'), false);
  assert.equal(serialized.includes('token=secret'), false);
  assert.ok(serialized.includes('https://kmtid.atgx.se/data/'));
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
