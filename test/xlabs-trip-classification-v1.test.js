import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyXlabsTripScenarios,
  persistXlabsTripScenarios,
  XLABS_TRIP_CLASSIFICATION_VERSION
} from '../src/xlabs-trip-classification-v1.js';
import { createTestEnv } from './helpers/d1.js';

function checkpoint(checkpointKey, leaderDistance, rows) {
  return rows.map((row) => ({
    checkpointKey,
    checkpointM: null,
    frameIndex: 1,
    observedAt: '2099-01-01T12:00:00.000Z',
    elapsedMs: 1,
    leaderProgressM: 1000 - leaderDistance,
    distanceToFinishM: leaderDistance + row.gap,
    positionRank: row.rank,
    metersBehindLeader: row.gap,
    relativeLateralOffsetM: row.lateral,
    positionsGainedSincePrevious: 0,
    gapGainMSincePrevious: 0,
    observedFieldCount: 6,
    activeFieldSize: 6,
    fieldCoverage: 1,
    localTargetCoverage: 1,
    longitudinalConfidence: 1,
    lateralConfidence: row.lateral == null ? null : 1,
    raceEntryId: row.id,
    sourceRecordId: 'src_trip',
    reconstructionVersion: 'xlabs-position-reconstruction-v1'
  }));
}

function reconstruction() {
  const field = [
    { id:'e1', rank:1, gap:0, lateral:0 },
    { id:'e2', rank:2, gap:1, lateral:2.2 },
    { id:'e3', rank:3, gap:3.2, lateral:0.2 },
    { id:'e4', rank:4, gap:5.5, lateral:2.1 },
    { id:'e5', rank:5, gap:9, lateral:2.15 },
    { id:'e6', rank:6, gap:13, lateral:0.1 }
  ];
  return {
    sourceRecordId:'src_trip',
    raceId:'race_trip',
    reconstructionVersion:'xlabs-position-reconstruction-v1',
    checkpoints:[
      ...checkpoint('400m',600,field),
      ...checkpoint('500m',500,field),
      ...checkpoint('600m',400,field)
    ],
    episodes:[]
  };
}

test('C4 classifies stable decision-window race scenarios without requiring absolute track orientation', () => {
  const rows=classifyXlabsTripScenarios(reconstruction());
  const byEntry=new Map(rows.map(row=>[row.raceEntryId,row]));
  assert.equal(byEntry.get('e1').leader,1);
  assert.equal(byEntry.get('e2').deathSeat,1);
  assert.equal(byEntry.get('e3').pocket,1);
  assert.equal(byEntry.get('e4').secondOver,1);
  assert.equal(byEntry.get('e5').thirdOver,1);
  assert.equal(byEntry.get('e6').event.scenario_key,'back');
  assert.equal(byEntry.get('e2').observedAtM,500);
  assert.equal(byEntry.get('e2').classificationVersion,XLABS_TRIP_CLASSIFICATION_VERSION);
  assert.equal(byEntry.get('e2').evidenceType,'calculated_xlabs');
});

test('C4 abstains when a tactical label exists at only one low-confidence checkpoint', () => {
  const one=reconstruction();
  one.checkpoints=one.checkpoints.filter(row=>row.checkpointKey==='500m').map(row=>({
    ...row,
    longitudinalConfidence:0.8,
    lateralConfidence:row.lateralConfidence==null?null:0.8
  }));
  const rows=classifyXlabsTripScenarios(one);
  assert.equal(rows.length,0);
});

test('C4 persists scenario rows idempotently into the existing race_positions table', async () => {
  const {env,db}=createTestEnv();
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('t','Test')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number) VALUES ('race_trip','t','2099-01-01',1)").run();
  db.prepare("INSERT INTO source_records (id,source_type,fetched_at,quality_status) VALUES ('src_trip','xlabs_race_json','2099-01-01T13:00:00Z','normalized_verified_subset')").run();
  for(let i=1;i<=6;i++){
    db.prepare('INSERT INTO horses (id,canonical_name) VALUES (?,?)').run('h'+i,'Häst '+i);
    db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number) VALUES (?,'race_trip',?,?)").run('e'+i,'h'+i,i);
  }
  const first=await persistXlabsTripScenarios(env,reconstruction());
  assert.equal(first.inserted,6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM race_positions').get().n,6);
  const death=db.prepare("SELECT death_seat,evidence_type,classification_version,confidence FROM race_positions WHERE race_entry_id='e2'").get();
  assert.equal(death.death_seat,1);
  assert.equal(death.evidence_type,'calculated_xlabs');
  assert.equal(death.classification_version,XLABS_TRIP_CLASSIFICATION_VERSION);
  assert.ok(death.confidence>=0.9);
  const second=await persistXlabsTripScenarios(env,reconstruction());
  assert.equal(second.inserted,0);
  assert.equal(second.skipped,6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM race_positions').get().n,6);
});
