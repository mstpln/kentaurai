import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MARKET_INPUT_CONTRACT,
  RECORDED_SYSTEM_CONTRACT,
  REGISTRATION_CONTEXT_CONTRACT,
  buildMarketInput,
  buildRegistrationContext,
  getExternalAnalysisStep1Prompt,
  getExternalAnalysisStep2Prompt,
  getRegistrationPrompt,
  importRecordedSystem,
  listExternalAnalysisRounds,
  recordExternalAnalysisExport
} from '../src/external-analysis-flow-v1.js';
import { createPreMarketAnalysisPackV3 } from '../src/analysis-pack-v3.js';
import { runNextPostRaceReviewV2 } from '../src/post-race-review-v2.js';
import { loadExternalDecisionReplayEvidenceV1 } from '../src/external-analysis-evidence-v1.js';
import { runDecisionReplayV1 } from '../src/replay-calibration-v1.js';
import { createTestEnv } from './helpers/d1.js';

const ROUND_ID = 'external-round';

function seedRound(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('external-track','Synthetic Track','SE')").run();
  db.prepare("INSERT INTO track_external_ids (track_id,source_type,external_id) VALUES ('external-track','official','901')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES (?, 'V85','2099-09-20','2099-09-20T14:00:00Z','2099-09-20T13:55:00Z','upcoming')").run(ROUND_ID);
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('external-market-source','official_provider','2099-09-20T10:00:00Z','normalized_verified_subset')").run();

  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = 'external-race-' + leg;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES (?, 'external-track','2099-09-20',?,'2099-09-20T14:00:00Z',2140,'auto','upcoming')").run(raceId, leg);
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)").run(ROUND_ID, leg, raceId);
    db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race', ?, 'external-market-source','2099-09-20T10:00:00Z',?,'normalized_verified_subset')")
      .run('external-race-obs-' + leg, raceId, JSON.stringify({
        date:'2099-09-20', raceNumber:leg, distanceM:2140, startMethod:'auto',
        scheduledStartAt:'2099-09-20T14:00:00Z', trackExternalId:'901', status:'upcoming'
      }));

    for (let starter = 1; starter <= 2; starter += 1) {
      const horseId = 'external-horse-' + leg + '-' + starter;
      const driverId = 'external-driver-' + leg + '-' + starter;
      const trainerId = 'external-trainer-' + leg + '-' + starter;
      const entryId = 'external-entry-' + leg + '-' + starter;
      const horseExternal = String(1000 + leg * 10 + starter);
      const driverExternal = String(2000 + leg * 10 + starter);
      const trainerExternal = String(3000 + leg * 10 + starter);
      db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(horseId, 'Synthetic Horse ' + leg + '-' + starter);
      db.prepare("INSERT INTO horse_external_ids (horse_id,source_type,external_id) VALUES (?,'official',?)").run(horseId, horseExternal);
      db.prepare("INSERT INTO drivers (id,canonical_name) VALUES (?,?)").run(driverId, 'Synthetic Driver ' + leg + '-' + starter);
      db.prepare("INSERT INTO driver_external_ids (driver_id,source_type,external_id) VALUES (?,'official',?)").run(driverId, driverExternal);
      db.prepare("INSERT INTO trainers (id,canonical_name) VALUES (?,?)").run(trainerId, 'Synthetic Trainer ' + leg + '-' + starter);
      db.prepare("INSERT INTO trainer_external_ids (trainer_id,source_type,external_id) VALUES (?,'official',?)").run(trainerId, trainerExternal);
      db.prepare("INSERT INTO race_entries (id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched,data_quality) VALUES (?,?,?,?,?,?,?,1,0,2140,0,'normalized_verified_subset')")
        .run(entryId, raceId, horseId, driverId, trainerId, starter, starter);
      db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json,quality_status) VALUES (?, 'race_entry', ?, 'external-market-source','2099-09-20T10:00:00Z',?,'normalized_verified_subset')")
        .run('external-entry-obs-' + leg + '-' + starter, entryId, JSON.stringify({
          startNumber:starter, postPosition:starter, startTier:1, handicapM:0, actualStartDistanceM:2140,
          scratched:false, scratchSemanticsVerified:true, horseExternalId:horseExternal,
          driverExternalId:driverExternal, trainerExternalId:trainerExternal
        }));
      db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank,source_record_id) VALUES (?,?,?,?,?,?,?,?)")
        .run('external-bet-' + leg + '-' + starter, ROUND_ID, leg, entryId, '2099-09-20T10:00:00Z', starter === 1 ? 60 : 40, starter, 'external-market-source');
    }
  }
}

