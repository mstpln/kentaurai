import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXlabsPositionReconstruction,
  createXlabsPositionReconstructionJob,
  normalizeCapturedXlabsPositionReconstruction,
  stepXlabsPositionReconstructionJob,
  XLABS_POSITION_RECONSTRUCTION_VERSION
} from '../src/xlabs-position-reconstruction-v1.js';
import { createTestEnv } from './helpers/d1.js';

const FETCHED_AT = '2099-01-02T13:00:00.000Z';
const TRACK_ID = 7;
const RACE_NUMBER = 5;
const RACE_ID = 'race_5';
const SOURCE_ID = 'src_xlabs_c3';

function entries(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    race_entry_id: `entry_${index + 1}`,
    start_number: index + 1,
    actual_start_distance_m: 1000,
    race_distance_m: 1000,
    scratched: 0
  }));
}

function ovalPoint(progressM, lateralM = 0) {
  const radius = 140 + lateralM;
  const angle = progressM / 140;
  return {
    posX: radius * Math.cos(angle),
    posY: radius * Math.sin(angle)
  };
}

function syntheticOvalTelemetry({ missing = {}, tied = false } = {}) {
  return Array.from({ length: 51 }, (_, index) => {
    const leaderProgress = index * 20;
    const d1 = Math.max(5, 1000 - leaderProgress);
    const d2 = tied ? d1 : Math.max(0, 1040 - index * 21);
    const d3 = Math.max(0, 1030 - index * 19.5);
    const distances = [d1, d2, d3];
    const laterals = [0, 4, -3];
    const targets = [];
    for (let number = 1; number <= 3; number += 1) {
      if ((missing[number] || []).includes(index)) continue;
      const progress = Math.max(0, 1000 - distances[number - 1]);
      const point = ovalPoint(progress, laterals[number - 1]);
      targets.push({
        number,
        posX: point.posX,
        posY: point.posY,
        distanceToFinish: distances[number - 1]
      });
    }
    return {
      trackId: TRACK_ID,
      raceNumber: RACE_NUMBER,
      timestamp: new Date(Date.UTC(2099, 0, 2, 12, 0, 0, index * 200)).toISOString(),
      targets
    };
  });
}

function syntheticJitterTelemetry() {
  return syntheticOvalTelemetry().map((frame, frameIndex) => ({
    ...frame,
    targets: frame.targets.map((target) => {
      if (target.number !== 1) return target;
      const jitter = frameIndex % 2 === 0 ? 1 : -1;
      return {
        ...target,
        posX: target.posX + jitter,
        posY: target.posY - jitter
      };
    })
  }));
}

function build(payload = syntheticOvalTelemetry()) {
  return buildXlabsPositionReconstruction(payload, {
    trackId: TRACK_ID,
    raceNumber: RACE_NUMBER,
    raceId: RACE_ID,
    entries: entries(),
    sourceRecordId: SOURCE_ID
  });
}

function seedOfficialRace(db) {
  db.prepare(`INSERT INTO tracks (id, canonical_name, country_code) VALUES ('track_7','Synthetic Track','SE')`).run();
  db.prepare(`INSERT INTO track_external_ids (track_id, source_type, external_id) VALUES ('track_7','official','7')`).run();
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method) VALUES ('race_5','track_7','2099-01-02',5,1000,'auto')`).run();
  for (let number = 1; number <= 3; number += 1) {
    db.prepare(`INSERT INTO horses (id, canonical_name) VALUES (?, ?)`).run(`horse_${number}`, `Synthetic ${number}`);
    db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number, actual_start_distance_m) VALUES (?, 'race_5', ?, ?, 1000)`).run(
      `entry_${number}`,
      `horse_${number}`,
      number
    );
  }
}

function seedCapturedTelemetry(db, objects, payload = syntheticOvalTelemetry(), sourceId = SOURCE_ID, fetchedAt = FETCHED_AT) {
  const key = `raw/xlabs_race_json/2099-01-02/${sourceId}.json`;
  objects.set(key, { body: JSON.stringify(payload), options: {} });
  db.prepare(`INSERT INTO source_records
    (id, source_type, external_id, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES (?, 'xlabs_race_json', '2099-01-02:7:5', ?, ?, ?, 'normalized_verified_subset', 'unknown', ?)`)
    .run(sourceId, fetchedAt, key, `synthetic-${sourceId}-hash`, JSON.stringify({ date: '2099-01-02', requestedTrackId: 7, xlabsTrackId: 7, raceNumber: 5 }));
}

