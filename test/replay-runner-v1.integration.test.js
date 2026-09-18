import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import { createReplayRunV1, getReplayRunV1, stepReplayRunV1 } from '../src/replay-runner-v1.js';

globalThis.crypto ??= webcrypto;

function insertSportsRace(db, { futureSnapshot = false, drift = false } = {}) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-s','Replay Track')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES ('race-s','track-s','2099-01-02',1,'2099-01-02T12:00:00Z',2140,'auto','finished')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-sa','A'),('horse-sb','B')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,actual_lane,handicap_m,actual_start_distance_m,scratched) VALUES ('entry-sa','race-s','horse-sa',1,1,0,2140,0),('entry-sb','race-s','horse-sb',2,2,0,2140,0)").run();

  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('source-pre','official_provider','race-s-pre','2099-01-02T10:30:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('source-future','official_provider','race-s-future','2099-01-02T11:30:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('source-result','official_provider','race-s-result','2099-01-02T12:30:00Z','normalized_verified_subset')").run();

  const raceFields = JSON.stringify({ date: '2099-01-02', distanceM: 2140, startMethod: 'auto', scheduledStartAt: '2099-01-02T12:00:00Z' });
  db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json) VALUES ('obs-race-pre','race','race-s','source-pre','2099-01-02T10:30:00Z',?)").run(raceFields);
  db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json) VALUES ('obs-race-future','race','race-s','source-future','2099-01-02T11:30:00Z',?)").run(raceFields);

  for (const [suffix, start, lane] of [['a',1,1],['b',2,2]]) {
    const entryFields = JSON.stringify({ startNumber: start, postPosition: lane, handicapM: 0, actualStartDistanceM: 2140, scratched: false, scratchSemanticsVerified: true });
    db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json) VALUES (?, 'race_entry', ?, 'source-pre','2099-01-02T10:30:00Z',?)").run(`obs-entry-s${suffix}-pre`, `entry-s${suffix}`, entryFields);
    const futureLane = suffix === 'a' && drift ? 9 : lane;
    const futureFields = JSON.stringify({ startNumber: start, postPosition: futureLane, handicapM: 0, actualStartDistanceM: 2140, scratched: false, scratchSemanticsVerified: true });
    db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json) VALUES (?, 'race_entry', ?, 'source-future','2099-01-02T11:30:00Z',?)").run(`obs-entry-s${suffix}-future`, `entry-s${suffix}`, futureFields);
  }
  if (drift) db.prepare("UPDATE race_entries SET actual_lane=9 WHERE id='entry-sa'").run();

  if (futureSnapshot) {
    db.prepare("INSERT INTO horse_stat_snapshots (id,horse_id,observed_at,snapshot_scope,starts,wins,source_record_id) VALUES ('future-stat','horse-sa','2099-01-02T11:30:00Z','life',20,10,'source-future')").run();
  }

  db.prepare("INSERT INTO race_results (race_entry_id,placing,placing_text,result_status,source_record_id) VALUES ('entry-sa',1,'1','official','source-result'),('entry-sb',2,'2','official','source-result')").run();
  db.prepare("INSERT INTO model_versions (id,created_at,feature_version,prompt_version,ai_provider,ai_model,config_json) VALUES ('model-s','2099-01-02T11:00:00Z','features-v3','prompt-s','openai','synthetic',?)").run(
    JSON.stringify({ replayEvaluation: { forecastKey: 'sports-baseline', featureFamilies: ['form'], invariantConfig: { policy: 'same' } } })
  );
  db.prepare("INSERT INTO ai_race_analyses (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at) VALUES ('analysis-s','race-s','model-s','2099-01-02T11:00:00Z',1,'2099-01-02T11:00:00Z')").run();
  db.prepare("INSERT INTO ai_horse_predictions (id,ai_race_analysis_id,race_entry_id,win_probability,raw_rank,abcd_group) VALUES ('pred-sa','analysis-s','entry-sa',0.65,1,'A'),('pred-sb','analysis-s','entry-sb',0.35,2,'B')").run();
}

async function runSportsOnce({ futureSnapshot = false, drift = false } = {}) {
  const { db, env } = createTestEnv();
  insertSportsRace(db, { futureSnapshot, drift });
  const run = await createReplayRunV1(env, {
    track: 'sports_feature',
    start_date: '2099-01-02',
    end_date: '2099-01-02',
    source_data_cutoff: '2099-01-02T13:00:00Z',
    walk_forward: { min_train_targets: 1, fold_size: 1 }
  }, { createdAt: '2099-01-03T00:00:00Z' });
  const first = await stepReplayRunV1(env, run.id, { updatedAt: '2099-01-03T00:01:00Z' });
  return { db, env, run, first };
}

