import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-settings.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import {
  PRESENTATION_OTHER_LONG_DISTANCE_GROUP,
  presentationDistanceGroup,
  presentationGroupDistanceRows
} from '../src/app-page-presentation-v2.js';
import {
  presentationFeatureLabel,
  presentationQualityLabel,
  presentationShoeLabel,
  renderAppPage
} from '../src/app-page-localization.js';
import { createTestEnv } from './helpers/d1.js';

test('long distances use canonical groups and one remaining long-distance bucket', () => {
  assert.equal(presentationDistanceGroup(2640), '2640');
  assert.equal(presentationDistanceGroup(2740), '2640');
  assert.equal(presentationDistanceGroup(2800), PRESENTATION_OTHER_LONG_DISTANCE_GROUP);
  assert.equal(presentationDistanceGroup(2880), PRESENTATION_OTHER_LONG_DISTANCE_GROUP);
  assert.equal(presentationDistanceGroup(3000), PRESENTATION_OTHER_LONG_DISTANCE_GROUP);
  assert.equal(presentationDistanceGroup(3040), '3140');
  assert.equal(presentationDistanceGroup(3140), '3140');
  assert.equal(presentationDistanceGroup(3240), '3140');
  assert.equal(presentationDistanceGroup(3540), '3640');
  assert.equal(presentationDistanceGroup(3640), '3640');
  assert.equal(presentationDistanceGroup(4040), '4140');
  assert.equal(presentationDistanceGroup(4140), '4140');
  assert.equal(presentationDistanceGroup(4300), PRESENTATION_OTHER_LONG_DISTANCE_GROUP);
});

test('long-distance grouping recalculates rates after aggregation', () => {
  const grouped = presentationGroupDistanceRows([
    { label: '2880', starts: 2, resultStarts: 2, wins: 1, top3: 1, gallops: 1 },
    { label: '3000', starts: 3, resultStarts: 3, wins: 0, top3: 2, gallops: 0 },
    { label: '3140', starts: 4, resultStarts: 4, wins: 1, top3: 2, gallops: 1 }
  ]);
  const other = grouped.find((row) => row.label === PRESENTATION_OTHER_LONG_DISTANCE_GROUP);
  assert.equal(other.starts, 5);
  assert.equal(other.wins, 1);
  assert.equal(other.top3, 3);
  assert.equal(other.gallops, 1);
  assert.equal(other.winRate, 1 / 5);
  assert.equal(other.top3Rate, 3 / 5);
  assert.equal(other.gallopRate, 1 / 5);
});

test('final localization maps current technical values to natural Swedish', () => {
  assert.equal(presentationShoeLabel('shod', false), 'Med skor');
  assert.equal(presentationShoeLabel('barefoot', true), 'Barfota');
  assert.equal(presentationShoeLabel(null, 0), 'Med skor');
  assert.equal(presentationShoeLabel(null, 1), 'Barfota');
  assert.equal(presentationQualityLabel('sufficient'), 'God');
  assert.equal(presentationQualityLabel('limited'), 'Begränsad');
  assert.equal(presentationFeatureLabel('form_starts_5'), 'Starter – senaste 5');
  assert.equal(presentationFeatureLabel('class_target_first_prize'), 'Förstapris i aktuellt lopp');
  assert.equal(presentationFeatureLabel('development_top3_rate_delta'), 'Förändring i topp 3-andel');
});

test('rendered app contains the requested natural Swedish presentation', () => {
  const html = renderAppPage();
  assert.doesNotMatch(html, /\(i år\)/);
  assert.doesNotMatch(html, /\(förra året\)/);
  assert.match(html, /new Date\(\)\.getFullYear\(\)/);
  assert.match(html, /Kommande/);
  assert.match(html, /Diskad/);
  assert.match(html, /Struken/);
  assert.match(html, /Rapporterad/);
  assert.match(html, /Med skor/);
  assert.match(html, /Barfota/);
  assert.match(html, /Senast uppdaterat/);
  assert.match(html, /Beräknade nyckeltal/);
  assert.match(html, /Vinnarodds/);
  assert.match(html, /Platsodds/);
  assert.match(html, /Startposition/);
  assert.match(html, /Övrigt >2640/);
  assert.match(html, /Starter – senaste 5/);
  assert.match(html, /Marknadsblind/);
  assert.match(html, /Värdekvot/);
  assert.match(html, /\.settings-button\{top:5px!important/);
});

test('all JavaScript in the final localized app remains syntactically valid', () => {
  const html = renderAppPage();
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const script of scripts) assert.doesNotThrow(() => new vm.Script(script));
});

test('settings wrapper does not swallow the reserved game summary route', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES ('round_summary','V85','2099-01-03','upcoming')`).run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system_summary','round_summary','main',200,120,3,'2099-01-03T10:00:00Z')`).run();
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/api/games/summary', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.all.rounds, 1);
  assert.equal(data.savedSystems, 1);
});
