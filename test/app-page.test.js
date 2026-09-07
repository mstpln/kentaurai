import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAppPage, renderLoginPage } from '../src/app-page.js';

test('interface keeps navigation order, adds Spel, and retains global search', () => {
  const html = renderAppPage();
  assert.match(html, /id="globalSearch"/);
  const start = html.indexOf('data-page="start"');
  const trainers = html.indexOf('data-page="trainers"');
  const horses = html.indexOf('data-page="horses"');
  const drivers = html.indexOf('data-page="drivers"');
  const games = html.indexOf('data-page="games"');
  assert.ok(start >= 0 && start < trainers && trainers < horses && horses < drivers && drivers < games);
  assert.match(html, />Spel<\/button>/);
  assert.match(html, /aria-label="Huvudnavigation"/);
  assert.doesNotMatch(html, /ADMIN_TOKEN/);
});

test('approved brand treatment renders Sagittarius mark and KENTAURAI wordmark', () => {
  const html = renderAppPage();
  const login = renderLoginPage();
  assert.match(html, /KENTAUR<span>AI<\/span>/);
  assert.match(login, /KENTAUR<span>AI<\/span>/);
  assert.match(html, /class="brand-icon" viewBox="0 0 512 512"/);
  assert.match(html, /M267\.934 459\.625l-80\.013-80\.08/);
  assert.match(html, /brand-badge/);
});

test('start page source is trends-first with requested categories and timeframes', () => {
  const html = renderAppPage();
  assert.match(html, /const categories=\[\['trainers','Tränare'\],\['horses','Hästar'\],\['drivers','Kuskar'\]\]/);
  assert.match(html, /\['2w','2 veckor'\]/);
  assert.match(html, /\['4w','4 veckor'\]/);
  assert.match(html, /\['3m','3 mån'\]/);
  assert.match(html, /\['6m','6 mån'\]/);
  assert.match(html, /\['1y','1 år'\]/);
  assert.match(html, /<h1>Trender<\/h1>/);
  assert.doesNotMatch(html, /Datastatus/);
  assert.doesNotMatch(html, /Databasöversikt och relevanta trender/);
});

test('search control has proper vector icon, divider, and deliberate query spacing', () => {
  const html = renderAppPage();
  assert.match(html, /class="search-prefix"/);
  assert.match(html, /class="search-icon"/);
  assert.match(html, /class="search-divider"/);
  assert.match(html, /padding:0 46px 0 78px/);
});

test('Spel has overview, V85, V86, sorting, and round-detail concepts', () => {
  const html = renderAppPage();
  assert.match(html, /\['overview','Översikt'\],\['v85','V85'\],\['v86','V86'\]/);
  assert.match(html, /\['latest','Senaste'\]/);
  assert.match(html, /\['correct_desc','Flest rätt'\]/);
  assert.match(html, /\['correct_asc','Färst rätt'\]/);
  assert.match(html, /\['spikes_desc','Bästa spikar'\]/);
  assert.match(html, /Så vann loppen/);
  assert.match(html, /Var missar vi\?/);
  assert.match(html, /Avdelning för avdelning/);
  assert.match(html, /Omgångens learnings/);
  assert.match(html, /Vann från/);
});

test('production interface remains factual and localized', () => {
  const html = renderAppPage();
  assert.doesNotMatch(html, /Käll-ID/);
  assert.match(html, /mare:'Sto'/);
  assert.match(html, /gelding:'Valack'/);
  assert.match(html, /stallion:'Hingst'/);
  assert.match(html, /Trenddata byggs upp/);
  assert.match(html, /Okänt/);
  assert.match(html, /Ingen automatisk viktändring efter en omgång/);
});

test('entity browsing still supports complete paginated lists', () => {
  const html = renderAppPage();
  assert.match(html, /class="entity-row"/);
  assert.match(html, /class="table starts-table"/);
  assert.match(html, /PAGE_SIZE=20/);
  assert.match(html, /listOffsets/);
  assert.match(html, /Föregående/);
  assert.match(html, /Nästa/);
});

test('embedded browser application script is valid JavaScript', () => {
  const html = renderAppPage();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected embedded application script');
  assert.doesNotThrow(() => new vm.Script(match[1]));
});
