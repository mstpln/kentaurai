import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { enhanceEntityDetailUiHtml } from '../src/entity-detail-ui.js';

function enhanced() {
  return enhanceEntityDetailUiHtml('<html><head></head><body></body></html>');
}

function statsScriptFrom(html) {
  const match = html.match(/<script id="kentaurai-entity-detail-statistics-v2-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  return match[1];
}

function runtimeScriptFrom(html) {
  const match = html.match(/<script id="kentaurai-entity-detail-ui-runtime">([\s\S]*?)<\/script>/);
  assert.ok(match);
  return match[1];
}

test('canonical detail enhancer composes the shared statistics UI, evidence styles and final runtime exactly once', () => {
  const html = enhanced();
  assert.match(html, /kentaurai-entity-detail-statistics-v2-script/);
  assert.match(html, /kentaurai-entity-detail-canonical-style/);
  assert.match(html, /kentaurai-external-evidence-ui-style/);
  assert.match(html, /kentaurai-entity-detail-ui-runtime/);
  assert.doesNotMatch(html, /#horseStatsBuildB,#trainerStatsBuildD,#driverStatsBuildC\{display:none!important\}/);
  assert.match(html, /external-evidence-table/);
  assert.match(html, /external-interview-card/);
  assert.doesNotThrow(() => new vm.Script(statsScriptFrom(html)));
  assert.doesNotThrow(() => new vm.Script(runtimeScriptFrom(html)));

  const twice = enhanceEntityDetailUiHtml(html);
  assert.equal((twice.match(/kentaurai-entity-detail-statistics-v2-script/g) || []).length, 1);
  assert.equal((twice.match(/kentaurai-external-evidence-ui-style/g) || []).length, 1);
  assert.equal((twice.match(/kentaurai-entity-detail-ui-runtime/g) || []).length, 1);
});

test('final runtime owns horse and trainer evidence tabs and leaves drivers unchanged', () => {
  const script = runtimeScriptFrom(enhanced());
  const context = vm.createContext({
    state: { detail:{ page:'horses', id:'horse-1' }, tab:'stats' },
    detailTabs(type) {
      if (type === 'horse') return [['stats','Statistik'],['starts','Starter'],['data','Data']];
      if (type === 'trainer') return [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']];
      return [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']];
    },
    statsView() { return '<div>legacy</div>'; },
    async renderDetail() {},
    app: { querySelector() { return null; } },
    api: async () => ({ items:[] }),
    esc: (value) => String(value ?? ''),
    Intl,
    Date,
    Number,
    Map,
    encodeURIComponent,
    console
  });
  new vm.Script(script).runInContext(context);

  assert.deepEqual(
    Array.from(context.detailTabs('horse'), (row) => Array.from(row)),
    [['stats','Statistik'],['external_stats','Extern statistik'],['interviews','Intervjuer'],['starts','Starter'],['data','Data']]
  );
  assert.deepEqual(
    Array.from(context.detailTabs('trainer'), (row) => Array.from(row)),
    [['stats','Statistik'],['interviews','Intervjuer'],['starts','Starter'],['horses','Hästar'],['data','Data']]
  );
  assert.deepEqual(
    Array.from(context.detailTabs('driver'), (row) => Array.from(row)),
    [['stats','Statistik'],['starts','Starter'],['horses','Hästar'],['data','Data']]
  );
  assert.equal(context.statsView({}), '<div>legacy</div>');
  assert.match(script, /if \(!\['stats','external_stats','interviews'\]\.includes\(requestedTab\)\) return legacyRenderDetail\(\)/);
});

test('shared detail enhancement composes valid runtime for trainer, driver and horse pages only', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /page==='trainers'/);
  assert.match(script, /page==='drivers'/);
  assert.match(script, /page==='horses'/);
  assert.doesNotMatch(script, /page==='tracks'/);
  assert.doesNotMatch(script, /page==='games'/);
});

test('scorecard win percentage uses a restrained font weight', () => {
  assert.match(enhanced(), /\.entity-detail-win\{[^}]*font-weight:600/);
});

test('canonical statistics mount is exposed without wrapping the legacy detail renderer', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /window\.__kentauraiEntityDetailStatistics=\{mount/);
  assert.doesNotMatch(script, /previousRenderDetail/);
  assert.doesNotMatch(script, /renderDetail=async function/);
});

test('detail pages reuse the exact start-page sliders icon and year-based selector', () => {
  const html = enhanced();
  assert.match(html, /M4 7h10M18 7h2M14 4v6M4 17h2M10 17h10M10 14v6/);
  assert.match(html, />Tidsperiod</);
  assert.match(html, /Array\.from\(\{length:5\}/);
  assert.match(html, /aria-label="Tidsperiod"/);
  assert.doesNotMatch(html, /2 veckor/);
  assert.doesNotMatch(html, /4 veckor/);
  assert.doesNotMatch(html, /3 mån/);
});

test('detail filters preserve canonical choices and reset is rendered last', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /\['good','Bra spår \(1\/6\/7\)'\]/);
  assert.match(script, /\['other','Övriga spår'\]/);
  assert.match(script, /\['all','All data'\],\['high_prize','Högre prissumma'\],\['weekday','Vardagstrav'\]/);
  assert.match(script, /fields\+=field\('Voltspår'[\s\S]*field\('Tillägg'[\s\S]*Återställ filter/);
  assert.match(script, /function count\(s,c\)/);
  assert.match(script, /k!=='year'/);
});

test('horse age options follow the selected calendar year rather than the device current year', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /const y=Number\(s\.filters\.year\)\|\|new Date\(\)\.getFullYear\(\)/);
  assert.match(script, /s\.options\.birthYears\.map\(v=>y-Number\(v\)\)/);
});

