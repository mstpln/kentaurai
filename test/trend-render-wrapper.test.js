import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

import { enhanceTrendHtml } from '../src/trend-ui.js';

test('Trend enhancement preserves previously composed renderStart wrappers', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.doesNotThrow(() => new vm.Script(match[1]));
  assert.match(match[1], /const priorTrendRenderStart=renderStart;/);
  assert.match(match[1], /await priorTrendRenderStart\(\);/);
  assert.match(match[1], /return renderTrendBuildA\(\);/);
  assert.match(match[1], /data-trend-category[\s\S]*renderTrendBuildA\(\)/);
  assert.doesNotMatch(match[1], /renderStart=async function\(\)\{\s*state\.detail=null/);
});

test('Trend critical path renders without summary or filter-option reads first', async () => {
  const baseSource = await readFile(new URL('../src/app-page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(baseSource, /state\.cache\.summary\|\|await api\('\/summary'\)/);

  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  const script = match[1];
  const renderStart = script.indexOf('async function renderTrendBuildA()');
  const bindStart = script.indexOf('function bindTrendBuildA()', renderStart);
  assert.ok(renderStart >= 0 && bindStart > renderStart);
  const renderBlock = script.slice(renderStart, bindStart);
  assert.doesNotMatch(renderBlock, /loadTrendFilterOptions\(\)/);
  assert.match(script, /toggle\.onclick=async\(\)=>\{[^}]*state\.trendFilterOpen[^}]*await loadTrendFilterOptions\(\)/);
});

test('Trend opens with the requested period and filter defaults', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  const script = match[1];

  assert.match(script, /state\.trendRange=state\.trendCategory==='horses'\?'3m':'2w';/);
  assert.match(script, /state\.trendRaceScope=state\.trendRaceScope\|\|'high_prize';/);
  assert.match(script, /state\.trendDetailFilters=\{trackId:'all',raceType:'all',breedType:'all',startMethod:'all',minStarts:state\.trendCategory==='horses'\?'3':'10',\.\.\.\(state\.trendDetailFilters\|\|\{\}\)\};/);
  assert.match(script, /state\.trendRange=next==='horses'\?'3m':'2w'/);
  assert.match(script, /state\.trendDetailFilters\.minStarts=next==='horses'\?'3':'10'/);
  assert.match(script, /period:state\.trendRange/);
  assert.match(script, /race_scope:state\.trendRaceScope/);
  assert.match(script, /min_starts:f\.minStarts/);
});

test('Trend uses compact accessible period selector beside the filter trigger', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  assert.match(html, /class="trend-period-menu"/);
  assert.match(html, /id="trendPeriodSelect"/);
  assert.match(html, /aria-label="Tidsperiod"/);
  assert.match(html, /class="trend-period-chevron"/);
  assert.match(html, /\.trend-period-select:focus-visible\{[^}]*outline:1px solid var\(--accent\)/);
  assert.match(html, /period\.onchange=\(\)=>\{state\.trendRange=period\.value;renderTrendBuildA\(\)\}/);
  assert.doesNotMatch(html, /class="range-group"/);
  assert.doesNotMatch(html, /class="range-btn/);
});

test('Trend filter badge counts Loppnivå plus active detail filters', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  const script = match[1];

  assert.match(script, /function activeFilterCount\(\)\{return detailCount\(\)\+\(state\.trendRaceScope&&state\.trendRaceScope!=='all'\?1:0\)\}/);
  assert.match(script, /function trendPageControls\(\)\{const count=activeFilterCount\(\)/);
  assert.match(script, /trend-filter-count/);
});

test('Trend reset restores category-specific canonical defaults', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  const script = match[1];

  assert.match(html, />Återställ filter<\/button>/);
  assert.match(script, /reset\.onclick=\(\)=>\{state\.trendRaceScope='high_prize';state\.trendDetailFilters=\{trackId:'all',raceType:'all',breedType:'all',startMethod:'all',minStarts:state\.trendCategory==='horses'\?'3':'10'\};renderTrendBuildA\(\)\}/);
});

test('Trend ranking rows remove repeated win label and preserve full prize-money space', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  assert.doesNotMatch(html, /trend-win-label/);
  assert.doesNotMatch(html, />Seger%<\/span>/);
  assert.match(html, /grid-template-columns:minmax\(0,\.9fr\) minmax\(0,\.9fr\) minmax\(0,1\.45fr\)/);
  assert.match(html, /\.trend-metric-pill:last-child strong\{[^}]*overflow:visible[^}]*text-overflow:clip/);
  assert.match(html, /\.trend-win-block\{[^}]*align-items:center[^}]*padding:0 10px/);
});


test('Trend categories use the unified muted connected tab row', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');

  assert.match(html, /class="trend-category-tabs"/);
  assert.match(html, /\.trend-category-tabs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\);height:40px;background:#11110f;border:1px solid var\(--line\);border-radius:10px;overflow:hidden\}/);
  assert.match(html, /\.trend-category-tabs \.segment-btn\{[^}]*border-right:1px solid var\(--line\)[^}]*border-radius:0[^}]*height:100%[^}]*font-size:12px[^}]*font-weight:600/);
  assert.match(html, /\.trend-category-tabs \.segment-btn\.active\{background:#b7ac9c;border-color:var\(--line\);color:#1a1713\}/);
  assert.doesNotMatch(html, /class="segment-group"[^>]*>.*data-trend-category/);
});