test('F1 sports replay scores a stored pre-race forecast and is reproducible with a future source row present', async () => {
  const clean = await runSportsOnce();
  const withFuture = await runSportsOnce({ futureSnapshot: true });
  assert.equal(clean.first.step_status, 'scored');
  assert.equal(withFuture.first.step_status, 'scored');

  const cleanEval = clean.db.prepare("SELECT * FROM forecast_evaluations").get();
  const futureEval = withFuture.db.prepare("SELECT * FROM forecast_evaluations").get();
  assert.equal(cleanEval.log_loss, futureEval.log_loss);
  assert.equal(cleanEval.brier_score, futureEval.brier_score);
  assert.equal(cleanEval.feature_fingerprint, futureEval.feature_fingerprint);
  assert.equal(cleanEval.forecast_as_of, '2099-01-02T11:00:00.000Z');
  assert.equal(cleanEval.evidence_eligible, 0);
  assert.equal(clean.db.prepare("SELECT COUNT(*) AS n FROM model_change_log").get().n, 0);

  const completed = await stepReplayRunV1(clean.env, clean.run.id, { updatedAt: '2099-01-03T00:02:00Z' });
  assert.equal(completed.step_status, 'completed');
  assert.equal(completed.status, 'completed');
  const retry = await stepReplayRunV1(clean.env, clean.run.id);
  assert.equal(retry.reused, true);
  assert.equal(clean.db.prepare("SELECT COUNT(*) AS n FROM forecast_evaluations").get().n, 1);
});

test('F1 sports replay fails closed and records a skip when future canonical state drift would contaminate reconstruction', async () => {
  const { db, env, run, first } = await runSportsOnce({ drift: true });
  assert.equal(first.step_status, 'skipped');
  assert.match(first.reason, /replay_target_state_drift/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM forecast_evaluations").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM replay_target_skips").get().n, 1);
  await stepReplayRunV1(env, run.id, { updatedAt: '2099-01-03T00:02:00Z' });
  const status = await getReplayRunV1(env, run.id);
  assert.equal(status.status, 'completed');
  assert.equal(status.skipped_targets, 1);
});

function seedDecisionRound(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-d','Decision Track')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES ('round-d','V85','2099-02-01','2099-02-01T12:01:00Z','2099-02-01T11:50:00Z','finished')").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status) VALUES ('source-d-result','official_provider','round-d-results','2099-02-01T13:00:00Z','normalized_verified_subset')").run();

  const legs = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,status) VALUES (?, 'track-d','2099-02-01',?,?,'finished')").run(`race-d-${leg}`, leg, `2099-02-01T12:${String(leg).padStart(2,'0')}:00Z`);
    db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('round-d',?,?)").run(leg, `race-d-${leg}`);
    for (const suffix of ['a','b']) {
      db.prepare("INSERT INTO horses (id,canonical_name) VALUES (?,?)").run(`horse-d-${leg}-${suffix}`, `Horse ${leg} ${suffix}`);
      db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,?, ?,0)").run(`entry-d-${leg}-${suffix}`, `race-d-${leg}`, `horse-d-${leg}-${suffix}`, suffix === 'a' ? 1 : 2);
    }
    const winner = leg === 2 ? 'b' : 'a';
    const loser = winner === 'a' ? 'b' : 'a';
    db.prepare("INSERT INTO race_results (race_entry_id,placing,placing_text,result_status,source_record_id) VALUES (?,1,'1','official','source-d-result'),(?,2,'2','official','source-d-result')").run(`entry-d-${leg}-${winner}`, `entry-d-${leg}-${loser}`);
    legs.push({
      leg_number: leg,
      race_id: `race-d-${leg}`,
      public_proxy_quality: 'verified_complete_winner_odds_v1',
      public_proxy_method: 'normalized_inverse_decimal_winner_odds',
      entries: [
        { race_entry_id: `entry-d-${leg}-a`, blind_probability: 0.7, public_win_probability_proxy: 0.6, decision_probability: 0.7 },
        { race_entry_id: `entry-d-${leg}-b`, blind_probability: 0.3, public_win_probability_proxy: 0.4, decision_probability: 0.3 }
      ]
    });
  }

  db.prepare(`INSERT INTO analysis_step1_locks (
    id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
  ) VALUES ('lock-d','round-d','kentaurai-step1-lock-v1','pack-d','2099-02-01T10:00:00Z','facts-d','openai','synthetic','step1','{}','lock-hash-d','2099-02-01T13:30:00Z')`).run();

  const decision = {
    contract_version: 'kentaurai-decision-probability-v1',
    decision_probability_version: 'decision-probability-v1-e1',
    policy_version: 'decision-blind-v1',
    round_id: 'round-d',
    lock_id: 'lock-d',
    lock_hash: 'lock-hash-d',
    market_fingerprint: 'market-d',
    market_cutoff: '2099-02-01T11:00:00.000Z',
    legs,
    decision_fingerprint: 'decision-fp-d'
  };
  db.prepare(`INSERT INTO analysis_decision_runs (
    id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,contract_version,decision_probability_version,
    policy_version,market_proxy_quality_json,context_reliability_json,decision_json,decision_fingerprint,created_at
  ) VALUES ('decision-d','round-d','lock-d','lock-hash-d','market-d','2099-02-01T11:00:00Z',
    'kentaurai-decision-probability-v1','decision-probability-v1-e1','decision-blind-v1','[]','[]',?,'decision-fp-d','2099-02-01T11:01:00Z')`).run(JSON.stringify(decision));

  const systemLegs = legs.map((leg) => {
    const isSpike = leg.leg_number <= 3;
    return {
      leg_number: leg.leg_number,
      race_id: leg.race_id,
      selected_count: isSpike ? 1 : 2,
      is_spike: isSpike,
      selected_entries: isSpike
        ? [{ race_entry_id: `entry-d-${leg.leg_number}-a`, decision_probability: 0.7 }]
        : [
            { race_entry_id: `entry-d-${leg.leg_number}-a`, decision_probability: 0.7 },
            { race_entry_id: `entry-d-${leg.leg_number}-b`, decision_probability: 0.3 }
          ]
    };
  });
  const optimizer = {
    contract_version: 'kentaurai-optimizer-v1',
    optimizer_version: 'optimizer-p8-exact3-v1-e2',
    policy_version: 'v85-v86-exact3-main-v1',
    round_id: 'round-d',
    decision_run_id: 'decision-d',
    decision_fingerprint: 'decision-fp-d',
    system: {
      spike_count: 3,
      row_count: 32,
      cost_sek: 16,
      estimated_p8: 0.343,
      legs: systemLegs
    }
  };
  db.prepare(`INSERT INTO analysis_optimizer_runs (
    id,game_round_id,decision_run_id,decision_fingerprint,contract_version,optimizer_version,policy_version,
    line_price_sek,target_budget_min_sek,max_budget_sek,spike_count,row_count,cost_sek,estimated_p8,
    policy_json,metrics_json,optimizer_json,optimizer_fingerprint,created_at
  ) VALUES ('optimizer-d','round-d','decision-d','decision-fp-d','kentaurai-optimizer-v1','optimizer-p8-exact3-v1-e2',
    'v85-v86-exact3-main-v1',0.5,150,250,3,32,16,0.343,'{}','{}',?,'optimizer-fp-d','2099-02-01T11:02:00Z')`).run(JSON.stringify(optimizer));
}

