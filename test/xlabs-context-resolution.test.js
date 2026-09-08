import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { inspectCapturedXlabsScript, inspectXlabsScriptText } from '../src/routes/xlabs-script-inspection.js';

function seedParent(db, objects, html) {
  const key = 'raw/xlabs/parent.html';
  objects.set(key, { body: html, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs','date:test','https://kmtid.atgx.se/260906/','2099-01-01T00:00:00Z',?,'hash_parent','captured_unmapped','unknown','{}')`).run(key);
}

function seedScript(db, objects, id, scriptName, script) {
  const key = `raw/xlabs_script/${id}.js`;
  objects.set(key, { body: script, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES (?, 'xlabs_script', ?, ?, '2099-01-01T00:00:00Z', ?, ?, 'captured_unmapped', 'unknown', ?)`)
    .run(id, `src_parent:${scriptName}`, `https://kmtid.atgx.se/260906/js/${scriptName}`, key, `hash_${id}`,
      JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName }));
}

test('member properties are not treated as unresolved variables', () => {
  const inspection = inspectXlabsScriptText(`
    const trackNumber = race.trackId.toString();
    const raceNumberString = race.number.toString();
    $.getJSON(path + trackNumber + raceNumberString);
  `, { documentBaseUrl: 'https://kmtid.atgx.se/260906/' });
  const unresolved = inspection.requestArgumentShapes[0].unresolvedIdentifiers;
  assert.ok(unresolved.includes('path'));
  assert.ok(unresolved.includes('race'));
  assert.equal(unresolved.includes('trackId'), false);
  assert.equal(unresolved.includes('number'), false);
  assert.equal(unresolved.includes('toString'), false);
});

test('comma-separated path definition in captured parent context is resolved', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects, `<script>var root = '/data/', path = root + 'json/';</script>`);
  seedScript(db, objects, 'src_calc', 'calculate.js', `
    const fileName = monthString + dayString + trackNumber + '1' + raceNumberString + '.json';
    $.getJSON(path + fileName);
  `);
  const result = await inspectCapturedXlabsScript(env, 'src_calc');
  const recipe = result.inspection.requestArgumentShapes[0].requestRecipe;
  const pathDefinition = recipe.contextDefinitions.find((x) => x.identifier === 'path');
  assert.ok(pathDefinition);
  assert.ok(pathDefinition.parts.some((x) => x.kind === 'string' && x.value === 'json/'));
  assert.equal(recipe.unresolvedIdentifiers.includes('path'), false);
});

test('assignment after a control-flow close parenthesis is resolved', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent(db, objects, `<script>if (true) path = '/json/';</script>`);
  seedScript(db, objects, 'src_calc', 'calculate.js', `$.getJSON(path + fileName);`);
  const result = await inspectCapturedXlabsScript(env, 'src_calc');
  const recipe = result.inspection.requestArgumentShapes[0].requestRecipe;
  assert.ok(recipe.contextDefinitions.some((x) => x.identifier === 'path'));
  assert.equal(recipe.unresolvedIdentifiers.includes('path'), false);
});
