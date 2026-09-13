import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const before = [
  '0001_core.sql','0002_reference_round.sql','0003_nullable_reference_prediction.sql','0004_official_live_observations.sql',
  '0005_historical_backfill.sql','0006_xlabs_backfill.sql','0007_official_first_prize.sql','0008_track_contact_metadata.sql',
  '0009_track_contact_provenance.sql','0010_horse_start_points.sql','0011_driver_statistics_indexes.sql','0012_trainer_statistics_indexes.sql',
  '0013_combined_analysis_systems.sql'
];

const raceEntryDependents = [
  'race_results','race_positions','equipment','xlabs_data','betting_snapshots','odds_snapshots',
  'editorial_items','analysis_features','ai_horse_predictions','system_selections','post_race_reviews',
  'reference_observations','horse_start_points'
];

function baseDb() {
  const db = new DatabaseSync(':memory:');
  for (const name of before) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function apply0014(db) {
  const sql = readFileSync(new URL('../migrations/0014_official_participant_identity.sql', import.meta.url), 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function seedHistoricalGraph(db) {
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('src1','synthetic','2099-01-01T00:00:00Z','verified')").run();
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('t1','Synthetic')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number) VALUES ('r1','t1','2099-01-01',1)").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('h1','Historical Horse')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched,data_quality) VALUES ('e1','r1','h1',1,0,'historical_verified')").run();
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('g1','V85','2099-01-01')").run();
  db.prepare("INSERT INTO model_versions (id,created_at,feature_version) VALUES ('m1','2099-01-01T00:00:00Z','synthetic-v1')").run();
  db.prepare("INSERT INTO ai_race_analyses (id,race_id,model_version_id,data_snapshot_at,market_blind,created_at) VALUES ('a1','r1','m1','2099-01-01T00:00:00Z',1,'2099-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO systems (id,game_round_id,budget_sek,row_count,spike_count,created_at) VALUES ('s1','g1',100,1,3,'2099-01-01T00:00:00Z')").run();

  db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,source_record_id) VALUES ('e1',1,'official','src1')").run();
  db.prepare("INSERT INTO race_positions (id,race_entry_id,position,source_record_id) VALUES ('p1','e1',1,'src1')").run();
  db.prepare("INSERT INTO equipment (id,race_entry_id,verification_status,source_record_id) VALUES ('q1','e1','reported','src1')").run();
  db.prepare("INSERT INTO xlabs_data (id,race_entry_id,quality_status,source_record_id) VALUES ('x1','e1','verified','src1')").run();
  db.prepare("INSERT INTO betting_snapshots (id,game_round_id,leg_number,race_entry_id,captured_at,source_record_id) VALUES ('b1','g1',1,'e1','2099-01-01T00:00:00Z','src1')").run();
  db.prepare("INSERT INTO odds_snapshots (id,race_entry_id,captured_at,market_type,source_record_id) VALUES ('o1','e1','2099-01-01T00:00:00Z','vinnare','src1')").run();
  db.prepare("INSERT INTO editorial_items (id,race_entry_id,horse_id,source_name,source_record_id) VALUES ('ed1','e1','h1','synthetic','src1')").run();
  db.prepare("INSERT INTO editorial_signals (id,editorial_item_id,signal_type,fact_or_opinion) VALUES ('es1','ed1','synthetic','fact')").run();
  db.prepare("INSERT INTO analysis_features (id,race_entry_id,feature_version,as_of,feature_name) VALUES ('f1','e1','synthetic-v1','2099-01-01T00:00:00Z','synthetic')").run();
  db.prepare("INSERT INTO ai_horse_predictions (id,ai_race_analysis_id,race_entry_id) VALUES ('hp1','a1','e1')").run();
  db.prepare("INSERT INTO system_selections (system_id,leg_number,race_entry_id,is_spike) VALUES ('s1',1,'e1',1)").run();
  db.prepare("INSERT INTO post_race_reviews (id,game_round_id,race_id,race_entry_id,system_id,model_version_id,created_at) VALUES ('pr1','g1','r1','e1','s1','m1','2099-01-01T00:00:00Z')").run();
  db.prepare("INSERT INTO reference_observations (id,game_round_id,current_race_entry_id,observation_type,payload_json) VALUES ('ro1','g1','e1','synthetic','{}')").run();
  db.prepare("INSERT INTO horse_start_points (id,horse_id,points,observed_at,race_entry_id,source_record_id) VALUES ('sp1','h1',10,'2099-01-01T00:00:00Z','e1','src1')").run();
}

test('0014 preserves the full historical dependency graph while making horse identity nullable', () => {
  const db = baseDb();
  seedHistoricalGraph(db);

  apply0014(db);

  assert.equal(db.prepare("SELECT COUNT(*) n FROM race_entries WHERE id='e1' AND horse_id='h1'").get().n, 1);
  for (const table of raceEntryDependents) {
    const column = table === 'reference_observations' ? 'current_race_entry_id' : 'race_entry_id';
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${column}='e1'`).get().n, 1, `${table} row was not preserved`);
    assert.ok(db.prepare(`PRAGMA foreign_key_list(${table})`).all().some((fk) => fk.table === 'race_entries'), `${table} no longer references race_entries`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) n FROM editorial_signals WHERE id='es1' AND editorial_item_id='ed1'").get().n, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(db.prepare('PRAGMA table_info(race_entries)').all().find((c) => c.name === 'horse_id').notnull, 0);
});

test('0014 keeps historical default false but converts legacy unverified live scratch to unknown', () => {
  const db = baseDb();
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('t1','Synthetic')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number) VALUES ('r1','t1','2099-01-01',1)").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('h1','Legacy Live Horse')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched,data_quality) VALUES ('e1','r1','h1',1,0,'official_declared_start_scratch_unverified')").run();

  apply0014(db);

  assert.equal(db.prepare("SELECT scratched FROM race_entries WHERE id='e1'").get().scratched, null);
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number) VALUES ('e2','r1',NULL,2)").run();
  assert.equal(db.prepare("SELECT scratched FROM race_entries WHERE id='e2'").get().scratched, 0);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
