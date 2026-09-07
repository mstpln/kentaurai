import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAppPage, renderLoginPage } from '../src/app-page.js';

test('entity interface keeps approved navigation order and global search', () => {
  const html = renderAppPage();
  assert.match(html, /id="globalSearch"/);
  const start = html.indexOf('data-page="start"');
  const trainers = html.indexOf('data-page="trainers"');
  const horses = html.indexOf('data-page="horses"');
  const drivers = html.indexOf('data-page="drivers"');
  assert.ok(start >= 0 && start < trainers && trainers < horses && horses < drivers);
  assert.match(html, /position:sticky;top:0/);
  assert.match(html, /position:fixed;z-index:50/);
  assert.match(html, /aria-label="Huvudnavigation"/);
  assert.doesNotMatch(html, /ADMIN_TOKEN/);
});

test('brand and navigation use real horse-aware vector icons', () => {
  const html = renderAppPage();
  const login = renderLoginPage();
  assert.match(html, /KENTAUR<span>AI<\/span>/);
  assert.match(login, /KENTAUR<span>AI<\/span>/);
  assert.match(html, /class="brand-badge"/);
  assert.match(html, /class="brand-icon"/);
  assert.match(html, /class="nav-icon"/);
  assert.doesNotMatch(html, /<span class="nav-icon">[⌂◉♞●]/);
});

test('start page is trends-first with category and timeframe controls', () => {
  const html = renderAppPage();
  assert.match(html, /<h1>Trender<\/h1>/);
  assert.match(html, /data-trend-category="trainers"/);
  assert.match(html, /data-trend-category="horses"/);
  assert.match(html, /data-trend-category="drivers"/);
  assert.match(html, /data-trend-range="2w"/);
  assert.match(html, /data-trend-range="4w"/);
  assert.match(html, /data-trend-range="3m"/);
  assert.match(html, /data-trend-range="6m"/);
  assert.match(html, /data-trend-range="1y"/);
  assert.doesNotMatch(html, /Databasöversikt och relevanta trender/);
  assert.doesNotMatch(html, /Datastatus/);
});

test('search control has large vector icon and visual divider', () => {
  const html = renderAppPage();
  assert.match(html, /class="search-prefix"/);
  assert.match(html, /class="search-icon"/);
  assert.match(html, /class="search-divider"/);
  assert.match(html, /padding:0 46px 0 74px/);
});

test('production interface remains factual and localized', () => {
  const html = renderAppPage();
  assert.doesNotMatch(html, /Käll-ID/);
  assert.match(html, /mare:'Sto'/);
  assert.match(html, /gelding:'Valack'/);
  assert.match(html, /stallion:'Hingst'/);
  assert.match(html, /Hästar i databasen/);
  assert.match(html, /Starter i databasen/);
  assert.match(html, /button:focus-visible/);
  assert.match(html, /Trenddata byggs upp/);
});

test('entity browsing still supports complete paginated lists', () => {
  const html = renderAppPage();
  assert.match(html, /class="entity-row"/);
  assert.match(html, /class="table starts-table"/);
  assert.match(html, /PAGE_SIZE=20/);
  assert.match(html, /listOffsets/);
  assert.match(html, /Visar /);
  assert.match(html, /Föregående/);
  assert.match(html, /Nästa/);
});

test('embedded browser application script is valid JavaScript', () => {
  const html = renderAppPage();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected embedded application script');
  assert.doesNotThrow(() => new vm.Script(match[1]));
});
