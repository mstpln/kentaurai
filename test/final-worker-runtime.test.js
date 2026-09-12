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

test('canonical Settings script from the actual Wrangler worker renders and executes the three-step analysis workflow', async () => {
  const html = await authenticatedAppHtml();
  const script = extractScript(html, 'kentaurai-settings-script');

  const app = { innerHTML: '' };
  const copied = [];
  const requested = [];
  const elements = new Map([
    ['settingsButton', { classList: classList(), onclick: null }],
    ['exportProvider', { value: 'openai' }],
    ['exportStep1', { onclick: null }],
    ['copyStep1Prompt', { onclick: null, disabled: false, textContent: 'Kopiera analysinstruktion' }],
    ['exportStep2', { onclick: null }],
    ['copyStep2Prompt', { onclick: null, disabled: false, textContent: 'Kopiera systeminstruktion' }],
    ['analysisFile', { files: [] }],
    ['importAnalysis', { onclick: null, disabled: false }],
    ['analysisImportResult', { className: '', textContent: '' }],
    ['copyAnalysisPrompt', { onclick: null, disabled: false, textContent: 'Kopiera exportinstruktion' }]
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
        async json() { return { prompt: `synthetic prompt for ${url}` }; }
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

  assert.match(app.innerHTML, /Analysera omgången utan marknad/);
  assert.match(app.innerHTML, /Värdera marknaden och bygg system/);
  assert.match(app.innerHTML, /Skapa importfil till KentaurAI/);
  assert.match(app.innerHTML, /Kopiera analysinstruktion/);
  assert.match(app.innerHTML, /Kopiera systeminstruktion/);
  assert.match(app.innerHTML, /Kopiera exportinstruktion/);
  assert.equal(typeof elements.get('copyStep1Prompt').onclick, 'function');
  assert.equal(typeof elements.get('copyStep2Prompt').onclick, 'function');
  assert.equal(typeof elements.get('copyAnalysisPrompt').onclick, 'function');

  await elements.get('copyStep1Prompt').onclick({ currentTarget: elements.get('copyStep1Prompt') });
  await elements.get('copyStep2Prompt').onclick({ currentTarget: elements.get('copyStep2Prompt') });
  await elements.get('copyAnalysisPrompt').onclick({ currentTarget: elements.get('copyAnalysisPrompt') });

  assert.deepEqual(requested, [
    '/app/api/settings/analysis-method-prompt?step=1',
    '/app/api/settings/analysis-method-prompt?step=2',
    '/app/api/settings/analysis-prompt?provider=openai'
  ]);
  assert.equal(copied.length, 3);
});

test('final composed statistics runtime replaces the loader and issues the breakdown request', async () => {
  const html = await authenticatedAppHtml();
  const script = extractScript(html, 'kentaurai-stat-filter-script');
  const microtasks = [];
  const requested = [];
  const elements = new Map();
  const globalFilters = { innerHTML: '' };

  const context = vm.createContext({
    state: { tab: 'stats', detail: { page: 'horses', id: 'horse-synthetic-1' } },
    localStartMethod: (value) => String(value ?? ''),
    document: {
      getElementById(id) { return elements.get(id) || null; },
      querySelector(selector) { return selector === '[data-global-stat-filters]' ? globalFilters : null; },
      querySelectorAll() { return []; }
    },
    queueMicrotask(fn) { microtasks.push(fn); },
    api: async (path) => {
      requested.push(path);
      return {
        summary: { resultStarts: 3, wins: 1, seconds: 1, thirds: 0, top3: 2, winRate: 1 / 3, top3Rate: 2 / 3, prizeSek: 15000, gallops: 0, gallopRate: 0, disqualifications: 0 },
        startMethods: [{ label: 'auto', starts: 3, wins: 1, winRate: 1 / 3, top3Rate: 2 / 3, gallopRate: 0 }],
        distances: [{ label: '2140', starts: 3, wins: 1, winRate: 1 / 3, top3Rate: 2 / 3, gallopRate: 0 }],
        tracks: [{ label: 'Synthetic bana', starts: 3, wins: 1, winRate: 1 / 3, top3Rate: 2 / 3, gallopRate: 0 }]
      };
    },
    dataSection: (title) => `<section>${title}</section>`,
    pct: (value) => value == null ? '—' : `${Math.round(Number(value) * 100)}%`,
    money: (value) => value == null ? '—' : String(value),
    num: (value) => String(value ?? 0),
    esc: (value) => String(value ?? ''),
    groupDistanceRows: (rows) => rows,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console
  });

  new vm.Script(script, { filename: 'kentaurai-stat-filter-script.js' }).runInContext(context);
  assert.equal(typeof context.statsView, 'function');

  const initial = context.statsView({ stats: { resultStarts: 3, wins: 1 } });
  assert.match(initial, /All data/);
  assert.match(initial, /Läser statistik…/);

  const tables = { innerHTML: '', querySelector() { return null; } };
  const summary = { innerHTML: '' };
  elements.set('entityStatTables', tables);
  elements.set('entityStatSummary', summary);

  assert.equal(microtasks.length, 1);
  microtasks.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requested.length, 1);
  assert.equal(
    requested[0],
    '/entities/horses/horse-synthetic-1/stat-breakdowns?year=all&race_scope=all&distance_start_method=all&track_start_method=all'
  );
  assert.doesNotMatch(tables.innerHTML, /Läser statistik…/);
  assert.match(tables.innerHTML, /Startmetod/);
  assert.match(tables.innerHTML, /Distans/);
  assert.match(tables.innerHTML, /Bana/);
});
