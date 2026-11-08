// Read-only inventory of obsolete AI/editorial data in private Cloudflare D1.
// Never fetch source IDs, personal text, racing facts, or R2 payloads.
// This is NOT a deletion tool or a proof that deleting a table is safe.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCloudflareReadonlyQuery } from './diagnose-storage-anomalies.mjs';

export const LEGACY_INVENTORY_GROUPS = Object.freeze({
  editorial: Object.freeze([
    'editorial_items', 'editorial_signals', 'external_horse_stat_snapshots'
  ]),
  ai_predictions: Object.freeze([
    'ai_race_analyses', 'ai_horse_predictions'
  ]),
  ai_workflow_first: Object.freeze([
    'analysis_step1_locks', 'analysis_step1_lock_revisions',
    'analysis_decision_runs', 'analysis_decision_probabilities'
  ]),
  ai_workflow_second: Object.freeze([
    'analysis_optimizer_runs', 'analysis_optimizer_selections',
    'analysis_step2_results', 'analysis_v3_runs'
  ]),
  external_analysis: Object.freeze([
    'analysis_external_exports', 'analysis_external_runs'
  ]),
  ai_replay: Object.freeze([
    'replay_runs', 'forecast_evaluations', 'replay_ablation_results'
  ]),
  ai_post_race: Object.freeze([
    'post_race_reviews_v2', 'post_race_learning_links',
    'post_race_reviews_external_v1', 'post_race_learning_links_external_v1'
  ]),
  ai_learning: Object.freeze([
    'learning_hypotheses', 'learning_observations', 'model_change_log'
  ]),
  manual_review_required: Object.freeze([
    'post_race_reviews', 'reference_round_exports',
    'reference_observations', 'model_versions'
  ]),
  protected_personal: Object.freeze([
    'systems', 'system_selections',
    'travdata_manual_systems', 'travdata_horse_notes'
  ])
});

export const DELETE_CANDIDATE_GROUPS = Object.freeze([
  'editorial', 'ai_predictions', 'ai_workflow_first', 'ai_workflow_second',
  'external_analysis', 'ai_replay', 'ai_post_race', 'ai_learning'
]);

export const ALWAYS_PROTECTED = Object.freeze([
  'source_records', 'import_runs', 'races', 'race_entries', 'race_results',
  'race_positions', 'game_rounds', 'game_legs', 'game_round_final_results',
  'horses', 'drivers', 'trainers', 'tracks', 'xlabs_data', 'xlabs_intervals',
  'betting_snapshots', 'odds_snapshots', 'equipment', 'race_conditions',
  'analysis_features', 'analysis_entry_form_snapshots', 'post_race_settlement_jobs',
  'travdata_personal_tombstones', 'official_snapshot_observations',
  'horse_profile_snapshots', 'horse_stat_snapshots', 'horse_record_snapshots',
  'person_stat_snapshots'
]);

function checkedCount(value, table) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('invalid_aggregate_count_' + table);
  }
  return value;
}

export function assertLegacyInventoryCatalog() {
  const seen = new Set();
  for (const [group, tables] of Object.entries(LEGACY_INVENTORY_GROUPS)) {
    if (!tables.length) throw new Error('empty_inventory_group_' + group);
    for (const table of tables) {
      if (!/^[a-z][a-z0-9_]*$/.test(table) || seen.has(table)) {
        throw new Error('duplicate_or_invalid_inventory_table');
      }
      seen.add(table);
    }
  }
  for (const group of DELETE_CANDIDATE_GROUPS) {
    if (!(group in LEGACY_INVENTORY_GROUPS)) throw new Error('unknown_candidate_group');
    if (LEGACY_INVENTORY_GROUPS[group].some((table) => ALWAYS_PROTECTED.includes(table))) {
      throw new Error('protected_table_selected');
    }
  }
  if (DELETE_CANDIDATE_GROUPS.some((name) => ['manual_review_required', 'protected_personal'].includes(name))) {
    throw new Error('unsafe_candidate_group');
  }
}

export function inventoryCountSql(group) {
  const tables = LEGACY_INVENTORY_GROUPS[group];
  if (!tables) throw new Error('unknown_inventory_group');
  return 'SELECT ' + tables.map((table) =>
    '(SELECT COUNT(*) FROM ' + table + ') AS ' + table
  ).join(', ');
}

export async function inventoryLegacyData(query) {
  assertLegacyInventoryCatalog();
  if (typeof query !== 'function') throw new Error('read_only_query_required');
  const counts = {};
  for (const [group, tables] of Object.entries(LEGACY_INVENTORY_GROUPS)) {
    const rows = await query(inventoryCountSql(group));
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
      throw new Error('invalid_inventory_result_' + group);
    }
    const values = {};
    for (const table of tables) {
      if (!Object.prototype.hasOwnProperty.call(rows[0], table)) {
        throw new Error('missing_inventory_count_' + table);
      }
      values[table] = checkedCount(rows[0][table], table);
    }
    counts[group] = values;
  }
  return {
    mode: 'read_only_legacy_data_inventory',
    scope: 'aggregate_D1_counts_only',
    counts,
    preservedSystemsNotClassifiedForDeletion: true,
    r2PayloadsNotInspected: true,
    deletionAuthorized: false
  };
}

async function main() {
  const client = createCloudflareReadonlyQuery(process.env);
  const report = await inventoryLegacyData(client.query);
  const cost = client.getCost();
  // Only table names and aggregate counts. Never print full private API responses.
  console.log(JSON.stringify({ ...report, cost }));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = Object.entries(report.counts).flatMap(([group, values]) =>
      Object.entries(values).map(([table, count]) => '| ' + group + ' | ' + table + ' | ' + count + ' |')
    );
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Legacy AI/editorial data inventory (read-only)\n\n'
      + 'No database rows or R2 objects were deleted. Counts do not authorize deletion. '
      + 'User-saved systems and official facts remain protected.\n\n'
      + '| Category | D1 table | Rows |\n|---|---|---:|\n'
      + rows.join('\n')
      + '\n\nD1 rows read: ' + cost.rowsRead + '; D1 rows written: ' + cost.rowsWritten
      + '; requests: ' + cost.requests + '.\n\n'
      + 'Before any separately reviewed deletion: inspect FK relationships and shared '
      + 'source records, take a verified private Cloudflare backup and preserve user-created systems.\n');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    // The existing read-only client uses sanitized errors; do not expose response bodies.
    console.error('legacy_inventory_stopped: ' + String(error?.message || 'unknown_error'));
    process.exitCode = 1;
  });
}
