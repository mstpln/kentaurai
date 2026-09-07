import test from 'node:test';
import assert from 'node:assert/strict';
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
});