test('C3 reconstructs obvious longitudinal order, gaps and lateral geometry on a synthetic oval', () => {
  const result = build();
  assert.equal(result.contractVersion, 'kentaurai-xlabs-position-reconstruction-v1');
  assert.equal(result.reconstructionVersion, XLABS_POSITION_RECONSTRUCTION_VERSION);
  assert.equal(result.semantics.named_trip_labels_enabled, false);
  assert.equal(result.semantics.legacy_race_positions_written, false);
  assert.equal(result.semantics.lateral_offset_sign, 'orientation_unvalidated_no_inner_outer_semantics');

  const early = result.checkpoints.filter((row) => row.checkpointKey === '200m');
  assert.equal(early.length, 3);
  const ranked = early.filter((row) => row.positionRank != null).sort((a, b) => a.positionRank - b.positionRank);
  assert.deepEqual(ranked.map((row) => row.raceEntryId), ['entry_1', 'entry_2', 'entry_3']);
  assert.equal(ranked[0].metersBehindLeader, 0);
  assert.ok(ranked[1].metersBehindLeader > 0);
  assert.ok(early.some((row) => Number.isFinite(row.relativeLateralOffsetM)));
  assert.ok(early.every((row) => row.fieldCoverage === 1));
  assert.ok(result.summaries.every((summary) => summary.frameCoverage === 1));
});

test('C3 smoothed tangent keeps lateral projection stable under alternating leader jitter', () => {
  const baseline = build();
  const jittered = build(syntheticJitterTelemetry());
  const baselineRow = baseline.checkpoints.find((row) => row.checkpointKey === '200m' && row.raceEntryId === 'entry_2');
  const jitteredRow = jittered.checkpoints.find((row) => row.checkpointKey === '200m' && row.raceEntryId === 'entry_2');
  assert.ok(Number.isFinite(baselineRow?.relativeLateralOffsetM));
  assert.ok(Number.isFinite(jitteredRow?.relativeLateralOffsetM));
  assert.ok(Math.abs(jitteredRow.relativeLateralOffsetM - baselineRow.relativeLateralOffsetM) < 2);
  assert.ok(jitteredRow.lateralConfidence >= 0.9);
});

test('C3 excludes a locally missing target only from affected frame/checkpoint coverage', () => {
  const payload = syntheticOvalTelemetry({ missing: { 3: [23, 24, 25, 26, 27] } });
  const result = build(payload);
  const partial = result.fieldCoverage.find((row) => row.observed_share < 1);
  assert.ok(partial, 'expected one checkpoint with partial target coverage');
  assert.equal(partial.observed_entries, 2);
  assert.equal(partial.active_field_size, 3);
  assert.equal(partial.observed_share, 2 / 3);
  const affectedRows = result.checkpoints.filter((row) => row.checkpointKey === partial.checkpoint_key);
  assert.equal(affectedRows.length, 2);
  assert.ok(result.fieldCoverage.some((row) => row.observed_share === 1), 'unrelated checkpoints remain fully observed');
  const horse3 = result.summaries.find((row) => row.raceEntryId === 'entry_3');
  assert.ok(horse3.frameCoverage < 1 && horse3.frameCoverage > 0.8);
});

test('C3 emits a stable lead-change candidate and finish checkpoint consistent with telemetry order', () => {
  const result = build();
  const leadChanges = result.episodes.filter((episode) => episode.episodeType === 'lead_change_candidate');
  const entry2LeadChange = leadChanges.find((episode) => episode.raceEntryId === 'entry_2');
  assert.ok(entry2LeadChange);
  assert.equal(entry2LeadChange.details.unresolved_checkpoints_between, 1);

  const finish = result.checkpoints.filter((row) => row.checkpointKey === 'finish' && row.positionRank != null);
  assert.ok(finish.length >= 2, 'finish checkpoint should retain observed finish ordering');
  finish.sort((a, b) => a.positionRank - b.positionRank);
  assert.equal(finish[0].raceEntryId, 'entry_2');
  assert.equal(finish[0].metersBehindLeader, 0);
  assert.ok(finish[1].metersBehindLeader > 0);
});

