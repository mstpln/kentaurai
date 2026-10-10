import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { buildStorageCleanupObservationPageSql } from '../src/storage-cleanup-audit.js';

function page(db, family, cursor = ['', '', ''], limit = 5000) {
  return db.prepare(buildStorageCleanupObservationPageSql()).all(family, ...cursor, limit);
}

test('observation pagination is family-first, stable and sparse-family bounded', { timeout: 120_000 }, () => {
  const { db } = createTestEnv();
  const insert = db.prepare(`
    INSERT INTO official_snapshot_observations
      (source_record_id,snapshot_family,entity_key,scope_key,observed_at,snapshot_id,factual_changed)
    VALUES (?,?,?,?,?,'synthetic-snapshot',0)
  `);
  db.exec('BEGIN');
  const insertSource = db.prepare(`
    INSERT INTO source_records(id,source_type,fetched_at,quality_status)
    VALUES (?,'synthetic','2026-09-10T10:00:00Z','unknown')
  `);
  for (let index = 0; index < 137; index += 1) {
    insertSource.run(`source-${String(index).padStart(3, '0')}`);
  }
  for (let index = 0; index < 100_000; index += 1) {
    const source = `source-${String(index % 137).padStart(3, '0')}`;
    insert.run(source, 'horse_stat', `stat-${String(index).padStart(6, '0')}`, `scope-${index % 11}`, '2026-09-10T10:00:00Z');
    if (index < 50_000) {
      insert.run(source, 'horse_profile', `profile-${String(index).padStart(6, '0')}`, `scope-${index % 7}`, '2026-09-10T10:00:00Z');
    }
  }
  insert.run('source-000', 'person_stat', 'driver:one', '2026', '2026-09-10T10:00:00Z');
  db.exec('COMMIT');

  const plan = db.prepare(`EXPLAIN QUERY PLAN ${buildStorageCleanupObservationPageSql()}`)
    .all('person_stat', '', '', '', 5000)
    .map((row) => String(row.detail || '')).join('\n');
  assert.match(plan, /SEARCH official_snapshot_observations USING INDEX idx_cleanup_observation_source_page/);
  assert.match(plan, /snapshot_family=[?]/);
  assert.doesNotMatch(plan, /USE TEMP B-TREE/);
  assert.doesNotMatch(plan, /SCAN official_snapshot_observations/);

  assert.equal(page(db, 'person_stat').length, 1);
  assert.equal(page(db, 'horse_record').length, 0);
  assert.equal(page(db, 'horse_profile', ['', '', ''], 4999).length, 4999);
  assert.equal(page(db, 'horse_profile', ['', '', ''], 5000).length, 5000);
  assert.equal(page(db, 'horse_profile', ['', '', ''], 5001).length, 5001);

  const first = page(db, 'horse_profile');
  const repeated = page(db, 'horse_profile');
  assert.deepEqual(repeated, first);
  const last = first.at(-1);
  const second = page(db, 'horse_profile', [last.source_record_id, last.entity_key, last.scope_key]);
  assert.equal(second.length, 5000);
  assert.notDeepEqual(second[0], first[0]);

  for (const [family, expected] of [['horse_profile', 50_000], ['horse_stat', 100_000]]) {
    let cursor = ['', '', ''];
    let total = 0;
    const identities = new Set();
    while (true) {
      const rows = page(db, family, cursor);
      for (const row of rows) identities.add(`${row.source_record_id}\0${row.entity_key}\0${row.scope_key}`);
      total += rows.length;
      if (rows.length < 5000) break;
      const tail = rows.at(-1);
      cursor = [tail.source_record_id, tail.entity_key, tail.scope_key];
    }
    assert.equal(total, expected);
    assert.equal(identities.size, expected, `${family} must not repeat or omit cursor identities`);
  }
});
