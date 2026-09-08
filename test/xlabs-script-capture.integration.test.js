import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import { captureReferencedXlabsScript } from '../src/provider/xlabs-script.js';
import { inspectCapturedXlabs } from '../src/routes/xlabs-inspection.js';

function seedParent({ db, objects, html, sourceUrl = 'https://kmtid.atgx.se/260906/' }) {
  const key = 'raw/xlabs/2099-01-01/parent.html';
  objects.set(key, { body: html, options: {} });
  db.prepare(`
    INSERT INTO source_records
      (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_parent','xlabs','date:2099-01-01',?,'2099-01-01T00:00:00Z',?,'hash_parent','captured_unmapped','unknown','{}')
  `).run(sourceUrl, key);
}

async function captureWithSyntheticResponse(env, scriptName) {
  const seen = [];
  const result = await captureReferencedXlabsScript(env, 'src_parent', scriptName, {
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(`const ${scriptName.replace('.js', '')} = true;`, {
        status: 200,
        headers: { 'content-type': 'application/javascript' }
      });
    }
  });
  return { result, seen };
}

test('X-Labs script capture selects each allowlisted script from sibling script tags', async () => {
  for (const scriptName of ['races.js', 'calculator.js', 'main.js']) {
    const { env, db, objects } = createTestEnv();
    seedParent({
      db,
      objects,
      html: [
        '<script src="js/races.js?token=private#fragment"></script>',
        '<script src="js/calculator.js"></script>',
        '<script src="js/main.js"></script>'
      ].join('')
    });

    const { result, seen } = await captureWithSyntheticResponse(env, scriptName);
    assert.equal(seen.length, 1);
    assert.equal(new URL(seen[0].url).pathname.endsWith(`/js/${scriptName}`), true);
    assert.equal(seen[0].init.redirect, 'manual');
    assert.equal(result.scriptName, scriptName);
    assert.equal(result.parentSourceRecordId, 'src_parent');
    assert.equal(result.url, `https://kmtid.atgx.se/260906/js/${scriptName}`);
    assert.equal(result.normalizationStatus, 'not_implemented');
    const scriptRecord = db.prepare("SELECT source_type, external_id, source_url, quality_status, metadata_json FROM source_records WHERE source_type = 'xlabs_script'").get();
    assert.equal(scriptRecord.external_id, `src_parent:${scriptName}`);
    assert.equal(scriptRecord.source_url, `https://kmtid.atgx.se/260906/js/${scriptName}`);
    assert.equal(scriptRecord.quality_status, 'captured_unmapped');
    assert.equal(JSON.parse(scriptRecord.metadata_json).scriptName, scriptName);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n, 0);
  }
});

test('inspector-visible production-shaped script list is capture-eligible for calculator and main', async () => {
  for (const scriptName of ['calculator.js', 'main.js']) {
    const { env, db, objects } = createTestEnv();
    seedParent({
      db,
      objects,
      html: [
        '<script src="js/vendor/modernizr-2.7.1.min.js"></script>',
        '<script src="js/Chart.bundle.min.js"></script>',
        '<script src="js/vendor/jquery-2.1.0.min.js"></script>',
        '<script src="js/moment.js"></script>',
        '<script src="js/language.js"></script>',
        '<script src="js/helper.js"></script>',
        '<script src="js/races.js"></script>',
        '<script src="js/calculator.js"></script>',
        '<script src="js/main.js"></script>'
      ].join('')
    });

    const inspected = await inspectCapturedXlabs(env, 'src_parent');
    assert.ok(inspected.inspection.scripts.externalSources.includes(`https://kmtid.atgx.se/260906/js/${scriptName}`));

    const { result, seen } = await captureWithSyntheticResponse(env, scriptName);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, `https://kmtid.atgx.se/260906/js/${scriptName}`);
    assert.equal(result.scriptName, scriptName);
    assert.equal(result.url, `https://kmtid.atgx.se/260906/js/${scriptName}`);
  }
});

test('X-Labs script capture strips query and fragment data before fetch and provenance', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent({ db, objects, html: '<script src="js/races.js?token=private#fragment"></script>' });
  const { result, seen } = await captureWithSyntheticResponse(env, 'races.js');
  assert.equal(seen[0].url, 'https://kmtid.atgx.se/260906/js/races.js');
  assert.equal(result.url, 'https://kmtid.atgx.se/260906/js/races.js');
  const scriptRecord = db.prepare("SELECT source_url, metadata_json FROM source_records WHERE source_type = 'xlabs_script'").get();
  assert.equal(scriptRecord.source_url, 'https://kmtid.atgx.se/260906/js/races.js');
  const metadata = JSON.parse(scriptRecord.metadata_json);
  assert.equal(metadata.requestedUrl, 'https://kmtid.atgx.se/260906/js/races.js');
  const run = db.prepare("SELECT metadata_json FROM import_runs WHERE source_type = 'xlabs_script_capture'").get();
  assert.equal(JSON.stringify(run).includes('token=private'), false);
  assert.equal(JSON.stringify(metadata).includes('token=private'), false);
});

test('X-Labs script capture rejects scripts outside the narrow allowlist', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent({ db, objects, html: '<script src="js/vendor.js"></script>' });
  await assert.rejects(
    () => captureReferencedXlabsScript(env, 'src_parent', 'vendor.js', { fetchImpl: async () => new Response('x') }),
    /script_name must be races\.js, calculator\.js or main\.js/
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM source_records WHERE source_type = 'xlabs_script'").get().n, 0);
});

test('X-Labs script capture rejects an allowlisted name that was not referenced by the parent page', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent({ db, objects, html: '<script src="js/main.js"></script>' });
  await assert.rejects(
    () => captureReferencedXlabsScript(env, 'src_parent', 'races.js', { fetchImpl: async () => new Response('x') }),
    /was not referenced by the captured page/
  );
});

test('X-Labs script capture ignores cross-host parent references', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent({ db, objects, html: '<script src="https://example.test/races.js"></script>' });
  await assert.rejects(
    () => captureReferencedXlabsScript(env, 'src_parent', 'races.js', { fetchImpl: async () => new Response('x') }),
    /was not referenced by the captured page/
  );
});

test('X-Labs script capture rejects unsafe redirects', async () => {
  const { env, db, objects } = createTestEnv();
  seedParent({ db, objects, html: '<script src="js/main.js"></script>' });
  await assert.rejects(
    () => captureReferencedXlabsScript(env, 'src_parent', 'main.js', {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://example.test/main.js' } })
    }),
    /must stay on kmtid\.atgx\.se/
  );
  const run = db.prepare("SELECT status, error_count FROM import_runs WHERE source_type = 'xlabs_script_capture'").get();
  assert.equal(run.status, 'failed');
  assert.equal(run.error_count, 1);
});

test('X-Labs script capture route remains behind ADMIN_TOKEN', async () => {
  const { env } = createTestEnv();
  env.ADMIN_TOKEN = 'synthetic-admin-token';
  const request = new Request('https://example.test/v1/xlabs/capture-script', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source_record_id: 'src_parent', script_name: 'races.js' })
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});
