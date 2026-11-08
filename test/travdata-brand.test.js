import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { renderAppPage, renderLoginPage } from '../src/app-page.js';
import { enhancePhase1Html } from '../src/phase1-ui.js';
import { enhanceTravdataHtml, travdataAssetResponse, travdataManifest } from '../src/travdata-brand.js';
import worker from '../src/worker-v079.js';
import { pwaHeadMarkup } from '../src/pwa.js';
import assets from '../src/assets/travdata.json' with { type: 'json' };

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
    ['/app/icon.png?brand=travdata-4', 512, 512],
    ['/app/apple-touch-icon.png?brand=travdata-4', 512, 512]
  ]) {
    const response = await travdataAssetResponse(new Request('https://example.test' + path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [137, 80, 78, 71]);
    assert.equal(new DataView(bytes.buffer).getUint32(16), width);
    assert.equal(new DataView(bytes.buffer).getUint32(20), height);
    // New pixels differ from the source only by zeroed transparent corner pixels.
    assert.notEqual(createHash('sha256').update(bytes).digest('hex'), 'aebac604fa63a40bee5efa52b701f93adc3ebce0a206242c53a0c9c14051711c');
    const idat = [];
    for (let offset = 8; offset + 12 < bytes.length;) {
      const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);
      const label = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (label === 'IDAT') idat.push(bytes.subarray(offset + 8, offset + 8 + size));
      offset += 12 + size;
    }
    const rgba = inflateSync(Buffer.concat(idat.map(chunk => Buffer.from(chunk))));
    const alpha = (col, row) => rgba[row * (width * 4 + 1) + 1 + col * 4 + 3];
    assert.equal(alpha(0, 0), 0);
    assert.equal(alpha(width - 1, height - 1), 0);
    assert.ok(alpha(256, 256) > 0, 'Approved emblem is still visible');
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
  assert.match(html, /rel="apple-touch-icon" sizes="512x512" href="\/app\/apple-touch-icon\.png\?brand=travdata-4"/);
  assert.match(html, /rel="manifest" href="\/app\/manifest\.webmanifest\?brand=travdata-4"/);
  const icon = travdataManifest().icons.find(icon => icon.type === 'image/png');
  assert.equal(icon.sizes, '512x512');
  assert.equal(icon.purpose, 'any');
  assert.equal(icon.src, '/app/icon.png?brand=travdata-4');
  const sw = await travdataAssetResponse(new Request('https://example.test/app/sw.js')).text();
  assert.match(sw, /kentaurai-pwa-v6/);
  assert.match(sw, /map\(path=>path\+'\?brand=travdata-4'\)/);
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
  const icon = await (await travdataAssetResponse(new Request('https://example.test/app/icon.svg'))).text();
  assert.match(icon, /aria-label="Travdata"/);
  assert.match(icon, /data:image\/png;base64,/);
  assert.doesNotMatch(icon, /stroke=|filter=|clip-path=/);
  assert.doesNotMatch(icon, /fill="#F7F7FC"/);
  const sw = await travdataAssetResponse(new Request('https://example.test/app/sw.js')).text();
  assert.match(sw, /kentaurai-pwa-v6/);
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

test('production app excludes demo payloads while local synthetic preview retains them', () => {
  const prod = enhancePhase1Html(renderAppPage(), { asOfDate: '2026-11-08' });
  const preview = enhancePhase1Html(renderAppPage(), { asOfDate: '2026-11-08', allowDemo: true });
  assert.match(prod, /const demoEnabled=false;/);
  assert.match(prod, /const demoRounds=\[\];/);
  assert.match(prod, /const demoSystems=\[\];/);
  assert.match(preview, /const demoEnabled=true;/);
  assert.match(preview, /demo-v85-2026-/);
});

function decodePngRgba(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  const compressed = [];
  for (let pos = 8; pos + 12 <= bytes.length;) {
    const size = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (type === 'IDAT') compressed.push(Buffer.from(bytes.subarray(pos + 8, pos + 8 + size)));
    pos += size + 12;
  }
  const scanlines = inflateSync(Buffer.concat(compressed));
  const stride = width * 4, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = scanlines[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const at = y * stride + i;
      const left = i >= 4 ? pixels[at - 4] : 0;
      const up = y > 0 ? pixels[at - stride] : 0;
      const diagonal = y > 0 && i >= 4 ? pixels[at - stride - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >>> 1;
      else if (filter === 4) {
        const p = left + up - diagonal;
        const dLeft = Math.abs(p - left), dUp = Math.abs(p - up), dDiagonal = Math.abs(p - diagonal);
        predictor = dLeft <= dUp && dLeft <= dDiagonal ? left : dUp <= dDiagonal ? up : diagonal;
      } else assert.equal(filter, 0, 'Only legal PNG scanline filters are accepted');
      pixels[at] = (scanlines[y * (stride + 1) + 1 + i] + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

test('clean master preserves the TD interior and removes every dark edge pixel', async () => {
  const original = decodePngRgba(Buffer.from(assets.iconPng, 'base64'));
  const response = await travdataAssetResponse(new Request('https://example.test/app/icon.png'));
  assert.equal(response.status, 200);
  const transformed = decodePngRgba(await response.arrayBuffer());
  assert.equal(transformed.width, original.width);
  assert.equal(transformed.height, original.height);
  const radius = original.width * 0.493;
  let preservedPixels = 0, clearedPixels = 0, antialiasedPixels = 0;
  for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
    const offset = (y * original.width + x) * 4;
    const distance = Math.hypot(x + .5 - original.width / 2, y + .5 - original.height / 2);
    const inside = distance < radius - 10;
    if (inside) {
      for (let channel = 0; channel < 4; channel++)
        assert.equal(transformed.pixels[offset + channel], original.pixels[offset + channel],
          `TD pixel changed at (${x},${y}), channel ${channel}`);
      preservedPixels++;
    } else {
      // This annulus contains only the blue field in the original, never T or D.
      assert.ok(original.pixels[offset + 3] < 128 ||
        (original.pixels[offset] < 30 && original.pixels[offset + 1] < 30),
        `Would overwrite approved artwork at (${x},${y})`);
      const alpha = Math.round(255 * Math.max(0, Math.min(1, radius + .5 - distance)));
      assert.deepEqual([...transformed.pixels.slice(offset, offset + 4)],
        alpha ? [0, 1, 253, alpha] : [0, 0, 0, 0]);
      if (alpha > 0 && alpha < 255) antialiasedPixels++;
      clearedPixels++;
    }
  }
  assert.ok(preservedPixels > 180000);
  assert.ok(clearedPixels > 30000);
  assert.ok(antialiasedPixels > 1000);
});

test('all PNG and SVG icon surfaces use the identical cleaned master', async () => {
  const master = Buffer.from(await (await travdataAssetResponse(new Request('https://example.test/app/icon.png'))).arrayBuffer());
  for (const path of ['/app/brand/td-mark.png', '/app/apple-touch-icon.png']) {
    const response = await travdataAssetResponse(new Request('https://example.test' + path));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), master);
  }
  for (const path of ['/app/icon.svg', '/app/icon-maskable.svg']) {
    const response = await travdataAssetResponse(new Request('https://example.test' + path));
    const svg = await response.text();
    assert.deepEqual(Buffer.from(svg.match(/base64,([^"]+)/)[1], 'base64'), master);
    if (path.includes('maskable')) assert.match(svg, /<rect[^>]+fill="#0001FD"/);
    else assert.doesNotMatch(svg, /<rect/);
  }
  const html = enhanceTravdataHtml(renderAppPage());
  assert.match(html, /td-mark\.png\?brand=travdata-4/);
  assert.match(html, /\.travdata-brand,\.travdata-brand img\{background:transparent!important;border:0!important;outline:0!important;box-shadow:none!important;padding:0!important\}/);
});
