import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker-v078.js';
import { createTestEnv } from './helpers/d1.js';

function seedTrack(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name, city, country_code) VALUES ('track-admin','Synthetic Admin Track','Teststad','SE')").run();
}

test('track profile admin routes require ADMIN_TOKEN', async () => {
  const { env, db } = createTestEnv();
  seedTrack(db);
  env.ADMIN_TOKEN = 'synthetic-admin-token';

  let response = await worker.fetch(new Request('https://example.test/v1/admin/tracks/profile-targets'), env, {});
  assert.equal(response.status, 401);

  response = await worker.fetch(new Request('https://example.test/v1/admin/tracks/profile-targets', {
    headers:{ authorization:'Bearer synthetic-admin-token' }
  }), env, {});
  assert.equal(response.status, 200);
  const targets = await response.json();
  assert.equal(targets.total, 1);
  assert.equal(targets.items[0].id, 'track-admin');

  response = await worker.fetch(new Request('https://example.test/v1/admin/tracks/profile-enrichment', {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ tracks:[] })
  }), env, {});
  assert.equal(response.status, 401);
});
