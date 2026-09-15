import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXlabsIntervalsV2,
  normalizeCapturedXlabsIntervalsV2,
  XLABS_INTERVALS_V2_VERSION
} from '../src/xlabs-intervals-v2.js';
import { createTestEnv } from './helpers/d1.js';

const AS_OF = '2099-01-02T13:00:00.000Z';

function syntheticTelemetry({ missing = {}, includeSecond = false, includeThird = false } = {}) {
  return Array.from({ length: 25 }, (_, index) => {
    const targets = [];
    if (!(missing[1] || []).includes(index)) {
      targets.push({
        number: 1,
        posX: index * 50,
        posY: 0,
        distanceToFinish: Math.max(0, 1200 - index * 50)
      });
    }
    if (includeSecond && !(missing[2] || []).includes(index)) {
      targets.push({
        number: 2,
        posX: index * 40,
        posY: 5,
        distanceToFinish: Math.max(0, 1200 - index * 40)
      });
    }
    if (includeThird && !(missing[3] || []).includes(index)) {
      targets.push({
        number: 3,
        posX: index * 45,
        posY: 10,
        distanceToFinish: Math.max(0, 1200 - index * 45)
      });
    }
    return {
      trackId: 7,
      raceNumber: 5,
      timestamp: new Date(Date.UTC(2099, 0, 2, 12, 0, index)).toISOString(),
      targets
    };
  });
}

function entries(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    race_entry_id: `entry_${index + 1}`,
    start_number: index + 1,
    actual_start_distance_m: 1000,
    race_distance_m: 1000,
    scratched: 0
  }));
}

function build(payload, raceEntries = entries(1)) {
  return buildXlabsIntervalsV2(payload, {
    trackId: 7,
    raceNumber: 5,
    entries: raceEntries,
    sourceRecordId: 'src_xlabs_c1',
    sourceSelectedAt: AS_OF,
    asOf: AS_OF
  });
}

function seedOfficialRace(db, raceEntryCount = 1) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_7','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_7','official','7')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('race_5','track_7','2099-01-02',5,1000,'auto')`).run();
  for (let number = 1; number <= raceEntryCount; number += 1) {
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(`horse_${number}`, `Synthetic ${number}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_start_distance_m) VALUES (?, 'race_5', ?, ?, 1000)`).run(
      `entry_${number}`,
      `horse_${number}`,
      number
    );
  }
}