function validPayload() {
  const legs = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    legs.push({
      leg_number: leg,
      race_id: 'external-race-' + leg,
      scenarios: [{ name: 'synthetic', weight: 1 }],
      race_shape_summary: 'Synthetic race shape.',
      conclusion: 'Synthetic conclusion.',
      data_quality: 'sufficient',
      predictions: [
        { race_entry_id: 'external-entry-' + leg + '-1', win_probability: 0.6, uncertainty_low: 0.5, uncertainty_high: 0.7, raw_rank: 1, abcd_group: 'A', scenario_robustness: 0.8, reasoning: 'Synthetic stronger runner.' },
        { race_entry_id: 'external-entry-' + leg + '-2', win_probability: 0.4, uncertainty_low: 0.3, uncertainty_high: 0.5, raw_rank: 2, abcd_group: 'B', scenario_robustness: 0.6, reasoning: 'Synthetic second runner.' }
      ]
    });
  }
  const selections = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    const count = leg <= 3 ? 1 : 2;
    for (let starter = 1; starter <= count; starter += 1) {
      selections.push({
        leg_number: leg,
        race_entry_id: 'external-entry-' + leg + '-' + starter,
        selection_reason: starter === 1 ? 'Synthetic selection.' : null
      });
    }
  }
  return {
    contract_version: RECORDED_SYSTEM_CONTRACT,
    submission_id: 'external-test-1',
    round_id: ROUND_ID,
    producer: { provider: 'openai', model: 'synthetic-model' },
    analysis_as_of: '2099-09-20T10:30:00Z',
    round_summary: 'Synthetic blind summary.',
    recommendations: { summary: 'Synthetic final system.' },
    legs,
    systems: [{
      system_id: 'main',
      system_type: 'main',
      notes: 'Synthetic main system.',
      risk_profile: 'balanced',
      selections
    }]
  };
}

function canonicalizeForFingerprint(value) {
  if (Array.isArray(value)) return value.map(canonicalizeForFingerprint);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizeForFingerprint(value[key])]));
  }
  return value;
}

