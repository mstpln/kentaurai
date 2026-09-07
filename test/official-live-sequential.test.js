import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { normalizeCapturedOfficialGameSequential } from '../src/import/official-live-sequential.js';

test('production cursor guard rejects skipped normalization work', async () => {
  const { env } = createTestEnv();
  await assert.rejects(
    () => normalizeCapturedOfficialGameSequential(env, 'src_synthetic_missing', 1),
    /cursor cannot skip unfinished entries; highest safe cursor is 0/
  );
});

test('production cursor guard derives progress only from source-backed race-entry observations', async () => {
  const { env, db } = createTestEnv();
  db.prepare(`
    INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status)
    VALUES ('src_progress', 'official_provider', 'game:V86_2099-03-01_997_1', '2099-02-28T10:00:00.000Z', 'captured_unmapped')
  `).run();
  db.prepare(`
    INSERT INTO normalized_observations
      (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status)
    VALUES
      ('obs_progress_1', 'race_entry', 'entry_progress_1', 'src_progress', '2099-02-28T10:00:00.000Z', '{}', 'normalized_verified_subset'),
      ('obs_progress_horse', 'horse', 'horse_progress_1', 'src_progress', '2099-02-28T10:00:00.000Z', '{}', 'normalized_verified_subset')
  `).run();

  await assert.rejects(
    () => normalizeCapturedOfficialGameSequential(env, 'src_progress', 2),
    /cursor cannot skip unfinished entries; highest safe cursor is 1/
  );
});
