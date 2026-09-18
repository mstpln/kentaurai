import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import {
  ANALYSIS_V3_NARRATIVE_CONTRACT,
  buildFinalNarrativePromptV1,
  getAnalysisV3,
  normalizeStep2ResultV1,
  persistFinalNarrativeV1,
  persistIntegratedStep2V1
} from '../src/analysis-step2-integration-v1.js';
import {
  ANALYSIS_STEP2_PROMPT_VERSION,
  ANALYSIS_STEP2_RESULT_CONTRACT,
  ANALYSIS_STEP2_VERSION,
  getAnalysisStep2PromptV3
} from '../src/analysis-step2-prompt-v3.js';

globalThis.crypto ??= webcrypto;

const LOCK_HASH = `sha256:${'a'.repeat(64)}`;
const MARKET_FP = `sha256:${'b'.repeat(64)}`;

function lockDocument() {
  return {
    contract_version: 'kentaurai-step1-lock-v1',
    lock_id: 'lock-e3',
    round_id: 'round-e3',
    pack: {
      pack_id: 'pack-e3',
      as_of: '2099-07-01T10:00:00.000Z',
      facts_fingerprint: `sha256:${'c'.repeat(64)}`
    },
    provider: 'openai',
    model: 'synthetic',
    prompt_version: 'step1-prompt-v3-d2',
    legs: Array.from({ length: 8 }, (_, i) => {
      const leg = i + 1;
      return {
        leg_number: leg,
        race_id: `race-${leg}`,
        predictions: [
          { race_entry_id: `entry-${leg}-a`, blind_probability: 0.6, raw_rank: 1, abcd_group: 'A' },
          { race_entry_id: `entry-${leg}-b`, blind_probability: 0.4, raw_rank: 2, abcd_group: 'B' }
        ]
      };
    })
  };
}

function marketPack() {
  return {
    manifest: {
      contract_version: 'kentaurai-market-pack-v3',
      pack_version: 'market-pack-v3-d4',
      round_id: 'round-e3',
      cutoff: '2099-07-01T10:30:00.000Z',
      lock: {
        lock_id: 'lock-e3',
        lock_hash: LOCK_HASH
      },
      market_fingerprint: MARKET_FP
    },
    files: Array.from({ length: 8 }, (_, i) => {
      const leg = i + 1;
      return {
        name: `${String(leg).padStart(2, '0')}_leg_${leg}_market.json`,
        payload: {
          contract_version: 'kentaurai-market-pack-v3',
          pack_version: 'market-pack-v3-d4',
          round_id: 'round-e3',
          lock_id: 'lock-e3',
          lock_hash: LOCK_HASH,
          market_fingerprint: MARKET_FP,
          cutoff: '2099-07-01T10:30:00.000Z',
          leg_number: leg,
          race_id: `race-${leg}`,
          proxy_quality: 'unavailable_incomplete_winner_odds',
          proxy_method: null,
          trend_semantics_verified: false,
          entries: [
            {
              race_entry_id: `entry-${leg}-a`,
              market_win_probability_proxy: null,
              maturity: { ownership_observation_count: 2, snapshot_age_minutes: 3 }
            },
            {
              race_entry_id: `entry-${leg}-b`,
              market_win_probability_proxy: null,
              maturity: { ownership_observation_count: 2, snapshot_age_minutes: 3 }
            }
          ]
        }
      };
    })
  };
}

