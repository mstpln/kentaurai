import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationNames() {
  return readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

test('F2 migration stores immutable post-race diagnostics and learning evidence links', () => {
  const db = new DatabaseSync(':memory:');
  for (const name of migrationNames()) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));

  const reviews = new Set(db.prepare('PRAGMA table_info(post_race_reviews_v2)').all().map((row) => row.name));
  for (const required of [
    'id','game_round_id','race_id','leg_number','winner_entry_id','analysis_v3_id','lock_id','decision_run_id',
    'optimizer_run_id','review_version','pre_race_fingerprint','winner_blind_probability',
    'winner_decision_probability','winner_rank','winner_assessment_confidence','scenario_match',
    'scenario_confidence','data_quality_summary','coverage_json','winner_market_percent','winner_market_rank',
    'public_win_probability_proxy','public_proxy_quality','optimizer_selected','optimizer_is_spike',
    'optimizer_selected_count','failure_class','learning_classification','diagnostics_json','created_at'
  ]) assert.ok(reviews.has(required), `missing post_race_reviews_v2.${required}`);

  const links = new Set(db.prepare('PRAGMA table_info(post_race_learning_links)').all().map((row) => row.name));
  for (const required of ['review_id','hypothesis_id','observation_id']) {
    assert.ok(links.has(required), `missing post_race_learning_links.${required}`);
  }

  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
  assert.ok(indexes.has('idx_post_race_reviews_v2_round'));
  assert.ok(indexes.has('idx_post_race_reviews_v2_analysis'));
  assert.ok(indexes.has('idx_post_race_reviews_v2_failure'));
});
