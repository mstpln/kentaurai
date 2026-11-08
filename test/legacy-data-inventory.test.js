import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEGACY_INVENTORY_GROUPS,
  DELETE_CANDIDATE_GROUPS,
  ALWAYS_PROTECTED,
  assertLegacyInventoryCatalog,
  inventoryCountSql,
  inventoryLegacyData
} from '../scripts/inventory-legacy-data.mjs';
import { createTestEnv } from './helpers/d1.js';

test('inventory catalog never targets personal systems or official measurements for deletion', () => {
  assert.doesNotThrow(assertLegacyInventoryCatalog);
  const candidates = DELETE_CANDIDATE_GROUPS.flatMap((group) => LEGACY_INVENTORY_GROUPS[group]);
  for (const table of [
    ...ALWAYS_PROTECTED, 'systems', 'system_selections',
    'travdata_manual_systems', 'travdata_horse_notes',
    'reference_round_exports', 'reference_observations', 'post_race_reviews'
  ]) {
    assert.equal(candidates.includes(table), false, table);
  }
  assert.ok(candidates.includes('editorial_items'));
  assert.ok(candidates.includes('ai_horse_predictions'));
  assert.ok(candidates.includes('external_horse_stat_snapshots'));
});

test('all inventory tables exist in the current complete migrated D1 schema', async () => {
  const { db } = createTestEnv();
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name));
  for (const [group, names] of Object.entries(LEGACY_INVENTORY_GROUPS)) {
    for (const name of names) assert.ok(tables.has(name), group + '/' + name);
    assert.match(inventoryCountSql(group), /^SELECT \(SELECT COUNT\(\*\) FROM /);
  }
  db.close();
});

test('inventory produces only safe aggregate counts and never changes D1', async () => {
  const { db } = createTestEnv();
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    assert.match(sql, /^SELECT /);
    assert.doesNotMatch(sql, /\b(?:DELETE|UPDATE|INSERT|DROP|ALTER|CREATE|ATTACH|DETACH|VACUUM)\b/i);
    return [db.prepare(sql).get()];
  };
  const out = await inventoryLegacyData(query);
  assert.equal(out.mode, 'read_only_legacy_data_inventory');
  assert.equal(out.deletionAuthorized, false);
  assert.equal(out.preservedSystemsNotClassifiedForDeletion, true);
  assert.equal(out.r2PayloadsNotInspected, true);
  assert.equal(calls.length, Object.keys(LEGACY_INVENTORY_GROUPS).length);
  for (const [group, values] of Object.entries(out.counts)) {
    assert.deepEqual(Object.keys(values), LEGACY_INVENTORY_GROUPS[group]);
    assert.ok(Object.values(values).every(x => x === 0));
  }
  assert.doesNotMatch(JSON.stringify(out), /source_record_id|raw_object_key|horse_id|race_entry_id|payload_json/);
  db.close();
});

test('inventory fails closed on a partial or malformed aggregation', async () => {
  await assert.rejects(inventoryLegacyData(async () => [{}]), /missing_inventory_count/);
  await assert.rejects(inventoryLegacyData(async () => [{editorial_items:-1}]), /invalid_aggregate_count/);
  await assert.rejects(inventoryLegacyData(async () => []), /invalid_inventory_result/);
});

test('manual inventory workflow has no deploy, destructive operations or secret exposure', () => {
  const workflow = readFileSync(new URL('../.github/workflows/production-legacy-data-inventory.yml', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../scripts/inventory-legacy-data.mjs', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /kentaurai-production-operation/);
  assert.match(workflow, /npm run qa/);
  assert.match(workflow, /inventory-legacy-data\.mjs/);
  assert.doesNotMatch(workflow, /\b(?:wrangler deploy|wrangler d1 execute|db:migrate|secret put|secret delete|mode:\s*execute)\b/i);
  assert.doesNotMatch(script, /RAW_BUCKET|\.delete\(|\bDROP TABLE\b|\bDELETE FROM\b/);
});
