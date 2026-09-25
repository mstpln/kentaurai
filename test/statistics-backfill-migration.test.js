import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationSqlThrough0040() {
  const dir=new URL('../migrations/',import.meta.url);
  return readdirSync(dir)
    .filter((name)=>/^\d{4}_.+\.sql$/.test(name) && Number(name.slice(0,4))<=40)
    .sort()
    .map((name)=>readFileSync(new URL(name,dir),'utf8'))
    .join('\n');
}

test('0041 upgrades pre-fix statistics rows without deleting terminal history',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(migrationSqlThrough0040());
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date) VALUES ('old_round','V86','2090-01-01')").run();
  db.prepare(`INSERT INTO statistics_data_backfill_rounds
    (game_round_id,status,result_status,final_market_status,payout_status,form_status,kai_rank_status,abcd_status,spike_status,
     attempt_count,last_error,last_checked_at)
    VALUES ('old_round','manual_review','complete','pending','pending','manual_review','complete','complete','complete',
      886,'form_replay: synthetic deterministic mismatch','2100-01-01T00:00:00Z')`).run();

  db.exec(readFileSync(new URL('../migrations/0041_statistics_backfill_state_machine.sql',import.meta.url),'utf8'));

  const row=db.prepare(`SELECT status,form_status,attempt_count,last_error,action_state,input_revision,
    form_input_revision,final_market_input_revision,audited_revision
    FROM statistics_data_backfill_rounds WHERE game_round_id='old_round'`).get();
  assert.equal(row.status,'manual_review');
  assert.equal(row.form_status,'manual_review');
  assert.equal(row.attempt_count,886);
  assert.match(row.last_error,/synthetic deterministic mismatch/);
  assert.equal(row.action_state,'manual_review');
  assert.equal(row.input_revision,0);
  assert.equal(row.form_input_revision,0);
  assert.equal(row.final_market_input_revision,0);
  assert.equal(row.audited_revision,-1);
});

test('0041 wakes only the relevant terminal metric for factual versus Form input changes',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(migrationSqlThrough0040());
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,bet_stop_at) VALUES ('rev_round','V86','2090-01-01','2090-01-01T12:00:00Z')").run();
  db.prepare("INSERT INTO statistics_data_backfill_rounds (game_round_id,status,result_status,final_market_status,payout_status,form_status,kai_rank_status,abcd_status,spike_status,last_checked_at) VALUES ('rev_round','manual_review','pending','pending','pending','manual_review','unavailable','unavailable','unavailable','2100-01-01T00:00:00Z')").run();
  db.exec(readFileSync(new URL('../migrations/0041_statistics_backfill_state_machine.sql',import.meta.url),'utf8'));

  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('rev_source','official_provider','2090-01-01T22:00:00Z','normalized_verified_subset')").run();
  db.prepare(`INSERT INTO game_round_final_results
    (game_round_id,game_type,source_record_id,captured_at,status,payouts_json)
    VALUES ('rev_round','V86','rev_source','2090-01-01T22:00:00Z','results','{}')`).run();
  let row=db.prepare("SELECT input_revision,form_input_revision,final_market_input_revision FROM statistics_data_backfill_rounds WHERE game_round_id='rev_round'").get();
  assert.ok(row.input_revision>0);
  assert.equal(row.form_input_revision,0);
  assert.ok(row.final_market_input_revision>0);

  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('rev_track','Synthetic')").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('rev_horse','Synthetic')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number) VALUES ('rev_race','rev_track','2090-01-01',1)").run();
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('rev_round',1,'rev_race')").run();
  const afterLeg=db.prepare("SELECT form_input_revision FROM statistics_data_backfill_rounds WHERE game_round_id='rev_round'").get();
  assert.ok(afterLeg.form_input_revision>0);

  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES ('rev_entry','rev_race','rev_horse',1,0)").run();
  const afterEntry=db.prepare("SELECT form_input_revision FROM statistics_data_backfill_rounds WHERE game_round_id='rev_round'").get();
  assert.ok(afterEntry.form_input_revision>afterLeg.form_input_revision);
});
