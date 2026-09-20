import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { renderAppPage } from '../src/app-page-aligned.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import worker from '../src/worker-v078.js';
import { createTestEnv } from './helpers/d1.js';

function primaryNavigationRuntime(html) {
  const match = html.match(/function alignPrimaryNavigation\(\)\{[\s\S]*?inner\.innerHTML=([\s\S]*?);\n\s*inner\.querySelector\('\[data-page="start"\]'\)/);
  assert.ok(match, 'primary navigation runtime should be present');
  return match[1];
}

test('primary bottom navigation is reduced to Start, Statistik and Spel', () => {
  const html = renderAppPage();
  const runtimeNav = primaryNavigationRuntime(html);
  const pages = [...runtimeNav.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]);

  assert.match(html, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.deepEqual(pages, ['start', 'statistics', 'games']);
  assert.match(runtimeNav, /Start<\/button>/);
  assert.match(runtimeNav, /Statistik<\/button>/);
  assert.match(runtimeNav, /Spel<\/button>/);
  assert.doesNotMatch(runtimeNav, /data-page="(?:trainers|horses|drivers|tracks)"/);
  assert.doesNotMatch(html, /addTrackNavigation\(\)/);
});

test('statistics navigation groups trainer horse driver and track browsing with selector variant 5', () => {
  const html = renderAppPage();
  assert.match(html, /class="statistics-category-nav"/);
  assert.match(html, /\['trainers','Tränare'\],\['horses','Hästar'\],\['drivers','Kuskar'\],\['tracks','Bana'\]/);
  assert.match(html, /\.statistics-category-nav\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:1px;background:var\(--line\);border:1px solid var\(--line\);border-radius:11px;overflow:hidden;margin-bottom:22px\}/);
  assert.match(html, /\.statistics-category-btn\.active\{background:#1d1913;color:var\(--accent-soft\);box-shadow:inset 0 -2px 0 var\(--accent\)\}/);
  assert.match(html, /app\.insertAdjacentHTML\('afterbegin',statisticsCategoryNav\(state\.page\)\)/);
  assert.match(html, /aria-label="Statistikområden"/);
  assert.match(html, /aria-current="page"/);
});

test('bottom navigation uses the approved trend, table and currency-circle-dollar icons', () => {
  const html = renderAppPage();
  const runtimeNav = primaryNavigationRuntime(html);
  assert.match(runtimeNav, /icon\('trend','nav-icon'\)/);
  assert.match(html, /M224,48H32a8,8,0,0,0-8,8V192/);
  assert.match(html, /M128,24A104,104,0,1,0,232,128/);
  assert.match(html, /A28,28,0,0,1,168,148Z/);
});

test('statistics category state follows entity and track navigation while bottom active state stays grouped', () => {
  const html = renderAppPage();
  assert.match(html, /priorAlignedSetNav\(STATISTICS_PAGES\.includes\(page\)\?'statistics':page\)/);
  assert.match(html, /state\.statisticsPage=page/);
  assert.match(html, /const page=STATISTICS_PAGES\.includes\(state\.statisticsPage\)\?state\.statisticsPage:'horses'/);
  assert.match(html, /if\(page==='tracks'\)renderTracks\(\);else renderEntityList\(page\)/);
  assert.match(html, /else\{state\.tab='list';renderEntityList\(page\);\}/);
});

test('full production-composed app keeps the grouped primary navigation after later wrappers', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';', 1)[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env, {});
  assert.equal(response.status, 200);
  const html = await response.text();
  const runtimeNav = primaryNavigationRuntime(html);
  const pages = [...runtimeNav.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(pages, ['start', 'statistics', 'games']);
  assert.doesNotMatch(runtimeNav, /data-page="(?:trainers|horses|drivers|tracks)"/);
  assert.match(html, /id="kentaurai-performance-v1-script"/);
  assert.match(html, /id="kentaurai-upcoming-games-v1-script"/);
  assert.match(html, /const gamesNav=document\.querySelector\('\.nav-item\[data-page="games"\]'\)/);
  assert.doesNotMatch(html, /addTrackNavigation\(\)/);
});

test('aligned application scripts remain valid JavaScript', () => {
  const html = renderAppPage();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
