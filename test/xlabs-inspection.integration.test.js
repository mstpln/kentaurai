import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createTestEnv } from './helpers/d1.js';
import { inspectCapturedXlabs, inspectXlabsHtml } from '../src/routes/xlabs-inspection.js';

test('X-Labs inspector reports structural signals without returning page content', () => {
  const html = `<!doctype html>
  <html>
    <head><title>Synthetic X-Labs</title></head>
    <body data-meeting="synthetic">
      <table><thead><tr><th>Horse</th><th>Last 200</th></tr></thead><tbody><tr><td>Alpha</td><td>10.7</td></tr></tbody></table>
      <script type="application/json" id="payload">{"raceId":"synthetic-race","starts":[1,2]}</script>
      <script>fetch('/api/results/260906?token=should-not-be-returned')</script>
    </body>
  </html>`;
  const result = inspectXlabsHtml(html);
  assert.equal(result.title, 'Synthetic X-Labs');
  assert.equal(result.counts.tables, 1);
  assert.equal(result.counts.rows, 2);
  assert.ok(result.candidateDataChannels.includes('html_table'));
  assert.ok(result.candidateDataChannels.includes('embedded_json'));
  assert.ok(result.candidateDataChannels.includes('network_or_api_reference'));
  assert.equal(result.scripts.jsonScriptSummaries[0].parseable, true);
  assert.deepEqual(result.scripts.jsonScriptSummaries[0].topLevelKeys, ['raceId', 'starts']);
  assert.deepEqual(result.tables[0].headers, ['Horse', 'Last 200']);
  assert.ok(result.scripts.candidateEndpoints.includes('/api/results/260906'));
  assert.equal(JSON.stringify(result).includes('10.7'), false);
  assert.equal(JSON.stringify(result).includes('Alpha'), false);
  assert.equal(JSON.stringify(result).includes('should-not-be-returned'), false);
});

test('X-Labs inspector reports sanitized iframe document references', () => {
  const html = '<html><body><iframe id="race-frame" name="race" src="/frame/260906?token=private#secret"></iframe></body></html>';
  const result = inspectXlabsHtml(html, { baseUrl: 'https://kmtid.atgx.se/260906/' });
  assert.equal(result.counts.iframes, 1);
  assert.ok(result.candidateDataChannels.includes('iframe_document'));
  assert.deepEqual(result.iframes, [{
    src: 'https://kmtid.atgx.se/frame/260906',
    name: 'race',
    id: 'race-frame'
  }]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('private'), false);
  assert.equal(serialized.includes('secret'), false);
});

test('X-Labs inspector resolves and sanitizes external script sources', () => {
  const html = `
    <script src="/assets/app.js?token=private#secret"></script>
    <script src="//cdn.example.test/lib.js?key=private"></script>
    <script src="javascript:alert(1)"></script>
  `;
  const result = inspectXlabsHtml(html, { baseUrl: 'https://kmtid.atgx.se/260906/' });
  assert.equal(result.scripts.external, 3);
  assert.deepEqual(result.scripts.externalSources, [
    'https://kmtid.atgx.se/assets/app.js',
    'https://cdn.example.test/lib.js'
  ]);
  assert.ok(result.candidateDataChannels.includes('external_script'));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('private'), false);
  assert.equal(serialized.includes('secret'), false);
});

test('X-Labs inspector does not treat body-row th values as structural headers', () => {
  const result = inspectXlabsHtml('<table><tbody><tr><th>Private Horse Value</th><td>10.7</td></tr></tbody></table>');
  assert.deepEqual(result.tables[0].headers, []);
  assert.equal(JSON.stringify(result).includes('Private Horse Value'), false);
  assert.equal(JSON.stringify(result).includes('10.7'), false);
});

test('X-Labs inspector refuses HTML above the capture size boundary', () => {
  const oversized = `<html>${'x'.repeat((8 * 1024 * 1024) + 1)}</html>`;
  assert.throws(() => inspectXlabsHtml(oversized), /exceeded inspection size limit/);
});

test('captured X-Labs inspection is source scoped, read-only and returns no raw HTML', async () => {
  const { env, db, objects } = createTestEnv();
  const html = '<html><head><title>Stored synthetic</title><script src="/assets/app.js?token=private"></script></head><body><iframe src="/embedded?token=private"></iframe><div data-race="x"></div></body></html>';
  const key = 'raw/xlabs/2099-01-01/synthetic.html';
  objects.set(key, { body: html, options: {} });
  db.prepare(`
    INSERT INTO source_records
      (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_xlabs','xlabs','date:2099-01-01','https://user:secret@kmtid.atgx.se/990101?token=private#fragment','2099-01-01T12:00:00Z',?,'hash_x','captured_unmapped','unknown','{"normalizationStatus":"not_implemented","secret":"must-not-return"}')
  `).run(key);

  const before = db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n;
  const result = await inspectCapturedXlabs(env, 'src_xlabs');
  const after = db.prepare('SELECT COUNT(*) AS n FROM xlabs_data').get().n;
  const serialized = JSON.stringify(result);

  assert.equal(result.sourceRecordId, 'src_xlabs');
  assert.equal(result.qualityStatus, 'captured_unmapped');
  assert.equal(result.inspection.title, 'Stored synthetic');
  assert.equal(result.sourceUrl, 'https://kmtid.atgx.se/990101');
  assert.deepEqual(result.inspection.iframes, [{ src: 'https://kmtid.atgx.se/embedded', name: null, id: null }]);
  assert.deepEqual(result.inspection.scripts.externalSources, ['https://kmtid.atgx.se/assets/app.js']);
  assert.deepEqual(result.metadata, { kind: null, date: null, normalizationStatus: 'not_implemented' });
  assert.equal(result.mapperStatus, 'not_implemented');
  assert.equal(result.normalizedRowsWritten, 0);
  assert.equal(before, after);
  assert.equal('html' in result, false);
  assert.equal('rawBody' in result, false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('private'), false);
});

test('captured X-Labs inspection rejects non-X-Labs source records', async () => {
  const { env, db, objects } = createTestEnv();
  const key = 'raw/manual/2099-01-01/synthetic.html';
  objects.set(key, { body: '<html></html>', options: {} });
  db.prepare(`
    INSERT INTO source_records (id, source_type, fetched_at, raw_object_key, quality_status)
    VALUES ('src_other','manual','2099-01-01T00:00:00Z',?,'captured_unmapped')
  `).run(key);
  await assert.rejects(() => inspectCapturedXlabs(env, 'src_other'), /captured X-Labs source record was not found/);
});

test('X-Labs inspection route remains behind the shared ADMIN_TOKEN gate', async () => {
  const { env } = createTestEnv();
  env.ADMIN_TOKEN = 'synthetic-admin-token';
  const request = new Request('https://example.test/v1/xlabs/inspect', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source_record_id: 'src_xlabs' })
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'unauthorized' });
});
