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
  assert.doesNotMatch(script, /await loadOptions\(s,c\);if\(state\.detail/);
  assert.match(script, /if\(s\.open&&!s\.options\)await loadOptions\(s,c\)/);
  assert.match(script, /calendar-statistics\?'.*specials=0/);
  assert.match(script, /calendar-specialties\?'/);
  assert.match(script, /id="entityDetailSpecialties"/);
  assert.match(script, /specialtyPromise\.then/);
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
  assert.match(script, /host\.innerHTML='<div class="entity-detail-controls">'\+toolbar\(s,c\)\+panel\(s,c\)\+'<\/div>'\+content\(data,s,c,extra\)/);
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
  assert.match(script, /Form '\+c\.form/);
  assert.match(script, /if\(c\.rest\)/);
  assert.match(script, /if\(c\.market\)/);
  assert.match(script, /table\('Startmetod'/);
  assert.match(script, /table\('Distans'/);
  assert.match(script, /table\('Bana'/);
});
