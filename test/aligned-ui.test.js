import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { renderAppPage } from '../src/app-page-aligned.js';

test('final aligned app adds Bana as the sixth bottom-navigation area', () => {
  const html = renderAppPage();
  assert.match(html, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(html, /data-page=\\"tracks\\"/);
  assert.match(html, /button\.innerHTML=TRACK_ICON\+'Bana'/);
  assert.match(html, /M12 21s6-5\.2 6-11/);
  assert.match(html, /ellipse cx=\\"12\\" cy=\\"10\\"/);
});

test('horse detail uses one compact expandable Starter history instead of a duplicate equipment tab', () => {
  const html = renderAppPage();
  assert.match(html, /if\(type==='horse'\)return \[\['stats','Statistik'\],\['starts','Starter'\],\['data','Data'\]\]/);
  assert.match(html, /Kommande lopp/);
  assert.match(html, /Tidigare starter/);
  assert.match(html, /<div>Datum<\/div><div>Lopp<\/div><div>Resultat<\/div><div>Skor<\/div><div>Vagn<\/div>/);
  assert.match(html, /priorAlignedStartCards\(detail\)/);
  assert.match(html, /querySelectorAll\('\.start-card'\)/);
  assert.match(html, /querySelector\('\.start-details'\)/);
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
  assert.match(html, /\.stat-filter-table th:not\(:first-child\),\.stat-filter-table td:not\(:first-child\)\{width:14\.6%!important;text-align:right!important\}/);
});

test('Bana detail contains the aligned overview, lane-statistics and home-trainer areas', () => {
  const html = renderAppPage();
  assert.match(html, /\['overview','Översikt'\],\['lanes','Spårstatistik'\],\['home','Hemmatränare'\]/);
  assert.match(html, /Banprofil/);
  assert.match(html, /Datatäckning/);
  assert.match(html, /Startnoteringar/);
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