function step2Payload() {
  return {
    contract_version: ANALYSIS_STEP2_RESULT_CONTRACT,
    result_id: 'step2_synthetic-e3',
    round_id: 'round-e3',
    lock_id: 'lock-e3',
    lock_hash: LOCK_HASH,
    market_fingerprint: MARKET_FP,
    market_cutoff: '2099-07-01T10:30:00.000Z',
    provider: 'openai',
    model: 'synthetic',
    prompt_version: ANALYSIS_STEP2_PROMPT_VERSION,
    legs: Array.from({ length: 8 }, (_, i) => {
      const leg = i + 1;
      return {
        leg_number: leg,
        entries: [
          {
            race_entry_id: `entry-${leg}-a`,
            blind_probability: 0.6,
            abcd_group: 'A',
            market_disagreement: 'own_more_positive',
            disagreement_reliability: 'medium',
            market_maturity: 'developing',
            value_signal: 'positive',
            value_confidence: 0.7,
            market_reasoning_summary: 'Synthetic market interpretation.'
          },
          {
            race_entry_id: `entry-${leg}-b`,
            blind_probability: 0.4,
            abcd_group: 'B',
            market_disagreement: 'market_more_positive',
            disagreement_reliability: 'low',
            market_maturity: 'developing',
            value_signal: 'negative',
            value_confidence: 0.4,
            market_reasoning_summary: 'Synthetic market interpretation.'
          }
        ]
      };
    }),
    round_risk_flags: ['synthetic risk'],
    external_signals_read_last: true
  };
}