async function fingerprintForTest(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalizeForFingerprint(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function legacyStep2FingerprintForTest(market) {
  return fingerprintForTest({
    contract_version: MARKET_INPUT_CONTRACT,
    round_id: market.round.id,
    game_type: market.round.game_type,
    system_policy: market.system_policy,
    market: market.market,
    market_history: market.market_history,
    external_rankings: [],
    entry_identity: market.entry_map.map((leg) => ({
      leg_number: leg.leg_number,
      race_id: leg.race_id,
      entries: leg.entries.map((entry) => ({
        race_entry_id: entry.race_entry_id,
        start_number: entry.start_number,
        horse_id: entry.horse_id
      }))
    }))
  });
}

async function withProvenance(env, payload, {
  step1AsOf = '2099-09-20T10:30:00Z',
  step2AsOf = '2099-09-20T11:00:00Z'
} = {}) {
  const pack = await createPreMarketAnalysisPackV3(env, ROUND_ID, { asOf: step1AsOf });
  const activeByLeg = new Map();
  for (const file of pack.files || []) {
    const legNumber = Number(file.payload?.leg_number);
    if (!Number.isInteger(legNumber)) continue;
    if (!activeByLeg.has(legNumber)) {
      activeByLeg.set(legNumber, { leg_number:legNumber, race_id:file.payload?.race?.race_id || null, entry_ids:[] });
    }
    for (const entry of file.payload?.entries || []) {
      if (entry?.current_facts?.analysis_eligible === true) activeByLeg.get(legNumber).entry_ids.push(entry.race_entry_id);
    }
  }
  await recordExternalAnalysisExport(env, {
    stage:'step1',
    roundId:ROUND_ID,
    artifactId:pack.manifest.pack_id,
    artifactFingerprint:pack.manifest.facts_fingerprint,
    asOf:pack.manifest.as_of,
    generatedAt:pack.manifest.generated_at,
    artifact:{ active_legs:[...activeByLeg.values()] }
  });
  const market = await buildMarketInput(env, ROUND_ID, step2AsOf);
  await recordExternalAnalysisExport(env, {
    stage:'step2',
    roundId:ROUND_ID,
    artifactId:market.market_fingerprint,
    artifactFingerprint:market.market_fingerprint,
    asOf:market.market_as_of,
    cutoffAt:market.market_cutoff,
    generatedAt:market.generated_at,
    artifact:{
      market_fingerprint:market.market_fingerprint,
      market_cutoff:market.market_cutoff,
      active_legs:(market.entry_map || []).map((leg) => ({
        leg_number:leg.leg_number,
        race_id:leg.race_id,
        entry_ids:(leg.entries || []).filter((entry) => !entry.scratched).map((entry) => entry.race_entry_id)
      }))
    }
  });
  payload.step1 = {
    pack_id: pack.manifest.pack_id,
    facts_fingerprint: pack.manifest.facts_fingerprint,
    as_of: pack.manifest.as_of,
    generated_at: pack.manifest.generated_at
  };
  payload.step2 = {
    market_fingerprint: market.market_fingerprint,
    as_of: market.market_as_of,
    cutoff: market.market_cutoff,
    generated_at: market.generated_at
  };
  payload.analysis_as_of = pack.manifest.as_of;
  return payload;
}


test('external workflow exposes independent Step 1, Step 2 and registration contracts', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);

  const rounds = await listExternalAnalysisRounds(env, 'analysis');
  assert.equal(rounds[0].id, ROUND_ID);

  const market = await buildMarketInput(env, ROUND_ID, '2099-09-20T10:00:00Z');
  assert.equal(market.contract_version, MARKET_INPUT_CONTRACT);
  assert.equal(market.round.id, ROUND_ID);
  assert.equal(market.system_policy.exact_spike_count, 3);
  assert.equal(market.market.betting.length, 16);

  const registration = await buildRegistrationContext(env, ROUND_ID);
  assert.equal(registration.contract_version, REGISTRATION_CONTEXT_CONTRACT);
  assert.equal(registration.output_contract, RECORDED_SYSTEM_CONTRACT);
  assert.equal(registration.legs.length, 8);
  assert.equal(registration.system_policy.exact_spike_count, 3);

  assert.match(getExternalAnalysisStep1Prompt('openai'), /Marknadsblind analys/);
  assert.match(getExternalAnalysisStep1Prompt('openai'), /Bygg inget system/);
  assert.match(getExternalAnalysisStep1Prompt('openai'), /track_analysis/);
  assert.match(getExternalAnalysisStep1Prompt('openai'), /dubbelräkna inte/);
  assert.match(getExternalAnalysisStep1Prompt('openai'), /Baseline/);
  assert.match(getExternalAnalysisStep2Prompt('anthropic'), /Marknadsanalys/);
  assert.match(getExternalAnalysisStep2Prompt('anthropic'), /Bygg inget system/);
  assert.doesNotMatch(getExternalAnalysisStep2Prompt('anthropic'), /SYSTEMREGLER/);
  assert.match(getRegistrationPrompt('openai'), /Gör inte om analysen/);
  assert.match(getRegistrationPrompt('openai'), /KentaurAI räknar/);
});

