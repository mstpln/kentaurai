import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-aligned-final.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { createTestEnv } from './helpers/d1.js';

async function finalAppHtml() {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  return response.text();
}

test('final Worker structurally aligns the mobile settings gear with the brand row', async () => {
  const html = await finalAppHtml();
  assert.match(html, /grid-template-areas:"brand settings" "search search"!important/);
  assert.match(html, /position:static!important/);
  assert.match(html, /top:auto!important/);
  assert.match(html, /right:auto!important/);
  assert.match(html, /grid-area:settings!important/);
  assert.match(html, /width:32px!important/);
  assert.match(html, /height:32px!important/);
});

test('final Worker replaces the inaccessible Settings render hook with a DOM observer', async () => {
  const html = await finalAppHtml();
  assert.doesNotMatch(html, /const priorAlignedRenderData=renderData/);
  assert.match(html, /const settingsStatusObserver=new MutationObserver/);
  assert.match(html, /alignSettingsStatuses\(\)/);
});

test('final Worker preserves separate track list, detail and tab browser history', async () => {
  const html = await finalAppHtml();
  assert.doesNotMatch(html, /view:\{\.\.\.current\.view,page:'tracks',trackDetail/);
  assert.match(html, /history\.pushState\(\{\.\.\.current,depth:Number\(current\.depth\|\|0\)\+1,trackDetail,trackTab\}/);
  assert.match(html, /history\.replaceState\(\{\.\.\.current,trackDetail,trackTab\}/);
  assert.match(html, /const navState=history\.state,view=navState\?\.view/);
  assert.match(html, /if\(navState\.trackDetail\)return renderTrackDetail\(navState\.trackDetail\)/);
});

test('all browser JavaScript in the final transformed app is syntactically valid', async () => {
  const html = await finalAppHtml();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
