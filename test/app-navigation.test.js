import test from 'node:test';
import assert from 'node:assert/strict';

import { groupDistanceRows, renderAppPage, standardDistanceGroup } from '../src/app-page-navigation.js';

test('standard distance grouping folds nearby variants into canonical race distances', () => {
  assert.equal(standardDistanceGroup(1609), '1640');
  assert.equal(standardDistanceGroup(1620), '1640');
  assert.equal(standardDistanceGroup(1640), '1640');
  assert.equal(standardDistanceGroup(2100), '2140');
  assert.equal(standardDistanceGroup(2120), '2140');
  assert.equal(standardDistanceGroup(2148), '2140');
  assert.equal(standardDistanceGroup(2160), '2140');
  assert.equal(standardDistanceGroup(2620), '2640');
  assert.equal(standardDistanceGroup(2640), '2640');
  assert.equal(standardDistanceGroup(3140), '3140');
  assert.equal(standardDistanceGroup(3600), '3600');
  assert.equal(standardDistanceGroup('unknown'), 'unknown');
});

test('distance rows aggregate counts before recalculating rates', () => {
  const grouped = groupDistanceRows([
    { label: '2140', starts: 54, resultStarts: 54, wins: 9, top3: 12, gallops: 6 },
    { label: '2148', starts: 4, resultStarts: 4, wins: 0, top3: 1, gallops: 1 },
    { label: '2120', starts: 1, resultStarts: 1, wins: 0, top3: 1, gallops: 0 },
    { label: '1640', starts: 20, resultStarts: 20, wins: 1, top3: 5, gallops: 2 },
    { label: '1609', starts: 4, resultStarts: 4, wins: 0, top3: 0, gallops: 1 }
  ]);

  const middle = grouped.find((row) => row.label === '2140');
  assert.deepEqual(middle, {
    label: '2140',
    starts: 59,
    resultStarts: 59,
    wins: 9,
    top3: 14,
    gallops: 7,
    winRate: 9 / 59,
    top3Rate: 14 / 59,
    gallopRate: 7 / 59
  });

  const short = grouped.find((row) => row.label === '1640');
  assert.equal(short.starts, 24);
  assert.equal(short.wins, 1);
  assert.equal(short.top3, 5);
  assert.equal(short.gallops, 3);
  assert.equal(short.gallopRate, 3 / 24);
});

test('rendered app shell has a borderless data-only settings gear and in-app history support for Analysis', () => {
  const html = renderAppPage();
  assert.match(html, /id="settingsButton"/);
  assert.match(html, /\.settings-button\{[^}]*border:0!important[^}]*background:transparent!important/);
  assert.match(html, /history\.pushState/);
  assert.match(html, /history\.replaceState/);
  assert.match(html, /window\.addEventListener\('popstate'/);
  assert.match(html, /history\.back\(\)/);
  assert.match(html, /SWIPE_EDGE_PX=24,SWIPE_TRIGGER_PX=72,SWIPE_MAX_VISUAL_PX=46/);
  assert.match(html, /document\.addEventListener\('touchstart'/);
  assert.match(html, /document\.addEventListener\('touchmove'[\s\S]*\{passive:false\}/);
  assert.match(html, /if\(shouldBack\)history\.back\(\)/);
  assert.match(html, /translate3d\('\+visual\+'px,0,0\)'/);
  assert.match(html, /input,select,textarea,\[contenteditable="true"\],\[data-no-back-swipe\]/);
  assert.match(html, /settingsTab:state\.settingsTab\|\|'data'/);
  assert.match(html, /state\.settingsTab='data'/);
  assert.match(html, /view\.page==='analysis'/);
  assert.match(html, /__kentauraiAnalysis/);
  assert.match(html, /async function openGameDetail\(id,systemId=null\)/);
  assert.match(html, /if\(systemId\)state\.gameSystemId=systemId;state\.gameDetail=id/);
  assert.match(html, /if\(!state\.gameSystemId\|\|!data\.systems\.some\(s=>s\.id===state\.gameSystemId\)\)state\.gameSystemId=data\.systems\[0\]\?\.id\|\|null/);
  assert.match(html, /groupDistanceRows/);
});
