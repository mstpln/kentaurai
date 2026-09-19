import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { createAppSessionCookie } from '../src/app-auth.js';
import worker from '../src/worker-v077.js';
import { createTestEnv } from './helpers/d1.js';

class FakeClassList {
  add() {}
  remove() {}
  toggle() {}
  contains() { return false; }
}

class FakeElement {
  constructor(document, id = '') {
    this.ownerDocument = document;
    this.id = id;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.childNodes = [];
    this.style = {};
    this._innerHTML = '';
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.ownerDocument.elementWrites.push({ id:this.id, html:this._innerHTML });
    if (this.id === 'app') {
      this.ownerDocument.appWrites.push(this._innerHTML);
      this.ownerDocument.resetRenderedNodes(this._innerHTML);
    }
  }
  get innerHTML() { return this._innerHTML; }
  get textContent() { return ''; }
  set textContent(_value) {}
  get firstElementChild() { return new FakeElement(this.ownerDocument); }
  get content() { return new FakeElement(this.ownerDocument); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  append(...nodes) { this.childNodes.push(...nodes); }
  appendChild(node) {
    this.childNodes.push(node);
    if (node?.id) this.ownerDocument.nodes.set(node.id, node);
    if (this.id === 'app') this.ownerDocument.domAppends.push(node?.id || '');
    return node;
  }
  insertBefore(node) { this.childNodes.push(node); return node; }
  insertAdjacentHTML(_position, html) { this.innerHTML += html; }
  remove() {}
  replaceWith() {}
  after() {}
  closest() { return null; }
}

class FakeDocument {
  constructor() {
    this.appWrites = [];
    this.elementWrites = [];
    this.domAppends = [];
    this.nodes = new Map();
    this.body = new FakeElement(this, 'body');
    for (const id of ['app', 'globalSearch', 'searchResults', 'clearSearch']) {
      this.nodes.set(id, new FakeElement(this, id));
    }
  }
  resetRenderedNodes(html) {
    for (const id of [...this.nodes.keys()]) {
      if (!['app', 'globalSearch', 'searchResults', 'clearSearch'].includes(id)) this.nodes.delete(id);
    }
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) this.nodes.set(match[1], new FakeElement(this, match[1]));
  }
  getElementById(id) {
    if (id === 'backBtn') return new FakeElement(this, id);
    return this.nodes.get(id) || null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  createElement() { return new FakeElement(this); }
  createTreeWalker() { return { nextNode() { return null; } }; }
  addEventListener() {}
}

async function productionHtml() {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';', 1)[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers:{ cookie } }), env, {});
  assert.equal(response.status, 200);
  return response.text();
}

function runtimeContext() {
  const document = new FakeDocument();
  const responses = new Map();
  const requestedPaths = [];
  const context = {
    document,
    console,
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    Intl,
    Date,
    Number,
    Map,
    Set,
    Promise,
    encodeURIComponent,
    decodeURIComponent,
    Element: FakeElement,
    Node: { TEXT_NODE:3 },
    NodeFilter: { SHOW_TEXT:4, FILTER_REJECT:2, FILTER_ACCEPT:1 },
    MutationObserver: class { observe() {} disconnect() {} },
    history: { state:null, pushState() {}, replaceState() {} },
    location: { pathname:'/app/', search:'', hash:'', href:'https://example.test/app/' },
    navigator: {},
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {},
    requestAnimationFrame(callback) { callback(); return 1; },
    setTimeout() { return 1; },
    clearTimeout() {},
    fetch: async (url) => {
      const path = String(url).replace(/^\/app\/api/, '');
      requestedPaths.push(path);
      const entry = [...responses.entries()].find(([key]) => path === key || path.startsWith(key + '?'));
      const data = entry?.[1] || (path === '/summary' ? { trends:{ available:false } } : {});
      return { ok:true, status:200, async json() { return data; }, async text() { return ''; } };
    }
  };
  context.window = context;
  context.globalThis = context;
  return { context:vm.createContext(context), document, responses, requestedPaths };
}