test('recorded-system import derives spikes, rows and cost instead of trusting AI arithmetic', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await withProvenance(env, validPayload());

  const result = await importRecordedSystem(env, payload);
  assert.equal(result.reused, false);
  assert.deepEqual(result.writes, { analyses: 8, predictions: 16, systems: 1, selections: 13 });
  assert.equal(result.systems[0].spike_count, 3);
  assert.equal(result.systems[0].row_count, 32);
  assert.equal(result.systems[0].cost_sek, 16);

  const system = db.prepare("SELECT spike_count,row_count,budget_sek,line_price_sek,metrics_json FROM systems WHERE game_round_id=?").get(ROUND_ID);
  assert.equal(system.spike_count, 3);
  assert.equal(system.row_count, 32);
  assert.equal(system.budget_sek, 16);
  assert.equal(system.line_price_sek, 0.5);
  const metrics = JSON.parse(system.metrics_json);
  assert.equal(metrics.row_count_derived, true);
  assert.equal(metrics.cost_derived, true);
  assert.equal(metrics.spike_count_derived, true);

  const spikes = db.prepare("SELECT leg_number FROM system_selections WHERE system_id=(SELECT id FROM systems WHERE game_round_id=?) AND is_spike=1 ORDER BY leg_number").all(ROUND_ID);
  assert.deepEqual(spikes.map((row) => row.leg_number), [1,2,3]);

  const retry = await importRecordedSystem(env, payload);
  assert.equal(retry.reused, true);
  assert.deepEqual(retry.writes, { analyses: 0, predictions: 0, systems: 0, selections: 0 });
});

test('recorded-system import fails closed on not-exactly-three spikes and client-supplied arithmetic', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);

  let payload = await withProvenance(env, validPayload());
  payload.systems[0].selections = payload.systems[0].selections.filter((row) => !(row.leg_number === 4 && row.race_entry_id.endsWith('-2')));
  await assert.rejects(() => importRecordedSystem(env, payload), /exactly three one-horse spike legs/);

  payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-test-2';
  payload.systems[0].row_count = 32;
  await assert.rejects(() => importRecordedSystem(env, payload), /row_count is calculated by KentaurAI/);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM systems WHERE game_round_id=?").get(ROUND_ID).n, 0);
});


test('recorded-system import rejects analysis created after the authoritative round deadline', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-test-late';
  payload.step1.as_of = '2099-09-20T14:01:00Z';
  payload.analysis_as_of = payload.step1.as_of;
  await assert.rejects(
    () => importRecordedSystem(env, payload),
    /step1.as_of must not be after the authoritative round deadline/
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM systems WHERE game_round_id=?").get(ROUND_ID).n, 0);
});

test('recorded-system import preserves an actually played system above the configured target budget', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  env.V85_LINE_PRICE_SEK = '10';
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-test-over-budget';

  const result = await importRecordedSystem(env, payload);
  assert.equal(result.reused, false);
  assert.equal(result.systems[0].cost_sek, 320);
  assert.equal(result.systems[0].within_target_budget, false);

  const stored = db.prepare("SELECT budget_sek,metrics_json FROM systems WHERE game_round_id=?").get(ROUND_ID);
  assert.equal(stored.budget_sek, 320);
  const metrics = JSON.parse(stored.metrics_json);
  assert.equal(metrics.within_target_budget, false);
  assert.equal(metrics.max_budget_sek, 250);
});


test('recorded-system import persists truthful external lineage and preserves unknown market values as null', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  db.prepare("UPDATE betting_snapshots SET bet_percent=NULL WHERE id='external-bet-1-1'").run();
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-null-market';

  const result = await importRecordedSystem(env, payload);
  const lineage = db.prepare("SELECT * FROM analysis_external_runs WHERE id=?").get(result.externalRunId);
  assert.equal(lineage.analysis_blindness, 'declared_unsealed');
  assert.equal(lineage.import_timing, 'pre_race');
  assert.equal(lineage.learning_eligibility, 'eligible_by_timing');
  assert.equal(lineage.step1_pack_id, payload.step1.pack_id);
  assert.equal(lineage.step1_facts_fingerprint, payload.step1.facts_fingerprint);
  assert.equal(lineage.step2_market_fingerprint, payload.step2.market_fingerprint);
  const storedAnalyses = db.prepare("SELECT DISTINCT market_blind,method_note FROM ai_race_analyses WHERE model_version_id=?").all(result.modelVersionId);
  assert.equal(storedAnalyses.length, 1);
  assert.equal(storedAnalyses[0].market_blind, 0);
  assert.equal(storedAnalyses[0].method_note, 'declared_unsealed');

  const selection = db.prepare("SELECT market_percent FROM system_selections WHERE system_id=? AND leg_number=1 AND race_entry_id='external-entry-1-1'")
    .get(lineage.main_system_id);
  assert.equal(selection.market_percent, null);
  const system = db.prepare("SELECT estimated_market_ownership,value_metric FROM systems WHERE id=?").get(lineage.main_system_id);
  assert.equal(system.estimated_market_ownership, null);
  assert.equal(system.value_metric, null);
});

