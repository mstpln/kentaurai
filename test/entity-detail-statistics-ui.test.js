import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { enhanceEntityDetailStatisticsHtml } from '../src/entity-detail-statistics-ui.js';

function enhanced() {
  return enhanceEntityDetailStatisticsHtml('<html><head></head><body></body></html>');
}

function scriptFrom(html) {
  const match = html.match(/<script id="kentaurai-entity-detail-statistics-v2-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  return match[1];
}

test('shared detail enhancement composes valid runtime for trainer, driver and horse pages only', () => {
  const html = enhanced();
  const script = scriptFrom(html);
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(script, /page==='trainers'/);
  assert.match(script, /page==='drivers'/);
  assert.match(script, /page==='horses'/);
  assert.doesNotMatch(script, /page==='tracks'/);
  assert.doesNotMatch(script, /page==='games'/);
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
  const html = enhanced();
  const script = scriptFrom(html);
  assert.match(script, /\['good','Bra spår \(1\/6\/7\)'\]/);
  assert.match(script, /\['other','Övriga spår'\]/);
  assert.match(script, /\['all','All data'\],\['high_prize','Högre prissumma'\],\['weekday','Vardagstrav'\]/);
  assert.match(script, /fields\+=field\('Voltspår'[\s\S]*field\('Tillägg'[\s\S]*Återställ filter/);
  assert.match(script, /function count\(s,c\)/);
  assert.match(script, /k!=='year'/);
});

test('filter controls are placed directly below the scorecard before detail tables', () => {
  const script = scriptFrom(enhanced());
  assert.match(script, /const scoreNode=host\.querySelector\('\.entity-detail-score'\)/);
  assert.match(script, /const controlsNode=host\.querySelector\('\.entity-detail-controls'\)/);
  assert.match(script, /scoreNode\.after\(controlsNode\)/);
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

test('horse-specific verified start-point and pattern sections are preserved while duplicate legacy blocks are hidden', () => {
  const html = enhanced();
  const script = scriptFrom(html);
  assert.match(script, /captureHorseExtra/);
  assert.match(script, /horse-special-grid/);
  assert.match(script, /horse-pattern-section/);
  assert.match(html, /horse-special:nth-child\(-n\+2\)\{display:none!important\}/);
  assert.match(script, /s\.horseExtra/);
});

test('shared scorecard keeps entity-specific specialized sections', () => {
  const script = scriptFrom(enhanced());
  assert.match(script, /Scorecard/);
  assert.match(script, /Segerprocent/);
  assert.match(script, /Form '\+c\.form/);
  assert.match(script, /if\(c\.rest\)/);
  assert.match(script, /if\(c\.market\)/);
  assert.match(script, /table\('Startmetod'/);
  assert.match(script, /table\('Distans'/);
  assert.match(script, /table\('Bana'/);
});
