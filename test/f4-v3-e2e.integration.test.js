import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { createTestEnv } from './helpers/d1.js';
import { createPreMarketAnalysisPackV3 } from '../src/analysis-pack-v3.js';
import { importStep1LockV1 } from '../src/analysis-step1-lock-v1.js';
import { ANALYSIS_STEP1_PROMPT_V3_VERSION } from '../src/analysis-step1-prompt-v3.js';
import { createMarketPackV3 } from '../src/analysis-market-pack-v3.js';
import {
  ANALYSIS_STEP2_RESULT_CONTRACT,
  ANALYSIS_STEP2_PROMPT_VERSION
} from '../src/analysis-step2-prompt-v3.js';
import { createF4Step2Bundle } from '../src/f4-step2-bundle.js';
import worker from '../src/worker-v076.js';
import { createAppSessionCookie } from '../src/app-auth.js';

globalThis.crypto ??= webcrypto;

const ROUND_ID = 'f4-e2e-round';
const PACK_AS_OF = '2099-08-01T10:05:00.000Z';
const LOCK_AT = PACK_AS_OF;
const MARKET_CUTOFF = PACK_AS_OF;
const MARKET_AT = '2099-08-01T09:59:00.000Z';
const BET_STOP = '2099-08-01T10:30:00.000Z';

function seedRound(db) {
  db.prepare(`
    INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status)
    VALUES (?,'V85','2099-08-01','2099-08-01T10:35:00Z',?,'upcoming')
  `).run(ROUND_ID,BET_STOP);
  db.prepare(`
    INSERT INTO source_records (id,source_type,external_id,fetched_at,content_hash,quality_status)
    VALUES ('f4-official','official_provider','game:f4-e2e','2099-08-01T09:55:00Z','f4-hash','normalized_verified_subset'),
           ('f4-market','official_provider','market:f4-e2e',?,'f4-market-hash','normalized_verified_subset')
  `).run(MARKET_AT);

  for (let leg = 1; leg <= 8; leg += 1) {
    const trackId = `f4-track-${leg}`;
    const raceId = `f4-race-${leg}`;
    db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES (?,?,'SE')`).run(trackId,`F4 Track ${leg}`);
    db.prepare(`INSERT INTO track_external_ids (track_id,source_type,external_id) VALUES (?,'official',?)`).run(trackId,String(900 + leg));
    db.prepare(`
      INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status)
      VALUES (?,?, '2099-08-01', ?, ?,2140,'auto','upcoming')
    `).run(raceId,trackId,leg,`2099-08-01T${String(10 + Math.ceil(leg / 2)).padStart(2,'0')}:35:00Z`);
    db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)`).run(ROUND_ID,leg,raceId);

    const raceFields = JSON.stringify({
      date:'2099-08-01',raceNumber:leg,distanceM:2140,startMethod:'auto',
      scheduledStartAt:`2099-08-01T${String(10 + Math.ceil(leg / 2)).padStart(2,'0')}:35:00Z`,
      trackExternalId:String(900 + leg),status:'upcoming'
    });
    db.prepare(`
      INSERT INTO normalized_observations
        (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status)
      VALUES (?, 'race', ?, 'f4-official','2099-08-01T09:55:00Z',?,'normalized_verified_subset')
    `).run(`f4-race-obs-${leg}`,raceId,raceFields);

    for (const [index,suffix] of ['a','b'].entries()) {
      const horseId = `f4-horse-${leg}-${suffix}`;
      const driverId = `f4-driver-${leg}-${suffix}`;
      const trainerId = `f4-trainer-${leg}-${suffix}`;
      const entryId = `f4-entry-${leg}-${suffix}`;
      const horseExternal = String(1000 + leg * 10 + index);
      const driverExternal = String(2000 + leg * 10 + index);
      const trainerExternal = String(3000 + leg * 10 + index);

      db.prepare(`INSERT INTO horses (id,canonical_name) VALUES (?,?)`).run(horseId,`F4 Horse ${leg} ${suffix}`);
      db.prepare(`INSERT INTO horse_external_ids (horse_id,source_type,external_id) VALUES (?,'official',?)`).run(horseId,horseExternal);
      db.prepare(`INSERT INTO drivers (id,canonical_name) VALUES (?,?)`).run(driverId,`F4 Driver ${leg} ${suffix}`);
      db.prepare(`INSERT INTO driver_external_ids (driver_id,source_type,external_id) VALUES (?,'official',?)`).run(driverId,driverExternal);
      db.prepare(`INSERT INTO trainers (id,canonical_name) VALUES (?,?)`).run(trainerId,`F4 Trainer ${leg} ${suffix}`);
      db.prepare(`INSERT INTO trainer_external_ids (trainer_id,source_type,external_id) VALUES (?,'official',?)`).run(trainerId,trainerExternal);
      db.prepare(`
        INSERT INTO race_entries
          (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched)
        VALUES (?,?,?,?,?,?,?,1,0,2140,0)
      `).run(entryId,raceId,horseId,driverId,trainerId,index + 1,index + 1);

      const entryFields = JSON.stringify({
        startNumber:index + 1,postPosition:index + 1,startTier:1,handicapM:0,actualStartDistanceM:2140,
        scratched:false,scratchSemanticsVerified:true,horseExternalId:horseExternal,
        driverExternalId:driverExternal,trainerExternalId:trainerExternal
      });
      db.prepare(`
        INSERT INTO normalized_observations
          (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status)
        VALUES (?, 'race_entry', ?, 'f4-official','2099-08-01T09:55:00Z',?,'normalized_verified_subset')
      `).run(`f4-entry-obs-${leg}-${suffix}`,entryId,entryFields);

      db.prepare(`
        INSERT INTO betting_snapshots
          (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id)
        VALUES (?,?,?,?,?,?,?,'f4-market')
      `).run(`f4-bet-${leg}-${suffix}`,ROUND_ID,leg,entryId,MARKET_AT,index === 0 ? 55 : 45,index + 1);
      db.prepare(`
        INSERT INTO odds_snapshots
          (id,race_entry_id,captured_at,market_type,odds,source_record_id)
        VALUES (?,?,?,'win',?,'f4-market')
      `).run(`f4-odds-${leg}-${suffix}`,entryId,MARKET_AT,index === 0 ? 2 : 3);
    }
  }
}

