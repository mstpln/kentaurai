import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker-pwa.js';
import { pwaManifest } from '../src/pwa.js';
import { createTestEnv } from './helpers/d1.js';

test('PWA manifest uses private app scope and standalone display', () => {
  const manifest = pwaManifest();
  assert.equal(manifest.name, 'KentaurAI');
  assert.equal(manifest.start_url, '/app/');
  assert.equal(manifest.scope, '/app/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0b0b0a');
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('PWA assets are public static metadata but expose no private data', async () => {
  const { env } = createTestEnv();
  for (const [path, type] of [
    ['/app/manifest.webmanifest', 'application/manifest+json'],
    ['/app/icon.svg', 'image/svg+xml'],
    ['/app/icon-maskable.svg', 'image/svg+xml'],
    ['/app/sw.js', 'text/javascript']
  ]) {
    const response = await worker.fetch(new Request(`https://example.test${path}`), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), new RegExp(type.replace('+', '\\+')));
    const body = await response.text();
    assert.ok(body.length > 20);
    assert.doesNotMatch(body, /ADMIN_TOKEN|APP_PASSWORD|reference_round_exports/);
  }
});

test('PWA wrapper preserves private app authentication', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const response = await worker.fetch(new Request('https://example.test/app/'), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/login');
});

test('login page advertises manifest and app page registers scoped service worker', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  let response = await worker.fetch(new Request('https://example.test/app/login'), env);
  assert.equal(response.status, 200);
  let html = await response.text();
  assert.match(html, /rel="manifest" href="\/app\/manifest\.webmanifest"/);
  assert.match(html, /apple-mobile-web-app-capable/);

  const { createAppSessionCookie } = await import('../src/app-auth.js');
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  html = await response.text();
  assert.match(html, /navigator\.serviceWorker\.register\('\/app\/sw\.js'/);
});

test('service worker only caches static PWA assets', async () => {
  const { env } = createTestEnv();
  const response = await worker.fetch(new Request('https://example.test/app/sw.js'), env);
  const script = await response.text();
  assert.match(script, /STATIC=new Set/);
  assert.doesNotMatch(script, /\/app\/api\//);
  assert.doesNotMatch(script, /caches\.open\([^)]*\).*\/app\/$/m);
});
