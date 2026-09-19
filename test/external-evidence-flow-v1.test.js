import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTERNAL_EVIDENCE_CONTEXT_CONTRACT,
  EXTERNAL_EVIDENCE_IMPORT_CONTRACT,
  buildExternalEvidenceContext,
  getExternalEvidenceImportPrompt,
  getExternalEvidenceStep3Prompt,
  getHorseExternalStats,
  getHorseInterviews,
  getTrainerInterviews,
  importExternalEvidence
} from '../src/external-evidence-flow-v1.js';
import { createTestEnv } from './helpers/d1.js';

const ROUND_ID = 'evidence-round';
const HORSE_ID = 'evidence-horse';
const TRAINER_ID = 'evidence-trainer';
const ENTRY_ID = 'evidence-entry';

function seed(env, db) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('evidence-track','Synthetic Track','SE')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,status) VALUES (?, 'V85','2099-09-20','2099-09-20T14:00:00Z','upcoming')").run(ROUND_ID);
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,distance_m,start_method,status) VALUES ('evidence-race','evidence-track','2099-09-20',1,2140,'auto','upcoming')").run();
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,1,'evidence-race')").run(ROUND_ID);
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?, 'Synthetic Horse')").run(HORSE_ID);
  db.prepare("INSERT INTO trainers (id,canonical_name) VALUES (?, 'Synthetic Trainer')").run(TRAINER_ID);
  db.prepare("INSERT INTO drivers (id,canonical_name) VALUES ('evidence-driver','Synthetic Driver')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_start_distance_m,scratched,data_quality) VALUES (?,'evidence-race',?,'evidence-driver',?,1,2140,0,'verified')").run(ENTRY_ID,HORSE_ID,TRAINER_ID);
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('evidence-official-source','official_provider','2099-09-20T08:00:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO equipment (id,race_entry_id,shoes_front,shoes_rear,barefoot_front,barefoot_rear,sulky_type,verification_status,source_record_id) VALUES ('evidence-equipment',?,'barefoot','barefoot',1,1,'american','reported','evidence-official-source')").run(ENTRY_ID);
}

function payload(exportId = 'manual-export-1', exportedAt = '2099-09-20T11:00:00Z') {
  return {
    contract_version: EXTERNAL_EVIDENCE_IMPORT_CONTRACT,
    round_id: ROUND_ID,
    source: { name:'manual_editorial_import', export_id:exportId, exported_at:exportedAt },
    statistics: [
      {
        horse_id:HORSE_ID,
        race_entry_id:ENTRY_ID,
        context_type:'all_starts',
        context_key:null,
        context_label:'Alla starter',
        starts:25,wins:10,seconds:5,thirds:1,win_rate_percent:40,roi_percent:132,
        observed_at:exportedAt
      },
      {
        horse_id:HORSE_ID,
        race_entry_id:ENTRY_ID,
        context_type:'balance',
        context_key:'balance:barefoot|barefoot',
        context_label:'Barfota runt om',
        starts:13,wins:2,seconds:5,thirds:0,win_rate_percent:15,roi_percent:55,
        observed_at:exportedAt
      }
    ],
    interviews: [{
      horse_id:HORSE_ID,
      trainer_id:TRAINER_ID,
      race_entry_id:ENTRY_ID,
      speaker_name:'Synthetic Speaker',
      speaker_role:'stable_representative',
      published_at:exportedAt,
      summary:'Hästen uppges träna bra och stallet planerar ett offensivt upplägg. Utrustningen är oförändrad.',
      signals:[
        { type:'training',value:'Tränar bra',polarity:'positive',strength:0.7,fact_or_opinion:'soft_signal',confidence:0.8,evidence_excerpt:'Kort syntetiskt utdrag.' },
        { type:'tactics',value:'Offensivt upplägg',polarity:'positive',strength:0.6,fact_or_opinion:'intention',confidence:0.7,evidence_excerpt:null }
      ]
    }]
  };
}

test('Step 3 context exposes only horse external statistics and horse/trainer interview identities', async () => {
  const { env, db } = createTestEnv();
  seed(env, db);
  const context = await buildExternalEvidenceContext(env, ROUND_ID);
  assert.equal(context.contract_version, EXTERNAL_EVIDENCE_CONTEXT_CONTRACT);
  assert.equal(context.entries.length, 1);
  const entry = context.entries[0];
  assert.equal(entry.horse_id, HORSE_ID);
  assert.equal(entry.trainer_id, TRAINER_ID);
  assert.equal(Object.hasOwn(entry, 'driver_id'), false);
  assert.deepEqual(entry.current_balance, { key:'balance:barefoot|barefoot', label:'Barfota runt om' });
  assert.deepEqual(entry.current_wagon, { key:'wagon:american', label:'Amerikansk vagn' });
  assert.ok(entry.allowed_stat_contexts.some((row) => row.context_type === 'current_track' && row.context_label === 'Synthetic Track'));
  assert.ok(entry.allowed_stat_contexts.some((row) => row.context_type === 'lead'));
  assert.equal(context.rules.drivers_are_out_of_scope, true);
  assert.match(getExternalEvidenceStep3Prompt('openai'), /Bygg inget färdigt system/);
  assert.match(getExternalEvidenceImportPrompt('anthropic'), /Ingen data ska skapas för kuskar/);
});

