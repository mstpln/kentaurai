import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { renderAppPage, renderLoginPage } from '../src/app-page.js';
import { enhancePhase1Html } from '../src/phase1-ui.js';
import { enhanceTravdataHtml, travdataAssetResponse, travdataManifest } from '../src/travdata-brand.js';
import worker from '../src/worker-v079.js';
import { pwaHeadMarkup } from '../src/pwa.js';

test('Travdata replaces the visible brand and login copy while retaining form behavior', () => {
  const html = enhanceTravdataHtml(renderLoginPage({ error: true }));
  assert.match(html, /<title>Travdata<\/title>/);
  assert.match(html, /aria-label="Travdata"/);
  assert.match(html, /class="travdata-word-trav">TRAV<\/span>/);
  assert.match(html, /class="travdata-word-data">DATA<\/span>/);
  assert.match(html, /Öppna Travdata/);
  assert.match(html, /Fel lösenord/);
  assert.match(html, /action="\/app\/login"/);
  assert.match(html, /name="password" type="password"/);
  assert.match(html, /name="color-scheme" content="light"/);
  assert.doesNotMatch(html, /KentaurAI|KENTAUR<span>/);
  assert.equal(enhanceTravdataHtml(html), html);
});

test('Travdata keeps existing navigation SVGs, Phase 1 controls, storage keys and valid scripts', () => {
  const original = enhancePhase1Html(renderAppPage(), { asOfDate: '2026-11-08' });
  const html = enhanceTravdataHtml(original);
  for (const selector of ['data-p1-nav="trend"', 'data-p1-nav="statistics"', 'data-p1-nav="spel"', 'data-p1-spel-view', 'settingsButton']) {
    assert.ok(html.includes(selector));
  }
  assert.match(html, /kentaurai\.phase1\.local\.v1/);
  const nav = source => source.match(/<nav[\s\S]*?<\/nav>/)?.[0];
  assert.equal(nav(html), nav(original));
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new vm.Script(script));
  }
});

test('the unchanged original TD symbol is a valid GET-only image', async () => {
  for (const [path, width, height] of [
    ['/app/brand/td-mark.png', 512, 512],
    ['/app/icon.png?brand=travdata-1', 512, 512],
    ['/app/apple-touch-icon.png?brand=travdata-1', 512, 512]
  ]) {
    const response = travdataAssetResponse(new Request('https://example.test' + path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [137, 80, 78, 71]);
    assert.equal(new DataView(bytes.buffer).getUint32(16), width);
    assert.equal(new DataView(bytes.buffer).getUint32(20), height);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), 'aebac604fa63a40bee5efa52b701f93adc3ebce0a206242c53a0c9c14051711c');
    assert.equal(travdataAssetResponse(new Request('https://example.test' + path, { method: 'POST' })), null);
  }
  assert.equal(travdataAssetResponse(new Request('https://example.test/app/api/brand')), null);
});

