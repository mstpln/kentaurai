import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';
import { readFile } from 'node:fs/promises';

async function cookie(env) {
  return (await createAppSessionCookie(env)).split(';')[0];
}

test('horse statistics composes after Trend and before the shared final statistics bootstrap', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie: await cookie(env) } }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  const trend = html.indexOf('kentaurai-trend-build-a-script');
  const horse = html.indexOf('kentaurai-horse-statistics-build-b-script');
  const finalizer = html.indexOf('kentaurai-statistics-finalize-script');
  assert.ok(trend >= 0 && horse > trend && finalizer > horse, 'render wrappers must retain their intended composition order');
});

test('horse statistics async renderers guard navigation and entity changes after awaited reads', async () => {
  const source = await readFile(new URL('../src/horse-statistics-ui.js', import.meta.url), 'utf8');
  assert.match(source, /token!==rankingToken\|\|state\.page!=='horses'\|\|state\.tab!=='stats'/);
  assert.match(source, /token!==detailToken\|\|state\.detail\?\.id!==id\|\|state\.tab!=='stats'/);
  assert.match(source, /rankingToken\+\+;return previousHorseEntityList/);
  assert.match(source, /const token=\+\+detailToken/);
});
