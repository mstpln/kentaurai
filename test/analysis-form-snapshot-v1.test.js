import test from 'node:test';
import assert from 'node:assert/strict';

import { persistAnalysisFormSnapshots } from '../src/analysis-form-snapshot-v1.js';
import { createTestEnv } from './helpers/d1.js';

function seed(envDb){
  const db=envDb;
  db.prepare("INSERT INTO tracks (id,canonical_name,country_code) VALUES ('form-track','Form Track','SE')").run();
  for(const [id,name] of [['h1','Horse One'],['h2','Horse Two'],['o1','Opponent One'],['o2','Opponent Two']]){
    db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run(id,name);
  }
  db.prepare("INSERT INTO game_rounds (id,game_type,round_date,scheduled_start_at,bet_stop_at,status) VALUES ('round-form','V86','2026-09-24','2026-09-24T18:00:00Z','2026-09-24T17:55:00Z','bettable')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status) VALUES ('current-race','form-track','2026-09-24',1,'2026-09-24T18:00:00Z',2140,'auto','scheduled')").run();
  db.prepare("INSERT INTO game_legs (game_round_id,leg_number,race_id) VALUES ('round-form',1,'current-race')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES ('current-e1','current-race','h1',1,0)").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES ('current-e2','current-race','h2',2,0)").run();

  for(const [suffix,horse,opp,placing] of [['1','h1','o1',1],['2','h2','o2',2]]){
    const race='prior-r'+suffix;
    db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,field_size,first_prize_sek,status) VALUES (?,'form-track','2026-09-20',?,'2026-09-20T12:00:00Z',2140,'auto',2,50000,'results')")
      .run(race,10+Number(suffix));
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,?,1,0)").run('prior-e'+suffix,race,horse);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,scratched) VALUES (?,?,?,2,0)").run('prior-o'+suffix,race,opp);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified,km_time) VALUES (?,?,'official',0,0,'1.13,0')").run('prior-e'+suffix,placing);
    db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified,km_time) VALUES (?,?,'official',0,0,'1.14,0')").run('prior-o'+suffix,placing===1?2:1);
  }
}

function pack(id='pack-form'){
  return {
    manifest:{round_id:'round-form',pack_id:id,as_of:'2026-09-24T08:00:00Z'},
    files:[{
      payload:{
        leg_number:1,
        entries:[
          {race_entry_id:'current-e1',horse_id:'h1',current_facts:{analysis_eligible:true}},
          {race_entry_id:'current-e2',horse_id:'h2',current_facts:{analysis_eligible:true}}
        ]
      }
    }]
  };
}

test('Step 1 export freezes Form 1-100 and relative Form rank idempotently',async()=>{
  const {env,db}=createTestEnv();
  seed(db);
  const first=await persistAnalysisFormSnapshots(env,pack());
  assert.equal(first.entryCount,2);
  assert.equal(first.inserted,2);

  const rows=db.prepare("SELECT race_entry_id,form_score,used_starts,form_rank,form_version,as_of FROM analysis_entry_form_snapshots ORDER BY race_entry_id").all();
  assert.equal(rows.length,2);
  assert.equal(rows[0].used_starts,1);
  assert.equal(rows[1].used_starts,1);
  assert.ok(rows[0].form_score>rows[1].form_score);
  assert.equal(rows[0].form_rank,1);
  assert.equal(rows[1].form_rank,2);
  assert.equal(rows[0].form_version,'horse-form-index-v1');
  assert.equal(rows[0].as_of,'2026-09-24T08:00:00Z');

  const again=await persistAnalysisFormSnapshots(env,pack());
  assert.equal(again.inserted,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM analysis_entry_form_snapshots').get().n,2);
});

test('historical Form snapshot does not leak a later result from the target race',async()=>{
  const {env,db}=createTestEnv();
  seed(db);
  await persistAnalysisFormSnapshots(env,pack('pack-before'));
  const before=db.prepare("SELECT form_score FROM analysis_entry_form_snapshots WHERE step1_pack_id='pack-before' AND race_entry_id='current-e1'").get().form_score;

  db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified,km_time) VALUES ('current-e1',1,'official',0,0,'1.12,0')").run();
  db.prepare("INSERT INTO race_results (race_entry_id,placing,result_status,gallop,disqualified,km_time) VALUES ('current-e2',2,'official',0,0,'1.13,0')").run();

  await persistAnalysisFormSnapshots(env,pack('pack-replay'));
  const replay=db.prepare("SELECT form_score,used_starts FROM analysis_entry_form_snapshots WHERE step1_pack_id='pack-replay' AND race_entry_id='current-e1'").get();
  assert.equal(replay.form_score,before);
  assert.equal(replay.used_starts,1);
});
