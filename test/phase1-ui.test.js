import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { enhancePhase1Html } from '../src/phase1-ui.js';
import { createPhase1DemoRounds, createPhase1DemoHistoricalRound, createPhase1DemoSystems } from '../src/phase1-fixtures.js';
import { displayStartResult, resultNet, summarizeSystems } from '../src/phase1-model.js';
import { phase1Api, phase1ApiBrowserSource, completedPhase1Starts } from '../src/phase1-data.js';
import worker from '../src/worker-v079.js';

test('Phase 1 is an idempotent HTML enhancement with explicit browser aliases', () => {
  const base = '<html><head></head><body><script>const originalApp=1;</script></body></html>';
  const html = enhancePhase1Html(base, { asOfDate: '2028-01-02' });
  assert.equal(enhancePhase1Html(html), html);
  assert.ok(html.indexOf('function __name(target)') < html.indexOf('const originalApp'));
  assert.match(html, /const summarizeSystems=\(function/);
  assert.match(html, /const calculateSystem=\(function/);
  assert.doesNotMatch(html, /fonts\.googleapis|DM Sans|Space Grotesk|IBM Plex/);
  assert.doesNotMatch(html, /demo-v85-1970|demo-v86-1970/);
  for (const [, script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    assert.doesNotThrow(() => new vm.Script(script));
  }
  assert.equal(html, enhancePhase1Html(base, { asOfDate: '2028-01-02' }));
  assert.notEqual(enhancePhase1Html(base, { asOfDate: '2028-01-02', allowDemo: true }), enhancePhase1Html(base, { asOfDate: '2028-01-09', allowDemo: true }));
});

test('bottom navigation preserves Trend, Statistik and Spel with settings outside it', () => {
  const html = enhancePhase1Html('<html><head></head><body></body></html>', { asOfDate: '2028-01-02' });
  assert.deepEqual([...html.matchAll(/data-p1-nav="([^"]+)"/g)].map(match => match[1]), ['trend', 'statistics', 'spel']);
  assert.doesNotMatch(html, /\.nav-icon\s*\{\s*display:none!important/);
  assert.match(html, /data-p1-spel-view/);
  assert.match(html, /settingsButton/);
});

test('Spel uses one three-part banner and removes redundant page copy and the oversized registration button', () => {
  const html = enhancePhase1Html('<html><head></head><body></body></html>', { asOfDate: '2028-01-02' });
  assert.match(html, /\[\['upcoming','Kommande'\],\['builder','Registrera system'\],\['systems','Mina system'\]\]/);
  assert.match(html, /spelSwitcher\('builder'\)/);
  assert.match(html, /else if\(spelView==='builder'\)renderBuilder\(\)/);
  assert.match(html, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\);height:40px;gap:0/);
  assert.doesNotMatch(html, /Egna anteckningar och system sparas|Startlistor utan val för egna system|V85 och V86 · verifierade startlistor/);
  assert.doesNotMatch(html, /button\('\+ Registrera system'/);
  assert.match(html, /Lokal lagring kunde inte användas/);
});

test('finance cards use short labels and no explanatory copy while retaining settled totals and net tone', () => {
  const html = enhancePhase1Html('<html><head></head><body></body></html>', { asOfDate: '2028-01-02' });
  assert.ok(html.includes("financeCard('INSATS',summary.stakeSek)+financeCard('UTDELNING',summary.payoutSek)+financeCard('RESULTAT',summary.netSek,true)"));
  const finance = html.match(/function financeCard[^\n]+/)[0];
  assert.doesNotMatch(finance, /p1-small|note/);
  assert.match(finance, /p1-positive.*p1-negative.*p1-neutral/);
  assert.match(html, /@media\(max-width:767px\)\{\s*\.p1-finance\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(html, /\.p1-finance-card:nth-child\(3\)\{grid-column:auto\}/);
});

test('relative demonstration rounds are reproducible, forthcoming, and internally coherent', () => {
  const date = '2028-01-02';
  const rounds = createPhase1DemoRounds(date);
  assert.deepEqual(rounds, createPhase1DemoRounds(date));
  assert.deepEqual(rounds.map(round => round.gameType), ['V85', 'V86']);
  let missingMeasurement = false;
  for (const round of rounds) {
    assert.ok(round.roundDate > date);
    assert.ok(new Date(round.roundDate) - new Date(date) <= 7 * 86400000);
    assert.equal(round.legs.length, 8);
    for (const leg of round.legs) {
      for (const entry of leg.entries) {
        assert.deepEqual(entry.form, entry.history.slice(0, 5).map(row => row.placing));
        assert.ok(entry.history.every(row => row.date <= date));
        if (entry.first200 == null || entry.last400 == null) missingMeasurement = true;
      }
    }
  }
  assert.equal(missingMeasurement, true);
  const historical = createPhase1DemoHistoricalRound(date);
  assert.ok(historical.roundDate < date);
  assert.ok(historical.legs.every(leg => leg.raceId.startsWith(historical.id)));
});

test('settled demo systems are historical, pending examples are forthcoming, and loss is explicit', () => {
  const date = '2028-01-02';
  const rounds = createPhase1DemoRounds(date);
  const systems = createPhase1DemoSystems(rounds, date);
  for (const system of systems) {
    assert.equal(system.source, 'synthetic');
    assert.ok(system.settlementState === 'settled' ? system.roundDate < date : system.roundDate > date);
  }
  assert.ok(systems.some(system => system.gameType === 'V85' && system.settlementState === 'settled'));
  assert.ok(systems.some(system => system.gameType === 'V86' && system.settlementState === 'settled'));
  assert.ok(systems.some(system => resultNet(system.payoutSek, system.stakeSek) === 0));
  assert.ok(summarizeSystems(systems).netSek < 0);
  assert.ok(systems.some(a => systems.some(b => a.id !== b.id && a.roundId === b.roundId)));
  const historical = createPhase1DemoHistoricalRound(date);
  assert.ok(systems.some(system => system.historical && system.roundId === historical.id));
});

test('result mapping uses explicit flags and never guesses unknown provider codes', () => {
  assert.equal(displayStartResult({ placing: 3, placing_text: '3', gallop: true }), '3G');
  assert.equal(displayStartResult({ placing: null, gallop: true, disqualified: true }), 'GD');
  assert.equal(displayStartResult({ placing_text: 'provider-code', gallop: null }), 'provider-code');
  assert.equal(displayStartResult({ disqualified: true, gallop: false }), null);
  assert.equal(displayStartResult({ placing: '3G' }), '3G');
  assert.equal(displayStartResult({ placing: 1, gallop: null }), '1');
  assert.equal(displayStartResult({}), null);
});

test('both browser and module API adapters use authenticated same-origin GETs only', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const fetch = async (path, options) => {
    requests.push({ path, options });
    return { ok: true, status: 200, json: async () => ({ items: [] }) };
  };
  globalThis.fetch = fetch;
  try {
    const context = vm.createContext({ fetch });
    vm.runInContext(phase1ApiBrowserSource + ';globalThis.adapter=phase1Api;', context);
    for (const adapter of [phase1Api, context.adapter]) {
      await adapter.upcomingRounds('V86');
      await adapter.upcomingRound('round/id');
      await adapter.upcomingLeg('round', 8);
      await adapter.horseFacts('round', 1, 'entry');
      await adapter.horseForms('round', 1);
      await adapter.horseProfile('horse');
      await adapter.search('Demo');
      await adapter.searchTracks('Demo');
      await adapter.historicalRounds('V85');
      await adapter.settingsStatus();
    }
    assert.equal(requests.length, 22);
    for (const request of requests) {
      assert.ok(request.path.startsWith('/app/api/'));
      assert.ok(!request.options.method || request.options.method === 'GET');
      assert.equal(request.options.credentials, 'same-origin');
      assert.equal(request.options.body, undefined);
    }
    assert.ok(requests.some(request => request.path.includes('round%2Fid')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('compact history excludes upcoming/scratched/future starts rather than treating them as results', () => {
  const rows = [
    { race_date: '2028-01-04', race_status: 'completed', placing: 1 },
    { race_date: '2028-01-02', race_status: 'scheduled' },
    { race_date: '2028-01-01', race_status: 'completed', scratched: true },
    { race_date: '2027-12-31', race_status: 'completed', placing: 3, gallop: true },
    { race_date: '2027-12-30', race_status: 'completed', placing: null }
  ];
  assert.deepEqual(completedPhase1Starts(rows, '2028-01-02'), rows.slice(3));
});

test('Phase 1 does not expose private APIs without the existing session', async () => {
  for (const path of ['/app/api/games/upcoming', '/app/api/settings/status', '/app/api/search?q=Demo']) {
    const response = await worker.fetch(new Request('https://example.test' + path), { APP_PASSWORD: 'synthetic-only-test-password' }, {});
    assert.equal(response.status, 401, path);
  }
});

test('personal data sync uses a same-origin authenticated JSON POST and refreshes on resumed PWA', async () => {
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async(path,options)=>{
    requests.push({path,options});
    return {ok:true,status:200,json:async()=>({ok:true})};
  };
  try{
    const context=vm.createContext({fetch:globalThis.fetch});
    vm.runInContext(phase1ApiBrowserSource + ';globalThis.adapter=phase1Api;',context);
    await context.adapter.personalSync({notes:[]});
    assert.equal(requests.length,1);
    const request=requests[0];
    assert.equal(request.path,'/app/api/travdata/personal');
    assert.equal(request.options.method,'POST');
    assert.equal(request.options.credentials,'same-origin');
    assert.equal(request.options.headers['content-type'],'application/json');
    assert.equal(JSON.parse(request.options.body).notes.length,0);
  }finally{globalThis.fetch=originalFetch;}
  const html=enhancePhase1Html('<html><head></head><body></body></html>');
  assert.match(html,/initializePersonalSync\(\)/);
  assert.match(html,/visibilitychange.*initializePersonalSync\(true\)/);
  assert.match(html,/tombstones/);
  assert.match(html,/Kunde inte spara lokalt/);
});

test('manual-review systems show why intervention is required and deletion is cross-device', () => {
  const html = enhancePhase1Html('<html><head></head><body></body></html>', { asOfDate:'2028-01-02' });
  assert.match(html, /stateLabel=settled\?'Avgjort':needsReview\?'Kontroll krävs':'Väntar'/);
  assert.match(html, /needsReview\?manualReviewText\(s\.reviewReason\)/);
  assert.match(html, /Strykning eller reserv måste kontrolleras/);
  assert.match(html, /Raderingen synkroniseras även till dina andra enheter/);
  assert.doesNotMatch(html, /Endast lokal data påverkas/);
  assert.match(html, /newestRecords\(local\.systems,remote\.systems,true\)/);
  assert.match(html, /else initializePersonalSync\(\);return true/);
  assert.match(html, /inte bekräftelse på inlämnat spel/);
});

test('horse cards show first 200 and last 400 times without min/km suffix',()=>{
  const html=enhancePhase1Html('<html><head></head><body></body></html>', {asOfDate:'2028-01-02'});
  const helper=html.match(/const pace1=[^\n]+/);
  assert.ok(helper,'browser pace formatter exists');
  const args=['1.07,6 min/km','1.13,6 min/km','1.07.2 min/km','07,6 min/km','1.15,0',null,'','–'];
  const context=vm.createContext({});
  vm.runInContext(helper[0]+';globalThis.formatPace=pace1;',context);
  assert.deepEqual(args.map(value=>context.formatPace(value)),[
    '1.07,6','1.13,6','1.07,2','1.07,6','1.15,0','–','–','–'
  ]);
  assert.match(html,/metric\('Första 200',pace1\(/);
  assert.match(html,/metric\('Sista 400',pace1\(/);
});


test('upcoming horse cards present scratch and handicap states without hiding the underlying start data', () => {
  const html = enhancePhase1Html('<html><head></head><body></body></html>', { asOfDate: '2028-01-02' });
  assert.match(html, /p1-scratched-label/);
  assert.match(html, /STRUKEN/);
  assert.match(html, /p1-handicap-badge/);
  assert.match(html, /m tillägg/);
  assert.match(html, /Spår: /);
  assert.match(html, /Form: /);
  assert.match(html, /Kusk: /);
  assert.match(html, /Skor: /);
  assert.match(html, /Vagn: /);
  assert.match(html, /p1-horse-separator/);
  assert.match(html, /align-items:baseline/);
  assert.match(html, /p1-horse-stats/);
  assert.match(html, /p1-equipment-changed/);
  assert.match(html, /p1-horse-scratched/);
});