test('external statistics and interviews import append-only and are readable from both horse and trainer', async () => {
  const { env, db } = createTestEnv();
  seed(env, db);

  const first = await importExternalEvidence(env, payload());
  assert.deepEqual(first.counts, { statistics:2, interviews:1, signals:2 });

  const retry = await importExternalEvidence(env, payload());
  assert.deepEqual(retry.counts, { statistics:0, interviews:0, signals:0 });
  assert.equal(retry.reused_raw_snapshot, true);

  const secondPayload = payload('manual-export-2','2099-10-01T11:00:00Z');
  secondPayload.statistics = [secondPayload.statistics[0]];
  secondPayload.statistics[0].starts = 27;
  secondPayload.statistics[0].wins = 11;
  secondPayload.statistics[0].win_rate_percent = 40.7;
  secondPayload.interviews = [];
  const second = await importExternalEvidence(env, secondPayload);
  assert.deepEqual(second.counts, { statistics:1, interviews:0, signals:0 });

  const stats = await getHorseExternalStats(env, HORSE_ID);
  assert.equal(stats.items.length, 3);
  const allStarts = stats.items.filter((row) => row.contextType === 'all_starts');
  assert.equal(allStarts.length, 2);
  assert.equal(allStarts[0].starts, 27);
  assert.equal(allStarts[1].starts, 25);

  const horseInterviews = await getHorseInterviews(env, HORSE_ID);
  const trainerInterviews = await getTrainerInterviews(env, TRAINER_ID);
  assert.equal(horseInterviews.items.length, 1);
  assert.equal(trainerInterviews.items.length, 1);
  assert.equal(horseInterviews.items[0].id, trainerInterviews.items[0].id);
  assert.equal(trainerInterviews.items[0].speakerName, 'Synthetic Speaker');
  assert.equal(trainerInterviews.items[0].signals.length, 2);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM external_horse_stat_snapshots WHERE horse_id=?").get(HORSE_ID).n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM editorial_items WHERE trainer_id=?").get(TRAINER_ID).n, 1);
});

test('Step 3 historical context excludes evidence unavailable at the round cutoff', async () => {
  const { env, db } = createTestEnv();
  seed(env, db);
  db.prepare("UPDATE game_rounds SET scheduled_start_at='2026-09-19T15:00:00Z',bet_stop_at='2026-09-19T14:55:00Z' WHERE id=?").run(ROUND_ID);

  const before = payload('before-cutoff','2026-09-19T12:00:00Z');
  before.statistics = [before.statistics[0]];
  await importExternalEvidence(env, before);

  const after = payload('after-cutoff','2026-09-19T16:00:00Z');
  after.statistics = [after.statistics[0]];
  after.statistics[0].starts = 26;
  after.interviews[0].summary = 'Syntetisk information som först blev tillgänglig efter spelstoppet.';
  await importExternalEvidence(env, after);

  const context = await buildExternalEvidenceContext(env, ROUND_ID);
  assert.equal(context.analysis_as_of, '2026-09-19T14:55:00.000Z');
  assert.equal(context.historical_external_statistics.length, 1);
  assert.equal(context.historical_external_statistics[0].starts, 25);
  assert.equal(context.historical_interviews.length, 1);
  assert.equal(context.historical_interviews[0].published_at, '2026-09-19T12:00:00.000Z');

  const importContext = await buildExternalEvidenceContext(env, ROUND_ID, { purpose:'import' });
  assert.deepEqual(importContext.historical_external_statistics, []);
  assert.deepEqual(importContext.historical_interviews, []);
});

test('external evidence import fails closed on mismatched context, trainer and full paid text fields', async () => {
  const { env, db } = createTestEnv();
  seed(env, db);

  const impossibleCounts = payload('impossible-counts');
  impossibleCounts.statistics = [impossibleCounts.statistics[0]];
  impossibleCounts.statistics[0].starts = 2;
  impossibleCounts.statistics[0].wins = 3;
  await assert.rejects(() => importExternalEvidence(env, impossibleCounts), /cannot exceed starts/);

  const wrongContext = payload('wrong-context');
  wrongContext.statistics[1].context_key = 'balance:shod|shod';
  await assert.rejects(() => importExternalEvidence(env, wrongContext), /context is not allowed/);

  const wrongTrainer = payload('wrong-trainer');
  wrongTrainer.interviews[0].trainer_id = 'not-the-trainer';
  await assert.rejects(() => importExternalEvidence(env, wrongTrainer), /trainer_id does not match/);

  const fullText = payload('full-text');
  fullText.interviews[0].full_text = 'Synthetic paid text must not be persisted.';
  await assert.rejects(() => importExternalEvidence(env, fullText), /full interview text is not accepted/);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM external_horse_stat_snapshots").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM editorial_items").get().n, 0);
});
