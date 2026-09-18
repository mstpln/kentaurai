import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import {
  ANALYSIS_DECISION_POLICY_VERSION,
  ANALYSIS_DECISION_PROBABILITY_CONTRACT,
  ANALYSIS_DECISION_PROBABILITY_VERSION,
  buildCanonicalDecisionProbabilityV1,
  persistCanonicalDecisionProbabilityV1
} from '../src/analysis-decision-probability-v1.js';

globalThis.crypto ??= webcrypto;

function syntheticLock() {
  return {
    contract_version: 'kentaurai-step1-lock-v1',
    lock_id: 'lock-e1',
    round_id: 'round-e1',
    legs: Array.from({ length: 8 }, (_, index) => {
      const leg = index + 1;
      return {
        leg_number: leg,
        race_id: `race-${leg}`,
        predictions: [
          { race_entry_id: `entry-${leg}-a`, blind_probability: 0.6 },
          { race_entry_id: `entry-${leg}-b`, blind_probability: 0.4 }
        ]
      };
    })
  };
}

function syntheticMarketPack({ completeProxy = true } = {}) {
  const lock = syntheticLock();
  const lockHash = 'sha256:lock-e1';
  const marketFingerprint = 'sha256:market-e1';
  const cutoff = '2099-06-01T12:00:00.000Z';
  const files = Array.from({ length: 8 }, (_, index) => {
    const leg = index + 1;
    const quality = completeProxy ? 'verified_complete_winner_odds_v1' : 'unavailable_incomplete_winner_odds';
    return {
      name: `${String(leg).padStart(2, '0')}_leg_${leg}_market.json`,
      payload: {
        round_id: lock.round_id,
        lock_id: lock.lock_id,
        lock_hash: lockHash,
        market_fingerprint: marketFingerprint,
        cutoff,
        leg_number: leg,
        race_id: `race-${leg}`,
        proxy_quality: quality,
        proxy_method: completeProxy ? 'normalized_inverse_decimal_winner_odds' : null,
        entries: [
          {
            race_entry_id: `entry-${leg}-a`,
            market_ownership_percent: 80,
            market_win_probability_proxy: completeProxy ? 0.7 : null,
            maturity: { ownership_observation_count: 3, snapshot_age_minutes: 2 }
          },
          {
            race_entry_id: `entry-${leg}-b`,
            market_ownership_percent: 20,
            market_win_probability_proxy: completeProxy ? 0.3 : null,
            maturity: { ownership_observation_count: 2, snapshot_age_minutes: 4 }
          }
        ]
      }
    };
  });
  return {
    manifest: {
      contract_version: 'kentaurai-market-pack-v3',
      pack_version: 'market-pack-v3-d4',
      round_id: lock.round_id,
      cutoff,
      lock: { lock_id: lock.lock_id, lock_hash: lockHash },
      market_fingerprint: marketFingerprint
    },
    files
  };
}

async function build(options = {}) {
  return buildCanonicalDecisionProbabilityV1({
    lockDocument: syntheticLock(),
    marketPack: syntheticMarketPack(options),
    generatedAt: '2099-06-01T12:00:05.000Z'
  });
}

test('E1 v1 policy keeps decision_probability exactly equal to blind_probability', async () => {
  const decision = await build();
  assert.equal(decision.contract_version, ANALYSIS_DECISION_PROBABILITY_CONTRACT);
  assert.equal(decision.decision_probability_version, ANALYSIS_DECISION_PROBABILITY_VERSION);
  assert.equal(decision.policy_version, ANALYSIS_DECISION_POLICY_VERSION);
  assert.equal(decision.policy.decision_source, 'blind_probability');
  assert.equal(decision.policy.market_blend_applied, false);
  assert.equal(decision.policy.ownership_used_as_win_probability, false);

  for (const leg of decision.legs) {
    assert.equal(leg.entries.reduce((sum, entry) => sum + entry.decision_probability, 0), 1);
    for (const entry of leg.entries) assert.equal(entry.decision_probability, entry.blind_probability);
  }
});

test('E1 exposes verified public proxy separately without allowing it to alter decision probabilities', async () => {
  const decision = await build();
  const leg = decision.legs[0];
  assert.equal(leg.public_proxy_quality, 'verified_complete_winner_odds_v1');
  assert.equal(leg.context_reliability.proxy_available, true);
  assert.equal(leg.context_reliability.blend_applied, false);
  assert.deepEqual(leg.entries.map((entry) => entry.public_win_probability_proxy), [0.7, 0.3]);
  assert.deepEqual(leg.entries.map((entry) => entry.decision_probability), [0.6, 0.4]);
});

test('E1 weak or unavailable public proxy stays null and cannot fall back to ownership', async () => {
  const decision = await build({ completeProxy: false });
  const leg = decision.legs[0];
  assert.equal(leg.public_proxy_quality, 'unavailable_incomplete_winner_odds');
  assert.equal(leg.context_reliability.proxy_available, false);
  assert.deepEqual(leg.entries.map((entry) => entry.public_win_probability_proxy), [null, null]);
  assert.deepEqual(leg.entries.map((entry) => entry.decision_probability), [0.6, 0.4]);
  assert.notEqual(leg.entries[0].decision_probability, 0.8);
});

