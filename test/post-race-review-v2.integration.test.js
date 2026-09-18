import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import { runNextPostRaceReview } from '../src/post-race-review.js';
import { POST_RACE_REVIEW_V2_VERSION } from '../src/post-race-review-v2.js';
import { stableFeatureJson } from '../src/analysis-v3-foundations.js';

function seedV3SettledRound(db) {
  const roundId = 'round_f2';
  const lockId = 'lock_f2';
  const decisionId = 'decision_f2';
  const optimizerId = 'optimizer_f2';
  const analysisId = 'analysis_f2';
  let lockHash = null;
  const decisionFingerprint = 'sha256:' + '2'.repeat(64);
  const optimizerFingerprint = 'sha256:' + '3'.repeat(64);
  const analysisFingerprint = 'sha256:' + '4'.repeat(64);
  const step2Fingerprint = 'sha256:' + '5'.repeat(64);
  const marketFingerprint = 'sha256:' + '6'.repeat(64);

  db.prepare(`INSERT INTO tracks (id,canonical_name,country_code) VALUES ('track_f2','F2 Park','SE')`).run();
  db.prepare(`INSERT INTO game_rounds (id,game_type,round_date,status) VALUES (?, 'V85','2099-03-01','finished')`).run(roundId);

  for (const suffix of ['a','b','c']) {
    db.prepare(`INSERT INTO horses (id,canonical_name) VALUES (?,?)`).run(`horse_f2_${suffix}`, `Horse ${suffix.toUpperCase()}`);
  }

  const lockLegs = [];
  const decisionLegs = [];
  const optimizerLegs = [];

  for (let leg = 1; leg <= 8; leg += 1) {
    const raceId = `race_f2_${leg}`;
    const startAt = `2099-03-01T12:${String(leg).padStart(2,'0')}:00Z`;
    db.prepare(`
      INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,status)
      VALUES (?, 'track_f2','2099-03-01',?,?, 'results')
    `).run(raceId,leg,startAt);
    db.prepare(`INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)`).run(roundId,leg,raceId);

    for (const [index,suffix] of ['a','b','c'].entries()) {
      db.prepare(`
        INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched)
        VALUES (?,?,?,?,0)
      `).run(`entry_f2_${leg}_${suffix}`,raceId,`horse_f2_${suffix}`,index + 1);
    }
    db.prepare(`
      INSERT INTO race_results (race_entry_id,placing,placing_text,gallop,disqualified,result_status)
      VALUES (?,1,'1',0,0,'official'), (?,2,'2',0,0,'official'), (?,3,'3',0,0,'official')
    `).run(`entry_f2_${leg}_a`,`entry_f2_${leg}_b`,`entry_f2_${leg}_c`);

    let predictions;
    if (leg === 1) {
      predictions = [
        { race_entry_id: `entry_f2_${leg}_b`, blind_probability: 0.6, raw_rank: 1, assessment_confidence: 0.8 },
        { race_entry_id: `entry_f2_${leg}_a`, blind_probability: 0.3, raw_rank: 2, assessment_confidence: 0.7 },
        { race_entry_id: `entry_f2_${leg}_c`, blind_probability: 0.1, raw_rank: 3, assessment_confidence: 0.5 }
      ];
    } else if (leg === 4) {
      predictions = [
        { race_entry_id: `entry_f2_${leg}_b`, blind_probability: 0.5, raw_rank: 1, assessment_confidence: 0.8 },
        { race_entry_id: `entry_f2_${leg}_c`, blind_probability: 0.3, raw_rank: 2, assessment_confidence: 0.7 },
        { race_entry_id: `entry_f2_${leg}_a`, blind_probability: 0.2, raw_rank: 3, assessment_confidence: 0.6 }
      ];
    } else {
      predictions = [
        { race_entry_id: `entry_f2_${leg}_a`, blind_probability: 0.6, raw_rank: 1, assessment_confidence: 0.8 },
        { race_entry_id: `entry_f2_${leg}_b`, blind_probability: 0.3, raw_rank: 2, assessment_confidence: 0.7 },
        { race_entry_id: `entry_f2_${leg}_c`, blind_probability: 0.1, raw_rank: 3, assessment_confidence: 0.5 }
      ];
    }

    lockLegs.push({
      leg_number: leg,
      race_id: raceId,
      data_quality_summary: `Synthetic sealed quality leg ${leg}`,
      race_shape_summary: 'Synthetic shape.',
      scenario_confidence: 0.55,
      scenarios: [],
      predictions
    });

    decisionLegs.push({
      leg_number: leg,
      entries: predictions.map((prediction) => ({
        race_entry_id: prediction.race_entry_id,
        blind_probability: prediction.blind_probability,
        public_win_probability_proxy: null,
        public_proxy_quality: 'unavailable',
        decision_probability: prediction.blind_probability
      }))
    });

    let selectedIds;
    const isSpike = leg <= 3;
    if (leg === 1) selectedIds = [`entry_f2_${leg}_b`];
    else if (leg === 4) selectedIds = [`entry_f2_${leg}_b`,`entry_f2_${leg}_c`];
    else if (isSpike) selectedIds = [`entry_f2_${leg}_a`];
    else selectedIds = [`entry_f2_${leg}_a`,`entry_f2_${leg}_b`];

    optimizerLegs.push({
      leg_number: leg,
      is_spike: isSpike,
      selected_entries: selectedIds.map((raceEntryId) => ({
        race_entry_id: raceEntryId,
        decision_probability: decisionLegs[leg - 1].entries.find((entry) => entry.race_entry_id === raceEntryId).decision_probability
      }))
    });
  }

  const lock = {
    contract_version: 'kentaurai-step1-lock-v1',
    lock_id: lockId,
    round_id: roundId,
    pack: { pack_id: 'pack_f2', as_of: '2099-03-01T09:00:00.000Z', facts_fingerprint: 'sha256:' + '7'.repeat(64) },
    provider: 'openai',
    model: 'synthetic-model',
    prompt_version: 'step1-prompt-v3-d2',
    legs: lockLegs
  };
  lockHash = `sha256:${createHash('sha256').update(stableFeatureJson(lock)).digest('hex')}`;
  const decision = {
    contract_version: 'kentaurai-decision-probability-v1',
    round_id: roundId,
    lock_id: lockId,
    lock_hash: lockHash,
    market_fingerprint: marketFingerprint,
    market_cutoff: '2099-03-01T10:30:00.000Z',
    decision_probability_version: 'decision-probability-v1-e1',
    policy_version: 'blind-equals-decision-v1',
    decision_fingerprint: decisionFingerprint,
    legs: decisionLegs
  };
  const optimizer = {
    contract_version: 'kentaurai-optimizer-v1',
    optimizer_version: 'optimizer-p8-exact3-v1-e2',
    policy_version: 'v85-v86-exact3-main-v1',
    round_id: roundId,
    decision_run_id: decisionId,
    decision_fingerprint: decisionFingerprint,
    optimizer_fingerprint: optimizerFingerprint,
    system: {
      line_price_sek: 0.5,
      target_budget_min_sek: 150,
      max_budget_sek: 250,
      spike_count: 3,
      row_count: 32,
      cost_sek: 16,
      estimated_p8: 0.25,
      legs: optimizerLegs
    }
  };

  db.prepare(`
    INSERT INTO analysis_step1_locks (
      id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,
      lock_json,lock_hash,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'2099-03-01T09:05:00.000Z')
  `).run(lockId,roundId,'kentaurai-step1-lock-v1','pack_f2','2099-03-01T09:00:00.000Z',lock.pack.facts_fingerprint,
    'openai','synthetic-model','step1-prompt-v3-d2',JSON.stringify(lock),lockHash);

  db.prepare(`
    INSERT INTO analysis_decision_runs (
      id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,contract_version,
      decision_probability_version,policy_version,market_proxy_quality_json,context_reliability_json,
      decision_json,decision_fingerprint,created_at
    ) VALUES (?,?,?,?,?,?,'kentaurai-decision-probability-v1','decision-probability-v1-e1','blind-equals-decision-v1','{}','{}',?,?,?)
  `).run(decisionId,roundId,lockId,lockHash,marketFingerprint,'2099-03-01T10:30:00.000Z',
    JSON.stringify(decision),decisionFingerprint,'2099-03-01T10:31:00.000Z');

  for (const leg of decisionLegs) {
    for (const entry of leg.entries) {
      db.prepare(`
        INSERT INTO analysis_decision_probabilities (
          decision_run_id,leg_number,race_entry_id,blind_probability,public_win_probability_proxy,public_proxy_quality,decision_probability
        ) VALUES (?,?,?,?,?,?,?)
      `).run(decisionId,leg.leg_number,entry.race_entry_id,entry.blind_probability,null,'unavailable',entry.decision_probability);
    }
  }

  db.prepare(`
    INSERT INTO analysis_optimizer_runs (
      id,game_round_id,decision_run_id,decision_fingerprint,contract_version,optimizer_version,policy_version,
      line_price_sek,target_budget_min_sek,max_budget_sek,spike_count,row_count,cost_sek,estimated_p8,
      policy_json,metrics_json,optimizer_json,optimizer_fingerprint,created_at
    ) VALUES (?,?,?,?,'kentaurai-optimizer-v1','optimizer-p8-exact3-v1-e2','v85-v86-exact3-main-v1',
      0.5,150,250,3,32,16,0.25,'{}','{}',?,?,?)
  `).run(optimizerId,roundId,decisionId,decisionFingerprint,JSON.stringify(optimizer),optimizerFingerprint,'2099-03-01T10:32:00.000Z');

  for (const leg of optimizerLegs) {
    for (const entry of leg.selected_entries) {
      db.prepare(`
        INSERT INTO analysis_optimizer_selections (
          optimizer_run_id,leg_number,race_entry_id,is_spike,decision_probability
        ) VALUES (?,?,?,?,?)
      `).run(optimizerId,leg.leg_number,entry.race_entry_id,leg.is_spike ? 1 : 0,entry.decision_probability);
    }
  }

  db.prepare(`
    INSERT INTO analysis_step2_results (
      id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,contract_version,step2_version,
      prompt_version,provider,model,result_json,result_fingerprint,created_at
    ) VALUES ('step2_f2',?,?,?,?,?,'kentaurai-step2-result-v1','step2-result-v1-e3','step2-prompt-v3-e3','openai','synthetic-model','{}',?,'2099-03-01T10:33:00.000Z')
  `).run(roundId,lockId,lockHash,marketFingerprint,'2099-03-01T10:30:00.000Z',step2Fingerprint);

  db.prepare(`
    INSERT INTO analysis_v3_runs (
      id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,step2_result_id,decision_run_id,optimizer_run_id,
      contract_version,analysis_version,step2_version,decision_probability_version,optimizer_version,
      step2_fingerprint,decision_fingerprint,optimizer_fingerprint,analysis_json,analysis_fingerprint,created_at
    ) VALUES (?,?,?,?,?,?,'step2_f2',?,?,'kentaurai-analysis-v3','analysis-v3-e3','step2-result-v1-e3',
      'decision-probability-v1-e1','optimizer-p8-exact3-v1-e2',?,?,?,'{}',?,'2099-03-01T10:34:00.000Z')
  `).run(analysisId,roundId,lockId,lockHash,marketFingerprint,'2099-03-01T10:30:00.000Z',
    decisionId,optimizerId,step2Fingerprint,decisionFingerprint,optimizerFingerprint,analysisFingerprint);

  db.prepare(`
    INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,bet_percent,market_rank)
    VALUES
      ('market_f2_early',?,1,'entry_f2_1_a','2099-03-01T10:00:00.000Z',0.30,2),
      ('market_f2_future',?,1,'entry_f2_1_a','2099-03-01T11:00:00.000Z',0.90,1)
  `).run(roundId,roundId);

  return { roundId, lockId, analysisId, analysisFingerprint };
}

