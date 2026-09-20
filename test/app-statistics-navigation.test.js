import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { renderAppPage } from '../src/app-page-aligned.js';

test('primary bottom navigation is reduced to Start, Statistik and Spel', () => {
  const html = renderAppPage();
  assert.match(html, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(html, /data-page="start"/);
  assert.match(html, /data-page="statistics"/);
  assert.match(html, /data-page="games"/);
  assert.match(html, /STATISTICS_NAV_ICON\+'Statistik'/);
  assert.match(html, /GAMES_NAV_ICON\+'Spel'/);
  assert.doesNotMatch(html, /addTrackNavigation\(\)/);
});

test('statistics navigation groups trainer horse driver and track browsing with selector variant 5', () => {
  const html = renderAppPage();
  assert.match(html, /class="statistics-category-nav"/);
  assert.match(html, /\['trainers','Tränare'\],\['horses','Hästar'\],\['drivers','Kuskar'\],\['tracks','Bana'\]/);
  assert.match(html, /\.statistics-category-nav\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);gap:1px;background:var\(--line\);border:1px solid var\(--line\);border-radius:11px;overflow:hidden;margin-bottom:22px\}/);
  assert.match(html, /\.statistics-category-btn\.active\{background:#1d1913;color:var\(--accent-soft\);box-shadow:inset 0 -2px 0 var\(--accent\)\}/);
  assert.match(html, /app\.insertAdjacentHTML\('afterbegin',statisticsCategoryNav\(state\.page\)\)/);
});

test('bottom navigation uses the approved table and currency-circle-dollar icon paths', () => {
  const html = renderAppPage();
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
});

test('aligned application scripts remain valid JavaScript', () => {
  const html = renderAppPage();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