function legPayloads(pack) {
  return pack.files
    .filter((file) => /^\d{2}_leg_\d+\.json$/.test(file.name))
    .map((file) => file.payload)
    .sort((a,b) => a.leg_number - b.leg_number);
}

function step1Document(pack) {
  return {
    contract_version:'kentaurai-step1-lock-v1',
    lock_id:'f4-step1-lock',
    round_id:ROUND_ID,
    pack:{
      pack_id:pack.manifest.pack_id,
      as_of:pack.manifest.as_of,
      facts_fingerprint:pack.manifest.facts_fingerprint
    },
    provider:'openai',
    model:'synthetic',
    prompt_version:ANALYSIS_STEP1_PROMPT_V3_VERSION,
    legs:legPayloads(pack).map((leg) => ({
      leg_number:leg.leg_number,
      race_id:leg.race.race_id,
      data_quality_summary:'Synthetic F4 evidence is sufficient.',
      race_shape_summary:'Synthetic F4 race shape.',
      scenario_confidence:0.6,
      scenarios:[],
      predictions:leg.entries.map((entry,index) => ({
        race_entry_id:entry.race_entry_id,
        blind_probability:index === 0 ? 0.6 : 0.4,
        uncertainty_low:index === 0 ? 0.5 : 0.3,
        uncertainty_high:index === 0 ? 0.7 : 0.5,
        raw_rank:index + 1,
        abcd_group:index === 0 ? 'A' : 'B',
        assessment_confidence:index === 0 ? 0.75 : 0.65,
        reasoning:'Synthetic F4 sealed assessment.'
      }))
    }))
  };
}

