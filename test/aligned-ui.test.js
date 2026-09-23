import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import { formatTrackAddress, renderAppPage } from '../src/app-page-aligned.js';

test('final aligned app uses four primary workspaces and keeps entity browsing grouped under Statistik', () => {
  const html = renderAppPage();
  assert.match(html, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html, /data-page="analysis"/);
  assert.match(html, /Trend<\/button>/);
  assert.match(html, /Analys<\/button>/);
  assert.match(html, /data-page="statistics"/);
  assert.match(html, /statisticsCategoryNav/);
  assert.match(html, /\['trainers','Tränare'\],\['horses','Hästar'\],\['drivers','Kuskar'\],\['tracks','Bana'\]/);
  assert.match(html, /M12 21s6-5\.2 6-11/);
  assert.match(html, /M229\.66,218\.34l-50\.07-50\.06/);
  assert.match(html, /STATISTICS_PAGES\.includes\(state\.page\)&&!state\.settingsOpen&&!state\.detail&&!state\.trackDetail/);
});

test('horse detail uses one compact expandable Starter history instead of a duplicate equipment tab', () => {
  const html = renderAppPage();
  assert.match(html, /if\(type==='horse'\)return \[\['stats','Statistik'\],\['external_stats','Extern statistik'\],\['interviews','Intervjuer'\],\['starts','Starter'\],\['data','Data'\]\]/);
  assert.match(html, /Kommande lopp/);
  assert.match(html, /Tidigare starter/);
  assert.match(html, /priorAlignedStartCards\(detail\)/);
  assert.match(html, /querySelectorAll\('\.start-card'\)/);
  assert.doesNotMatch(html, /priorAlignedDetailTabs/);
});

test('settings statuses use a dedicated labelled bottom row with words rather than standalone symbols', () => {
  const html = renderAppPage();
  assert.match(html, /settings-row-status/);
  assert.match(html, /settings-row-status-label/);
  assert.match(html, /label\.textContent='Status'/);
  assert.match(html, /success:'Klar'/);
  assert.match(html, /running:'Pågår'/);
  assert.match(html, /warning:'Fel upptäckt'/);
  assert.match(html, /error:'Fel upptäckt'/);
  assert.match(html, /unknown:'Ingen körning ännu'/);
  assert.match(html, /never_run:'Ingen körning ännu'/);
  assert.match(html, /waiting:'Väntar'/);
  assert.match(html, /completed:'Klar'/);
  assert.match(html, /error_retrying:'Fel upptäckt'/);
  assert.match(html, /action_required:'Åtgärd krävs'/);
});

test('mobile entity statistic tables fit all six columns without horizontal scrolling', () => {
  const html = renderAppPage();
  assert.match(html, /\.stat-table-scroll\{overflow-x:visible!important\}/);
  assert.match(html, /\.stat-filter-table\{width:100%!important;table-layout:fixed!important\}/);
  assert.match(html, /white-space:nowrap!important/);
});

