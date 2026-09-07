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

test('premium polish keeps brand identity and mobile-first entity lists', () => {
  const html = renderAppPage();
  const login = renderLoginPage();
  assert.match(html, /KENTAUR<span>AI<\/span>/);
  assert.match(login, /KENTAUR<span>AI<\/span>/);
  assert.match(html, /<circle cx="32" cy="32" r="29"/);
  assert.match(html, /class="entity-row"/);
  assert.match(html, /class="table starts-table"/);
  assert.match(html, /PAGE_SIZE=20/);
  assert.match(html, /listOffsets/);
  assert.match(html, /Visar /);
  assert.match(html, /Föregående/);
  assert.match(html, /Nästa/);
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
});

test('embedded browser application script is valid JavaScript', () => {
  const html = renderAppPage();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected embedded application script');
  assert.doesNotThrow(() => new vm.Script(match[1]));
});
