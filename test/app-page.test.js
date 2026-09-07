import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderAppPage } from '../src/app-page.js';

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
  assert.doesNotMatch(html, /ADMIN_TOKEN/);
});

test('embedded browser application script is valid JavaScript', () => {
  const html = renderAppPage();
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'expected embedded application script');
  assert.doesNotThrow(() => new vm.Script(match[1]));
});