test('E1 fails closed on cross-parent market state, field mismatch, or malformed public distributions', async () => {
  const wrongParent = syntheticMarketPack();
  wrongParent.manifest.lock.lock_id = 'other-lock';
  await assert.rejects(
    () => buildCanonicalDecisionProbabilityV1({ lockDocument: syntheticLock(), marketPack: wrongParent }),
    /same sealed Step 1 lock/
  );

  const missing = syntheticMarketPack();
  missing.files[0].payload.entries.pop();
  await assert.rejects(
    () => buildCanonicalDecisionProbabilityV1({ lockDocument: syntheticLock(), marketPack: missing }),
    /market entries do not match/
  );

  const malformed = syntheticMarketPack();
  malformed.files[0].payload.entries[0].market_win_probability_proxy = 0.8;
  await assert.rejects(
    () => buildCanonicalDecisionProbabilityV1({ lockDocument: syntheticLock(), marketPack: malformed }),
    /public proxy probabilities must sum to 1/
  );
});

test('E1 fingerprint is deterministic across generation time but changes with market parent state', async () => {
  const first = await build();
  const second = await buildCanonicalDecisionProbabilityV1({
    lockDocument: syntheticLock(),
    marketPack: syntheticMarketPack(),
    generatedAt: '2099-06-01T12:05:00.000Z'
  });
  assert.equal(first.decision_fingerprint, second.decision_fingerprint);
  assert.notEqual(first.generated_at, second.generated_at);

  const changedMarket = syntheticMarketPack();
  changedMarket.manifest.market_fingerprint = 'sha256:market-e1-changed';
  for (const file of changedMarket.files) file.payload.market_fingerprint = 'sha256:market-e1-changed';
  const changed = await buildCanonicalDecisionProbabilityV1({
    lockDocument: syntheticLock(), marketPack: changedMarket, generatedAt: '2099-06-01T12:05:00.000Z'
  });
  assert.notEqual(first.decision_fingerprint, changed.decision_fingerprint);
});

function seedPersistenceParents(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-e1','Synthetic E1')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('round-e1','V85','2099-06-01')").run();
  for (let leg = 1; leg <= 8; leg += 1) {
    db.prepare('INSERT INTO races (id,track_id,race_date,race_number) VALUES (?,?,?,?)').run(`race-${leg}`, 'track-e1', '2099-06-01', leg);
    db.prepare('INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES (?,?,?)').run('round-e1', leg, `race-${leg}`);
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
    'lock-e1','round-e1','kentaurai-step1-lock-v1','pack-e1','2099-06-01T11:00:00.000Z','sha256:facts-e1',
    'openai','synthetic','step1-prompt-v3-d2',JSON.stringify(syntheticLock()),'sha256:lock-e1','2099-06-01T11:05:00.000Z'
  );
}

test('E1 persistence rejects tampered decision content instead of trusting a supplied fingerprint', async () => {
  const { db, env } = createTestEnv();
  seedPersistenceParents(db);
  const decision = await build();
  decision.legs[0].entries[0].decision_probability = 0.5;
  await assert.rejects(
    () => persistCanonicalDecisionProbabilityV1(env, decision, { createdAt: '2099-06-01T12:00:10.000Z' }),
    /must equal blind_probability exactly/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_decision_runs').get().n, 0);
});

test('E1 persists versioned calibration hooks and reuses the same canonical decision fingerprint idempotently', async () => {
  const { db, env } = createTestEnv();
  seedPersistenceParents(db);
  const firstDecision = await build();
  const first = await persistCanonicalDecisionProbabilityV1(env, firstDecision, { createdAt: '2099-06-01T12:00:10.000Z' });
  assert.equal(first.reused, false);
  assert.equal(first.decision_probability_version, ANALYSIS_DECISION_PROBABILITY_VERSION);

  const run = db.prepare('SELECT * FROM analysis_decision_runs WHERE id=?').get(first.id);
  assert.equal(run.policy_version, ANALYSIS_DECISION_POLICY_VERSION);
  assert.match(run.market_proxy_quality_json, /verified_complete_winner_odds_v1/);
  assert.match(run.context_reliability_json, /blend_applied/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_decision_probabilities WHERE decision_run_id=?').get(first.id).n, 16);

  const regenerated = await buildCanonicalDecisionProbabilityV1({
    lockDocument: syntheticLock(),
    marketPack: syntheticMarketPack(),
    generatedAt: '2099-06-01T12:30:00.000Z'
  });
  const reused = await persistCanonicalDecisionProbabilityV1(env, regenerated, { createdAt: '2099-06-01T12:30:01.000Z' });
  assert.equal(reused.reused, true);
  assert.equal(reused.id, first.id);
  assert.equal(reused.decision.generated_at, firstDecision.generated_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analysis_decision_runs').get().n, 1);
});
