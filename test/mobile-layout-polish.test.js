import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v064.js';
import { enhanceMobileLayoutPolish } from '../src/mobile-layout-polish.js';
import { createTestEnv } from './helpers/d1.js';

test('mobile layout polish adds viewport, CSS and script exactly once', () => {
  const base = '<!doctype html><html><head><title>KentaurAI</title></head><body><div id="app"></div></body></html>';
  const once = enhanceMobileLayoutPolish(base);
  const twice = enhanceMobileLayoutPolish(once);

  assert.match(once, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.equal((twice.match(/kentaurai-mobile-layout-polish-v102/g) || []).length, 2);
  assert.equal((twice.match(/name="viewport"/g) || []).length, 1);
  assert.equal(twice, once);
});

test('mobile polish restores document scrolling while keeping top and bottom navigation visible', () => {
  const html = enhanceMobileLayoutPolish('<html><head></head><body><div id="app"></div></body></html>');
  assert.match(html, /body\{[\s\S]*overflow-y:auto!important/);
  assert.match(html, /\.shell\{[\s\S]*height:auto!important[\s\S]*overflow:visible!important/);
  assert.match(html, /\.topbar\{[\s\S]*position:sticky!important[\s\S]*top:0!important/);
  assert.match(html, /\.bottom-nav\{[\s\S]*position:fixed!important[\s\S]*bottom:0!important/);
  assert.doesNotMatch(html, /html,body\{[^}]*overflow:hidden!important/);
});

test('mobile polish keeps wide tables locally scrollable', () => {
  const html = enhanceMobileLayoutPolish('<html><head></head><body><div id="app"></div></body></html>');
  assert.match(html, /\.table-wrap\{max-width:100%!important;overflow-x:auto!important/);
  assert.match(html, /\.starts-table,.game-table\{min-width:620px\}/);
  assert.doesNotMatch(html, /\.table-wrap\{max-width:100%!important;overflow-x:hidden!important/);
});

test('mobile polish keeps all five time periods on one row and six nav items in viewport', () => {
  const html = enhanceMobileLayoutPolish('<html><head></head><body><div id="app"></div></body></html>');
  assert.match(html, /\.range-group\{[\s\S]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)!important/);
  assert.match(html, /\.range-btn\{[\s\S]*white-space:nowrap!important/);
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important/);
  assert.match(html, /padding-bottom:calc\(7px \+ env\(safe-area-inset-bottom\)\)!important/);
});

test('mobile polish covers settings controls and narrow Trend filters', () => {
  const html = enhanceMobileLayoutPolish('<html><head></head><body><div id="app"></div></body></html>');
  assert.match(html, /\.settings-primary,.settings-secondary\{min-height:44px/);
  assert.match(html, /@media\(max-width:430px\)[\s\S]*\.trend-detail-panel\{grid-template-columns:1fr!important\}/);
  assert.match(html, /\.settings-actions\{display:grid!important;grid-template-columns:1fr!important/);
});

test('Trend Loppnivå stays hidden on the start surface and moves into the opened filter panel', () => {
  const html = enhanceMobileLayoutPolish('<html><head></head><body><div id="app"></div></body></html>');
  assert.match(html, /if\(panel\)\{[\s\S]*panel\.insertBefore\(scopeBlock,panel\.firstChild\)/);
  assert.match(html, /else if\(scopeBlock\.style\.display!=='none'\)\{[\s\S]*scopeBlock\.style\.display='none'/);
  assert.match(html, /scopeBlock\.classList\.contains\('trend-scope-filter-block'\)/);
});

test('Trend filter alignment observes renders safely through a queued idempotent pass', () => {
  const html = enhanceMobileLayoutPolish('<html><head></head><body><div id="app"></div></body></html>');
  assert.match(html, /let alignQueued=false/);
  assert.match(html, /function queueAlign\(\)/);
  assert.match(html, /requestAnimationFrame\(\(\)=>\{/);
  assert.match(html, /new MutationObserver\(\(\)=>queueAlign\(\)\)/);
  assert.match(html, /observer\.observe\(app,\{childList:true,subtree:true\}\)/);
  assert.match(html, /if\(badge\.textContent!==String\(count\)\)badge\.textContent=String\(count\)/);
});

test('embedded mobile browser script is syntactically valid', () => {
  const html = enhanceMobileLayoutPolish('<html><head></head><body><div id="app"></div></body></html>');
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script, { filename: `mobile-polish-${index}.js` })));
});

test('actual Wrangler worker serves the mobile polish layer after authenticated app login', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const login = await worker.fetch(new Request('https://example.test/app/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: env.APP_PASSWORD })
  }), env);
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal((html.match(/id="kentaurai-mobile-layout-polish-v102"/g) || []).length, 1);
  assert.equal((html.match(/id="kentaurai-mobile-layout-polish-v102-script"/g) || []).length, 1);
  assert.equal((html.match(/name="viewport"/g) || []).length, 1);
});