test('recorded-system import uses first-leg start as deadline fallback', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  db.prepare("UPDATE game_rounds SET bet_stop_at=NULL,scheduled_start_at=NULL WHERE id=?").run(ROUND_ID);
  const payload = validPayload();
  payload.step1 = {
    pack_id: 'irrelevant-after-deadline',
    facts_fingerprint: 'sha256:' + 'a'.repeat(64),
    as_of: '2099-09-20T14:01:00Z',
    generated_at: '2099-09-20T14:01:00Z'
  };
  payload.step2 = {
    market_fingerprint: 'sha256:' + 'b'.repeat(64),
    as_of: '2099-09-20T14:01:00Z',
    cutoff: '2099-09-20T14:00:00Z',
    generated_at: '2099-09-20T14:01:00Z'
  };
  payload.analysis_as_of = payload.step1.as_of;
  await assert.rejects(
    () => importRecordedSystem(env, payload),
    /step1.as_of must not be after the authoritative round deadline/
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM systems WHERE game_round_id=?").get(ROUND_ID).n, 0);
});


function settleRound(db) {
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('external-result-source','official_provider','2099-09-20T16:00:00Z','normalized_verified_subset')").run();
  for (let leg = 1; leg <= 8; leg += 1) {
    for (let starter = 1; starter <= 2; starter += 1) {
      db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,source_record_id,updated_at) VALUES (?,?,?,?,?)")
        .run('external-entry-' + leg + '-' + starter, starter, 'official', 'external-result-source', '2099-09-20T16:00:00Z');
    }
  }
}

test('external registered system is the F1/F2 evidence lineage instead of stale sealed-v3 lineage', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-evidence';
  const imported = await importRecordedSystem(env, payload);
  settleRound(db);

  const review = await runNextPostRaceReviewV2(env, { roundId: ROUND_ID });
  assert.equal(review.externalRunId, imported.externalRunId);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM post_race_reviews_external_v1 WHERE external_run_id=?").get(imported.externalRunId).n, 8);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM post_race_reviews_v2 WHERE game_round_id=?").get(ROUND_ID).n, 0);

  const replay = await runDecisionReplayV1(env, {
    from: '2099-09-20T00:00:00Z',
    to: '2099-09-21T00:00:00Z',
    max_targets: 10
  });
  assert.equal(replay.target_count, 8);
  assert.equal(replay.evidence_target_count, 8);
  const directEvidence = await loadExternalDecisionReplayEvidenceV1(env, {
    from: '2099-09-20T00:00:00Z',
    to: '2099-09-21T00:00:00Z',
    max_targets: 10
  });
  assert.equal(directEvidence.systemDiagnostics.length, 1);
  assert.equal(directEvidence.systemDiagnostics[0].external_run_id, imported.externalRunId);
  assert.ok(replay.version_metadata.decision_lineages.some((lineage) =>
    lineage.version_metadata?.lineage_type === 'external_declared_unsealed'
    && lineage.version_metadata?.external_run_id === imported.externalRunId
  ));
});


