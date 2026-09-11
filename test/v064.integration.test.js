import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

import worker from '../src/worker-v064.js';
import { createAppSessionCookie } from '../src/app-auth.js';
import { buildAnalysisImportInstructions } from '../src/analysis-import-instructions.js';
import {
  classifyRaceTypes,
  classifyStlClass,
  getEnhancedTrackDetail,
  getEnhancedTrackLaneStats
} from '../src/routes/track-enhancements.js';
import { createTestEnv } from './helpers/d1.js';
import { v064Script } from '../src/ui-v064.js';

function seed(db) {
  db.prepare(`INSERT INTO tracks
    (id, canonical_name, city, country_code, street_address, postal_code, website_url)
    VALUES ('track-v064','Syntetiska Travbanan','Teststad','SE','Testvägen 1','123 45','https://example.test/track')`).run();

  const races = [
    ['race-silver-mares','2026-01-01',2140,'auto','Silverdivisionen',JSON.stringify(['Stolopp'])],
    ['race-gold-ladder','2026-01-02',2140,'auto','Gulddivisionen',JSON.stringify(['Spårtrappa'])],
    ['race-class-i','2026-01-03',2140,'auto','Klass I',JSON.stringify(['Lärlingslopp'])],
    ['race-volt','2026-01-04',2140,'volte','Silverdivisionen',JSON.stringify(['Stolopp'])]
  ];
  for (const [id,date,distance,method,mainClass,flags] of races) {
    db.prepare(`INSERT INTO races
      (id, track_id, race_date, race_number, distance_m, start_method, main_class, class_flags_json, status)
      VALUES (?, 'track-v064', ?, 1, ?, ?, ?, ?, 'results')`).run(id,date,distance,method,mainClass,flags);
  }

  for (let i = 1; i <= 4; i += 1) {
    db.prepare('INSERT INTO horses (id, canonical_name) VALUES (?, ?)').run(`horse-v064-${i}`, `Syntethäst ${i}`);
  }
  const entries = [
    ['entry-silver','race-silver-mares','horse-v064-1',1,1,0],
    ['entry-gold','race-gold-ladder','horse-v064-2',1,2,1],
    ['entry-class','race-class-i','horse-v064-3',2,1,0],
    ['entry-volt','race-volt','horse-v064-4',1,1,0]
  ];
  for (const [entryId,raceId,horseId,lane,placing,gallop] of entries) {
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_lane, scratched)
      VALUES (?, ?, ?, 1, ?, 0)`).run(entryId,raceId,horseId,lane);
    db.prepare(`INSERT INTO race_results (race_entry_id, placing, gallop, result_status)
      VALUES (?, ?, ?, 'official')`).run(entryId,placing,gallop);
  }
}

test('race classification separates STL class from race type', () => {
  assert.equal(classifyStlClass({ main_class: 'Silverdivisionen', class_flags_json: '["Stolopp"]' }), 'silver');
  assert.equal(classifyStlClass({ main_class: 'Klass III' }), 'class_iii');
  assert.equal(classifyStlClass({ main_class: 'Klass II' }), 'class_ii');
  assert.equal(classifyStlClass({ main_class: 'Klass I' }), 'class_i');
  assert.deepEqual(classifyRaceTypes({ main_class: 'Silverdivisionen', class_flags_json: '["Stolopp","Spårtrappa"]' }).sort(), ['lane_ladder','mares']);
});

test('enhanced track detail exposes nullable address and website metadata', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  const detail = await getEnhancedTrackDetail(env, 'track-v064');
  assert.equal(detail.address.street, 'Testvägen 1');
  assert.equal(detail.address.postalCode, '123 45');
  assert.equal(detail.address.city, 'Teststad');
  assert.equal(detail.websiteUrl, 'https://example.test/track');
});

test('lane stats combine track period method distance STL class and race type', async () => {
  const { env, db } = createTestEnv();
  seed(db);

  const silver = await getEnhancedTrackLaneStats(env, 'track-v064', {
    year: '2026', startMethod: 'auto', distanceGroup: '2140', stlClass: 'silver', raceType: 'all'
  });
  assert.equal(silver.totals.starts, 1);
  assert.equal(silver.rows[0].wins, 1);

  const mares = await getEnhancedTrackLaneStats(env, 'track-v064', {
    year: '2026', startMethod: 'auto', distanceGroup: '2140', stlClass: 'all', raceType: 'mares'
  });
  assert.equal(mares.totals.starts, 1);

  const impossibleCombination = await getEnhancedTrackLaneStats(env, 'track-v064', {
    year: '2026', startMethod: 'auto', distanceGroup: '2140', stlClass: 'gold', raceType: 'mares'
  });
  assert.equal(impossibleCombination.totals.starts, 0);
});

test('analysis import instructions describe the exact KentaurAI contract and never encourage invented ids', () => {
  const prompt = buildAnalysisImportInstructions();
  assert.match(prompt, /kentaurai-analysis-v1/);
  assert.match(prompt, /EXAKT TRE spikavdelningar/);
  assert.match(prompt, /Summan av win_probability.*1\.0/s);
  assert.match(prompt, /parent_submission_id/);
  assert.match(prompt, /Uppfinn aldrig KentaurAI-identiteter/);
  assert.match(prompt, /value_ratio och market_percent får INTE skickas/);
  assert.match(prompt, /ren JSON-fil/);
});

test('v064 browser overlay is syntactically valid and contains aligned labels and filter choices', () => {
  const script = v064Script.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  assert.doesNotThrow(() => new vm.Script(script));
  assert.match(v064Script, /Skapa V85\/V86-systemanalysfil för import/);
  assert.match(v064Script, /Alla STL-klasser/);
  assert.match(v064Script, /Alla lopptyper/);
  assert.match(v064Script, /V85\/V86-omgångar/);
  assert.match(v064Script, /Miss:'Fel'/);
  assert.match(v064Script, /Klass:'Loppklass'/);
});

test('v064 private endpoints require session and return filtered track data and prompt', async () => {
  const { env, db } = createTestEnv();
  seed(db);
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-import-instructions'), env);
  assert.equal(response.status, 401);

  const cookie = (await createAppSessionCookie(env)).split(';')[0];
  response = await worker.fetch(new Request('https://example.test/app/api/settings/analysis-import-instructions', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const instructions = await response.json();
  assert.equal(instructions.contractVersion, 'kentaurai-analysis-v1');
  assert.match(instructions.prompt, /parent_submission_id/);

  response = await worker.fetch(new Request('https://example.test/app/api/tracks/track-v064/lane-stats?year=2026&start_method=auto&distance_group=2140&stl_class=silver&race_type=mares', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const stats = await response.json();
  assert.equal(stats.totals.starts, 1);

  response = await worker.fetch(new Request('https://example.test/app/api/tracks/track-v064', { headers: { cookie } }), env);
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.websiteUrl, 'https://example.test/track');
});
