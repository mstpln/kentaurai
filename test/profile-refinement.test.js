import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAppPage } from '../src/app-page-release.js';
import { toEntityAppView } from '../src/routes/entity-view.js';

test('profile refinement uses approved icons, initials and navigation order', () => {
  const html = renderAppPage();
  assert.match(html, /M21\.378 12\.626/);
  assert.match(html, /M15 14c\.2-1/);
  assert.match(html, /M20 20v-7a4 4/);
  assert.match(html, /INITIAL_STOP_WORDS/);
  assert.match(html, /slice\(0,3\)/);
  assert.match(html, /\['stats','Statistik'\],\['starts','Starter'\],\['horses','Hästar'\],\['data','Data'\]/);
  assert.match(html, /\['stats','Statistik'\],\['starts','Starter'\],\['equipment','Utrustning'\],\['data','Data'\]/);
  assert.match(html, /Galopp %/);
  assert.match(html, /profile-horse-row/);
  assert.match(html, /detail-role-link/);
  assert.match(html, /Tekniska interna statusvärden/);
});

test('profile refinement removes technical observation metadata from the visible profile data set', () => {
  const html = renderAppPage();
  const dataViewMatch = html.match(/function dataView\(detail\)\{([\s\S]*?)\}\nfunction horsesView/);
  assert.ok(dataViewMatch);
  assert.doesNotMatch(dataViewMatch[1], /Senast observerad/);
  assert.doesNotMatch(dataViewMatch[1], /Datakvalitet/);
});

test('entity app view calculates gallop rate from completed result starts', () => {
  const view = toEntityAppView({
    stats: { resultStarts: 20, gallops: 3 },
    latestObservation: null,
    starts: []
  });
  assert.equal(view.stats.gallopRate, 0.15);

  const empty = toEntityAppView({
    stats: { resultStarts: 0, gallops: 0 },
    latestObservation: null,
    starts: []
  });
  assert.equal(empty.stats.gallopRate, null);
});

test('all embedded browser scripts remain valid JavaScript', () => {
  const html = renderAppPage();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
