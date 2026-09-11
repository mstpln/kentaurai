import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v064.js';
import { createTestEnv } from './helpers/d1.js';

function classList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

function extractScript(html, id) {
  const match = String(html).match(new RegExp(`<script id=["']${id}["']>([\\s\\S]*?)<\\/script>`));
  assert.ok(match, `expected final worker HTML to contain ${id}`);
  return match[1];
}

async function authenticatedAppHtml() {
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
  return response.text();
}

test('canonical Settings script from the actual Wrangler worker renders and executes the analysis CTA', async () => {
  const html = await authenticatedAppHtml();
  const script = extractScript(html, 'kentaurai-settings-script');

  const app = { innerHTML: '' };
  const copied = [];
  const requested = [];
  const elements = new Map([
    ['settingsButton', { classList: classList(), onclick: null }],
    ['exportProvider', { value: 'openai' }],
    ['exportAllData', { onclick: null }],
    ['analysisFile', { files: [] }],
    ['importAnalysis', { onclick: null, disabled: false }],
    ['analysisImportResult', { className: '', textContent: '' }],
    ['copyAnalysisPrompt', { onclick: null, disabled: false, textContent: 'Kopiera instruktioner till AI' }]
  ]);

  const context = vm.createContext({
    app,
    state: { settingsTab: 'ai', settingsOpen: false, detail: null, gameDetail: null, gameSystemId: null },
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelectorAll() { return []; },
      createElement() { return { style: {}, select() {}, remove() {}, value: '' }; },
      body: { appendChild() {} },
      execCommand() { return true; }
    },
    window: { location: { href: '' } },
    navigator: { clipboard: { async writeText(value) { copied.push(value); } } },
    fetch: async (url) => {
      requested.push(String(url));
      return {
        ok: true,
        async json() { return { prompt: 'synthetic provider-neutral analysis prompt' }; }
      };
    },
    api: async (path) => {
      assert.equal(path, '/settings/status');
      return { appVersion: '0.6.0' };
    },
    heading: (title, subtitle) => `<h1>${title}</h1><p>${subtitle}</p>`,
    tabs: (items) => items.map(([, label]) => label).join(' '),
    esc: (value) => String(value ?? ''),
    num: (value) => String(value ?? 0),
    setNav() {},
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    FormData: globalThis.FormData,
    console
  });

  new vm.Script(script, { filename: 'kentaurai-settings-script.js' }).runInContext(context);
  assert.equal(typeof elements.get('settingsButton').onclick, 'function');

  elements.get('settingsButton').onclick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.match(app.innerHTML, /Skapa V85\/V86-systemanalysfil för import/);
  assert.match(app.innerHTML, /Kopiera instruktioner till AI/);
  assert.match(app.innerHTML, /data-canonical-analysis-prompt="true"/);
  assert.equal(typeof elements.get('copyAnalysisPrompt').onclick, 'function');

  await elements.get('copyAnalysisPrompt').onclick();
  assert.deepEqual(requested, ['/app/api/settings/analysis-prompt?provider=openai']);
  assert.deepEqual(copied, ['synthetic provider-neutral analysis prompt']);
});