test('post-deadline registration is retained for diagnostics but excluded from automatic learning', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-post-race';
  const imported = await importRecordedSystem(env, payload, { now: '2099-09-20T16:30:00Z' });
  assert.equal(imported.importTiming, 'post_race_recovery');
  assert.equal(imported.learningEligibility, 'manual_review_required');
  const lineage = db.prepare("SELECT import_timing,learning_eligibility,analysis_blindness FROM analysis_external_runs WHERE id=?").get(imported.externalRunId);
  assert.equal(lineage.import_timing, 'post_race_recovery');
  assert.equal(lineage.learning_eligibility, 'manual_review_required');
  assert.equal(lineage.analysis_blindness, 'declared_unsealed_post_race_import');

  settleRound(db);
  const review = await runNextPostRaceReviewV2(env, { roundId: ROUND_ID });
  assert.equal(review.externalRunId, imported.externalRunId);
  const learning = db.prepare("SELECT DISTINCT learning_eligible,learning_classification FROM post_race_reviews_external_v1 WHERE external_run_id=?").all(imported.externalRunId);
  assert.equal(learning.length, 1);
  assert.equal(learning[0].learning_eligible, 0);
  assert.equal(learning[0].learning_classification, 'no_change');

  const replay = await runDecisionReplayV1(env, {
    from: '2099-09-20T00:00:00Z',
    to: '2099-09-21T00:00:00Z',
    max_targets: 10
  });
  assert.equal(replay.evidence_target_count, 0);
  assert.equal(replay.regression_only_target_count, 8);
  assert.equal(replay.regression_only_summary.systems.system_count, 1);
});


test('recorded-system import reproduces audited Step 2 exports created with the legacy external-rankings fingerprint recipe', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);

  const payload = validPayload();
  const pack = await createPreMarketAnalysisPackV3(env, ROUND_ID, { asOf: '2099-09-20T10:30:00Z' });
  const activeByLeg = new Map();
  for (const file of pack.files || []) {
    const legNumber = Number(file.payload?.leg_number);
    if (!Number.isInteger(legNumber)) continue;
    if (!activeByLeg.has(legNumber)) {
      activeByLeg.set(legNumber, { leg_number:legNumber, race_id:file.payload?.race?.race_id || null, entry_ids:[] });
    }
    for (const entry of file.payload?.entries || []) {
      if (entry?.current_facts?.analysis_eligible === true) activeByLeg.get(legNumber).entry_ids.push(entry.race_entry_id);
    }
  }
  await recordExternalAnalysisExport(env, {
    stage:'step1',
    roundId:ROUND_ID,
    artifactId:pack.manifest.pack_id,
    artifactFingerprint:pack.manifest.facts_fingerprint,
    asOf:pack.manifest.as_of,
    generatedAt:pack.manifest.generated_at,
    artifact:{ active_legs:[...activeByLeg.values()] }
  });

  const market = await buildMarketInput(env, ROUND_ID, '2099-09-20T11:00:00Z');
  const legacyFingerprint = await legacyStep2FingerprintForTest(market);
  assert.notEqual(legacyFingerprint, market.market_fingerprint);
  await recordExternalAnalysisExport(env, {
    stage:'step2',
    roundId:ROUND_ID,
    artifactId:legacyFingerprint,
    artifactFingerprint:legacyFingerprint,
    asOf:market.market_as_of,
    cutoffAt:market.market_cutoff,
    generatedAt:market.generated_at,
    artifact:{
      market_fingerprint:legacyFingerprint,
      market_cutoff:market.market_cutoff,
      active_legs:(market.entry_map || []).map((leg) => ({
        leg_number:leg.leg_number,
        race_id:leg.race_id,
        entry_ids:(leg.entries || []).filter((entry) => !entry.scratched).map((entry) => entry.race_entry_id)
      }))
    }
  });

  payload.step1 = {
    pack_id: pack.manifest.pack_id,
    facts_fingerprint: pack.manifest.facts_fingerprint,
    as_of: pack.manifest.as_of,
    generated_at: pack.manifest.generated_at
  };
  payload.step2 = {
    market_fingerprint: legacyFingerprint,
    as_of: market.market_as_of,
    cutoff: market.market_cutoff,
    generated_at: market.generated_at
  };
  payload.analysis_as_of = pack.manifest.as_of;
  payload.submission_id = 'external-legacy-step2-replay';

  const result = await importRecordedSystem(env, payload);
  assert.equal(result.reused, false);
  const stored = db.prepare("SELECT config_json FROM model_versions WHERE id=?").get(result.modelVersionId);
  const config = JSON.parse(stored.config_json);
  assert.equal(config.recordedSystem.step2_market_fingerprint, legacyFingerprint);
});

