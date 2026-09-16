import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

function migrationNames() {
  return readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
}

function apply(db, names) {
  for (const name of names) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
}

test('D3 migration creates immutable lock revision lineage and compact revision bases on a fresh database', () => {
  const db = new DatabaseSync(':memory:');
  apply(db, migrationNames());
  const basisColumns = new Map(db.prepare('PRAGMA table_info(analysis_step1_lock_revision_bases)').all().map((row) => [row.name, row]));
  for (const required of ['lock_id','game_round_id','basis_version','pack_id','pack_as_of','facts_fingerprint','round_material_hash','leg_material_hashes_json','volatile_facts_json','created_at']) {
    assert.ok(basisColumns.has(required), `missing analysis_step1_lock_revision_bases.${required}`);
  }
  const revisionColumns = new Map(db.prepare('PRAGMA table_info(analysis_step1_lock_revisions)').all().map((row) => [row.name, row]));
  for (const required of ['id','game_round_id','parent_lock_id','child_lock_id','parent_lock_hash','child_lock_hash','parent_facts_fingerprint','child_facts_fingerprint','revision_scope','affected_legs_json','revision_pack_hash','request_json','revision_json','revision_hash','created_at']) {
    assert.ok(revisionColumns.has(required), `missing analysis_step1_lock_revisions.${required}`);
  }
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((row) => row.name));
  assert.ok(indexes.has('idx_analysis_step1_lock_revision_bases_round'));
  assert.ok(indexes.has('idx_analysis_step1_lock_revisions_round_created'));
});

test('D3 migration upgrades D2 without rewriting legacy systems and prevents branching lock lineage', () => {
  const names = migrationNames();
  assert.equal(names.at(-1), '0020_analysis_step1_lock_revisions.sql');
  const db = new DatabaseSync(':memory:');
  apply(db, names.slice(0, -1));
  db.prepare("INSERT INTO game_rounds (id, game_type, round_date) VALUES ('legacy-round', 'V85', '2026-09-06')").run();
  db.prepare(`INSERT INTO systems (id, game_round_id, system_type, budget_sek, row_count, spike_count, created_at)
    VALUES ('legacy-system', 'legacy-round', 'main', 200, 400, 2, '2026-09-06T00:00:00Z')`).run();
  for (const [id, created] of [['parent','2026-09-06T08:00:00Z'],['child-a','2026-09-06T08:10:00Z'],['child-b','2026-09-06T08:20:00Z']]) {
    db.prepare(`INSERT INTO analysis_step1_locks (
      id,game_round_id,contract_version,pack_id,pack_as_of,facts_fingerprint,provider,model,prompt_version,lock_json,lock_hash,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,'legacy-round','kentaurai-step1-lock-v1',`pack-${id}`,'2026-09-06T07:00:00.000Z',`facts-${id}`,
      'openai','synthetic-model','step1-prompt-v3-d2','{}',`hash-${id}`,created
    );
  }
  apply(db, ['0020_analysis_step1_lock_revisions.sql']);
  assert.equal(db.prepare("SELECT spike_count FROM systems WHERE id='legacy-system'").get().spike_count, 2);
  const insertRevision = (id, child) => db.prepare(`INSERT INTO analysis_step1_lock_revisions (
    id,game_round_id,parent_lock_id,child_lock_id,parent_lock_hash,child_lock_hash,parent_facts_fingerprint,child_facts_fingerprint,
    revision_scope,affected_legs_json,revision_pack_hash,request_json,revision_json,revision_hash,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,'legacy-round','parent',child,'hash-parent',`hash-${child}`,'facts-parent',`facts-${child}`,
    'affected_legs','[1]','pack-hash','{}','{}',`revision-hash-${id}`,'2026-09-06T08:30:00Z'
  );
  insertRevision('revision-a','child-a');
  assert.throws(() => insertRevision('revision-b','child-b'), /UNIQUE constraint failed/);
});