test('F1 decision replay scores blind/public/decision distributions, evaluates exact3 system and excludes reference round from evidence', async () => {
  const { db, env } = createTestEnv();
  seedDecisionRound(db);
  const run = await createReplayRunV1(env, {
    track: 'v85_v86_decision',
    start_date: '2099-02-01',
    end_date: '2099-02-01',
    source_data_cutoff: '2099-02-01T14:00:00Z',
    reference_targets: ['round-d'],
    walk_forward: { min_train_targets: 1, fold_size: 1 }
  }, { createdAt: '2099-02-02T00:00:00Z' });

  const first = await stepReplayRunV1(env, run.id, { updatedAt: '2099-02-02T00:01:00Z' });
  assert.equal(first.step_status, 'scored');
  assert.equal(first.scored_forecasts, 24);
  const evaluations = db.prepare("SELECT forecast_key,evidence_eligible,is_reference,COUNT(*) AS n FROM forecast_evaluations GROUP BY forecast_key,evidence_eligible,is_reference ORDER BY forecast_key").all();
  assert.deepEqual(evaluations.map((row) => [row.forecast_key,row.n]), [
    ['blind_probability',8],
    ['decision_probability',8],
    ['market_win_probability_proxy',8]
  ]);
  assert.ok(evaluations.every((row) => row.evidence_eligible === 0 && row.is_reference === 1));

  const system = db.prepare("SELECT * FROM replay_system_evaluations").get();
  assert.equal(system.covered_legs, 7);
  assert.equal(system.spike_misses, 1);
  assert.equal(system.actual_all_covered, 0);
  assert.equal(system.row_count, 32);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM model_change_log").get().n, 0);

  const done = await stepReplayRunV1(env, run.id, { updatedAt: '2099-02-02T00:02:00Z' });
  assert.equal(done.status, 'completed');
  assert.equal(done.summary.forecasts && Object.keys(done.summary.forecasts).length, 0);
  assert.equal(done.summary.system_quality.evaluated_systems, 0);
  assert.equal(done.summary.reference_targets_excluded_from_evidence, true);
});

test('F1 public proxy is not scored when E1 quality is not verified complete', async () => {
  const { db, env } = createTestEnv();
  seedDecisionRound(db);
  const decision = JSON.parse(db.prepare("SELECT decision_json FROM analysis_decision_runs WHERE id='decision-d'").get().decision_json);
  for (const leg of decision.legs) {
    leg.public_proxy_quality = 'unavailable_incomplete_winner_odds';
    leg.public_proxy_method = null;
    for (const entry of leg.entries) entry.public_win_probability_proxy = null;
  }
  db.prepare("UPDATE analysis_decision_runs SET decision_json=? WHERE id='decision-d'").run(JSON.stringify(decision));

  const run = await createReplayRunV1(env, {
    track: 'v85_v86_decision',
    start_date: '2099-02-01',
    end_date: '2099-02-01',
    source_data_cutoff: '2099-02-01T14:00:00Z',
    reference_targets: ['round-d']
  });
  const first = await stepReplayRunV1(env, run.id);
  assert.equal(first.scored_forecasts, 16);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM forecast_evaluations WHERE forecast_key='market_win_probability_proxy'").get().n, 0);
});
