import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceUpcomingGamesHtml } from '../src/app-upcoming-games-ui.js';

test('upcoming games UI installs factual Spel navigation and responsive contracts', () => {
  const html = enhanceUpcomingGamesHtml('<html><head></head><body><script>const state={};function renderGames(){};</script></body></html>');
  assert.match(html, /Kommande/);
  assert.match(html, /Historik/);
  assert.match(html, /Översikt/);
  assert.match(html, /Närmaste omgång först/);
  assert.match(html, /Senast hämtat/);
  assert.match(html, /X-Labs/);
  assert.match(html, /Första 200/);
  assert.match(html, /Sista 400/);
  assert.match(html, /Visa mer/);
  assert.match(html, /Hög prissumma/);
  assert.match(html, /Vardagstrav/);
  assert.doesNotMatch(html, /Lopp körs/);
  assert.doesNotMatch(html, /Prestationsnivå efter loppets prissumma/);
  assert.doesNotMatch(html, /Intervjuer/);
  assert.match(html, /grid-template-columns:minmax\(155px,.85fr\) minmax\(0,1.55fr\)/);
  assert.match(html, /grid-template-columns:22px minmax\(82px,1fr\) 42px 48px 48px 42px/);
});

test('upcoming games UI enhancer is idempotent', () => {
  const once = enhanceUpcomingGamesHtml('<html><head></head><body></body></html>');
  const twice = enhanceUpcomingGamesHtml(once);
  assert.equal(twice, once);
});
