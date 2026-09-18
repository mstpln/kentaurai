import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  REPLAY_POSITION_EVIDENCE_VERSION,
  REPLAY_RACE_TERMS_VERSION,
  REPLAY_START_POINTS_DYNAMICS_VERSION,
  buildReplayPositionEvidenceV1ForEntries,
  buildReplayRaceTermsV1ForEntries,
  buildReplayStartPointsDynamicsV1ForEntries
} from '../src/replay-feature-candidates-v1.js';
import { RACE_PROPOSITION_PARSER_VERSION } from '../src/race-proposition-v1.js';
import { XLABS_POSITION_RECONSTRUCTION_VERSION } from '../src/xlabs-position-reconstruction-v1.js';

function source(db, id, fetchedAt, type = 'official_provider') {
  db.prepare(`
    INSERT INTO source_records (id,source_type,external_id,fetched_at,quality_status)
    VALUES (?,?,?,?,?)
  `).run(id, type, id, fetchedAt, type === 'official_provider' ? 'normalized_verified_subset' : 'synthetic');
}

function baseRace(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-replay-features','Replay Feature Track')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-a','Horse A'),('horse-b','Horse B')").run();
  db.prepare(`
    INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method)
    VALUES ('target-race','track-replay-features','2099-06-10',1,'2099-06-10T12:00:00Z',2140,'auto')
  `).run();
  db.prepare(`
    INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched)
    VALUES ('target-a','target-race','horse-a',1,0),('target-b','target-race','horse-b',2,0)
  `).run();
}

test('F1 Start Points dynamics is as-of safe and field-relative without future observations', async () => {
  const { db, env } = createTestEnv();
  baseRace(db);
  source(db, 'sp-a-1', '2099-05-01T10:00:00Z');
  source(db, 'sp-a-2', '2099-06-01T10:00:00Z');
  source(db, 'sp-b-1', '2099-06-01T10:00:00Z');
  source(db, 'sp-a-future', '2099-06-20T10:00:00Z');
  db.prepare(`
    INSERT INTO horse_start_points (id,horse_id,points,observed_at,source_record_id) VALUES
      ('hsp-a-1','horse-a',40,'2099-05-01T10:00:00Z','sp-a-1'),
      ('hsp-a-2','horse-a',70,'2099-06-01T10:00:00Z','sp-a-2'),
      ('hsp-b-1','horse-b',50,'2099-06-01T10:00:00Z','sp-b-1'),
      ('hsp-a-future','horse-a',999,'2099-06-20T10:00:00Z','sp-a-future')
  `).run();

  const features = await buildReplayStartPointsDynamicsV1ForEntries(env, ['target-a','target-b'], '2099-06-10T12:00:00Z');
  const a = features.get('target-a');
  assert.equal(a.feature_version, REPLAY_START_POINTS_DYNAMICS_VERSION);
  assert.equal(a.current_points, 70);
  assert.equal(a.previous_different_points, 40);
  assert.equal(a.absolute_delta, 30);
  assert.equal(a.field_rank, 1);
  assert.equal(a.field_known_count, 2);
  assert.ok(!a.source_refs.some((ref) => ref.source_record_id === 'sp-a-future'));
});

test('F1 terms candidate selects only parser facts observed by target as-of', async () => {
  const { db, env } = createTestEnv();
  baseRace(db);
  for (const [id, at] of [['terms-early','2099-06-01T10:00:00Z'],['terms-future','2099-06-20T10:00:00Z']]) {
    source(db, id, at);
    db.prepare(`
      INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json)
      VALUES (?,?,?,?,?,'{}')
    `).run(`obs-${id}`, 'race', 'target-race', id, at);
  }
  db.prepare(`
    INSERT INTO race_proposition_facts (
      id,race_id,source_observation_id,source_record_id,observed_at,parser_version,parse_status,
      raw_terms_json,facts_json,matched_patterns_json,unparsed_fragments_json,ambiguous_fragments_json
    ) VALUES
      ('rpf-early','target-race','obs-terms-early','terms-early','2099-06-01T10:00:00Z',?,'parsed','[]','{"final":true}','[]','[]','[]'),
      ('rpf-future','target-race','obs-terms-future','terms-future','2099-06-20T10:00:00Z',?,'parsed','[]','{"final":false}','[]','[]','[]')
  `).run(RACE_PROPOSITION_PARSER_VERSION, RACE_PROPOSITION_PARSER_VERSION);

  const features = await buildReplayRaceTermsV1ForEntries(env, ['target-a'], '2099-06-10T12:00:00Z');
  const row = features.get('target-a');
  assert.equal(row.feature_version, REPLAY_RACE_TERMS_VERSION);
  assert.deepEqual(row.facts, { final: true });
  assert.equal(row.source_record_id, 'terms-early');
});

test('F1 position evidence uses only historical reconstruction sources captured by target as-of', async () => {
  const { db, env } = createTestEnv();
  baseRace(db);
  db.prepare(`
    INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method)
    VALUES ('history-race','track-replay-features','2099-05-10',2,'2099-05-10T12:00:00Z',2140,'auto')
  `).run();
  db.prepare(`
    INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched)
    VALUES ('history-a','history-race','horse-a',1,0)
  `).run();

  source(db, 'position-early', '2099-05-10T13:00:00Z', 'xlabs_race_json');
  source(db, 'position-future', '2099-06-20T13:00:00Z', 'xlabs_race_json');
  for (const [sourceId, coverage, rank] of [
    ['position-early', 0.8, 2],
    ['position-future', 1.0, 1]
  ]) {
    db.prepare(`
      INSERT INTO race_trajectory_summaries (
        id,race_entry_id,source_record_id,total_frame_count,observed_frame_count,frame_coverage,
        checkpoint_count,ranked_checkpoint_count,lateral_checkpoint_count,episode_count,
        longitudinal_confidence,lateral_confidence,reconstruction_status,reconstruction_version
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      `summary-${sourceId}`,'history-a',sourceId,100,Math.round(coverage*100),coverage,
      2,2,2,0,coverage,coverage,'usable',XLABS_POSITION_RECONSTRUCTION_VERSION
    );
    db.prepare(`
      INSERT INTO race_position_checkpoints (
        id,race_entry_id,source_record_id,checkpoint_key,frame_index,observed_at,elapsed_ms,
        leader_progress_m,distance_to_finish_m,position_rank,meters_behind_leader,
        relative_lateral_offset_m,positions_gained_since_previous,gap_gain_m_since_previous,
        observed_field_count,active_field_size,field_coverage,local_target_coverage,
        longitudinal_confidence,lateral_confidence,reconstruction_version
      ) VALUES (?,?,?,?,0,?,1000,100,2040,?,1,2,1,1,2,2,1,1,1,1,?)
    `).run(
      `checkpoint-${sourceId}`,'history-a',sourceId,'100m',
      sourceId === 'position-early' ? '2099-05-10T12:01:00Z' : '2099-05-10T12:01:30Z',
      rank,XLABS_POSITION_RECONSTRUCTION_VERSION
    );
  }

  const features = await buildReplayPositionEvidenceV1ForEntries(env, ['target-a'], '2099-06-10T12:00:00Z');
  const row = features.get('target-a');
  assert.equal(row.feature_version, REPLAY_POSITION_EVIDENCE_VERSION);
  assert.equal(row.reconstructed_starts, 1);
  assert.equal(row.mean_frame_coverage, 0.8);
  assert.equal(row.latest_source_fetched_at, '2099-05-10T13:00:00Z');
  assert.equal(row.named_trip_labels_enabled, false);
  assert.equal(row.missing_is_neutral, true);
});