function seedDb(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-e3','Synthetic E3')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('round-e3','V85','2099-07-01')").run();
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare('INSERT INTO races (id,track_id,race_date,race_number) VALUES (?,?,?,?)').run(`race-${leg}`, 'track-e3', '2099-07-01', leg);
    db.prepare('INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)').run('round-e3', leg, `race-${leg}`);
    for (const suffix of ['a','b']) {
      db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(`horse-${leg}-${suffix}`, `Horse ${leg} ${suffix}`);
      db.prepare('INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,?,?,0)').run(
        `entry-${leg}-${suffix}`, `race-${leg}`, `horse-${leg}-${suffix}`, suffix === 'a' ? 1 : 2
      );
    }
  }
  const lock = lockDocument();
  db.prepare(`INSERT INTO analysis_step1_locks (
    id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'lock-e3','round-e3','kentaurai-step1-lock-v1','pack-e3','2099-07-01T10:00:00.000Z',
    lock.pack.facts_fingerprint,'openai','synthetic','step1-prompt-v3-d2',JSON.stringify(lock),LOCK_HASH,'2099-07-01T10:05:00.000Z'
  );
}

test('E3 Step 2 v3 prompt removes legacy system-building rules and delegates authoritative system to code', () => {
  const prompt = getAnalysisStep2PromptV3('openai');
  assert.match(prompt, /Do NOT submit decision_probability/i);
  assert.match(prompt, /code optimizer will build the authoritative system/i);
  assert.match(prompt, /external rankings.*last/i);
  assert.doesNotMatch(prompt, /700\s*kr/i);
  assert.doesNotMatch(prompt, /minst\s*7\s*%/i);
  assert.doesNotMatch(prompt, /två spikar/i);
  assert.doesNotMatch(prompt, /personligt system/i);
});

test('E3 rejects changed Step 1 probability/ABCD and client-trusted market/system fields', async () => {
  const parents = { lockDocument: lockDocument(), marketPack: marketPack() };

  const changedProbability = step2Payload();
  changedProbability.legs[0].entries[0].blind_probability = 0.59;
  await assert.rejects(() => normalizeStep2ResultV1(changedProbability, parents), /cannot change sealed blind_probability/);

  const changedAbcd = step2Payload();
  changedAbcd.legs[0].entries[0].abcd_group = 'B';
  await assert.rejects(() => normalizeStep2ResultV1(changedAbcd, parents), /cannot change sealed ABCD/);

  for (const forbidden of ['decision_probability','market_ownership_percent','row_count','is_spike','selections']) {
    const payload = step2Payload();
    payload.legs[0].entries[0][forbidden] = forbidden === 'row_count' ? 10 : true;
    await assert.rejects(() => normalizeStep2ResultV1(payload, parents), /unsupported fields/);
  }
});

test('E3 atomically stores Step2 + canonical decision + exact3 optimizer + integrated version references', async () => {
  const { db, env } = createTestEnv();
  seedDb(db);
  const parents = { lockDocument: lockDocument(), marketPack: marketPack() };

  const result = await persistIntegratedStep2V1(
    env,
    step2Payload(),
    parents,
    'V85',
    { line_price_sek: 0.5, target_budget_min_sek: 150, max_budget_sek: 250 },
    { generatedAt: '2099-07-01T10:31:00.000Z', createdAt: '2099-07-01T10:31:01.000Z' }
  );

  assert.equal(result.reused, false);
  assert.equal(result.analysis.step2_version, ANALYSIS_STEP2_VERSION);
  assert.equal(result.analysis.decision_probability_version, 'decision-probability-v1-e1');
  assert.equal(result.analysis.optimizer_version, 'optimizer-p8-exact3-v1-e2');
  assert.equal(result.analysis.optimizer_system.spike_count, 3);
  assert.equal(result.analysis.optimizer_system.row_count, 32);
  assert.equal(result.analysis.optimizer_system.cost_sek, 16);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_step2_results').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_decision_runs').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_optimizer_runs').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_v3_runs').get().n, 1);
  assert.equal(db.prepare('SELECT spike_count FROM analysis_optimizer_runs').get().spike_count, 3);

  const decisionRows = db.prepare('SELECT blind_probability,decision_probability FROM analysis_decision_probabilities').all();
  assert.ok(decisionRows.every((row) => row.blind_probability === row.decision_probability));

  const retry = await persistIntegratedStep2V1(
    env,
    step2Payload(),
    parents,
    'V85',
    { line_price_sek: 0.5, target_budget_min_sek: 150, max_budget_sek: 250 },
    { generatedAt: '2099-07-01T10:40:00.000Z', createdAt: '2099-07-01T10:40:01.000Z' }
  );
  assert.equal(retry.reused, true);
  assert.equal(retry.id, result.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_v3_runs').get().n, 1);
});

test('E3 validation failure writes no partial Step2/decision/optimizer state', async () => {
  const { db, env } = createTestEnv();
  seedDb(db);
  const parents = { lockDocument: lockDocument(), marketPack: marketPack() };
  const invalid = step2Payload();
  invalid.legs[2].entries[1].blind_probability = 0.39;

  await assert.rejects(
    () => persistIntegratedStep2V1(
      env, invalid, parents, 'V85',
      { line_price_sek: 0.5, target_budget_min_sek: 150, max_budget_sek: 250 }
    ),
    /cannot change sealed blind_probability/
  );

  for (const table of ['analysis_step2_results','analysis_decision_runs','analysis_optimizer_runs','analysis_v3_runs']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
});

test('E3 final narrative is post-optimizer, fingerprint-bound, immutable and cannot carry system structure', async () => {
  const { db, env } = createTestEnv();
  seedDb(db);
  const parents = { lockDocument: lockDocument(), marketPack: marketPack() };
  const integrated = await persistIntegratedStep2V1(
    env, step2Payload(), parents, 'V85',
    { line_price_sek: 0.5, target_budget_min_sek: 150, max_budget_sek: 250 }
  );

  const prompt = buildFinalNarrativePromptV1(integrated);
  assert.match(prompt, /authoritative system.*selected by KentaurAI code/i);
  assert.match(prompt, /do not alter/i);

  const narrative = {
    contract_version: ANALYSIS_V3_NARRATIVE_CONTRACT,
    analysis_id: integrated.id,
    optimizer_fingerprint: integrated.analysis.optimizer_fingerprint,
    summary: 'Synthetic final explanation.',
    spike_explanation: ['Three code-selected spike legs.'],
    guarded_legs: ['Five guarded legs consume rows.'],
    miss_risk: ['Synthetic risk.'],
    value_vs_safety: ['Synthetic balance.'],
    refresh_triggers: ['Late factual change.']
  };
  const saved = await persistFinalNarrativeV1(env, narrative);
  assert.equal(saved.reused, false);

  const loaded = await getAnalysisV3(env, integrated.id);
  assert.equal(loaded.narrative.summary, narrative.summary);

  const retry = await persistFinalNarrativeV1(env, narrative);
  assert.equal(retry.reused, true);

  const forbidden = { ...narrative, row_count: 32 };
  await assert.rejects(() => persistFinalNarrativeV1(env, forbidden), /unsupported fields/);

  const changed = { ...narrative, summary: 'Changed after sealing.' };
  await assert.rejects(() => persistFinalNarrativeV1(env, changed), /already sealed with different content/);
});
