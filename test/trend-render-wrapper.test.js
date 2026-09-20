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

test('Trend keeps category-specific period and minimum-start defaults', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  const script = match[1];

  assert.match(script, /TREND_DEFAULTS=\{trainers:\{range:'2w',minStarts:'10'\},horses:\{range:'3m',minStarts:'3'\},drivers:\{range:'2w',minStarts:'10'\}\}/);
  assert.match(script, /state\.trendRaceScope=state\.trendRaceScope\|\|'high_prize';/);
  assert.match(script, /applyTrendCategoryDefaults\(state\.trendCategory\)/);
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
  assert.match(html, /period\.onchange=\(\)=>\{state\.trendRange=period\.value;saveTrendCategoryDefaults\(\);renderTrendBuildA\(\)\}/);
  assert.doesNotMatch(html, /class="range-group"/);
  assert.doesNotMatch(html, /class="range-btn/);
});

test('Trend filter badge counts Loppnivå and Loppnivå is a dropdown inside the filter panel', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  const script = match[1];

  assert.match(script, /function activeFilterCount\(\)\{return detailCount\(\)\+\(state\.trendRaceScope&&state\.trendRaceScope!=='all'\?1:0\)\}/);
  assert.match(script, /function trendPageControls\(\)\{const count=activeFilterCount\(\)/);
  assert.match(script, /trend-filter-count/);
  assert.match(script, /id="trendRaceScopeSelect"/);
  assert.match(script, /<label>Loppnivå<\/label><select id="trendRaceScopeSelect"/);
  assert.doesNotMatch(script, /data-trend-scope/);
});

test('Trend reset clears Loppnivå and every detail filter in the canonical Trend handler', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  const match = html.match(/<script id="kentaurai-trend-build-a-script">([\s\S]*?)<\/script>/);
  assert.ok(match);
  const script = match[1];

  assert.match(html, />Återställ filter<\/button>/);
  assert.match(script, /reset\.onclick=\(\)=>\{state\.trendRaceScope='all';state\.trendDetailFilters=\{trackId:'all',raceType:'all',breedType:'all',startMethod:'all',minStarts:'all'\};renderTrendBuildA\(\)\}/);
});

test('horse Trend uses existing Form as the primary metric and shows recent results', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  assert.match(html, /state\.trendCategory==='horses'\?'Starkast form':'Högst segerprocent'/);
  assert.match(html, /trend-score-label">Form/);
  assert.match(html, /item\.formScore/);
  assert.match(html, /item\.recentResults\.join\('–'\)/);
  assert.match(html, /metricPill\('Seger %'/);
  assert.match(html, /metricPill\('Topp 3 %'/);
});

test('Trend ranking rows remove repeated win label and preserve full prize-money space', () => {
  const html = enhanceTrendHtml('<html><head></head><body></body></html>');
  assert.doesNotMatch(html, /trend-win-label/);
  assert.doesNotMatch(html, />Seger%<\/span>/);
  assert.match(html, /grid-template-columns:minmax\(0,\.9fr\) minmax\(0,\.9fr\) minmax\(0,1\.45fr\)/);
  assert.match(html, /\.trend-metric-pill:last-child strong\{[^}]*overflow:visible[^}]*text-overflow:clip/);
  assert.match(html, /\.trend-win-block\{[^}]*align-items:center[^}]*padding:0 10px/);
});