test('F2 stores immutable v3 probability, market, optimizer and learning diagnostics', async () => {
  const { env, db } = createTestEnv();
  const seeded = seedV3SettledRound(db);
  const lockBefore = db.prepare('SELECT lock_json FROM analysis_step1_locks WHERE id=?').get(seeded.lockId).lock_json;

  const result = await runNextPostRaceReview(env, { roundId: seeded.roundId });
  assert.equal(result.status, 'completed');
  assert.equal(result.reviewVersion, POST_RACE_REVIEW_V2_VERSION);
  assert.equal(result.reviews, 8);

  const rows = db.prepare(`
    SELECT leg_number,winner_blind_probability,winner_decision_probability,winner_rank,winner_market_percent,
      winner_market_rank,optimizer_selected,optimizer_is_spike,failure_class,learning_eligible,learning_classification,
      scenario_match,coverage_json,pre_race_fingerprint
    FROM post_race_reviews_v2
    WHERE analysis_v3_id=?
    ORDER BY leg_number
  `).all(seeded.analysisId);
  assert.equal(rows.length, 8);
  assert.equal(rows[0].failure_class, 'spike');
  assert.equal(rows[0].learning_eligible, 1);
  assert.equal(rows[0].learning_classification, 'candidate_learning');
  assert.equal(rows[0].winner_market_percent, 0.30);
  assert.equal(rows[0].winner_market_rank, 2);
  assert.equal(rows[0].optimizer_selected, 0);
  assert.equal(rows[0].optimizer_is_spike, 1);
  assert.equal(rows[3].failure_class, 'ranking');
  assert.equal(rows[3].winner_rank, 3);
  assert.equal(rows[3].optimizer_selected, 0);
  assert.ok(rows.filter((row) => row.failure_class == null).every((row) => row.learning_classification === 'no_change'));
  assert.ok(rows.every((row) => row.scenario_match === 'unavailable'));
  assert.ok(rows.every((row) => JSON.parse(row.coverage_json).status === 'not_structured_in_step1_lock'));
  assert.ok(rows.every((row) => row.pre_race_fingerprint === seeded.analysisFingerprint));

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learning_hypotheses').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learning_observations').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM post_race_learning_links').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM model_change_log').get().count, 0);

  const lockAfter = db.prepare('SELECT lock_json FROM analysis_step1_locks WHERE id=?').get(seeded.lockId).lock_json;
  assert.equal(lockAfter, lockBefore);
  assert.equal(db.prepare('SELECT analysis_fingerprint FROM analysis_v3_runs WHERE id=?').get(seeded.analysisId).analysis_fingerprint, seeded.analysisFingerprint);
});

