import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { renderAppPage } from '../src/app-page-aligned.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import worker from '../src/worker-v078.js';
import { createTestEnv } from './helpers/d1.js';

function primaryNavigationRuntime(html) {
  const match = html.match(/function alignPrimaryNavigation\(\)\{[\s\S]*?inner\.innerHTML=([\s\S]*?);\n\s*inner\.querySelector\('\[data-page="start"\]'\)/);
  assert.ok(match, 'primary navigation runtime should be present');
  return match[1];
}

test('primary bottom navigation is Trend, Statistik, Analys and Spel', () => {
  const html = renderAppPage();
  const runtimeNav = primaryNavigationRuntime(html);
  const pages = [...runtimeNav.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]);

  assert.match(html, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.deepEqual(pages, ['start', 'statistics', 'analysis', 'games']);
  assert.match(runtimeNav, /Trend<\/button>/);
  assert.match(runtimeNav, /Statistik<\/button>/);
  assert.match(runtimeNav, /Analys<\/button>/);
  assert.match(runtimeNav, /Spel<\/button>/);
  assert.doesNotMatch(runtimeNav, /data-page="(?:trainers|horses|drivers|tracks)"/);
  assert.doesNotMatch(html, /addTrackNavigation\(\)/);
});

test('four-item bottom navigation keeps icons and labels legible and centered responsively', () => {
  const html = renderAppPage();
  assert.match(html, /\.bottom-inner\{width:100%!important;max-width:720px!important;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important;gap:6px!important;align-items:center!important\}/);
  assert.match(html, /\.nav-item\{min-width:0!important;min-height:70px!important;[^}]*font-size:13px!important;[^}]*display:flex!important;[^}]*justify-content:center!important;[^}]*gap:7px!important\}/);
  assert.match(html, /\.nav-icon\{width:27px!important;height:27px!important;margin:0!important/);
  assert.match(html, /@media\(max-width:760px\)\{[^}]*\.shell\{padding-bottom:calc\(110px \+ env\(safe-area-inset-bottom\)\)!important\}[^}]*\.bottom-nav\{padding-top:9px!important;padding-bottom:calc\(9px \+ env\(safe-area-inset-bottom\)\)!important\}/);
  assert.match(html, /\.nav-item\{min-height:72px!important;padding:9px 2px 8px!important;border-radius:15px!important;font-size:13px!important;line-height:1\.1!important;gap:7px!important\}/);
  assert.match(html, /\.nav-icon\{width:28px!important;height:28px!important;margin:0!important\}/);
  assert.match(html, /@media\(max-width:420px\)/);
  assert.match(html, /\.nav-item\{min-height:68px!important;font-size:12px!important;gap:6px!important\}/);
  assert.match(html, /\.nav-icon\{width:26px!important;height:26px!important\}/);
});

test('statistics navigation uses the unified muted Trend-style category tabs', () => {
  const html = renderAppPage();
  assert.match(html, /class="statistics-category-nav"/);
  assert.match(html, /\['trainers','Tränare'\],\['horses','Hästar'\],\['drivers','Kuskar'\],\['tracks','Bana'\]/);
  assert.match(html, /\.statistics-category-nav\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\);height:40px;background:#11110f;border:1px solid var\(--line\);border-radius:10px;overflow:hidden;margin-bottom:22px\}/);
  assert.match(html, /\.statistics-category-btn\{[^}]*border-right:1px solid var\(--line\)[^}]*height:100%[^}]*display:flex[^}]*justify-content:center/);
  assert.match(html, /\.statistics-category-btn\.active\{background:#b7ac9c;color:#1a1713\}/);
  assert.doesNotMatch(html, /\.statistics-category-btn\.active\{[^}]*box-shadow:inset 0 -2px 0 var\(--accent\)/);
  assert.match(html, /app\.insertAdjacentHTML\('afterbegin',statisticsCategoryNav\(state\.page\)\)/);
  assert.match(html, /STATISTICS_PAGES\.includes\(state\.page\)&&!state\.settingsOpen&&!state\.detail&&!state\.trackDetail/);
  assert.match(html, /aria-label="Statistikområden"/);
  assert.match(html, /aria-current="page"/);
});

