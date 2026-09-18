import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  assertFeatureProvenanceAsOfV1,
  assertHistoricalRaceEntryStateAsOfV1,
  assertRaceTargetStateAsOfV1
} from '../src/replay-asof-v1.js';

function seedObservedRace(db) {
  db.prepare("INSERT INTO tracks (id,canonical_name) VALUES ('track-audit','Audit Track')").run();
  db.prepare("INSERT INTO races (id,track_id,race_date,race_number,scheduled_start_at,distance_m,start_method,first_prize_sek) VALUES ('race-audit','track-audit','2099-03-01',1,'2099-03-01T12:00:00Z',2140,'auto',60000)").run();
  db.prepare("INSERT INTO horses (id,canonical_name) VALUES ('horse-audit','Audit Horse')").run();
  db.prepare("INSERT INTO race_entries (id,race_id,horse_id,start_number,actual_lane,handicap_m,actual_start_distance_m,scratched) VALUES ('entry-audit','race-audit','horse-audit',1,1,0,2140,0)").run();
  db.prepare("INSERT INTO source_records (id,source_type,external_id,fetched_at) VALUES ('audit-pre','official_provider','race:audit-pre','2099-03-01T10:00:00Z'),('audit-future','official_provider','race:audit-future','2099-03-01T11:30:00Z')").run();
  const racePre = JSON.stringify({ date:'2099-03-01',distanceM:2140,startMethod:'auto',scheduledStartAt:'2099-03-01T12:00:00Z',prizeText:'Pris: 60.000-30.000-15.000' });
  const entryPre = JSON.stringify({ startNumber:1,postPosition:1,handicapM:0,actualStartDistanceM:2140,scratched:false,scratchSemanticsVerified:true });
  db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json) VALUES ('audit-race-pre','race','race-audit','audit-pre','2099-03-01T10:00:00Z',?)").run(racePre);
  db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json) VALUES ('audit-entry-pre','race_entry','entry-audit','audit-pre','2099-03-01T10:00:00Z',?)").run(entryPre);
}

test('F1 race as-of guard validates canonical target and strict observed first prize', async () => {
  const { db, env } = createTestEnv();
  seedObservedRace(db);
  const result = await assertRaceTargetStateAsOfV1(env,'race-audit','2099-03-01T11:00:00Z');
  assert.equal(result.checked_entries,1);

  db.prepare("UPDATE races SET first_prize_sek=70000 WHERE id='race-audit'").run();
  await assert.rejects(
    () => assertRaceTargetStateAsOfV1(env,'race-audit','2099-03-01T11:00:00Z'),
    /first_prize_sek/
  );
});

test('F1 historical state audit rejects a correction that only became available after forecast time', async () => {
  const { db, env } = createTestEnv();
  seedObservedRace(db);
  db.prepare("UPDATE race_entries SET actual_lane=9 WHERE id='entry-audit'").run();
  const futureFields = JSON.stringify({ startNumber:1,postPosition:9,handicapM:0,actualStartDistanceM:2140,scratched:false,scratchSemanticsVerified:true });
  db.prepare("INSERT INTO normalized_observations (id,entity_type,entity_id,source_record_id,observed_at,fields_json) VALUES ('audit-entry-future','race_entry','entry-audit','audit-future','2099-03-01T11:30:00Z',?)").run(futureFields);

  await assert.rejects(
    () => assertHistoricalRaceEntryStateAsOfV1(env,'race-audit','entry-audit','2099-03-01T11:00:00Z'),
    /replay_historical_state_drift.*actual_lane/
  );
});

test('F1 feature provenance guard rejects any source selected after forecast as-of', async () => {
  const clean = {
    families: {
      form: {
        provenance: {
          as_of: '2099-03-01T11:00:00Z',
          source_refs: [{ source_record_id:'pre',selected_at:'2099-03-01T10:00:00Z',time_basis:'fetched_at' }]
        }
      }
    }
  };
  await assert.doesNotReject(() => assertFeatureProvenanceAsOfV1(clean,'2099-03-01T11:00:00Z'));

  const leaked = structuredClone(clean);
  leaked.families.form.provenance.source_refs.push({ source_record_id:'future',selected_at:'2099-03-01T11:01:00Z',time_basis:'fetched_at' });
  await assert.rejects(
    () => assertFeatureProvenanceAsOfV1(leaked,'2099-03-01T11:00:00Z'),
    /future_source_row_in_feature_provenance/
  );
});
