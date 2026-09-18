import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import {
  ANALYSIS_OPTIMIZER_VERSION,
  persistOptimizerV1
} from '../src/analysis-optimizer-v1.js';

globalThis.crypto ??= webcrypto;

const DECISION_FP = `sha256:${'2'.repeat(64)}`;

function decisionDocument() {
  return {
    contract_version: 'kentaurai-decision-probability-v1',
    decision_probability_version: 'decision-probability-v1-e1',
    policy_version: 'decision-blind-v1',
    round_id: 'round-e2',
    lock_id: 'lock-e2',
    lock_hash: 'sha256:lock-e2',
    decision_fingerprint: DECISION_FP,
    legs: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      return {
        leg_number: leg,
        race_id: `race-${leg}`,
        entries: [
          { race_entry_id: `entry-${leg}-a`, decision_probability: 0.6 },
          { race_entry_id: `entry-${leg}-b`, decision_probability: 0.4 }
        ]
      };
    })
  };
}

function seedParents(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-e2','Synthetic E2')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('round-e2','V85','2099-06-01')").run();
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare('INSERT INTO races (id,track_id,race_date,race_number) VALUES (?,?,?,?)').run(`race-${leg}`, 'track-e2', '2099-06-01', leg);
    db.prepare('INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)').run('round-e2', leg, `race-${leg}`);
    for (const suffix of ['a', 'b']) {
      db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(`horse-${leg}-${suffix}`, `Horse ${leg} ${suffix}`);
      db.prepare('INSERT INTO race_entries (id,race_id,horse_id,start_number) VALUES (?,?,?,?)').run(
        `entry-${leg}-${suffix}`, `race-${leg}`, `horse-${leg}-${suffix}`, suffix === 'a' ? 1 : 2
      );
    }
  }

  db.prepare(`INSERT INTO analysis_step1_locks (
    id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'lock-e2','round-e2','kentaurai-step1-lock-v1','pack-e2','2099-06-01T11:00:00.000Z','sha256:facts-e2',
    'openai','synthetic','step1-prompt-v3-d2','{}','sha256:lock-e2','2099-06-01T11:05:00.000Z'
  );

  const decision = decisionDocument();
  db.prepare(`INSERT INTO analysis_decision_runs (
    id,game_round_id,lock_id,lock_hash,market_fingerprint,market_cutoff,contract_version,
    decision_probability_version,policy_version,market_proxy_quality_json,context_reliability_json,
    decision_json,decision_fingerprint,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'decision-e2','round-e2','lock-e2','sha256:lock-e2','sha256:market-e2','2099-06-01T12:00:00.000Z',
    'kentaurai-decision-probability-v1','decision-probability-v1-e1','decision-blind-v1','[]','[]',
    JSON.stringify(decision),DECISION_FP,'2099-06-01T12:00:05.000Z'
  );
}

test('E2 persists optimizer metrics and selections idempotently from a stored E1 decision run', async () => {
  const { db, env } = createTestEnv();
  seedParents(db);

  const first = await persistOptimizerV1(env, 'round-e2', {
    decision_run_id: 'decision-e2',
    line_price_sek: 0.5,
    target_budget_min_sek: 150,
    max_budget_sek: 250,
    generatedAt: '2099-06-01T12:05:00.000Z',
    createdAt: '2099-06-01T12:05:01.000Z'
  });
  assert.equal(first.reused, false);
  assert.equal(first.optimizer_version, ANALYSIS_OPTIMIZER_VERSION);
  assert.equal(first.optimizer.system.spike_count, 3);

  const run = db.prepare('SELECT * FROM analysis_optimizer_runs WHERE id=?').get(first.id);
  assert.equal(run.spike_count, 3);
  assert.equal(run.row_count, first.optimizer.system.row_count);
  assert.equal(run.cost_sek, first.optimizer.system.cost_sek);
  assert.match(run.policy_json, /exact_spike_count/);
  assert.match(run.metrics_json, /states_evaluated/);

  const selectionCount = first.optimizer.system.legs.reduce((sum, leg) => sum + leg.selected_count, 0);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM analysis_optimizer_selections WHERE optimizer_run_id=?').get(first.id).n,
    selectionCount
  );
  assert.equal(
    db.prepare('SELECT COUNT(DISTINCT leg_number) AS n FROM analysis_optimizer_selections WHERE optimizer_run_id=? AND is_spike=1').get(first.id).n,
    3
  );

  const retry = await persistOptimizerV1(env, 'round-e2', {
    decision_run_id: 'decision-e2',
    line_price_sek: 0.5,
    target_budget_min_sek: 150,
    max_budget_sek: 250,
    generatedAt: '2099-06-01T12:30:00.000Z',
    createdAt: '2099-06-01T12:30:01.000Z'
  });
  assert.equal(retry.reused, true);
  assert.equal(retry.id, first.id);
  assert.equal(retry.optimizer.generated_at, first.optimizer.generated_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_optimizer_runs').get().n, 1);
});

test('E2 refuses to optimize a decision bound to a superseded Step 1 lock', async () => {
  const { db, env } = createTestEnv();
  seedParents(db);
  db.prepare(`INSERT INTO analysis_step1_locks (
    id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'lock-e2-new','round-e2','kentaurai-step1-lock-v1','pack-e2-new','2099-06-01T11:30:00.000Z','sha256:facts-e2-new',
    'openai','synthetic','step1-prompt-v3-d2','{}','sha256:lock-e2-new','2099-06-01T11:35:00.000Z'
  );

  await assert.rejects(
    () => persistOptimizerV1(env, 'round-e2', {
      decision_run_id: 'decision-e2',
      line_price_sek: 0.5,
      target_budget_min_sek: 150,
      max_budget_sek: 250
    }),
    /newest sealed Step 1 lock|older lock is superseded/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_optimizer_runs').get().n, 0);
});


test('E2 refuses to optimize when the current active field has drifted after the decision', async () => {
  const { db, env } = createTestEnv();
  seedParents(db);
  db.prepare("UPDATE race_entries SET scratched=1 WHERE id='entry-1-a'").run();

  await assert.rejects(
    () => persistOptimizerV1(env, 'round-e2', {
      decision_run_id: 'decision-e2',
      line_price_sek: 0.5,
      target_budget_min_sek: 150,
      max_budget_sek: 250
    }),
    /current active field no longer matches/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_optimizer_runs').get().n, 0);
});


test('E2 canonical persistence rejects a forged decision parent even when optimizer content is otherwise valid', async () => {
  const { db, env } = createTestEnv();
  seedParents(db);

  const storedDecision = decisionDocument();
  const forgedDecision = structuredClone(storedDecision);
  forgedDecision.legs[0].entries = [
    { race_entry_id: 'entry-1-a', decision_probability: 0.55 },
    { race_entry_id: 'entry-1-b', decision_probability: 0.45 }
  ];

  const { buildCanonicalOptimizerV1, persistCanonicalOptimizerV1 } = await import('../src/analysis-optimizer-v1.js');
  const optimizer = await buildCanonicalOptimizerV1({
    decision: forgedDecision,
    decisionRunId: 'decision-e2',
    gameType: 'V85',
    policy: {
      line_price_sek: 0.5,
      target_budget_min_sek: 150,
      max_budget_sek: 250
    },
    generatedAt: '2099-06-01T12:10:00.000Z'
  });

  await assert.rejects(
    () => persistCanonicalOptimizerV1(env, optimizer, forgedDecision),
    /decision parent does not match the stored E1 decision run/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_optimizer_runs').get().n, 0);
});
