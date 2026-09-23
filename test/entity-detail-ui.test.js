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


test('canonical detail enhancer composes shared statistics and evidence presentation without owning detail runtime', () => {
  const html = enhanced();
  assert.match(html, /kentaurai-entity-detail-statistics-v2-script/);
  assert.match(html, /kentaurai-entity-detail-canonical-style/);
  assert.match(html, /kentaurai-external-evidence-ui-style/);
  assert.doesNotMatch(html, /kentaurai-entity-detail-ui-runtime/);
  assert.doesNotMatch(html, /legacyRenderDetail|renderCanonicalShell/);
  assert.match(html, /external-evidence-table/);
  assert.match(html, /external-interview-card/);
  assert.match(html, /external-interview-row/);
  assert.match(html, /external-interview-change/);
  assert.doesNotThrow(() => new vm.Script(statsScriptFrom(html)));

  const twice = enhanceEntityDetailUiHtml(html);
  assert.equal((twice.match(/kentaurai-entity-detail-statistics-v2-script/g) || []).length, 1);
  assert.equal((twice.match(/kentaurai-entity-detail-canonical-style/g) || []).length, 1);
  assert.equal((twice.match(/kentaurai-external-evidence-ui-style/g) || []).length, 1);
  assert.equal((twice.match(/kentaurai-entity-detail-ui-runtime/g) || []).length, 0);
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

test('critical detail statistics render defers filter options and specialty reads', () => {
  const script = statsScriptFrom(enhanced());
  const mountStart = script.indexOf('async function mount()');
  const mountEnd = script.indexOf('window.__kentauraiEntityDetailStatistics', mountStart);
  assert.ok(mountStart >= 0 && mountEnd > mountStart);
  assert.doesNotMatch(script.slice(mountStart, mountEnd), /loadOptions\(/);
  assert.match(script, /if\(s\.open&&!s\.options\)await loadOptions\(s,c\)/);
  assert.match(script, /calendar-statistics\?'.*specials=0/);
  assert.match(script, /calendar-specialties\?'/);
  assert.match(script, /id="entityDetailSpecialties"/);
  assert.match(script, /calendar-specialties\?'.*\.then\(specialties=>/);
});


test('horse trip scenarios load independently and distinguish loading empty and error states', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /calendar-trip-scenarios\?'/);
  assert.match(script, /id="entityDetailTripScenarios"/);
  assert.match(script, /Läser löpningsscenario…/);
  assert.match(script, /Ingen löpningsscenariostatistik för valt urval\./);
  assert.match(script, /Kunde inte läsa löpningsscenario\./);
  assert.doesNotMatch(script, /specialtyContent\([^\n]*tripScenarioResults/);
  assert.match(script, /tripScenarioPromise=s\.page==='horses'/);
  assert.match(script, /scenarioTable\(result\?\.data\?\.tripScenarioResults,'ready'\)/);
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

test('year and filter controls are rendered above the score summary because they affect the full view', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /host\.innerHTML='<div class="entity-detail-controls">'\+toolbar\(s,c\)\+panel\(s,c\)\+'<\/div>'\+content\(data,s,c\)/);
  assert.doesNotMatch(script, /scoreNode\.after\(controlsNode\)/);
});


test('detail layout explicitly supports narrow mobile widths and scrollable tables', () => {
  const html = enhanced();
  assert.match(html, /@media\(max-width:430px\)/);
  assert.match(html, /@media\(max-width:375px\)/);
  assert.match(html, /@media\(max-width:340px\)/);
  assert.match(html, /@media\(max-width:320px\)/);
  assert.match(html, /overflow-x:auto/);
  assert.match(html, /-webkit-overflow-scrolling:touch/);
  assert.match(html, /entity-detail-score\{display:grid;gap:0;border:1px solid var\(--line\);border-radius:11px;overflow:hidden/);
  assert.match(html, /entity-detail-score-main\{display:grid;grid-template-columns:minmax\(0,1\.2fr\) minmax\(0,1fr\);gap:0;border-bottom:1px solid var\(--line-soft\)/);
  assert.match(html, /entity-detail-side\{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:0\}/);
  assert.match(html, /entity-detail-side>\.entity-detail-mini:nth-child\(odd\)\{border-right:1px solid var\(--line-soft\)\}/);
  assert.match(html, /@media\(max-width:650px\)\{\.entity-detail-score-main\{grid-template-columns:1fr\}\.entity-detail-hero\{border-right:0;border-bottom:1px solid var\(--line-soft\)\}/);
});

test('horse start points render from primary canonical data and verified top speed loads lazily', () => {
  const html = enhanced();
  const script = statsScriptFrom(html);
  assert.match(script, /currentStartPoints/);
  assert.match(script, /topSpeed/);
  assert.match(script, /Toppfart/);
  assert.match(script, /horse-pattern-section/);
  assert.match(script, /calendar-statistics\?'.*specials=0/);
  assert.match(script, /id="entityDetailHorseExtra"/);
  assert.match(script, /topSpeedPromise=s\.page==='horses'\?delayedRequest\('\/horses\/'\+encodeURIComponent\(s\.id\)\+'\/top-speed',token\)\.catch\(\(\)=>null\):Promise\.resolve\(null\)/);
  assert.match(script, /extraHost\.innerHTML=horseExtra\(extra\)/);
  assert.match(script, /Ingen verifierad X-Labs-mätning/);
  assert.doesNotMatch(script, /captureHorseExtra|horseStatsBuildB/);
});

test('trainer-specific verified home-track summaries remain visible after shared redesign', () => {
  const script = statsScriptFrom(enhanced());
  assert.match(script, /if\(s\.page==='trainers'\)/);
  assert.match(script, /special\('Hemmabana',data\?\.homeTrackResults,'Senaste verifierade officiella hemmabana'\)/);
  assert.match(script, /special\('Övriga banor',data\?\.otherTrackResults,'Endast tränare med verifierad hemmabana'\)/);
});

test('shared summary keeps entity-specific specialized sections without the scorecard kicker', () => {
  const html = enhanced();
  const script = statsScriptFrom(html);
  assert.doesNotMatch(script, /Scorecard/);
  assert.doesNotMatch(html, /entity-detail-kicker/);
  assert.doesNotMatch(html, /\.entity-detail-label\{[^}]*margin-top/);
  assert.match(script, /Segerprocent/);
  assert.match(script, /Form \(1–100\)/);
  assert.match(script, /formMini\(data\.entityType,null\)/);
  assert.match(script, /entity-detail-side">'\+form\+mini\('Prispengar'/);
  assert.doesNotMatch(script, /entity-detail-side">'\+mini\('Prispengar'[^\n]*\+form/);
  assert.match(script, /if\(c\.rest\)/);
  assert.match(script, /if\(c\.market\)/);
  assert.match(script, /table\('Startmetod'/);
  assert.match(script, /table\('Distans'/);
  assert.match(script, /table\('Bana'/);
});
