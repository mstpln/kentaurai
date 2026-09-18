import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import { stableFeatureJson } from '../src/analysis-v3-foundations.js';
import {
  REPLAY_CONTRACT_VERSION,
  REPLAY_VERSION,
  buildAblationFeatureSetsV1,
  buildCalibrationSummaryV1,
  buildWalkForwardFoldsV1,
  persistReplayResultV1,
  runDecisionReplayV1,
  runSportsFeatureReplayV1,
  scoreMulticlassForecastV1
} from '../src/replay-calibration-v1.js';

globalThis.crypto ??= webcrypto;

function seedSource(db, id, fetchedAt, sourceType = 'official_provider') {
  db.prepare(`
    INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status)
    VALUES (?,?,?,?,?)
  `).run(id, sourceType, id, fetchedAt, sourceType === 'official_provider' ? 'normalized_verified_subset' : 'synthetic');
}

test('F1 multiclass log loss, Brier and calibration are deterministic', () => {
  const input = {
    winnerEntryId: 'entry-a',
    entries: [
      { race_entry_id: 'entry-b', probability: 0.3 },
      { race_entry_id: 'entry-a', probability: 0.7 }
    ]
  };
  const first = scoreMulticlassForecastV1(input);
  const second = scoreMulticlassForecastV1(input);
  assert.deepEqual(first, second);
  assert.equal(first.winner_rank, 1);
  assert.equal(first.top1_hit, true);
  assert.equal(first.top2_hit, true);
  assert.equal(first.top3_hit, true);
  assert.ok(Math.abs(first.log_loss - (-Math.log(0.7))) < 1e-10);
  assert.ok(Math.abs(first.brier_score - 0.18) < 1e-10);

  const calibration = buildCalibrationSummaryV1([
    { winner_entry_id: 'entry-a', forecast: first.forecast },
    { winner_entry_id: 'entry-b', forecast: first.forecast }
  ], 5);
  assert.equal(calibration.bin_count, 5);
  assert.equal(calibration.prediction_count, 4);
  assert.ok(calibration.expected_calibration_error >= 0);
});

test('F1 walk-forward folds are chronological expanding windows with no random split', () => {
  const targets = Array.from({ length: 7 }, (_, index) => ({
    target_group_id: `g${index + 1}`,
    target_at: `2099-01-${String(index + 1).padStart(2, '0')}T12:00:00Z`
  }));
  const result = buildWalkForwardFoldsV1(targets, {
    min_train_groups: 2,
    calibration_groups: 1,
    test_groups: 2,
    step_groups: 2
  });
  assert.equal(result.folds.length, 2);
  assert.deepEqual(result.folds[0].train_group_ids, ['g1','g2']);
  assert.deepEqual(result.folds[0].calibration_group_ids, ['g3']);
  assert.deepEqual(result.folds[0].test_group_ids, ['g4','g5']);
  assert.deepEqual(result.folds[1].train_group_ids, ['g1','g2','g3','g4']);
  assert.deepEqual(result.folds[1].calibration_group_ids, ['g5']);
  assert.deepEqual(result.folds[1].test_group_ids, ['g6','g7']);
});

test('F1 walk-forward never splits equal-time groups across chronology windows', () => {
  const targets = [
    { target_group_id: 'g1', target_at: '2099-01-01T12:00:00Z' },
    { target_group_id: 'g2', target_at: '2099-01-02T12:00:00Z' },
    { target_group_id: 'g3a', target_at: '2099-01-03T12:00:00Z' },
    { target_group_id: 'g3b', target_at: '2099-01-03T12:00:00Z' },
    { target_group_id: 'g4', target_at: '2099-01-04T12:00:00Z' }
  ];
  const result = buildWalkForwardFoldsV1(targets, {
    min_train_groups: 1,
    calibration_groups: 1,
    test_groups: 1,
    step_groups: 1
  });
  assert.equal(result.time_block_count, 4);
  for (const fold of result.folds) {
    const windows = [
      new Set(fold.train_group_ids),
      new Set(fold.calibration_group_ids),
      new Set(fold.test_group_ids)
    ];
    const containing = windows.filter((window) => window.has('g3a') || window.has('g3b'));
    if (containing.length) {
      assert.equal(containing.length, 1);
      assert.ok(containing[0].has('g3a') && containing[0].has('g3b'));
    }
  }
});

