import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { inspectCapturedXlabsScript, inspectXlabsScriptText } from '../src/routes/xlabs-script-inspection.js';

function seedParent(db, objects, html = '<html></html>') {
  const key = 'raw/xlabs/parent.html';
  objects.set(key, { body: html, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs','date:test','https://kmtid.atgx.se/260906/','2099-01-01T00:00:00Z',?,'hash_parent','captured_unmapped','unknown','{}')`).run(key);
}

function seedScript(db, objects, id, scriptName, script, parentSourceRecordId = 'src_parent') {
  const key = `raw/xlabs_script/${id}.js`;
  objects.set(key, { body: script, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES (?, 'xlabs_script', ?, ?, '2099-01-01T00:00:00Z', ?, ?, 'captured_unmapped', 'unknown', ?)`)
    .run(id, `${parentSourceRecordId}:${scriptName}`, `https://kmtid.atgx.se/260906/js/${scriptName}`, key, `hash_${id}`,
      JSON.stringify({ parentSourceRecordId, scriptName }));
}

test('request recipe preserves ordered dynamic parts', () => {
  const inspection = inspectXlabsScriptText(`
    const fileName = monthString + dayString + trackNumber + '1' + raceNumberString + '.json';
    $.getJSON(path + fileName);
  `, { documentBaseUrl: 'https://kmtid.atgx.se/260906/' });
  const shape = inspection.requestArgumentShapes[0];
  assert.deepEqual(shape.parts, [
    { kind: 'identifier', value: 'path' },
    { kind: 'identifier', value: 'fileName' }
  ]);
  const fileName = shape.definitions.find((x) => x.identifier === 'fileName');
  assert.equal(fileName.parts.at(-1).value, '.json');
});

test('captured inspection resolves path from sibling script', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects);
  seedScript(db, objects, 'src_calc', 'calculate.js', `
    const fileName = monthString + dayString + trackNumber + '1' + raceNumberString + '.json';
    $.getJSON(path + fileName);
  `);
  seedScript(db, objects, 'src_main', 'main.js', `const path = '/data/';`);
  const result = await inspectCapturedXlabsScript(env, 'src_calc');
  const shape = result.inspection.requestArgumentShapes[0];
  assert.ok(shape.contextDefinitions.some((x) => x.source === 'main.js' && x.identifier === 'path'));
  assert.ok(shape.requestRecipe.contextDefinitions.some((x) => x.identifier === 'path'));
});

test('context lookup does not cross-match parent ids through LIKE wildcards', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects);
  seedScript(db, objects, 'src_calc', 'calculate.js', `$.getJSON(path + fileName);`);
  seedScript(db, objects, 'src_good', 'main.js', `const path = '/correct/';`);
  seedScript(db, objects, 'src_wrong', 'wrong.js', `const path = '/wrong/';`, 'srcXparent');

  const result = await inspectCapturedXlabsScript(env, 'src_calc');
  const definitions = result.inspection.requestArgumentShapes[0].requestRecipe.contextDefinitions;
  assert.ok(definitions.some((x) => x.source === 'main.js' && x.identifier === 'path'));
  assert.equal(definitions.some((x) => x.source === 'wrong.js'), false);
});
