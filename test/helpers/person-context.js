export function seedPersonContextBase(db){
  db.prepare("INSERT OR IGNORE INTO tracks(id,canonical_name) VALUES('track-a','Track A'),('track-b','Track B')").run();
  db.prepare("INSERT OR IGNORE INTO horses(id,canonical_name) VALUES('horse-a','Horse A'),('horse-b','Horse B')").run();
  db.prepare("INSERT OR IGNORE INTO drivers(id,canonical_name) VALUES('driver-a','Driver A'),('driver-b','Driver B')").run();
  db.prepare("INSERT OR IGNORE INTO trainers(id,canonical_name) VALUES('trainer-a','Trainer A'),('trainer-b','Trainer B')").run();
}
export function seedSource(db,id,at,type='official_provider'){
  db.prepare('INSERT INTO source_records(id,source_type,external_id,fetched_at,quality_status) VALUES(?,?,?,?,?)').run(id,type,id,at,'normalized_verified_subset');
}
export function seedPersonStart(db,{key,date,horse='horse-a',driver='driver-a',trainer='trainer-a',track='track-a',method='auto',distance=2140,tier=1,placing=1,gallop=false,dq=false,target=false,resultObserved=null}){
  seedPersonContextBase(db);const race=`race-${key}`,entry=`entry-${key}`;
  db.prepare('INSERT INTO races(id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,status,source_quality) VALUES(?,?,?,?,?,?,?,?,?)').run(race,track,date,1,`${date}T12:00:00Z`,distance,method,'scheduled','normalized_verified_subset');
  db.prepare('INSERT INTO race_entries(id,race_id,horse_id,driver_id,trainer_id,start_number,actual_lane,start_tier,handicap_m,actual_start_distance_m,scratched,data_quality) VALUES(?,?,?,?,?,1,1,?,0,?,0,?)').run(entry,race,horse,driver,trainer,tier,distance,'synthetic');
  if(!target){const source=`result-${key}`;seedSource(db,source,resultObserved||`${date}T14:00:00Z`);db.prepare("INSERT INTO race_results(race_entry_id,placing,gallop,disqualified,result_status,source_record_id) VALUES(?,?,?,?, 'official',?)").run(entry,placing,Number(gallop),Number(dq),source);}
  return {raceId:race,entryId:entry};
}
export function seedPersonSnapshot(db,{type,id,observed='2026-09-19T10:00:00Z',year=2026,starts=100,wins=20,seconds=15,thirds=10,key=`${type}-${id}`}){
  const source=`person-source-${key}`;seedSource(db,source,observed);
  db.prepare('INSERT INTO person_stat_snapshots(id,person_type,person_id,observed_at,stat_year,starts,wins,seconds,thirds,source_record_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`ps-${key}`,type,id,observed,year,starts,wins,seconds,thirds,source);
  db.prepare("INSERT INTO official_snapshot_source_sync(source_record_id,status,person_stat_count) VALUES(?,'complete',1)").run(source);
}
export function seedPersonXlabs(db,entryId,key,observed='2026-09-10T15:00:00Z',first200='1.10,0 min/km'){
  const source=`xlabs-${key}`;seedSource(db,source,observed,'xlabs_race_json');
  db.prepare("INSERT INTO xlabs_data(id,race_entry_id,first_200_time,quality_status,source_record_id) VALUES(?,?,?,'xlabs-telemetry-v1',?)").run(`x-${key}`,entryId,first200,source);
}
