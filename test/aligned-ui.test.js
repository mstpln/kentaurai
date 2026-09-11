import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { renderAppPage } from '../src/app-page-aligned.js';

test('final aligned app adds Bana as the sixth bottom-navigation area', () => {
  const html = renderAppPage();
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(html, /button\.dataset\.page='tracks'/);
  assert.match(html, /button\.innerHTML=TRACK_ICON\+'Bana'/);
  assert.match(html, /M12 21s6-5\.2 6-11/);
});

test('horse detail uses one compact expandable Starter history instead of a duplicate equipment tab', () => {
  const html = renderAppPage();
  assert.match(html, /if\(type==='horse'\)return \[\['stats','Statistik'\],\['starts','Starter'\],\['data','Data'\]\]/);
  assert.match(html, /Kommande lopp/);
  assert.match(html, /Tidigare starter/);
  assert.match(html, /priorAlignedStartCards\(detail\)/);
  assert.match(html, /querySelectorAll\('\.start-card'\)/);
  assert.doesNotMatch(html, /return \[\['stats','Statistik'\],\['starts','Starter'\],\['equipment','Utrustning'\],\['data','Data'\]\];return priorAlignedDetailTabs/);
});

test('settings statuses use a dedicated labelled bottom row with words rather than standalone symbols', () => {
  const html = renderAppPage();
  assert.match(html, /settings-row-status/);
  assert.match(html, /settings-row-status-label/);
  assert.match(html, /label\.textContent='Status'/);
  assert.match(html, /success:'Klar'/);
  assert.match(html, /running:'Pågår'/);
  assert.match(html, /warning:'Varning'/);
  assert.match(html, /error:'Fel'/);
});

test('mobile entity statistic tables fit all six columns without horizontal scrolling', () => {
  const html = renderAppPage();
  assert.match(html, /\.stat-table-scroll\{overflow-x:visible!important\}/);
  assert.match(html, /\.stat-filter-table\{width:100%!important;table-layout:fixed!important\}/);
  assert.match(html, /white-space:nowrap!important/);
});

test('Bana detail owns STL and race-type filters in the canonical lane flow', () => {
  const html = renderAppPage();
  assert.match(html, /\['overview','Översikt'\],\['lanes','Spårstatistik'\],\['home','Hemmatränare'\]/);
  assert.match(html, /STL-klass/);
  assert.match(html, /Lopptyp/);
  assert.match(html, /Alla STL-klasser/);
  assert.match(html, /Alla lopptyper/);
  assert.match(html, /stlClass:'all',raceType:'all'/);
  assert.match(html, /data-canonical-track-class-filters="true"/);
  assert.match(html, /if\(f\.stlClass!=='all'\)q\.set\('stl_class',f\.stlClass\)/);
  assert.match(html, /if\(f\.raceType!=='all'\)q\.set\('race_type',f\.raceType\)/);
  assert.match(html, /f\.stlClass=s\.value;trackLaneView\(detail\)/);
  assert.match(html, /f\.raceType=s\.value;trackLaneView\(detail\)/);
  assert.match(html, /\[\['all','All data'\]/);
  assert.doesNotMatch(html, /Alla år/);
  assert.doesNotMatch(html, /Alla startmetoder/);
});

test('Bana overview localizes Sweden and renders contact facts only when present with HTTPS defense in depth', () => {
  const html = renderAppPage();
  assert.match(html, /SE:'Sverige'/);
  assert.match(html, /trackCountry\(detail\.countryCode\)/);
  assert.match(html, /Kontakt & plats/);
  assert.match(html, /Öppna hemsida ↗/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /url\.protocol==='https:'/);
  assert.match(html, /if\(!address&&!website\)return ''/);
});

test('Bana detail retains statistics and home trainer behavior', () => {
  const html = renderAppPage();
  assert.match(html, /Spår<\/th><th>Starter<\/th><th>Vinst %<\/th><th>Topp 3 %<\/th><th>Galopp %/);
  assert.match(html, /Autostart/);
  assert.match(html, /Voltstart/);
  assert.match(html, /resultatsatta starter ligger bakom procentsatserna/);
  assert.match(html, /senaste verifierade officiella tränarobservationen/);
  assert.doesNotMatch(html, /Hemmahästar/);
  assert.doesNotMatch(html, /Hemmakuskar/);
});

test('all browser JavaScript in the aligned app is syntactically valid', () => {
  const html = renderAppPage();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});
