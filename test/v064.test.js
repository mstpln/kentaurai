import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { enhanceAppHtmlV064 } from '../src/app-v064-overlay.js';
import { buildAnalysisImportPrompt, recommendedAnalysisFilename } from '../src/analysis-import-prompt.js';
import { classifyRace, matchesRaceClassification } from '../src/race-classification.js';
import { getTrackDetailV064, getTrackLaneStatsV064 } from '../src/routes/tracks-v064.js';
import { createTestEnv } from './helpers/d1.js';

function seedClassifiedTrack(db) {
  db.prepare(`INSERT INTO tracks (
    id, canonical_name, city, country_code, street_address, postal_code, website_url
  ) VALUES ('track-v064','Testbanan','Teststad','SE','Testvägen 1','123 45','https://example.test/track')`).run();

  const races = [
    ['r-silver-sto', '2026-06-01', 'Silverdivisionen', ['Stolopp', 'Spårtrappa']],
    ['r-silver-open', '2026-06-02', 'Silverdivisionen', ['Spårtrappa']],
    ['r-bronze-sto', '2026-06-03', 'Bronsdivisionen', ['Stolopp']],
    ['r-class-i', '2026-06-04', 'Klass I', ['Lärlingslopp']]
  ];
  let horse = 0;
  for (const [raceId, date, mainClass, flags] of races) {
    db.prepare(`INSERT INTO races (
      id, track_id, race_date, race_number, distance_m, start_method, main_class, class_flags_json, status
    ) VALUES (?, 'track-v064', ?, 1, 2140, 'auto', ?, ?, 'results')`).run(raceId, date, mainClass, JSON.stringify(flags));
    for (let lane = 1; lane <= 2; lane += 1) {
      horse += 1;
      const horseId = `h-${horse}`;
      const entryId = `e-${horse}`;
      db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?, ?)').run(horseId, `Häst ${horse}`);
      db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_lane, scratched)
        VALUES (?, ?, ?, ?, ?, 0)`).run(entryId, raceId, horseId, lane, lane);
      db.prepare(`INSERT INTO race_results (race_entry_id, placing, gallop, result_status)
        VALUES (?, ?, ?, 'official')`).run(entryId, lane, lane === 2 ? 1 : 0);
    }
  }
}

test('race classification separates Loppklass, STL-klass and Lopptyp', () => {
  const race = classifyRace({ mainClass: 'Silverdivisionen', classFlags: ['Stolopp', 'Spårtrappa', 'Gr I'] });
  assert.equal(race.raceClass, 'Silverdivisionen');
  assert.equal(race.stlClass, 'silver');
  assert.deepEqual(race.raceTypes.sort(), ['lane_ladder', 'mares']);
  assert.equal(matchesRaceClassification({ mainClass: 'Silverdivisionen', classFlags: ['Stolopp'] }, { stlClass: 'silver', raceType: 'mares' }), true);
  assert.equal(matchesRaceClassification({ mainClass: 'Bronsdivisionen', classFlags: ['Stolopp'] }, { stlClass: 'silver', raceType: 'mares' }), false);
  assert.equal(classifyRace({ raceName: 'Silverdivisionen - Stolopp' }).stlClass, 'silver');
  assert.deepEqual(classifyRace({ raceName: 'Silverdivisionen - Stolopp' }).raceTypes, ['mares']);
});

test('track detail exposes optional verified address and HTTPS website fields', async () => {
  const { env, db } = createTestEnv();
  seedClassifiedTrack(db);
  let detail = await getTrackDetailV064(env, 'track-v064');
  assert.equal(detail.address.street, 'Testvägen 1');
  assert.equal(detail.address.postalCode, '123 45');
  assert.equal(detail.websiteUrl, 'https://example.test/track');

  db.prepare("UPDATE tracks SET website_url='javascript:alert(1)' WHERE id='track-v064'").run();
  detail = await getTrackDetailV064(env, 'track-v064');
  assert.equal(detail.websiteUrl, null);
});

test('lane statistics combine persisted STL-class and race-type filters with existing filters', async () => {
  const { env, db } = createTestEnv();
  seedClassifiedTrack(db);

  assert.equal(db.prepare("SELECT stl_class FROM race_stl_classifications WHERE race_id='r-silver-sto'").get().stl_class, 'silver');
  assert.deepEqual(
    db.prepare("SELECT race_type FROM race_type_classifications WHERE race_id='r-silver-sto' ORDER BY race_type").all().map((row) => row.race_type),
    ['lane_ladder', 'mares']
  );

  const all = await getTrackLaneStatsV064(env, 'track-v064', {
    year: '2026', startMethod: 'auto', distanceGroup: '2140'
  });
  assert.equal(all.totals.starts, 8);

  const silver = await getTrackLaneStatsV064(env, 'track-v064', {
    year: '2026', startMethod: 'auto', distanceGroup: '2140', stlClass: 'silver'
  });
  assert.equal(silver.totals.starts, 4);

  const silverMares = await getTrackLaneStatsV064(env, 'track-v064', {
    year: '2026', startMethod: 'auto', distanceGroup: '2140', stlClass: 'silver', raceType: 'mares'
  });
  assert.equal(silverMares.totals.starts, 2);
  assert.equal(silverMares.filters.stlClass, 'silver');
  assert.equal(silverMares.filters.raceType, 'mares');
});

test('analysis import prompt mirrors strict pre-market and final API rules', () => {
  const prompt = buildAnalysisImportPrompt('anthropic');
  assert.match(prompt, /kentaurai-analysis-v1/);
  assert.match(prompt, /EXAKT 3 spikavdelningar/);
  assert.match(prompt, /context_fingerprint/);
  assert.match(prompt, /parent_submission_id/);
  assert.match(prompt, /market_percent/);
  assert.match(prompt, /value_ratio/);
  assert.match(prompt, /own_probability/);
  assert.match(prompt, /Returnera endast giltig JSON/);
  assert.match(prompt, /data_snapshot_at får INTE finnas/);
  assert.match(prompt, /legs får inte finnas i final-filen/);
  assert.match(prompt, /gemena a-z, siffror och enkla bindestreck/);
  assert.match(prompt, /producer\.model är obligatoriskt/);
  assert.match(prompt, /producer\.provider måste vara exakt "anthropic"/);
  assert.equal(recommendedAnalysisFilename('anthropic'), 'kentaurai-analysis_anthropic_ÅÅÅÅ-MM-DD.json');
  assert.equal(recommendedAnalysisFilename('claude'), 'kentaurai-analysis_anthropic_ÅÅÅÅ-MM-DD.json');
});

test('v0.6.4 app overlay contains compact class filters, natural Swedish and import-prompt control', () => {
  const html = enhanceAppHtmlV064('<html><head></head><body><div id="app"></div></body></html>');
  assert.match(html, /STL-klass/);
  assert.match(html, /Alla STL-klasser/);
  assert.match(html, /Alla lopptyper/);
  assert.match(html, /Alla år/);
  assert.match(html, /Alla startmetoder/);
  assert.match(html, /Skapa V85\/V86-systemanalysfil för import/);
  assert.match(html, /Kopiera instruktioner till AI/);
  assert.match(html, /V85\/V86-omgångar/);
  assert.match(html, /Missad spik/);
  assert.match(html, /Vinnaren saknades på systemet/);
  assert.match(html, /Inga registrerade lärdomar för omgången ännu/);
  assert.match(html, /\['Miss', 'Missad'\]/);
  assert.match(html, /Loppkategorier/);
  assert.match(html, /Faktisk distans/);
  assert.match(html, /Omräknad km-tid/);
  assert.match(html, /3:e utvändigt/);
  assert.match(html, /structured-key/);
  assert.match(html, /Öppna hemsida/);
  assert.match(html, /url\.origin === location\.origin/);
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  scripts.forEach((script, index) => {
    try {
      new vm.Script(script, { filename: `v064-embedded-${index}.js` });
    } catch (error) {
      console.error(`Generated v064 script ${index}:\n${script.split('\n').map((line, lineIndex) => `${String(lineIndex + 1).padStart(4, '0')}: ${line}`).join('\n')}`);
      throw error;
    }
  });
});

test('analysis-prompt app endpoint requires session and returns the copyable contract prompt', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-prompt?provider=openai'), env);
  assert.equal(response.status, 401);

  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-prompt?provider=openai', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.contractVersion, 'kentaurai-analysis-v1');
  assert.equal(payload.recommendedFilename, 'kentaurai-analysis_openai_ÅÅÅÅ-MM-DD.json');
  assert.match(payload.prompt, /exakt 8 avdelningar/i);
  assert.match(payload.prompt, /producer\.provider måste vara exakt "openai"/);
  assert.match(payload.prompt, /legs får inte finnas i final-filen/);
});