test('F1 ablation variants can change only their declared feature family', () => {
  const plan = buildAblationFeatureSetsV1(
    ['capacity','form','equipment_response'],
    ['capacity','form'],
    [
      { id: 'remove-form', feature_family: 'form', mode: 'remove' },
      { id: 'add-equipment', feature_family: 'equipment_response', mode: 'add' }
    ]
  );
  assert.deepEqual(plan.variants.find((variant) => variant.id === 'baseline').feature_families, ['capacity','form']);
  assert.deepEqual(plan.variants.find((variant) => variant.id === 'remove-form').feature_families, ['capacity']);
  assert.deepEqual(plan.variants.find((variant) => variant.id === 'add-equipment').feature_families, ['capacity','equipment_response','form']);

  assert.throws(
    () => buildAblationFeatureSetsV1(['capacity','form'], ['capacity'], [{ id:'bad', feature_family:'capacity', mode:'add' }]),
    /non-baseline family/
  );
});

function seedSportsReplay(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-f1','F1 Track')").run();
  for (const horse of ['a','b']) {
    db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(`horse-${horse}`, `Horse ${horse}`);
  }

  seedSource(db, 'snap-a-early', '2098-12-01T10:00:00Z');
  seedSource(db, 'snap-b-early', '2098-12-01T10:00:00Z');
  db.prepare(`
    INSERT INTO horse_stat_snapshots
      (id,horse_id,observed_at,snapshot_scope,starts,wins,start_points,source_record_id)
    VALUES
      ('stat-a-early','horse-a','2098-12-01T10:00:00Z','life',20,6,70,'snap-a-early'),
      ('stat-b-early','horse-b','2098-12-01T10:00:00Z','life',20,4,30,'snap-b-early')
  `).run();

  for (let index = 1; index <= 3; index += 1) {
    const day = String(index).padStart(2, '0');
    const raceId = `sports-race-${index}`;
    const start = `2099-01-${day}T12:00:00Z`;
    db.prepare(`
      INSERT INTO races
        (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status,source_quality)
      VALUES (?,?,?,?,?,2140,'auto','finished','normalized_verified_subset')
    `).run(raceId, 'track-f1', `2099-01-${day}`, index, start);
    for (const [offset, horse] of ['a','b'].entries()) {
      const entryId = `sports-entry-${index}-${horse}`;
      db.prepare(`
        INSERT INTO race_entries
          (id,race_id,horse_id,start_number,actual_lane,handicap_m,actual_start_distance_m,scratched,data_quality)
        VALUES (?,?,?,?,?,0,2140,0,'synthetic')
      `).run(entryId, raceId, `horse-${horse}`, offset + 1, offset + 1);
      const resultSource = `sports-result-source-${index}-${horse}`;
      seedSource(db, resultSource, `2099-01-${day}T13:00:00Z`);
      db.prepare(`
        INSERT INTO race_results
          (race_entry_id,placing,placing_text,result_status,source_record_id)
        VALUES (?,?,?,?,?)
      `).run(entryId, horse === 'a' ? 1 : 2, horse === 'a' ? '1' : '2', 'official', resultSource);
    }
  }
}

const capacityProducer = {
  version: 'synthetic-capacity-producer-v1',
  fingerprint: `sha256:${'c'.repeat(64)}`,
  async predict({ entries }) {
    const raw = entries.map((entry) => {
      const points = Number(entry.features.capacity?.metrics?.official_start_points?.value ?? 1);
      return { race_entry_id: entry.race_entry_id, points: Math.max(0.001, points) };
    });
    const total = raw.reduce((sum, row) => sum + row.points, 0);
    return raw.map((row) => ({ race_entry_id: row.race_entry_id, probability: row.points / total }));
  }
};