test('later registration can reproduce Step 1/2 provenance after round status changes', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-later-registration';
  db.prepare("UPDATE game_rounds SET status='completed' WHERE id=?").run(ROUND_ID);

  const result = await importRecordedSystem(env, payload, { now: '2099-09-20T16:30:00Z' });
  assert.equal(result.reused, false);
  assert.equal(result.importTiming, 'post_race_recovery');
  assert.equal(result.learningEligibility, 'manual_review_required');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM analysis_external_runs WHERE id=?").get(result.externalRunId).n, 1);
});


test('submission identity is idempotent and changed content under the same id fails closed', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-idempotent';
  const first = await importRecordedSystem(env, payload);
  const retry = await importRecordedSystem(env, structuredClone(payload));
  assert.equal(retry.reused, true);
  assert.equal(retry.externalRunId, first.externalRunId);

  const changed = structuredClone(payload);
  changed.round_summary = 'Changed content under same submission id.';
  await assert.rejects(
    () => importRecordedSystem(env, changed),
    /submission_id already exists with different content/
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM analysis_external_runs WHERE game_round_id=?").get(ROUND_ID).n, 1);
});

test('a later external registration explicitly supersedes the prior external run', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const firstPayload = await withProvenance(env, validPayload());
  firstPayload.submission_id = 'external-first';
  const first = await importRecordedSystem(env, firstPayload);

  const secondPayload = await withProvenance(env, validPayload());
  secondPayload.submission_id = 'external-second';
  secondPayload.round_summary = 'Second explicit registration.';
  const second = await importRecordedSystem(env, secondPayload);

  const lineage = db.prepare("SELECT id,supersedes_run_id FROM analysis_external_runs WHERE id=?").get(second.externalRunId);
  assert.equal(lineage.supersedes_run_id, first.externalRunId);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM analysis_external_runs WHERE game_round_id=?").get(ROUND_ID).n, 2);
});


test('later scratch preserves the original Step 1 prediction population', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-late-scratch';

  db.prepare("UPDATE race_entries SET scratched=1 WHERE id='external-entry-1-2'").run();

  const result = await importRecordedSystem(env, payload, { now: '2099-09-20T16:30:00Z' });
  assert.equal(result.reused, false);
  assert.equal(result.importTiming, 'post_race_recovery');

  const prediction = db.prepare(
    "SELECT p.race_entry_id FROM ai_horse_predictions p JOIN ai_race_analyses a ON a.id=p.ai_race_analysis_id WHERE a.model_version_id=? AND p.race_entry_id='external-entry-1-2'"
  ).get(result.modelVersionId);
  assert.equal(prediction.race_entry_id, 'external-entry-1-2');

  const externalRun = db.prepare("SELECT main_system_id FROM analysis_external_runs WHERE id=?").get(result.externalRunId);
  const selected = db.prepare(
    "SELECT COUNT(*) AS n FROM system_selections WHERE system_id=? AND race_entry_id='external-entry-1-2'"
  ).get(externalRun.main_system_id);
  assert.equal(selected.n, 0);
});


test('later scratch of a Step 2 selected horse does not invalidate the recorded played system', async () => {
  const { env, db } = createTestEnv();
  seedRound(db);
  const payload = await withProvenance(env, validPayload());
  payload.submission_id = 'external-selected-late-scratch';

  db.prepare("UPDATE race_entries SET scratched=1 WHERE id='external-entry-4-2'").run();

  const result = await importRecordedSystem(env, payload, { now: '2099-09-20T16:30:00Z' });
  assert.equal(result.reused, false);
  const externalRun = db.prepare("SELECT main_system_id FROM analysis_external_runs WHERE id=?").get(result.externalRunId);
  const selected = db.prepare(
    "SELECT is_spike FROM system_selections WHERE system_id=? AND leg_number=4 AND race_entry_id='external-entry-4-2'"
  ).get(externalRun.main_system_id);
  assert.equal(selected.is_spike, 0);
});