test('F2 reviews reference rounds diagnostically but never turns them into learning evidence', async () => {
  const { env, db } = createTestEnv();
  const seeded = seedV3SettledRound(db);
  db.prepare(`
    INSERT INTO source_records (id,source_type,external_id,fetched_at)
    VALUES ('reference_source_f2','reference_import','synthetic-f2','2099-03-01T08:00:00Z')
  `).run();
  db.prepare(`
    INSERT INTO reference_round_exports (
      id,game_round_id,source_record_id,export_version,captured_at,source_count,race_count,entry_count
    ) VALUES ('reference_export_f2',?,'reference_source_f2','kentaurai-reference-v1','2099-03-01T08:00:00Z',1,8,24)
  `).run(seeded.roundId);

  const result = await runNextPostRaceReview(env, { roundId: seeded.roundId });
  assert.equal(result.status, 'completed');
  assert.equal(result.reviews, 8);

  const rows = db.prepare(`
    SELECT failure_class,learning_eligible,learning_classification
    FROM post_race_reviews_v2 ORDER BY leg_number
  `).all();
  assert.ok(rows.some((row) => row.failure_class != null));
  assert.ok(rows.every((row) => row.learning_eligible === 0));
  assert.ok(rows.every((row) => row.learning_classification === 'no_change'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learning_observations').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM post_race_learning_links').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM model_change_log').get().count, 0);
});

test('F2 post-race review is idempotent and does not duplicate learning evidence', async () => {
  const { env, db } = createTestEnv();
  const seeded = seedV3SettledRound(db);
  await runNextPostRaceReview(env, { roundId: seeded.roundId });
  const second = await runNextPostRaceReview(env, { roundId: seeded.roundId });
  assert.equal(second.status, 'idle');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM post_race_reviews_v2').get().count, 8);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM learning_observations').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM model_change_log').get().count, 0);
});