test('actual production scripts initialize without errors and no later layer reverts canonical tabs', async () => {
  const html = await productionHtml();
  assert.doesNotMatch(html, /kentaurai-entity-detail-ui-runtime/);
  const scripts = [...html.matchAll(/<script(?: id="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
  const { context } = runtimeContext();
  const errors = [];
  const canonicalHorse = [['stats','Statistik'],['external_stats','Extern statistik'],['interviews','Intervjuer'],['starts','Starter'],['data','Data']];
  let canonicalSeen = false;
  const lateSnapshots = [];
  for (const [, id = '(base)', source] of scripts) {
    try {
      new vm.Script(source, { filename:id }).runInContext(context);
      if (vm.runInContext("typeof detailTabs", context) === 'function') {
        const horseTabs = Array.from(vm.runInContext("detailTabs('horse')", context), (row) => Array.from(row));
        if (JSON.stringify(horseTabs) === JSON.stringify(canonicalHorse)) canonicalSeen = true;
        if (canonicalSeen) lateSnapshots.push({ id, horseTabs });
      }
    } catch (error) {
      errors.push({ id, message:error.message });
    }
  }
  assert.deepEqual(errors, []);
  assert.equal(canonicalSeen, true);
  for (const snapshot of lateSnapshots) assert.deepEqual(snapshot.horseTabs, canonicalHorse, snapshot.id);
  assert.deepEqual(
    Array.from(vm.runInContext("detailTabs('trainer')", context), (row) => Array.from(row)),
    [['stats','Statistik'],['interviews','Intervjuer'],['starts','Starter'],['horses','Hästar'],['data','Data']]
  );
  assert.deepEqual(
    Array.from(vm.runInContext("detailTabs('driver')", context), (row) => Array.from(row)),
    [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']]
  );
});

test('actual production evidence tabs call their canonical APIs', async () => {
  const html = await productionHtml();
  const scripts = [...html.matchAll(/<script(?: id="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
  const { context, responses, requestedPaths } = runtimeContext();
  for (const [, id = '(base)', source] of scripts) new vm.Script(source, { filename:id }).runInContext(context);
  const horse = { type:'horse', entity:{ name:'Nilla Lane', country_code:'SE' }, stats:{}, breakdowns:{}, coverage:{}, starts:[] };
  const trainer = { type:'trainer', entity:{ name:'Test Trainer', country_code:'SE' }, stats:{}, breakdowns:{}, coverage:{}, starts:[] };
  responses.set('/entities/horses/horse-1', horse);
  responses.set('/entities/trainers/trainer-1', trainer);
  responses.set('/horses/horse-1/external-statistics', { items:[] });
  responses.set('/horses/horse-1/interviews', { items:[] });
  responses.set('/trainers/trainer-1/interviews', { items:[] });

  vm.runInContext("state.detail={page:'horses',id:'horse-1'};state.page='horses';state.tab='external_stats'", context);
  await vm.runInContext('renderDetail()', context);
  vm.runInContext("state.tab='interviews'", context);
  await vm.runInContext('renderDetail()', context);
  vm.runInContext("state.detail={page:'trainers',id:'trainer-1'};state.page='trainers';state.tab='interviews'", context);
  await vm.runInContext('renderDetail()', context);

  assert.ok(requestedPaths.includes('/horses/horse-1/external-statistics'));
  assert.ok(requestedPaths.includes('/horses/horse-1/interviews'));
  assert.ok(requestedPaths.includes('/trainers/trainer-1/interviews'));
});

test('core production detail path is canonical with no final runtime wrapper present', async () => {
  const html = await productionHtml();
  assert.doesNotMatch(html, /kentaurai-entity-detail-ui-runtime/);
  const scripts = [...html.matchAll(/<script(?: id="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
  const { context, document, responses, requestedPaths } = runtimeContext();
  for (const [, id = '(base)', source] of scripts) new vm.Script(source, { filename:id }).runInContext(context);
  const detail = {
    type:'horse', entity:{ name:'Nilla Lane', country_code:'SE' }, latestObservation:null,
    stats:{}, breakdowns:{ startMethods:[], distances:[], tracks:[] }, coverage:{}, starts:[]
  };
  responses.set('/entities/horses/horse-1', detail);
  responses.set('/horses/statistics/filter-options', { tracks:[], distanceGroups:[], ageOptions:[], birthYears:[], handicapBuckets:[] });
  responses.set('/horses/horse-1/calendar-statistics', { summary:{}, startMethods:[], distances:[], tracks:[] });
  responses.set('/horses/horse-1/statistics', { currentStartPoints:null, relevantPatterns:null });
  document.appWrites.length = 0;
  document.elementWrites.length = 0;
  document.domAppends.length = 0;

  await vm.runInContext("openDetail('horses','horse-1')", context);

  const shell = document.appWrites.at(-1);
  assert.match(shell, /Statistik[\s\S]*Extern statistik[\s\S]*Intervjuer[\s\S]*Starter[\s\S]*Data/);
  assert.match(shell, /entityDetailStatisticsV2/);
  for (const write of document.elementWrites) {
    assert.doesNotMatch(write.html, /Starter med resultat|Vinstprocent|entityStatSummary|horseStatsBuildB|trainerStatsBuildD|driverStatsBuildC/);
  }
  assert.deepEqual(document.domAppends.filter((id) => /StatsBuild/.test(id)), []);
  assert.equal(requestedPaths.some((path) => path.startsWith('/horses/horse-1/statistics?')), false);
  assert.match(document.getElementById('entityDetailStatisticsV2').innerHTML, /Scorecard/);
});

test('actual production click path owns tabs and never paints legacy statistics', async () => {
  const html = await productionHtml();
  const scripts = [...html.matchAll(/<script(?: id="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
  const { context, document, responses, requestedPaths } = runtimeContext();
  for (const [, id = '(base)', source] of scripts) new vm.Script(source, { filename:id }).runInContext(context);
  const detail = {
    type:'horse', entity:{ name:'Nilla Lane', country_code:'SE' }, latestObservation:null,
    stats:{}, breakdowns:{ startMethods:[], distances:[], tracks:[] }, coverage:{}, starts:[]
  };
  responses.set('/entities/horses/horse-1', detail);
  responses.set('/horses/statistics/filter-options', { tracks:[], distanceGroups:[], ageOptions:[], birthYears:[], handicapBuckets:[] });
  responses.set('/horses/horse-1/calendar-statistics', { summary:{}, startMethods:[], distances:[], tracks:[] });
  responses.set('/horses/horse-1/statistics', { currentStartPoints:null, relevantPatterns:null });
  responses.set('/entities/trainers/trainer-1', { ...detail, type:'trainer', entity:{ name:'Test Trainer', country_code:'SE' } });
  responses.set('/trainers/statistics/filter-options', { tracks:[], distanceGroups:[], ageOptions:[], birthYears:[], handicapBuckets:[] });
  responses.set('/trainers/trainer-1/calendar-statistics', { summary:{}, startMethods:[], distances:[], tracks:[] });
  responses.set('/entities/drivers/driver-1', { ...detail, type:'driver', entity:{ name:'Test Driver', country_code:'SE' } });
  responses.set('/drivers/statistics/filter-options', { tracks:[], distanceGroups:[], ageOptions:[], birthYears:[], handicapBuckets:[] });
  responses.set('/drivers/driver-1/calendar-statistics', { summary:{}, startMethods:[], distances:[], tracks:[] });
  document.appWrites.length = 0;
  document.elementWrites.length = 0;
  document.domAppends.length = 0;

  await vm.runInContext("openDetail('horses','horse-1')", context);

  assert.ok(document.appWrites.length >= 2);
  assert.match(document.appWrites[0], /kentaurai-fast-loading/);
  const shell = document.appWrites.at(-1);
  assert.match(shell, /Statistik[\s\S]*Extern statistik[\s\S]*Intervjuer[\s\S]*Starter[\s\S]*Data/);
  assert.match(shell, /entityDetailStatisticsV2[\s\S]*skeleton/);
  for (const write of document.elementWrites) {
    assert.doesNotMatch(write.html, /Starter med resultat|Vinstprocent|entityStatSummary|horseStatsBuildB|trainerStatsBuildD|driverStatsBuildC/);
  }
  assert.deepEqual(document.domAppends.filter((id) => /StatsBuild/.test(id)), []);
  assert.equal(requestedPaths.some((path) => path.startsWith('/horses/horse-1/statistics?')), false);
  assert.match(document.getElementById('entityDetailStatisticsV2').innerHTML, /Scorecard/);
  assert.match(document.getElementById('entityDetailStatisticsV2').innerHTML, /Segerprocent/);

  document.appWrites.length = 0;
  await vm.runInContext("openDetail('trainers','trainer-1')", context);
  assert.match(document.appWrites.at(-1), /Statistik[\s\S]*Intervjuer[\s\S]*Starter[\s\S]*Hästar[\s\S]*Data/);
  assert.doesNotMatch(document.appWrites.at(-1), /Extern statistik/);

  document.appWrites.length = 0;
  await vm.runInContext("openDetail('drivers','driver-1')", context);
  assert.match(document.appWrites.at(-1), /Statistik[\s\S]*Starter[\s\S]*Hästar[\s\S]*Data/);
  assert.doesNotMatch(document.appWrites.at(-1), /Extern statistik|Intervjuer/);
});

test('composed production payload has no legacy async detail writer left to resolve after canonical mount', async () => {
  const html = await productionHtml();
  assert.doesNotMatch(html, /previousHorseRenderDetail|previousHorsePatternsRenderDetail|appendDetailStats|horseStatsBuildB/);
  assert.doesNotMatch(html, /appendTrainerDetailStats|trainerStatsBuildD/);
  assert.doesNotMatch(html, /appendDriverDetailStats|driverStatsBuildC/);
  assert.doesNotMatch(html, /priorAlignedDetailTabs|kentaurai-entity-detail-ui-runtime/);
});