test('C3 abstains from rank and leader gap when longitudinal telemetry is ambiguous', () => {
  const result = build(syntheticOvalTelemetry({ tied: true }));
  const rows = result.checkpoints.filter((row) => row.checkpointKey === '200m');
  const tiedRows = rows.filter((row) => row.raceEntryId === 'entry_1' || row.raceEntryId === 'entry_2');
  assert.equal(tiedRows.length, 2);
  assert.ok(tiedRows.every((row) => row.positionRank == null));
  assert.ok(tiedRows.every((row) => row.metersBehindLeader == null));
});

test('C3 persistence is idempotent, source-backed and promotes stable C4 labels into race_positions', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedCapturedTelemetry(db, objects);

  const first = await normalizeCapturedXlabsPositionReconstruction(env, SOURCE_ID);
  assert.equal(first.reconstructionVersion, XLABS_POSITION_RECONSTRUCTION_VERSION);
  assert.ok(first.checkpointRows > 0);
  assert.ok(first.summaryRows === 3);
  assert.ok(first.counts.inserted > 0);
  assert.equal(first.namedTripLabelsEnabled, true);
  assert.ok(first.tripClassificationRows >= 0);
  const firstNamed = db.prepare(`SELECT COUNT(*) AS n FROM race_positions`).get().n;
  assert.equal(firstNamed, first.tripClassificationRows);
  assert.equal(db.prepare(`SELECT quality_status FROM source_records WHERE id=?`).get(SOURCE_ID).quality_status, 'normalized_verified_subset');
  const countsAfterFirst = {
    checkpoints: db.prepare(`SELECT COUNT(*) AS n FROM race_position_checkpoints`).get().n,
    episodes: db.prepare(`SELECT COUNT(*) AS n FROM race_trajectory_episodes`).get().n,
    summaries: db.prepare(`SELECT COUNT(*) AS n FROM race_trajectory_summaries`).get().n
  };

  const second = await normalizeCapturedXlabsPositionReconstruction(env, SOURCE_ID);
  assert.equal(second.counts.inserted, 0);
  assert.ok(second.counts.skipped > 0);
  assert.deepEqual({
    checkpoints: db.prepare(`SELECT COUNT(*) AS n FROM race_position_checkpoints`).get().n,
    episodes: db.prepare(`SELECT COUNT(*) AS n FROM race_trajectory_episodes`).get().n,
    summaries: db.prepare(`SELECT COUNT(*) AS n FROM race_trajectory_summaries`).get().n
  }, countsAfterFirst);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM race_positions`).get().n, firstNamed);
});

test('C3 selective reconstruction job is date-bounded, checkpointed and advances one stored source per explicit step', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  seedCapturedTelemetry(db, objects);
  db.prepare(`INSERT INTO xlabs_backfill_jobs (id, scope, start_date, end_date, next_date, status) VALUES ('existing-backfill','historical_all','2098-01-01','2098-12-31','2098-06-01','failed')`).run();

  const job = await createXlabsPositionReconstructionJob(env, { startDate: '2099-01-02', endDate: '2099-01-02' });
  const firstStep = await stepXlabsPositionReconstructionJob(env, job.id);
  assert.equal(firstStep.done, false);
  assert.equal(firstStep.sourceRecordId, SOURCE_ID);
  const stored = db.prepare(`SELECT processed_sources,cursor_source_record_id,status FROM xlabs_position_reconstruction_jobs WHERE id=?`).get(job.id);
  assert.equal(stored.processed_sources, 1);
  assert.equal(stored.cursor_source_record_id, SOURCE_ID);
  assert.equal(stored.status, 'running');

  const secondStep = await stepXlabsPositionReconstructionJob(env, job.id);
  assert.equal(secondStep.done, true);
  assert.equal(secondStep.status, 'completed');
  const oldBackfill = db.prepare(`SELECT status,next_date FROM xlabs_backfill_jobs WHERE id='existing-backfill'`).get();
  assert.equal(oldBackfill.status, 'failed');
  assert.equal(oldBackfill.next_date, '2098-06-01');
});


test('C3 reconstruction quarantines deterministic duplicate-target telemetry and advances without inventing rows', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  const duplicatePayload = syntheticOvalTelemetry();
  duplicatePayload[10].targets.push({ ...duplicatePayload[10].targets[0] });
  seedCapturedTelemetry(db, objects, duplicatePayload, 'src_bad_duplicate', '2099-01-02T12:00:00.000Z');
  seedCapturedTelemetry(db, objects, syntheticOvalTelemetry(), 'src_good_after', '2099-01-02T13:00:00.000Z');

  const job = await createXlabsPositionReconstructionJob(env, { startDate: '2099-01-02', endDate: '2099-01-02' });
  const first = await stepXlabsPositionReconstructionJob(env, job.id);
  assert.equal(first.quarantined, true);
  assert.equal(first.failureCode, 'duplicate_target');
  assert.equal(first.sourceRecordId, 'src_bad_duplicate');

  const storedAfterBad = db.prepare(`
    SELECT status,processed_sources,quarantined_sources,consecutive_errors,last_error,cursor_source_record_id
    FROM xlabs_position_reconstruction_jobs WHERE id=?
  `).get(job.id);
  assert.equal(storedAfterBad.status, 'running');
  assert.equal(storedAfterBad.processed_sources, 1);
  assert.equal(storedAfterBad.quarantined_sources, 1);
  assert.equal(storedAfterBad.consecutive_errors, 0);
  assert.equal(storedAfterBad.last_error, null);
  assert.equal(storedAfterBad.cursor_source_record_id, 'src_bad_duplicate');
  const quarantine = db.prepare(`
    SELECT source_record_id,failure_code,reconstruction_version
    FROM xlabs_position_reconstruction_quarantine WHERE job_id=?
  `).get(job.id);
  assert.equal(quarantine.source_record_id, 'src_bad_duplicate');
  assert.equal(quarantine.failure_code, 'duplicate_target');
  assert.equal(quarantine.reconstruction_version, XLABS_POSITION_RECONSTRUCTION_VERSION);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM race_position_checkpoints WHERE source_record_id='src_bad_duplicate'`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM race_positions WHERE source_record_id='src_bad_duplicate'`).get().n, 0);

  const second = await stepXlabsPositionReconstructionJob(env, job.id);
  assert.equal(second.quarantined, undefined);
  assert.equal(second.sourceRecordId, 'src_good_after');
  assert.ok(second.result.counts.inserted > 0);

  const third = await stepXlabsPositionReconstructionJob(env, job.id);
  assert.equal(third.status, 'completed');
  const final = db.prepare(`
    SELECT status,processed_sources,quarantined_sources,cursor_source_record_id
    FROM xlabs_position_reconstruction_jobs WHERE id=?
  `).get(job.id);
  assert.equal(final.status, 'completed');
  assert.equal(final.processed_sources, 2);
  assert.equal(final.quarantined_sources, 1);
  assert.equal(final.cursor_source_record_id, 'src_good_after');
});

test('C3 reconstruction still fails closed on non-quarantinable telemetry errors', async () => {
  const { env, db, objects } = createTestEnv();
  seedOfficialRace(db);
  const invalidPayload = syntheticOvalTelemetry();
  invalidPayload[1] = { ...invalidPayload[1], timestamp: invalidPayload[0].timestamp };
  seedCapturedTelemetry(db, objects, invalidPayload, 'src_bad_timestamp');

  const job = await createXlabsPositionReconstructionJob(env, { startDate: '2099-01-02', endDate: '2099-01-02' });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await assert.rejects(
      () => stepXlabsPositionReconstructionJob(env, job.id),
      /timestamps must be strictly increasing/
    );
  }

  const stored = db.prepare(`
    SELECT status,processed_sources,quarantined_sources,consecutive_errors,cursor_source_record_id
    FROM xlabs_position_reconstruction_jobs WHERE id=?
  `).get(job.id);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.processed_sources, 0);
  assert.equal(stored.quarantined_sources, 0);
  assert.equal(stored.consecutive_errors, 3);
  assert.equal(stored.cursor_source_record_id, null);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM xlabs_position_reconstruction_quarantine WHERE job_id=?`).get(job.id).n, 0);
});