test('F1 sports replay reconstructs as-of features and excludes future official snapshots', async () => {
  const { db, env } = createTestEnv();
  seedSportsReplay(db);
  const config = {
    from: '2099-01-01T00:00:00Z',
    to: '2099-01-03T23:59:59Z',
    baseline_families: ['capacity'],
    walk_forward: { min_train_groups: 1, calibration_groups: 1, test_groups: 1, step_groups: 1 }
  };

  const before = await runSportsFeatureReplayV1(env, config, capacityProducer);
  assert.equal(before.contract_version, REPLAY_CONTRACT_VERSION);
  assert.equal(before.replay_version, REPLAY_VERSION);
  assert.equal(before.track, 'sports_feature');
  assert.equal(before.fold_count, 1);
  assert.equal(before.baseline_summary.target_count, 1);

  seedSource(db, 'snap-a-future', '2099-02-01T10:00:00Z');
  db.prepare(`
    INSERT INTO horse_stat_snapshots
      (id,horse_id,observed_at,snapshot_scope,starts,wins,start_points,source_record_id)
    VALUES ('stat-a-future','horse-a','2099-02-01T10:00:00Z','life',21,20,999,'snap-a-future')
  `).run();

  const after = await runSportsFeatureReplayV1(env, config, capacityProducer);
  assert.equal(after.result_fingerprint, before.result_fingerprint);
  assert.deepEqual(after.baseline_summary, before.baseline_summary);
});

