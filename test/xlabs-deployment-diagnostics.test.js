import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import { captureReferencedXlabsScript, XLABS_SCRIPT_SELECTOR_VERSION } from '../src/provider/xlabs-script.js';

function seedParent({ db, objects, html }) {
  const key = 'raw/xlabs/2099-01-01/diagnostic-parent.html';
  objects.set(key, { body: html, options: {} });
  db.prepare(`
    INSERT INTO source_records
      (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_diag','xlabs','date:2099-01-01','https://kmtid.atgx.se/260906/','2099-01-01T00:00:00Z',?,'hash_diag','captured_unmapped','unknown','{}')
  `).run(key);
}

test('health exposes the active X-Labs selector version', async () => {
  const { env } = createTestEnv();
  const response = await worker.fetch(new Request('https://example.test/health'), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.xlabsScriptSelector, XLABS_SCRIPT_SELECTOR_VERSION);
});

test('failed X-Labs selection reports selector version and available script names only', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent({
    db,
    objects,
    html: [
      '<script src="js/races.js?token=private"></script>',
      '<script src="js/main.js"></script>'
    ].join('')
  });

  await assert.rejects(
    () => captureReferencedXlabsScript(env, 'src_diag', 'calculator.js', { fetchImpl: async () => new Response('x') }),
    (error) => {
      assert.match(error.message, new RegExp(`selector=${XLABS_SCRIPT_SELECTOR_VERSION}`));
      assert.match(error.message, /requested=calculator\.js/);
      assert.match(error.message, /available=races\.js,main\.js/);
      assert.equal(error.message.includes('token=private'), false);
      return true;
    }
  );
});