function seedCapturedTelemetry(db, objects, payload, qualityStatus = 'captured_unmapped') {
  const key = 'raw/xlabs_race_json/2099-01-02/c1-synthetic.json';
  objects.set(key, { body: JSON.stringify(payload), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES ('src_xlabs_c1','xlabs_race_json','2099-01-02:7:5',?,?,'synthetic-c1-hash',?,'unknown',?)`)
    .run(AS_OF, key, qualityStatus, JSON.stringify({ date: '2099-01-02', requestedTrackId: 7, xlabsTrackId: 7, raceNumber: 5 }));
}

test('C1 keeps useful local intervals when total starter coverage is only 96 percent', () => {
  const result = build(syntheticTelemetry({ missing: { 1: [20] } }));
  const bundle = result.bundles[0];
  assert.equal(bundle.total_target_frame_count, 24);
  assert.equal(bundle.total_frame_count, 25);
  assert.equal(bundle.total_frame_coverage, 0.96);
  assert.equal(bundle.whole_race_v1_eligible, false);
  assert.equal(bundle.features.first_100_km_pace_ms.evidence_level, 'B');
  assert.ok(Number.isFinite(bundle.features.first_100_km_pace_ms.value));
  assert.equal(bundle.features.extra_distance_pct.value, null);
  assert.equal(bundle.features.extra_distance_pct.evidence_level, 'D');
  const firstInterval = result.intervalRows.find((row) => row.intervalStartM === 0 && row.intervalEndM === 100);
  assert.equal(firstInterval.status, 'valid');
  assert.ok(Number.isFinite(firstInterval.elapsedMs));
  assert.ok(Number.isFinite(firstInterval.kmPaceMs));
});

test('a missing local window nulls that feature without discarding unrelated X-Labs features', () => {
  const result = build(syntheticTelemetry({ missing: { 1: [8] } }));
  const bundle = result.bundles[0];
  assert.ok(Number.isFinite(bundle.features.first_100_km_pace_ms.value));
  assert.equal(bundle.features.second_100_km_pace_ms.value, null);
  assert.equal(bundle.features.second_100_km_pace_ms.evidence_level, 'D');
  assert.equal(bundle.features.opening_acceleration_delta_ms_per_km.value, null);
  assert.ok(Number.isFinite(bundle.features.last_100_km_pace_ms.value));
  assert.ok(Number.isFinite(bundle.features.best_100_km_pace_ms.value));
});

test('C1 replay is deterministic for the same source, cutoff and official entries', () => {
  const payload = syntheticTelemetry({ missing: { 1: [20] } });
  const first = build(payload);
  const second = build(structuredClone(payload));
  assert.deepEqual(second, first);
});

test('field-relative X-Labs metrics always disclose the measured denominator and leave unmeasured starters unranked', () => {
  const payload = syntheticTelemetry({ includeSecond: true });
  const result = build(payload, entries(3));
  const first = result.bundles.find((bundle) => bundle.start_number === 1);
  const second = result.bundles.find((bundle) => bundle.start_number === 2);
  const third = result.bundles.find((bundle) => bundle.start_number === 3);
  const metric1 = first.field_relative.first_100_km_pace_ms;
  const metric2 = second.field_relative.first_100_km_pace_ms;
  const metric3 = third.field_relative.first_100_km_pace_ms;
  assert.equal(metric1.measured_field_count, 2);
  assert.equal(metric1.active_field_size, 3);
  assert.equal(metric1.measured_field_share, 2 / 3);
  assert.equal(metric1.ascending_rank, 1);
  assert.equal(metric2.ascending_rank, 2);
  assert.equal(metric3.ascending_rank, null);
  assert.equal(third.features.first_100_km_pace_ms.value, null);
  assert.equal(third.features.first_100_km_pace_ms.evidence_level, 'D');
});

test('C1 rejects feature cutoffs earlier than the raw source availability time', () => {
  assert.throws(() => buildXlabsIntervalsV2(syntheticTelemetry(), {
    trackId: 7,
    raceNumber: 5,
    entries: entries(1),
    sourceRecordId: 'src_xlabs_c1',
    sourceSelectedAt: AS_OF,
    asOf: '2099-01-02T12:59:59.000Z'
  }), /sourceSelectedAt cannot be after asOf/);
});

test('C1 persists compact interval rows idempotently without changing trusted v1 source quality', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedCapturedTelemetry(db, objects, syntheticTelemetry({ missing: { 1: [20] } }), 'normalized_verified_subset');

  const first = await normalizeCapturedXlabsIntervalsV2(env, 'src_xlabs_c1');
  assert.equal(first.mapperVersion, XLABS_INTERVALS_V2_VERSION);
  assert.equal(first.intervalRows, 10);
  assert.equal(first.counts.inserted, 10);
  assert.ok(first.validIntervals > 0 && first.validIntervals < 10);
  assert.equal(db.prepare(`SELECT quality_status FROM source_records WHERE id='src_xlabs_c1'`).get().quality_status, 'normalized_verified_subset');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_intervals WHERE source_record_id='src_xlabs_c1'`).get().n, 10);
  assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_intervals WHERE eligibility_status <> 'valid'`).get().n > 0);
  const firstRows = db.prepare(`SELECT interval_start_m, interval_end_m, elapsed_ms, km_pace_ms, local_frame_coverage, eligibility_status, mapper_version FROM xlabs_intervals ORDER BY interval_start_m`).all();

  const second = await normalizeCapturedXlabsIntervalsV2(env, 'src_xlabs_c1');
  assert.equal(second.counts.inserted, 0);
  assert.equal(second.counts.skipped, 10);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_intervals WHERE source_record_id='src_xlabs_c1'`).get().n, 10);
  assert.deepEqual(
    db.prepare(`SELECT interval_start_m, interval_end_m, elapsed_ms, km_pace_ms, local_frame_coverage, eligibility_status, mapper_version FROM xlabs_intervals ORDER BY interval_start_m`).all(),
    firstRows
  );
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM import_runs WHERE source_type='xlabs_intervals_v2_normalize' AND status='success'`).get().n, 2);
});