test('Bana Spårstatistik follows the canonical filter icon and dropdown interaction', () => {
  const html = renderAppPage();
  assert.match(html, /\['overview','Banprofil'\],\['analysis','Bananalys'\],\['lanes','Spårstatistik'\],\['home','Hemmatränare'\]/);
  assert.match(html, /startMethod:'all',raceScope:'all'/);
  assert.match(html, /TRACK_FILTER_ICON/);
  assert.match(html, /id="trackFilterToggle"/);
  assert.match(html, /aria-label="Detaljfilter"/);
  assert.match(html, /track-stats-filter-count/);
  assert.match(html, /track-stats-period/);
  assert.match(html, /data-track-year/);
  assert.match(html, /trackFilterField\('Startmetod'/);
  assert.match(html, /Loppnivå/);
  assert.match(html, /\[\['all','All data'\],\['high_prize','Högre prissumma'\],\['weekday','Vardagstrav'\]\]/);
  assert.match(html, /STL-klass/);
  assert.match(html, /Lopptyp/);
  assert.match(html, /Alla STL-klasser/);
  assert.match(html, /Alla lopptyper/);
  assert.match(html, /data-canonical-track-class-filters="true"/);
  assert.match(html, /document\.querySelectorAll\('\[data-track-race-scope\]'\)\.forEach\(s=>s\.onchange/);
  assert.match(html, /document\.querySelectorAll\('\[data-track-distance\]'\)\.forEach\(s=>s\.onchange/);
  assert.match(html, /if\(f\.stlClass!=='all'\)q\.set\('stl_class',f\.stlClass\)/);
  assert.match(html, /if\(f\.raceType!=='all'\)q\.set\('race_type',f\.raceType\)/);
  assert.doesNotMatch(html, /trackFilterButtons/);
});

test('Bana profile keeps physical facts separate from the dedicated Bananalys tab', () => {
  const html = renderAppPage();
  assert.match(html, /\['overview','Banprofil'\],\['analysis','Bananalys'\]/);
  assert.doesNotMatch(html, /\\.track-analysis-empty\\{/);
  assert.match(html, /trackFactBlock\('Grundmått'/);
  assert.match(html, /trackFactBlock\('Start & bredd'/);
  assert.match(html, /trackFactBlock\('Till första sväng'/);
  assert.match(html, /trackFactBlock\('Kurvradier'/);
  assert.match(html, /trackFactBlock\('Dosering'/);
  assert.match(html, /Beräknat/);
  assert.match(html, /Verifierat/);
  assert.match(html, /Datagrund/);
  assert.match(html, /M20 20v-7a4 4 0 0 0-4-4H4/);
  assert.doesNotMatch(html, /↩ <span>Banor<\/span>/);
  assert.doesNotMatch(html, /Banan i korthet/);
  assert.doesNotMatch(html, /\["Underlag",p\.surface\]/);
});


test('Bana Bananalys uses the agreed compact filters, winner focus and analysis evidence', () => {
  const html = renderAppPage();
  assert.match(html, /trackAnalysisFilterToggle/);
  assert.match(html, /TRACK_FILTER_ICON/);
  assert.match(html, /data-track-analysis-method/);
  assert.match(html, /data-track-analysis-distance/);
  assert.match(html, /track-analysis-filter-stack/);
  assert.match(html, /Start & första position/);
  assert.match(html, /Spets, 200 m/);
  assert.match(html, /Topp 3, 200 m/);
  assert.match(html, /Spets vs\. snittet/);
  assert.doesNotMatch(html, /Medianpos\./);
  assert.doesNotMatch(html, /Mot baseline/);
  assert.match(html, /Löpningsscenario & vinnarprofil/);
  assert.match(html, /Seger %/);
  assert.match(html, /Andel vinnare/);
  assert.match(html, /Vinst vs\. snittet/);
  assert.doesNotMatch(html, /<th>Förekomst<\/th>/);
  assert.doesNotMatch(html, /<th>Topp 3 %<\/th>/);
  assert.doesNotMatch(html, /<th>Baseline<\/th>/);
  assert.match(html, /Analysunderlag/);
  assert.match(html, /200 m täckning/);
  assert.match(html, /Vinnarscenario/);
  assert.match(html, /Breddat underlag/);
  assert.match(html, /track-analysis-copy:before/);
  assert.match(html, /Bananalysen kunde inte läsas just nu/);
  assert.match(html, /current\.startMethod!==requestMethod/);
  assert.match(html, /current\.distanceGroup!==requestDistance/);
  assert.doesNotMatch(html, /Exakt kombination/);
  assert.doesNotMatch(html, /Startgalopp/);
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

test('track address formatting removes duplicate city components before appending postal city', () => {
  assert.equal(
    formatTrackAddress({ address: { street: 'Travvägen 1, Malmö', postalCode: '212 00' }, city: 'Malmö' }),
    'Travvägen 1, 212 00 Malmö'
  );
  assert.equal(
    formatTrackAddress({ address: { street: 'Travvägen 1, 212 00 Malmö', postalCode: '212 00' }, city: 'Malmö' }),
    'Travvägen 1, 212 00 Malmö'
  );
  assert.equal(
    formatTrackAddress({ address: { street: 'Travvägen 1', postalCode: null }, city: 'Malmö' }),
    'Travvägen 1, Malmö'
  );
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