function step2Document(lock, market) {
  return {
    contract_version:ANALYSIS_STEP2_RESULT_CONTRACT,
    result_id:'step2_f4_e2e_result',
    round_id:ROUND_ID,
    lock_id:lock.lock_id,
    lock_hash:lock.lock_hash,
    market_fingerprint:market.manifest.market_fingerprint,
    market_cutoff:market.manifest.cutoff,
    provider:'openai',
    model:'synthetic',
    prompt_version:ANALYSIS_STEP2_PROMPT_VERSION,
    legs:Array.from({length:8},(_,i) => {
      const leg=i+1;
      return {
        leg_number:leg,
        entries:['a','b'].map((suffix,index) => ({
          race_entry_id:`f4-entry-${leg}-${suffix}`,
          blind_probability:index===0 ? 0.6 : 0.4,
          abcd_group:index===0 ? 'A' : 'B',
          market_disagreement:'aligned',
          disagreement_reliability:'medium',
          market_maturity:'developing',
          value_signal:'neutral',
          value_confidence:0.5,
          market_reasoning_summary:'Synthetic F4 market interpretation.'
        }))
      };
    }),
    round_risk_flags:[],
    external_signals_read_last:true
  };
}

test('F4 default mode disables sealed-v3 creation endpoints', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';
  const cookie = (await createAppSessionCookie(env)).split(';')[0];

  const requests = [
    new Request('https://example.test/app/api/settings/analysis-step1-lock?round_id=' + encodeURIComponent(ROUND_ID), {
      method:'POST', headers:{ cookie, 'content-type':'application/json' }, body:'{}'
    }),
    new Request('https://example.test/app/api/settings/analysis-decision-probability?round_id=' + encodeURIComponent(ROUND_ID), {
      method:'POST', headers:{ cookie, 'content-type':'application/json' }, body:'{}'
    }),
    new Request('https://example.test/app/api/settings/analysis-optimizer?round_id=' + encodeURIComponent(ROUND_ID), {
      method:'POST', headers:{ cookie, 'content-type':'application/json' }, body:'{}'
    }),
    new Request('https://example.test/app/api/settings/analysis-step2?round_id=' + encodeURIComponent(ROUND_ID), {
      method:'POST', headers:{ cookie, 'content-type':'application/json' }, body:'{}'
    })
  ];

  for (const request of requests) {
    const response = await worker.fetch(request, env, {});
    assert.equal(response.status, 410, request.url);
    const body = await response.json();
    assert.equal(body.error, 'legacy_analysis_creation_disabled');
    assert.match(body.message, /external/i);
  }

  for (const path of [
    '/app/api/settings/f4-step2-bundle?round_id=' + encodeURIComponent(ROUND_ID),
    '/app/api/settings/analysis-market-pack?round_id=' + encodeURIComponent(ROUND_ID),
    '/app/api/settings/analysis-step2-prompt?provider=openai',
    '/app/api/settings/analysis-step1-revision-prompt?provider=openai'
  ]) {
    const response = await worker.fetch(new Request('https://example.test' + path, { headers:{ cookie } }), env, {});
    assert.equal(response.status, 410, path);
  }

  env.ADMIN_TOKEN = 'synthetic-admin-token-with-high-entropy';
  for (const path of [
    '/v1/analysis-step1-lock/' + encodeURIComponent(ROUND_ID),
    '/v1/analysis-step1-revision/' + encodeURIComponent(ROUND_ID),
    '/v1/analysis-decision-probability/' + encodeURIComponent(ROUND_ID),
    '/v1/analysis-optimizer/' + encodeURIComponent(ROUND_ID),
    '/v1/analysis-step2/' + encodeURIComponent(ROUND_ID),
    '/v1/analysis-v3/synthetic/narrative'
  ]) {
    const response = await worker.fetch(new Request('https://example.test' + path, {
      method:'POST',
      headers:{ authorization:'Bearer ' + env.ADMIN_TOKEN, 'content-type':'application/json' },
      body:'{}'
    }), env, {});
    assert.equal(response.status, 410, path);
  }

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_v3_runs').get().n, 0);
});
