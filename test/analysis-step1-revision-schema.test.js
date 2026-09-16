import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationNames() {
  return readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function applyAll(db) {
  for (const name of migrationNames()) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
  }
}

function insertLock(db, { id, packId, fingerprint, createdAt }) {
  db.prepare(`INSERT INTO analysis_step1_locks (
    id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    'round-d3-schema',
    'kentaurai-step1-lock-v1',
    packId,
    createdAt,
    fingerprint,
    'openai',
    'synthetic-model',
    'step1-prompt-v3-d2',
    '{}',
    `sha256:${id}`,
    createdAt
  );
}

function insertRevision(db, { childId, parentId, parentFingerprint, childFingerprint, createdAt }) {
  db.prepare(`INSERT INTO analysis_step1_lock_revisions (
    child_lock_id,parent_lock_id,game_round_id,contract_version,parent_facts_fingerprint,child_facts_fingerprint,
    affected_legs_json,revision_json,revision_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    childId,
    parentId,
    'round-d3-schema',
    'kentaurai-step1-revision-v1',
    parentFingerprint,
    childFingerprint,
    '[1]',
    '{}',
    `sha256:revision-${childId}`,
    createdAt
  );
}

test('D3 migration preserves immutable single-child lineage under concurrent revision attempts', () => {
  const db = new DatabaseSync(':memory:');
  applyAll(db);
  db.prepare("INSERT INTO game_rounds (id, game_type, round_date) VALUES ('round-d3-schema', 'V85', '2026-09-16')").run();

  insertLock(db, { id: 'parent-lock', packId: 'pack-parent', fingerprint: 'sha256:parent', createdAt: '2026-09-16T08:00:00.000Z' });
  insertLock(db, { id: 'child-a', packId: 'pack-a', fingerprint: 'sha256:a', createdAt: '2026-09-16T08:10:00.000Z' });
  insertLock(db, { id: 'child-b', packId: 'pack-b', fingerprint: 'sha256:b', createdAt: '2026-09-16T08:10:01.000Z' });

  insertRevision(db, {
    childId: 'child-a',
    parentId: 'parent-lock',
    parentFingerprint: 'sha256:parent',
    childFingerprint: 'sha256:a',
    createdAt: '2026-09-16T08:10:00.000Z'
  });

  assert.throws(() => insertRevision(db, {
    childId: 'child-b',
    parentId: 'parent-lock',
    parentFingerprint: 'sha256:parent',
    childFingerprint: 'sha256:b',
    createdAt: '2026-09-16T08:10:01.000Z'
  }), /UNIQUE constraint failed/);

  const lineage = db.prepare('SELECT child_lock_id,parent_lock_id FROM analysis_step1_lock_revisions').all();
  assert.deepEqual(
    lineage.map((row) => ({ child_lock_id: row.child_lock_id, parent_lock_id: row.parent_lock_id })),
    [{ child_lock_id: 'child-a', parent_lock_id: 'parent-lock' }]
  );
});