test('Helvetica body, italic Arial wordmark, navy banners and purple highlights are deliberate', () => {
  const html = enhanceTravdataHtml(renderAppPage());
  assert.match(html, /font-family:Helvetica,Arial,sans-serif/);
  assert.doesNotMatch(html, /@font-face\{font-family:Inter/);
  assert.match(html, /\.trend-category-tabs,\.statistics-category-nav,\.p1-spel-switcher\{\s*background:transparent!important;border:0!important;padding:0!important;box-shadow:none!important/);
  assert.match(html, /\.entity-detail-toolbar,\.trend-scope-line\{background:transparent!important/);
  assert.match(html, /\.trend-category-tabs \.segment-btn\.active[\s\S]{0,220}background:#0001FD/);
  assert.match(html, /--accent:#8E31FD;--accent-soft:#6D20C4/);
  assert.match(html, /font:italic 700 calc\(var\(--travdata-logo-size\)\*\.9605\)\/var\(--travdata-logo-size\) Arial,Helvetica,sans-serif/);
  assert.match(html, /\.topbar \.travdata-brand\{gap:4px!important\}/);
  assert.match(html, /\.topbar #settingsButton svg\{color:#0001FD!important\}/);
  assert.match(html, /\.nav-item\.active\{color:#6D20C4!important;background:rgba\(142,49,253,.09\)!important\}/);
  assert.match(html, /\.p1-leg-tab\.active strong,\.p1-leg-tab\.active span\{color:#FFFFFF!important\}/);
  assert.match(html, /\.p1-horse \.p1-expand-btn\{background:transparent!important;border:0!important;box-shadow:none!important/);
});

test('all page-heading families share responsive sizes, weight, line height and spacing', () => {
  const html = enhanceTravdataHtml(renderAppPage());
  assert.match(html, /--travdata-title-size:28px;--travdata-subtitle-size:16px/);
  assert.match(html, /@media\(max-width:767px\)\{\s*:root\{--travdata-title-size:24px;--travdata-subtitle-size:14px\}/);
  assert.match(html, /\.page-heading,\.start-heading,\.p1-page-head\{margin-bottom:24px!important\}/);
  assert.match(html, /\.page-heading h1,\.start-heading h1,\.p1-page-head h1\{[\s\S]*?font-size:var\(--travdata-title-size\)!important;[\s\S]*?font-weight:700!important;line-height:1\.2!important/);
  assert.match(html, /\.page-heading p,\.start-heading p,\.p1-page-head p\{[\s\S]*?font-size:var\(--travdata-subtitle-size\)!important;[\s\S]*?line-height:1\.4!important;margin:8px 0 0!important/);
});

test('mobile installation uses the unchanged TD PNG and versioned manifest and Apple icon URLs', async () => {
  const html = enhanceTravdataHtml(renderLoginPage().replace('</head>', pwaHeadMarkup() + '</head>'));
  assert.match(html, /rel="apple-touch-icon" sizes="512x512" href="\/app\/apple-touch-icon\.png\?brand=travdata-1"/);
  assert.match(html, /rel="manifest" href="\/app\/manifest\.webmanifest\?brand=travdata-1"/);
  const icon = travdataManifest().icons.find(icon => icon.type === 'image/png');
  assert.equal(icon.sizes, '512x512');
  assert.equal(icon.purpose, 'any');
  assert.equal(icon.src, '/app/icon.png?brand=travdata-1');
  const sw = await travdataAssetResponse(new Request('https://example.test/app/sw.js')).text();
  assert.match(sw, /kentaurai-pwa-v3/);
  assert.match(sw, /map\(path=>path\+'\?brand=travdata-1'\)/);
  assert.match(sw, /'\/app\/apple-touch-icon\.png'/);
  assert.doesNotMatch(sw, /kentaurai-pwa-v2/);
  assert.equal(travdataAssetResponse(new Request('https://example.test/app/apple-touch-icon.png', { method: 'POST' })), null);
  assert.equal(travdataAssetResponse(new Request('https://example.test/app/api/private.png')), null);
});

test('PWA identity and icons change without changing installed app scope or caching private data', async () => {
  const manifest = travdataManifest();
  assert.equal(manifest.name, 'Travdata');
  assert.equal(manifest.short_name, 'Travdata');
  assert.equal(manifest.id, '/app/');
  assert.equal(manifest.scope, '/app/');
  assert.equal(manifest.start_url, '/app/');
  assert.equal(manifest.theme_color, '#010127');
  const icon = await travdataAssetResponse(new Request('https://example.test/app/icon.svg')).text();
  assert.match(icon, /aria-label="Travdata"/);
  assert.match(icon, /data:image\/png;base64,/);
  const sw = await travdataAssetResponse(new Request('https://example.test/app/sw.js')).text();
  assert.match(sw, /kentaurai-pwa-v3/);
  assert.doesNotMatch(sw, /\/app\/api/);
});

test('the final Worker brands public login but keeps private APIs session-protected', async () => {
  const env = { APP_PASSWORD: 'test-only-development-password' };
  const login = await worker.fetch(new Request('https://example.test/app/login'), env, {});
  assert.equal(login.status, 200);
  assert.match(await login.text(), /<title>Travdata<\/title>/);
  const api = await worker.fetch(new Request('https://example.test/app/api/games/upcoming'), env, {});
  assert.equal(api.status, 401);
});
