import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceUpcomingGamesHtml } from '../src/app-upcoming-games-ui.js';
import worker from '../src/worker-v078.js';

test('upcoming games UI installs factual Spel navigation and responsive contracts', () => {
  const html = enhanceUpcomingGamesHtml('<html><head></head><body><script>const state={};function renderGames(){};</script></body></html>');
  assert.match(html, /Kommande/);
  assert.match(html, /id="ugBack">← Kommande/);
  assert.match(html, /if\(state\.upcomingRound\)return ugOpenRound\(state\.upcomingRound\)/);
  assert.match(html, /Historik/);
  assert.match(html, /Översikt/);
  assert.match(html, /Närmaste omgång först/);
  assert.match(html, /Senast hämtat/);
  assert.match(html, /X-Labs/);
  assert.match(html, /Första 200/);
  assert.match(html, /ugMarketPercent/);
  assert.match(html, /format\(n\)\+' %'/);
  assert.doesNotMatch(html, /pct\(e\.betPercent\)/);
  assert.match(html, /return full\[1\]\+'\.'\+full\[2\]/);
  assert.ok(html.includes("api('/horses/'+encodeURIComponent(e.horseId)+'/calendar-form?year='+year)"));
  assert.match(html, /Sista 400/);
  assert.match(html, /Visa mer/);
  assert.match(html, /Hög prissumma/);
  assert.match(html, /Vardagstrav/);
  assert.match(html, /state\.gameTab==='v85'\|\|state\.gameTab==='v86'/);
  assert.match(html, /state\.historyType=state\.gameTab\.toUpperCase\(\)/);
  assert.doesNotMatch(html, /Lopp körs/);
  assert.doesNotMatch(html, /Prestationsnivå efter loppets prissumma/);
  assert.doesNotMatch(html, /Intervjuer/);
  assert.match(html, /grid-template-columns:minmax\(155px,.85fr\) minmax\(0,1.55fr\)/);
  assert.match(html, /grid-template-columns:22px minmax\(82px,1fr\) 42px 48px 48px 42px/);
});

test('Spel history renders one row per system and opens the selected system directly', () => {
  const html = enhanceUpcomingGamesHtml('<html><head></head><body><script>const state={};function renderGames(){};</script></body></html>');
  assert.ok(html.includes(`data-system-id="'+esc(r.systemId)+'"`));
  assert.ok(html.includes("esc(r.systemLabel||'System')"));
  assert.ok(!html.includes("num(r.systemCount)+' system"));
  assert.match(html, /openGameDetail\(b\.dataset\.roundId,b\.dataset\.systemId\)/);
});

test('upcoming games UI enhancer is idempotent', () => {
  const once = enhanceUpcomingGamesHtml('<html><head></head><body></body></html>');
  const twice = enhanceUpcomingGamesHtml(once);
  assert.equal(twice, once);
});


test('upcoming game app APIs remain session-private', async () => {
  const response = await worker.fetch(new Request('https://example.test/app/api/games/upcoming'), { APP_PASSWORD:'synthetic-password' }, {});
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error:'unauthorized' });
});