test('F2 fails closed on a dead heat or ambiguous winner', async () => {
  const { env, db } = createTestEnv();
  const seeded = seedV3SettledRound(db);
  db.prepare(`
    UPDATE race_results SET placing=1,placing_text='1'
    WHERE race_entry_id='entry_f2_8_b'
  `).run();

  const result = await runNextPostRaceReview(env, { roundId: seeded.roundId });
  assert.equal(result.status, 'idle');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM post_race_reviews_v2').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM model_change_log').get().count, 0);
});

test('F2 rejects tampered Step 1 content and post-race parent timestamps', async () => {
  {
    const { env, db } = createTestEnv();
    const seeded = seedV3SettledRound(db);
    const storedLock = JSON.parse(db.prepare('SELECT lock_json FROM analysis_step1_locks WHERE id=?').get(seeded.lockId).lock_json);
    storedLock.legs[0].data_quality_summary = 'Tampered after seal';
    db.prepare('UPDATE analysis_step1_locks SET lock_json=? WHERE id=?').run(JSON.stringify(storedLock),seeded.lockId);
    await assert.rejects(
      () => runNextPostRaceReview(env, { roundId: seeded.roundId }),
      /Step 1 lock content does not match stored hash/
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM post_race_reviews_v2').get().count, 0);
  }

  for (const [table, idColumn, idValue, timeColumn, timestamp, pattern] of [
    ['analysis_step1_locks','id','lock_f2','created_at','2099-03-01T10:30:00.000Z',/Step 1 lock is not sealed before market cutoff/],
    ['analysis_decision_runs','id','decision_f2','created_at','2099-03-01T12:01:00.000Z',/v3 lineage is not strictly pre-race/],
    ['analysis_optimizer_runs','id','optimizer_f2','created_at','2099-03-01T12:01:00.000Z',/v3 lineage is not strictly pre-race/]
  ]) {
    const { env, db } = createTestEnv();
    const seeded = seedV3SettledRound(db);
    db.prepare(`UPDATE ${table} SET ${timeColumn}=? WHERE ${idColumn}=?`).run(timestamp,idValue);
    await assert.rejects(
      () => runNextPostRaceReview(env, { roundId: seeded.roundId }),
      pattern
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM post_race_reviews_v2').get().count, 0);
  }
});

test('F2 fails closed if deterministic learning evidence was previously tampered', async () => {
  const { env, db } = createTestEnv();
  const seeded = seedV3SettledRound(db);
  await runNextPostRaceReview(env, { roundId: seeded.roundId });

  db.prepare(`
    DELETE FROM post_race_learning_links
    WHERE review_id=(SELECT id FROM post_race_reviews_v2 WHERE leg_number=1)
  `).run();
  db.prepare(`
    UPDATE learning_observations
    SET evidence_json='{"tampered":true}'
    WHERE race_id='race_f2_1'
  `).run();

  db.prepare(`DELETE FROM post_race_reviews_v2 WHERE leg_number=8`).run();
  await assert.rejects(
    () => runNextPostRaceReview(env, { roundId: seeded.roundId }),
    /conflicts with deterministic review evidence/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM model_change_log').get().count, 0);
});

test('F2 rejects analysis or market lineage created at the first-race boundary', async () => {
  const { env, db } = createTestEnv();
  const seeded = seedV3SettledRound(db);
  db.prepare(`
    UPDATE analysis_v3_runs
    SET created_at='2099-03-01T12:01:00.000Z'
    WHERE id=?
  `).run(seeded.analysisId);

  let result = await runNextPostRaceReview(env, { roundId: seeded.roundId });
  assert.equal(result.status, 'idle');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM post_race_reviews_v2').get().count, 0);

  db.prepare(`
    UPDATE analysis_v3_runs
    SET created_at='2099-03-01T10:34:00.000Z',market_cutoff='2099-03-01T12:01:00.000Z'
    WHERE id=?
  `).run(seeded.analysisId);
  result = await runNextPostRaceReview(env, { roundId: seeded.roundId });
  assert.equal(result.status, 'idle');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM post_race_reviews_v2').get().count, 0);
});
