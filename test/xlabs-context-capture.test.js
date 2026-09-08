import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { captureXlabsContextScripts, XLABS_SCRIPT_SELECTOR_VERSION } from '../src/provider/xlabs-script.js';

function seedParentAndCalculate(db, objects) {
  const parentKey = 'raw/xlabs/parent.html';
  objects.set(parentKey, {
    body: `<html><script src="https://kmtid.atgx.se/260906/js/language.js"></script><script src="https://kmtid.atgx.se/260906/js/helper.js"></script><script src="https://kmtid.atgx.se/260906/js/calculate.js"></script></html>`,
    options: {}
  });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs','date:test','https://kmtid.atgx.se/260906/','2099-01-01T00:00:00Z',?,'hash_parent','captured_unmapped','unknown','{}')`).run(parentKey);

  const scriptKey = 'raw/xlabs_script/calculate.js';
  objects.set(scriptKey, { body: `$.getJSON(path + fileName);`, options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_calc','xlabs_script','src_parent:calculate.js','https://kmtid.atgx.se/260906/js/calculate.js','2099-01-01T00:00:00Z',?,'hash_calc','captured_unmapped','unknown',?)`)
    .run(scriptKey, JSON.stringify({ parentSourceRecordId: 'src_parent', scriptName: 'calculate.js' }));
}

test('captures only the bounded first-party context scripts from the same parent page', async () => {
  const { env, db, objects } = createTestEnv();
  seedParentAndCalculate(db, objects);
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return new Response(`const path = '/data/';`, {
      status: 200,
      headers: { 'content-type': 'application/javascript' }
    });
  };

  const captures = await captureXlabsContextScripts(env, 'src_calc', { fetchImpl });
  assert.deepEqual(captures.map((x) => x.scriptName), ['language.js', 'helper.js']);
  assert.equal(XLABS_SCRIPT_SELECTOR_VERSION, 'inspector-sources-v5');
  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.startsWith('https://kmtid.atgx.se/260906/js/')));

  const rows = db.prepare(`SELECT external_id, source_url FROM source_records WHERE source_type = 'xlabs_script' ORDER BY external_id`).all();
  assert.ok(rows.some((row) => row.external_id === 'src_parent:language.js'));
  assert.ok(rows.some((row) => row.external_id === 'src_parent:helper.js'));
  assert.ok(rows.every((row) => row.source_url.startsWith('https://kmtid.atgx.se/')));
});