function seedDecisionRound(db, index) {
  const roundId = `decision-round-${index}`;
  const day = String(index).padStart(2, '0');
  const roundDate = `2099-02-${day}`;
  const lockId = `decision-lock-${index}`;
  const lockHash = `sha256:${String(index).repeat(64).slice(0,64)}`;
  const marketFingerprint = `sha256:${String(index + 3).repeat(64).slice(0,64)}`;
  const marketCutoff = `${roundDate}T10:00:00.000Z`;

  db.prepare('INSERT INTO game_rounds (id,game_type,round_date,status) VALUES (?,?,?,?)')
    .run(roundId, 'V85', roundDate, 'finished');
  db.prepare(`
    INSERT INTO analysis_step1_locks (
      id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    lockId, roundId, 'kentaurai-step1-lock-v1', `pack-${index}`, `${roundDate}T09:00:00.000Z`,
    `sha256:${'f'.repeat(64)}`, 'openai', 'synthetic', 'step1-prompt-v3-d2', '{}', lockHash, `${roundDate}T09:05:00.000Z`
  );

  const decisionLegs = [];
  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `decision-race-${index}-${leg}`;
    const start = `${roundDate}T12:${String(leg).padStart(2,'0')}:00.000Z`;
    db.prepare(`
      INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,status)
      VALUES (?,?,?,?,?,'finished')
    `).run(raceId, null, roundDate, leg, start);
    db.prepare('INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)').run(roundId, leg, raceId);

    const entries = [];
    for (const [offset, suffix] of ['a','b'].entries()) {
      const horseId = `decision-horse-${index}-${leg}-${suffix}`;
      const entryId = `decision-entry-${index}-${leg}-${suffix}`;
      db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(horseId, horseId);
      db.prepare('INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,?,?,0)')
        .run(entryId, raceId, horseId, offset + 1);
      const sourceId = `decision-result-source-${index}-${leg}-${suffix}`;
      seedSource(db, sourceId, `${roundDate}T14:00:00.000Z`);
      db.prepare('INSERT INTO race_results (race_entry_id,placing,placing_text,result_status,source_record_id) VALUES (?,?,?,?,?)')
        .run(entryId, suffix === 'a' ? 1 : 2, suffix === 'a' ? '1' : '2', 'official', sourceId);
      entries.push({
        race_entry_id: entryId,
        blind_probability: suffix === 'a' ? 0.6 : 0.4,
        public_win_probability_proxy: null,
        public_proxy_quality: 'unavailable_incomplete_winner_odds',
        decision_probability: suffix === 'a' ? 0.6 : 0.4
      });
    }
    decisionLegs.push({
      leg_number: leg,
      race_id: raceId,
      public_proxy_quality: 'unavailable_incomplete_winner_odds',
      public_proxy_method: null,
      context_reliability: {
        proxy_available: false,
        proxy_quality: 'unavailable_incomplete_winner_odds',
        proxy_method: null,
        ownership_observation_count_min: null,
        snapshot_age_minutes_max: null,
        trend_semantics_verified: false,
        blend_applied: false
      },
      entries
    });
  }

  const policy = {
    decision_source: 'blind_probability',
    market_blend_applied: false,
    ownership_used_as_win_probability: false,
    calibration_status: 'foundation_only_not_fitted'
  };
  const decisionBase = {
    contract_version: 'kentaurai-decision-probability-v1',
    decision_probability_version: 'decision-probability-v1-e1',
    policy_version: 'decision-blind-v1',
    round_id: roundId,
    lock_id: lockId,
    lock_hash: lockHash,
    market_fingerprint: marketFingerprint,
    market_cutoff: marketCutoff,
    policy,
    legs: decisionLegs
  };
  const decisionFingerprint = `sha256:${createHash('sha256').update(stableFeatureJson(decisionBase)).digest('hex')}`;
  const decision = {
    ...decisionBase,
    generated_at: `${roundDate}T10:00:30.000Z`,
    decision_fingerprint: decisionFingerprint
  };
  db.prepare(`
    INSERT INTO analysis_decision_runs (
      id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,contract_version,
      decision_probability_version,policy_version,market_proxy_quality_json,context_reliability_json,
      decision_json,decision_fingerprint,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `decision-run-${index}`,roundId,lockId,lockHash,marketFingerprint,marketCutoff,
    'kentaurai-decision-probability-v1','decision-probability-v1-e1','decision-blind-v1','[]','[]',
    JSON.stringify(decision),decisionFingerprint,`${roundDate}T10:01:00.000Z`
  );

  const optimizerFingerprint = `sha256:${String(index + 9).repeat(64).slice(0,64)}`;
  const optimizerSystem = {
    spike_count: 3,
    row_count: 32,
    cost_sek: 16,
    estimated_p8: 0.216,
    legs: decisionLegs.map((leg) => ({
      leg_number: leg.leg_number,
      is_spike: leg.leg_number <= 3,
      selected_entries: leg.leg_number <= 3
        ? [{ race_entry_id: leg.entries[0].race_entry_id }]
        : leg.entries.map((entry) => ({ race_entry_id: entry.race_entry_id }))
    }))
  };
  const optimizerDocument = {
    contract_version: 'kentaurai-optimizer-v1',
    optimizer_version: 'optimizer-p8-exact3-v1-e2',
    policy_version: 'v85-v86-exact3-main-v1',
    round_id: roundId,
    decision_run_id: `decision-run-${index}`,
    decision_fingerprint: decisionFingerprint,
    optimizer_fingerprint: optimizerFingerprint,
    system: optimizerSystem
  };
  db.prepare(`
    INSERT INTO analysis_optimizer_runs (
      id,game_round_id,decision_run_id,decision_fingerprint,contract_version,optimizer_version,policy_version,
      line_price_sek,target_budget_min_sek,max_budget_sek,spike_count,row_count,cost_sek,estimated_p8,
      policy_json,metrics_json,optimizer_json,optimizer_fingerprint,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `optimizer-run-${index}`,roundId,`decision-run-${index}`,decisionFingerprint,'kentaurai-optimizer-v1',
    'optimizer-p8-exact3-v1-e2','v85-v86-exact3-main-v1',0.5,150,250,3,32,16,0.216,
    '{}','{}',JSON.stringify(optimizerDocument),optimizerFingerprint,`${roundDate}T10:02:00.000Z`
  );

  const step2Fingerprint = `sha256:${String(index + 12).repeat(64).slice(0,64)}`;
  db.prepare(`
    INSERT INTO analysis_step2_results (
      id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,contract_version,step2_version,
      prompt_version,provider,model,result_json,result_fingerprint,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `step2-result-${index}`,roundId,lockId,lockHash,marketFingerprint,marketCutoff,
    'kentaurai-step2-result-v1','step2-result-v1-e3','step2-prompt-v3-e3','openai','synthetic','{}',
    step2Fingerprint,`${roundDate}T10:03:00.000Z`
  );

  const analysisFingerprint = `sha256:${String(index + 15).repeat(64).slice(0,64)}`;
  db.prepare(`
    INSERT INTO analysis_v3_runs (
      id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,step2_result_id,decision_run_id,
      optimizer_run_id,contract_version,analysis_version,step2_version,decision_probability_version,optimizer_version,
      step2_fingerprint,decision_fingerprint,optimizer_fingerprint,analysis_json,analysis_fingerprint,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `analysis-v3-${index}`,roundId,lockId,lockHash,marketFingerprint,marketCutoff,`step2-result-${index}`,
    `decision-run-${index}`,`optimizer-run-${index}`,'kentaurai-analysis-v3','analysis-v3-e3','step2-result-v1-e3',
    'decision-probability-v1-e1','optimizer-p8-exact3-v1-e2',step2Fingerprint,decisionFingerprint,
    optimizerFingerprint,'{}',analysisFingerprint,`${roundDate}T10:04:00.000Z`
  );
}

test('F1 V85/V86 decision replay is reproducible, walk-forward and persists exact version metadata', async () => {
  const { db, env } = createTestEnv();
  for (let index = 1; index <= 3; index += 1) seedDecisionRound(db, index);

  const config = {
    from: '2099-02-01T00:00:00Z',
    to: '2099-02-03T23:59:59Z',
    decision_probability_version: 'decision-probability-v1-e1',
    walk_forward: { min_train_groups: 1, calibration_groups: 1, test_groups: 1, step_groups: 1 }
  };
  const first = await runDecisionReplayV1(env, config);
  const second = await runDecisionReplayV1(env, config);
  assert.equal(first.result_fingerprint, second.result_fingerprint);
  assert.deepEqual(first.decision_summary, second.decision_summary);
  assert.equal(first.fold_count, 1);
  assert.equal(first.decision_summary.target_count, 8);
  assert.equal(first.decision_summary.mean_log_loss, first.blind_summary.mean_log_loss);
  assert.equal(first.decision_summary.mean_brier_score, first.blind_summary.mean_brier_score);
  assert.equal(first.decision_minus_blind.delta_log_loss, 0);
  assert.equal(first.decision_minus_blind.delta_brier, 0);
  assert.equal(first.system_summary.system_count, 1);
  assert.equal(first.system_summary.observed_p8_rate, 1);
  assert.equal(first.system_summary.spike_miss_rate, 0);
  assert.equal(first.version_metadata.decision_lineages.length, 3);
  assert.equal(first.version_metadata.decision_lineages[0].version_metadata.step1_prompt_version, 'step1-prompt-v3-d2');
  assert.equal(first.version_metadata.decision_lineages[0].version_metadata.optimizer_lineage[0].optimizer_version, 'optimizer-p8-exact3-v1-e2');
  assert.equal(first.version_metadata.decision_lineages[0].version_metadata.integrated_lineage[0].analysis_version, 'analysis-v3-e3');
  assert.equal(first.version_metadata.decision_lineages[0].version_metadata.integrated_lineage[0].step2_prompt_version, 'step2-prompt-v3-e3');

  const saved = await persistReplayResultV1(env, first, { createdAt: '2099-03-01T00:00:00Z' });
  assert.equal(saved.reused, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM replay_runs').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM forecast_evaluations').get().n, 48);

  const retry = await persistReplayResultV1(env, second, { createdAt: '2099-03-02T00:00:00Z' });
  assert.equal(retry.reused, true);
  assert.equal(retry.id, saved.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM replay_runs').get().n, 1);
});

test('F1 excludes a decision snapshot whose market cutoff is after race start', async () => {
  const { db, env } = createTestEnv();
  seedDecisionRound(db, 1);
  db.prepare("UPDATE analysis_decision_runs SET market_cutoff='2099-02-01T13:00:00.000Z' WHERE id='decision-run-1'").run();

  const result = await runDecisionReplayV1(env, {
    from: '2099-02-01T00:00:00Z',
    to: '2099-02-01T23:59:59Z',
    walk_forward: { min_train_groups: 1, calibration_groups: 1, test_groups: 1, step_groups: 1 }
  });
  assert.equal(result.target_count, 0);
  assert.equal(result.status, 'insufficient_evidence');
});


test('F1 keeps a designated regression-only round outside promotion evidence', async () => {
  const { db, env } = createTestEnv();
  for (let index = 1; index <= 4; index += 1) seedDecisionRound(db, index);

  const result = await runDecisionReplayV1(env, {
    from: '2099-02-01T00:00:00Z',
    to: '2099-02-04T23:59:59Z',
    decision_probability_version: 'decision-probability-v1-e1',
    regression_only_round_ids: ['decision-round-1'],
    walk_forward: { min_train_groups: 1, calibration_groups: 1, test_groups: 1, step_groups: 1 }
  });

  assert.equal(result.fold_count, 1);
  assert.equal(result.target_count, 32);
  assert.equal(result.evidence_target_count, 24);
  assert.equal(result.regression_only_target_count, 8);
  assert.equal(result.decision_summary.target_count, 8);
  assert.equal(result.regression_only_summary.decision.target_count, 8);
  assert.equal(result.regression_only_summary.systems.system_count, 1);
  assert.ok(!result.walk_forward.folds.flatMap((fold) => fold.test_group_ids).includes('decision-round-1'));
});

test('F1 rejects tampered canonical E1 decision content', async () => {
  const { db, env } = createTestEnv();
  seedDecisionRound(db, 1);
  const row = db.prepare("SELECT decision_json FROM analysis_decision_runs WHERE id='decision-run-1'").get();
  const decision = JSON.parse(row.decision_json);
  decision.legs[0].entries[0].decision_probability = 0.65;
  decision.legs[0].entries[1].decision_probability = 0.35;
  db.prepare("UPDATE analysis_decision_runs SET decision_json=? WHERE id='decision-run-1'")
    .run(JSON.stringify(decision));

  await assert.rejects(
    () => runDecisionReplayV1(env, {
      from: '2099-02-01T00:00:00Z',
      to: '2099-02-01T23:59:59Z',
      walk_forward: { min_train_groups: 1, calibration_groups: 1, test_groups: 1, step_groups: 1 }
    }),
    /decision_probability must equal blind_probability|decision_fingerprint does not match/
  );
});

test('F1 persistence rejects tampered evaluation scores before writing', async () => {
  const { db, env } = createTestEnv();
  for (let index = 1; index <= 3; index += 1) seedDecisionRound(db, index);
  const result = await runDecisionReplayV1(env, {
    from: '2099-02-01T00:00:00Z',
    to: '2099-02-03T23:59:59Z',
    decision_probability_version: 'decision-probability-v1-e1',
    walk_forward: { min_train_groups: 1, calibration_groups: 1, test_groups: 1, step_groups: 1 }
  });
  result.evaluations[0].log_loss += 0.01;

  await assert.rejects(
    () => persistReplayResultV1(env, result),
    /log_loss does not match forecast score/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM replay_runs').get().n, 0);
});


test('F1 excludes post-start optimizer and integration rows from system evidence', async () => {
  const { db, env } = createTestEnv();
  for (let index = 1; index <= 3; index += 1) seedDecisionRound(db, index);
  db.prepare("UPDATE analysis_optimizer_runs SET created_at='2099-02-03T13:00:00.000Z' WHERE id='optimizer-run-3'").run();
  db.prepare("UPDATE analysis_step2_results SET created_at='2099-02-03T13:00:00.000Z' WHERE id='step2-result-3'").run();
  db.prepare("UPDATE analysis_v3_runs SET created_at='2099-02-03T13:01:00.000Z' WHERE id='analysis-v3-3'").run();

  const result = await runDecisionReplayV1(env, {
    from: '2099-02-01T00:00:00Z',
    to: '2099-02-03T23:59:59Z',
    decision_probability_version: 'decision-probability-v1-e1',
    walk_forward: { min_train_groups: 1, calibration_groups: 1, test_groups: 1, step_groups: 1 }
  });

  assert.equal(result.decision_summary.target_count, 8);
  assert.equal(result.system_summary.system_count, 0);
  assert.equal(result.exclusions.post_start_optimizer, 1);
  assert.equal(result.exclusions.post_start_integration, 1);
});