test('bottom navigation reuses Trend and uses approved Table, Magnifying Glass and Currency Circle Dollar icons', () => {
  const html = renderAppPage();
  const runtimeNav = primaryNavigationRuntime(html);
  assert.match(html, /const startIcon=inner\.querySelector\('\[data-page="start"\] \.nav-icon'\)\?\.outerHTML\|\|''/);
  assert.match(runtimeNav, /startIcon\+'Trend/);
  assert.match(html, /M229\.66,218\.34l-50\.07-50\.06/);
  assert.doesNotMatch(runtimeNav, /icon\(/);
  assert.match(html, /M224,48H32a8,8,0,0,0-8,8V192/);
  assert.match(html, /M128,24A104,104,0,1,0,232,128/);
  assert.match(html, /A28,28,0,0,1,168,148Z/);
});

test('statistics selector is scoped away from Settings, Analysis and detail views', () => {
  const html = renderAppPage();
  assert.match(html, /const shouldShow=STATISTICS_PAGES\.includes\(state\.page\)&&!state\.settingsOpen&&!state\.detail&&!state\.trackDetail/);
  assert.match(html, /state\.page='analysis'/);
  assert.match(html, /async function renderSettings\(\)\{state\.settingsOpen=true/);
  assert.match(html, /window\.__kentauraiAnalysis=\{render:renderAnalysis\}/);
});

test('statistics category state follows entity and track navigation while bottom active state stays grouped', () => {
  const html = renderAppPage();
  assert.match(html, /priorAlignedSetNav\(STATISTICS_PAGES\.includes\(page\)\?'statistics':page\)/);
  assert.match(html, /state\.statisticsPage=page/);
  assert.match(html, /const page=STATISTICS_PAGES\.includes\(state\.statisticsPage\)\?state\.statisticsPage:'horses'/);
  assert.match(html, /if\(page==='tracks'\)renderTracks\(\);else renderEntityList\(page\)/);
  assert.match(html, /else\{state\.tab='list';renderEntityList\(page\);\}/);
});

test('full production-composed app keeps the grouped primary navigation after later wrappers', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';', 1)[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env, {});
  assert.equal(response.status, 200);
  const html = await response.text();
  const runtimeNav = primaryNavigationRuntime(html);
  const pages = [...runtimeNav.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(pages, ['start', 'statistics', 'analysis', 'games']);
  assert.match(runtimeNav, /startIcon\+'Trend/);
  assert.match(runtimeNav, /data-page="analysis"/);
  assert.doesNotMatch(runtimeNav, /icon\(/);
  assert.doesNotMatch(runtimeNav, /data-page="(?:trainers|horses|drivers|tracks)"/);
  assert.match(html, /id="kentaurai-performance-v1-script"/);
  assert.match(html, /id="kentaurai-upcoming-games-v1-script"/);
  assert.match(html, /id="kentaurai-mobile-layout-polish-v104"/);
  assert.match(html, /\.bottom-inner\{width:100%!important;max-width:none!important;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)!important;gap:4px!important;align-items:center!important\}/);
  assert.match(html, /\.nav-item\{min-width:0!important;min-height:72px!important;font-size:13px!important;font-weight:600!important;[^}]*justify-content:center!important;gap:7px!important;overflow:visible!important\}/);
  assert.match(html, /\.nav-icon\{width:28px!important;height:28px!important;margin:0!important;flex:0 0 auto!important\}/);
  assert.ok(html.indexOf('kentaurai-mobile-layout-polish-v104') > html.indexOf('kentaurai-aligned-ui-v063'), 'final mobile polish must come after aligned UI');
  assert.match(html, /const gamesNav=document\.querySelector\('\.nav-item\[data-page="games"\]'\)/);
  assert.doesNotMatch(html, /addTrackNavigation\(\)/);
});

test('aligned application scripts remain valid JavaScript', () => {
  const html = renderAppPage();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
