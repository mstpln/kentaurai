import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { enhanceAppHtmlV064 } from '../src/app-v064-overlay.js';
import { buildAnalysisImportPrompt, recommendedAnalysisFilename } from '../src/analysis-import-prompt.js';
import { classifyRace, matchesRaceClassification } from '../src/race-classification.js';
import { getTrackDetailV064, getTrackLaneStatsV064 } from '../src/routes/tracks-v064.js';
import { applyTrackContactEnrichment, listTrackContactTargets } from '../src/track-contact-enrichment.js';
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

function seedAnalysisPromptRound(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name, country_code) VALUES ('prompt-track','Promptbanan','SE')").run();
  db.prepare(`INSERT INTO game_rounds (
    id, game_type, round_date, scheduled_start_at, bet_stop_at, status
  ) VALUES ('prompt-round','V85','2099-09-12','2099-09-12T15:00:00Z','2099-09-12T14:55:00Z','upcoming')`).run();
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `prompt-race-${leg}`;
    const horseId = `prompt-horse-${leg}`;
    const entryId = `prompt-entry-${leg}`;
    db.prepare(`INSERT INTO races (
      id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, status
    ) VALUES (?, 'prompt-track', '2099-09-12', ?, '2099-09-12T15:00:00Z', 2140, 'auto', 'upcoming')`).run(raceId, leg);
    db.prepare('INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?)').run('prompt-round', leg, raceId);
    db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?, ?)').run(horseId, `Prompthäst ${leg}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, scratched)
      VALUES (?, ?, ?, 1, 0)`).run(entryId, raceId, horseId);
  }
}

test('race classification separates Loppklass, STL-klass and Lopptyp', () => {
  const race = classifyRace({ mainClass: 'Silverdivisionen', classFlags: ['Stolopp', 'Spårtrappa', 'Gr I'] });
  assert.equal(race.raceClass, 'Silverdivisionen');
  assert.equal(race.stlClass, 'silver');
  assert.deepEqual([...race.raceTypes].sort(), ['lane_ladder', 'mares']);
  assert.equal(matchesRaceClassification({ mainClass: 'Silverdivisionen', classFlags: ['Stolopp'] }, { stlClass: 'silver', raceType: 'mares' }), true);
  assert.equal(matchesRaceClassification({ mainClass: 'Bronsdivisionen', classFlags: ['Stolopp'] }, { stlClass: 'silver', raceType: 'mares' }), false);
});

test('track detail exposes optional address and only safe HTTPS website fields', async () => {
  const { env, db } = createTestEnv();
  seedClassifiedTrack(db);
  let detail = await getTrackDetailV064(env, 'track-v064');
  assert.equal(detail.address.street, 'Testvägen 1');
  assert.equal(detail.address.postalCode, '123 45');
  assert.equal(detail.websiteUrl, 'https://example.test/track');

  for (const unsafe of ['javascript:alert(1)', 'http://example.test/track']) {
    db.prepare('UPDATE tracks SET website_url=? WHERE id=?').run(unsafe, 'track-v064');
    detail = await getTrackDetailV064(env, 'track-v064');
    assert.equal(detail.websiteUrl, null);
  }
});

test('lane statistics combine persisted STL-class and race-type filters with existing filters', async () => {
  const { env, db } = createTestEnv();
  seedClassifiedTrack(db);

  const all = await getTrackLaneStatsV064(env, 'track-v064', {
    year: '2026', startMethod: 'auto', distanceGroup: '2140'
  });
  assert.equal(all.totals.starts, 8);

  const silverMares = await getTrackLaneStatsV064(env, 'track-v064', {
    year: '2026', startMethod: 'auto', distanceGroup: '2140', stlClass: 'silver', raceType: 'mares'
  });
  assert.equal(silverMares.totals.starts, 2);
  assert.equal(silverMares.filters.stlClass, 'silver');
  assert.equal(silverMares.filters.raceType, 'mares');
});

test('track contact enrichment is exact-id, idempotent, provenance-backed and conflict preserving', async () => {
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id, canonical_name, city, country_code) VALUES ('track-contact','Syntetiska banan','Teststad','SE')").run();
  const payload = { tracks: [{
    track_id: 'track-contact',
    canonical_name: 'Syntetiska banan',
    street_address: 'Testgatan 7',
    postal_code: '123 45',
    website_url: 'https://example.test/track',
    address_source: { url: 'https://example.test/contact', type: 'official_track' },
    website_source: { url: 'https://example.test/', type: 'official_track' },
    verified_at: '2026-09-11T09:00:00Z'
  }] };

  let result = await applyTrackContactEnrichment(env, payload);
  assert.equal(result.verifiedFacts, 3);
  let track = db.prepare("SELECT street_address, postal_code, website_url FROM tracks WHERE id='track-contact'").get();
  assert.equal(track.street_address, 'Testgatan 7');
  assert.equal(track.postal_code, '123 45');
  assert.equal(track.website_url, 'https://example.test/track');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM track_contact_fact_observations WHERE track_id='track-contact' AND status='verified'").get().n, 3);

  result = await applyTrackContactEnrichment(env, payload);
  assert.equal(result.verifiedFacts, 0);
  assert.equal(result.unchangedFacts, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM track_contact_fact_observations WHERE track_id='track-contact'").get().n, 3);

  result = await applyTrackContactEnrichment(env, { tracks: [{
    ...payload.tracks[0],
    street_address: 'Annan testgata 9',
    postal_code: null,
    website_url: null,
    verified_at: '2026-09-11T10:00:00Z'
  }] });
  assert.equal(result.conflicts, 1);
  track = db.prepare("SELECT street_address FROM tracks WHERE id='track-contact'").get();
  assert.equal(track.street_address, 'Testgatan 7');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM track_contact_fact_observations WHERE track_id='track-contact' AND status='conflict'").get().n, 1);

  const targets = await listTrackContactTargets(env);
  assert.equal(targets.total, 1);
  assert.equal(targets.items[0].id, 'track-contact');
});

test('track contact enrichment rejects unsafe URLs and identity mismatches', async () => {
  const { env, db } = createTestEnv();
  db.prepare("INSERT INTO tracks (id, canonical_name) VALUES ('track-contact','Syntetiska banan')").run();
  await assert.rejects(() => applyTrackContactEnrichment(env, { tracks: [{
    track_id: 'track-contact', canonical_name: 'Fel bana', website_url: 'https://example.test/',
    website_source: { url: 'https://example.test/', type: 'official_track' }, verified_at: '2026-09-11T09:00:00Z'
  }] }), /canonical_name mismatch/);
  await assert.rejects(() => applyTrackContactEnrichment(env, { tracks: [{
    track_id: 'track-contact', website_url: 'http://example.test/',
    website_source: { url: 'https://example.test/', type: 'official_track' }, verified_at: '2026-09-11T09:00:00Z'
  }] }), /HTTPS/);
});

test('v064 overlay keeps optional localization behavior without creating canonical settings UI', () => {
  const html = enhanceAppHtmlV064('<html><head></head><body><div id="app"></div></body></html>');
  assert.match(html, /\['Miss', 'Fel'\]/);
  assert.doesNotMatch(html, /Alla år/);
  assert.doesNotMatch(html, /Alla startmetoder/);
  assert.doesNotMatch(html, /localizeFilterAllLabels/);
  assert.doesNotMatch(html, /enhanceAnalysisImportGuide/);
  assert.doesNotMatch(html, /Skapa V85\/V86-systemanalysfil för import/);
  assert.match(html, /Loppkategorier/);
  const scripts = [...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  scripts.forEach((script, index) => assert.doesNotThrow(() => new vm.Script(script, { filename: `v064-embedded-${index}.js` })));
});

test('actual Wrangler worker serves the canonical completion UI after browser login', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const login = await worker.fetch(new Request('https://example.test/app/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: env.APP_PASSWORD })
  }), env);
  assert.equal(login.status, 303);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await worker.fetch(new Request('https://example.test/app/', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const label of ['Trend', 'Tränare', 'Hästar', 'Kuskar', 'Bana', 'Spel', 'AI', 'Data',
    'Analysera omgången utan marknad', 'Exportera marknadsblind data', 'Värdera marknaden och bygg system',
    'Exportera marknadsdata', 'Skapa importfil till KentaurAI', 'Kopiera exportinstruktion', 'V85/V86-omgångar',
    'All data', 'Loppnivå', 'Högre prissumma', 'Vardagstrav', 'Översikt', 'Spårstatistik', 'Hemmatränare',
    'Startmetod', 'STL-klass', 'Lopptyp', 'Sverige']) assert.match(html, new RegExp(label.replace('/', '\\/')));
  assert.doesNotMatch(html, /STL-lopp/);
  assert.match(html, /kentaurai-analysis-v2/);
  assert.match(html, /startMethod:'all',raceScope:'all'/);
  assert.match(html, /selected===false\?'Fel':'Ej rättad'/);
  assert.doesNotMatch(html, /selected===false\?'Miss':'Ej rättad'/);
  assert.doesNotMatch(html, /enhanceAnalysisImportGuide|app-page-scope-polish|Alla år|Alla startmetoder/);
});

test('private track contact operations require admin auth', async () => {
  const { env, db } = createTestEnv();
  env.ADMIN_TOKEN = 'synthetic-admin-token';
  db.prepare("INSERT INTO tracks (id, canonical_name) VALUES ('track-contact','Syntetiska banan')").run();
  let response = await worker.fetch(new Request('https://example.test/v1/admin/tracks/contact-targets'), env);
  assert.equal(response.status, 401);
  response = await worker.fetch(new Request('https://example.test/v1/admin/tracks/contact-targets', { headers: { authorization: 'Bearer synthetic-admin-token' } }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).total, 1);
});

test('analysis import prompt mirrors the aligned export-only contract', () => {
  const prompt = buildAnalysisImportPrompt('anthropic', {
    export_stage: 'pre_market',
    provider: 'anthropic',
    round_id: 'synthetic-round',
    parent_submission_id: null,
    context_fingerprint: `sha256:${'a'.repeat(64)}`,
    context: { stage: 'pre_market', contextFingerprint: `sha256:${'a'.repeat(64)}`, legs: [] }
  });
  assert.match(prompt, /kentaurai-analysis-v1/);
  assert.match(prompt, /KENTAURAI-UNDERLAG/);
  assert.match(prompt, /synthetic-round/);
  assert.match(prompt, /is_spike är rent beskrivande/);
  assert.match(prompt, /INTE kontrollera om systemet borde ha fler eller färre spikar/);
  assert.doesNotMatch(prompt, /EXAKT 3 spikavdelningar/);
  assert.match(prompt, /UTTRYCKLIGEN angiven rankingsekvens/);
  assert.match(prompt, /Deterministisk komplettering/);
  assert.match(prompt, /pre_market-fritext/);
  assert.match(prompt, /context_fingerprint/);
  assert.match(prompt, /parent_submission_id/);
  assert.match(prompt, /market_percent/);
  assert.match(prompt, /value_ratio/);
  assert.match(prompt, /own_probability/);
  assert.equal(recommendedAnalysisFilename('claude'), 'kentaurai-analysis_anthropic_ACTUAL-MODEL_STAGE_ÅÅÅÅ-MM-DD.json');
});

test('analysis-prompt app endpoint requires session and copies a complete live combined context', async () => {
  const { env, db } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  seedAnalysisPromptRound(db);
  let response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-prompt?provider=openai'), env);
  assert.equal(response.status, 401);
  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-prompt?provider=openai', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.contractVersion, 'kentaurai-analysis-v2');
  assert.equal(payload.stage, 'combined');
  assert.equal(payload.roundId, 'prompt-round');
  assert.equal(payload.recommendedFilename, 'kentaurai-analysis_openai_ACTUAL-MODEL_combined_ÅÅÅÅ-MM-DD.json');
  assert.match(payload.prompt, /# KENTAURAI-UNDERLAG/);
  assert.match(payload.prompt, /"round_id": "prompt-round"/);
  assert.match(payload.prompt, /"raceEntryId": "prompt-entry-1"/);
  assert.match(payload.prompt, /"horseName": "Prompthäst 1"/);
  assert.match(payload.prompt, /"context_fingerprint": "sha256:[a-f0-9]{64}"/);

  response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-prompt?provider=anthropic', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const anthropic = await response.json();
  assert.equal(anthropic.stage, 'combined');
  assert.equal(anthropic.recommendedFilename, 'kentaurai-analysis_anthropic_ACTUAL-MODEL_combined_ÅÅÅÅ-MM-DD.json');
  assert.match(anthropic.prompt, /producer.provider ska vara exakt "anthropic"/);
});