test('filter controls are placed directly below the scorecard before detail tables', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /const scoreNode=host\.querySelector\('\.entity-detail-score'\)/);
  assert.match(script, /const controlsNode=host\.querySelector\('\.entity-detail-controls'\)/);
  assert.match(script, /scoreNode\.after\(controlsNode\)/);
});

test('canonical runtime intercepts statistics before delegating any legacy detail render', () => {
  const script = runtimeScriptFrom(enhanced());
  const intercept = "if (!['stats','external_stats','interviews'].includes(requestedTab)) return legacyRenderDetail();";
  assert.ok(script.includes(intercept));
  assert.match(script, /if \(requestedTab === 'stats'\) \{[\s\S]*__kentauraiEntityDetailStatistics\.mount\(\)/);
  assert.doesNotMatch(script, /await legacyRenderDetail\(\)[\s\S]*requestedTab === 'stats'/);
});

test('detail layout explicitly supports narrow mobile widths and scrollable tables', () => {
  const html = enhanced();
  assert.match(html, /@media\(max-width:430px\)/);
  assert.match(html, /@media\(max-width:375px\)/);
  assert.match(html, /@media\(max-width:340px\)/);
  assert.match(html, /@media\(max-width:320px\)/);
  assert.match(html, /overflow-x:auto/);
  assert.match(html, /-webkit-overflow-scrolling:touch/);
  assert.match(html, /entity-detail-score-main\{display:grid;grid-template-columns:minmax\(0,1\.2fr\) minmax\(0,1fr\)/);
  assert.match(html, /@media\(max-width:650px\)\{\.entity-detail-score-main\{grid-template-columns:1fr\}/);
});

test('horse-specific verified start-point and pattern sections render directly from canonical data', () => {
  const html = enhanced();
  const script = statsScriptFrom(html);
  assert.match(script, /currentStartPoints/);
  assert.match(script, /relevantPatterns/);
  assert.match(script, /horse-special-grid/);
  assert.match(script, /horse-pattern-section/);
  assert.match(script, /api\('\/horses\/'\+encodeURIComponent\(s\.id\)\+'\/statistics'\)/);
  assert.doesNotMatch(script, /captureHorseExtra|horseStatsBuildB/);
});

test('trainer-specific verified home-track summaries remain visible after shared redesign', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /if\(s\.page==='trainers'\)/);
  assert.match(script, /special\('Hemmabana',data\.homeTrackResults,'Senaste verifierade officiella hemmabana'\)/);
  assert.match(script, /special\('Övriga banor',data\.otherTrackResults,'Endast tränare med verifierad hemmabana'\)/);
});

test('shared scorecard keeps entity-specific specialized sections', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /Scorecard/);
  assert.match(script, /Segerprocent/);
  assert.match(script, /Form '\+c\.form/);
  assert.match(script, /if\(c\.rest\)/);
  assert.match(script, /if\(c\.market\)/);
  assert.match(script, /table\('Startmetod'/);
  assert.match(script, /table\('Distans'/);
  assert.match(script, /table\('Bana'/);
});
