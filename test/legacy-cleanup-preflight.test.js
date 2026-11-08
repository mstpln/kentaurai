import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTestEnv } from './helpers/d1.js';
import {
  FIRST_CLEANUP_TABLES, PRESERVED_TABLES, PREFLIGHT_SQL, previewLegacyCleanup
} from '../scripts/preview-legacy-cleanup.mjs';
import { LEGACY_INVENTORY_GROUPS } from '../scripts/inventory-legacy-data.mjs';

test('candidate catalog is narrowly scoped and keeps all user history plus shared source records',()=>{
  const all=new Set(Object.values(LEGACY_INVENTORY_GROUPS).flat());
  for(const table of FIRST_CLEANUP_TABLES)assert.ok(all.has(table));
  for(const table of PRESERVED_TABLES)assert.equal(FIRST_CLEANUP_TABLES.includes(table),false);
  assert.ok(FIRST_CLEANUP_TABLES.includes('editorial_signals'));
  assert.ok(FIRST_CLEANUP_TABLES.includes('analysis_external_exports'));
  assert.equal(FIRST_CLEANUP_TABLES.includes('analysis_external_runs'),false);
  assert.equal(FIRST_CLEANUP_TABLES.includes('post_race_reviews_external_v1'),false);
});

test('production preview SQL runs on complete migrated D1 and cannot mutate data',async()=>{
  const f=createTestEnv();const queries=[];
  const out=await previewLegacyCleanup(async (sql)=>{
    queries.push(sql);
    assert.match(sql,/^SELECT /);
    assert.doesNotMatch(sql,/\b(INSERT|DELETE|UPDATE|DROP|ALTER|CREATE|PRAGMA|REPLACE)\b/i);
    return [f.db.prepare(sql).get()];
  });
  assert.equal(queries.length,Object.keys(PREFLIGHT_SQL).length);
  assert.equal(out.potentialFirstStageRows,0);
  assert.equal(out.releaseEligibleForDeletion,false);
  assert.equal(out.sqlRowsWritten,0);
  assert.equal(out.allOrphanChecksPassed,true);
  assert.equal(out.protected.systems,0);
  assert.equal(out.rawPayloadReturned,false);
  assert.doesNotMatch(JSON.stringify(out),/source_record_id|raw_object_key|race_entry_id|horse_id|payload_json/i);
  f.db.close();
});

test('preflight reports live count discrepancy without silently approving deletion',async()=>{
  const f=createTestEnv();
  f.db.prepare("INSERT INTO horses(id,canonical_name) VALUES ('horse-test','Synthetic Horse')").run();
  f.db.prepare("INSERT INTO editorial_items(id,horse_id,source_name) VALUES ('ed-test','horse-test','synthetic')").run();
  f.db.prepare("INSERT INTO editorial_signals(id,editorial_item_id,signal_type,fact_or_opinion) VALUES ('sig-test','ed-test','synthetic','opinion')").run();
  const out=await previewLegacyCleanup(async sql=>[f.db.prepare(sql).get()]);
  assert.equal(out.candidates.editorial_items,1);
  assert.equal(out.candidates.editorial_signals,1);
  assert.equal(out.potentialFirstStageRows,2);
  assert.equal(out.allOrphanChecksPassed,true);
  assert.equal(out.releaseEligibleForDeletion,false);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM editorial_items').get().n,1);
  f.db.close();
});

test('preflight fails closed for incomplete results, and schema integrity warnings remain warnings',async()=>{
  await assert.rejects(previewLegacyCleanup(async()=>[]),/legacy_preflight_invalid_candidates/);
  await assert.rejects(previewLegacyCleanup(async()=>[{editorial_items:-1}]),/legacy_preflight_bad_count/);
  const f=createTestEnv();
  const normal=await previewLegacyCleanup(async sql=>[f.db.prepare(sql).get()]);
  assert.equal(normal.releaseEligibleForDeletion,false);
  f.db.close();
});

test('extended inventory workflow remains manual and read-only',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/production-legacy-data-inventory.yml',import.meta.url),'utf8');
  const preflight=readFileSync(new URL('../scripts/preview-legacy-cleanup.mjs',import.meta.url),'utf8');
  assert.match(workflow,/preview-legacy-cleanup\.mjs/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/npm run qa/);
  assert.doesNotMatch(workflow,/secret put|wrangler deploy|migrations apply|\/execute\b/);
  assert.doesNotMatch(preflight,/\bDELETE FROM\b|\bDROP TABLE\b|\.delete\(/);
});
