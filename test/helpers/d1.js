import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const D1_MAX_BOUND_PARAMETERS = 100;
const D1_MAX_COMPOUND_SELECT_TERMS = 5;

function stripSqlLiteralsAndComments(sql) {
  return String(sql)
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function maxCompoundSelectTerms(sql) {
  const cleaned = stripSqlLiteralsAndComments(sql);
  const frames = [0];
  let maxTerms = 1;
  for (const match of cleaned.matchAll(/\(|\)|\b(?:UNION|INTERSECT|EXCEPT)\b/gi)) {
    const token = match[0].toUpperCase();
    if (token === '(') {
      frames.push(0);
    } else if (token === ')') {
      const operators = frames.length > 1 ? frames.pop() : frames[0];
      maxTerms = Math.max(maxTerms, operators + 1);
    } else {
      frames[frames.length - 1] += 1;
      maxTerms = Math.max(maxTerms, frames[frames.length - 1] + 1);
    }
  }
  return maxTerms;
}

class StatementAdapter {
  constructor(db, sql, metrics) {
    this.db = db;
    this.sql = sql;
    this.metrics = metrics;
    this.args = [];
  }
  markExecution(kind) {
    if (!this.metrics) return;
    this.metrics.statements += 1;
    this.metrics[kind] = (this.metrics[kind] || 0) + 1;
  }
  bind(...args) { if (args.length > D1_MAX_BOUND_PARAMETERS) throw new Error(`D1_ERROR: too many SQL variables (${args.length} > ${D1_MAX_BOUND_PARAMETERS})`); this.args = args; return this; }
  async run() {
    this.markExecution('runs');
    const result = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid) } };
  }
  async first() { this.markExecution('firsts'); return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() {
    this.markExecution('alls');
    const results = this.db.prepare(this.sql).all(...this.args);
    return { results, meta: { rows_read: results.length, rows_written: 0, duration: 0 } };
  }
}

class D1Adapter {
  constructor(db, metrics, faults) { this.db = db; this.metrics = metrics; this.faults = faults; }
  prepare(sql) { const terms = maxCompoundSelectTerms(sql); if (terms > D1_MAX_COMPOUND_SELECT_TERMS) throw new Error(`D1_ERROR: too many terms in compound SELECT (${terms} > ${D1_MAX_COMPOUND_SELECT_TERMS})`); return new StatementAdapter(this.db, sql, this.metrics); }
  async batch(statements) {
    if (this.metrics) this.metrics.batches += 1;
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (let index = 0; index < statements.length; index += 1) {
        if (this.faults?.batchBeforeStatement === index) {
          this.faults.batchBeforeStatement = null;
          throw new Error(`injected D1 batch failure before statement ${index}`);
        }
        results.push(await statements[index].run());
        if (this.faults?.batchAfterStatement === index) {
          this.faults.batchAfterStatement = null;
          throw new Error(`injected D1 batch failure after statement ${index}`);
        }
      }
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createTestEnv() {
  const db = new DatabaseSync(':memory:');
  for (const migration of [
    '../../migrations/0001_core.sql',
    '../../migrations/0002_reference_round.sql',
    '../../migrations/0003_nullable_reference_prediction.sql',
    '../../migrations/0004_official_live_observations.sql',
    '../../migrations/0005_historical_backfill.sql',
    '../../migrations/0006_xlabs_backfill.sql',
    '../../migrations/0007_official_first_prize.sql',
    '../../migrations/0008_track_contact_metadata.sql',
    '../../migrations/0009_track_contact_provenance.sql',
    '../../migrations/0010_horse_start_points.sql',
    '../../migrations/0011_driver_statistics_indexes.sql',
    '../../migrations/0012_trainer_statistics_indexes.sql',
    '../../migrations/0013_combined_analysis_systems.sql',
    '../../migrations/0014_official_participant_identity.sql',
    '../../migrations/0015_official_snapshot_promotion.sql',
    '../../migrations/0016_race_proposition_facts.sql',
    '../../migrations/0017_xlabs_intervals_v2.sql',
    '../../migrations/0018_xlabs_position_reconstruction_v1.sql',
    '../../migrations/0019_analysis_step1_locks.sql',
    '../../migrations/0020_analysis_step1_lock_revisions.sql',
    '../../migrations/0021_analysis_decision_probability_v1.sql',
    '../../migrations/0022_analysis_optimizer_v1.sql',
    '../../migrations/0023_analysis_step2_integration_v1.sql',
    '../../migrations/0024_replay_calibration_v1.sql',
    '../../migrations/0025_post_race_learning_f2.sql',
    '../../migrations/0026_app_read_performance.sql',
    '../../migrations/0027_external_analysis_lineage_v1.sql',
    '../../migrations/0028_external_evidence_v1.sql',
    '../../migrations/0029_xlabs_interval_backfill.sql',
    '../../migrations/0030_interview_change_marker.sql',
    '../../migrations/0031_post_race_settlement.sql',
    '../../migrations/0032_track_physical_profile_v1.sql',
    '../../migrations/0033_xlabs_trip_classification_v1.sql',
    '../../migrations/0034_settings_alert_acknowledgements.sql',
    '../../migrations/0035_race_scope_evidence.sql',
    '../../migrations/0037_xlabs_position_reconstruction_quarantine.sql',
    '../../migrations/0038_track_analysis_v1.sql',
    '../../migrations/0039_game_statistics_v1.sql',
    '../../migrations/0040_statistics_data_backfill_v1.sql',
    '../../migrations/0041_statistics_data_backfill_state_v2.sql',
    '../../migrations/0042_cost_storage_safety_v1.sql',
    '../../migrations/0043_storage_cleanup_executor_v1.sql',
    '../../migrations/0044_storage_cleanup_resume_state.sql',
    '../../migrations/0045_storage_cleanup_sessions.sql',
    '../../migrations/0046_snapshot_observation_lookup_index.sql',
    '../../migrations/0047_storage_cleanup_session_audits.sql',
    '../../migrations/0048_live_pending_cost_indexes.sql',
    '../../migrations/0049_runtime_controls.sql',
    '../../migrations/0050_cost_efficiency_v2.sql',
    '../../migrations/0051_storage_cleanup_audit_indexes.sql',
    '../../migrations/0052_storage_cleanup_horse_profile_source_index.sql',
    '../../migrations/0053_storage_cleanup_horse_stat_source_index.sql',
    '../../migrations/0054_storage_cleanup_horse_record_source_index.sql',
    '../../migrations/0055_storage_cleanup_person_stat_source_index.sql',
    '../../migrations/0056_storage_cleanup_sync_status_source_index.sql',
    '../../migrations/0057_storage_cleanup_resumable_audits.sql',
    '../../migrations/0058_cleanup_horse_profile_order.sql',
    '../../migrations/0059_cleanup_horse_stat_order.sql',
    '../../migrations/0060_cleanup_horse_record_order.sql',
    '../../migrations/0061_cleanup_person_stat_order.sql',
    '../../migrations/0062_cleanup_horse_profile_source_page.sql',
    '../../migrations/0063_cleanup_horse_stat_source_page.sql',
    '../../migrations/0064_cleanup_horse_record_source_page.sql',
    '../../migrations/0065_cleanup_person_stat_source_page.sql',
    '../../migrations/0066_cleanup_observation_source_page.sql',
    '../../migrations/0067_cleanup_audit_atomic_fencing.sql'
  ]) {
    db.exec(readFileSync(new URL(migration, import.meta.url), 'utf8'));
  }

  const objects = new Map();
  const d1Metrics = { statements: 0, runs: 0, firsts: 0, alls: 0, batches: 0 };
  const d1Faults = { batchBeforeStatement: null, batchAfterStatement: null };
  return {
    db,
    d1Metrics,
    d1Faults,
    env: {
      DB: new D1Adapter(db, d1Metrics, d1Faults),
      ADMIN_TOKEN: 'synthetic-test-admin-token',
      V85_LINE_PRICE_SEK: '0.50',
      V86_LINE_PRICE_SEK: '0.25',
      RAW_BUCKET: {
        async put(key, body, options = {}) {
          objects.set(key, { body, options });
        },
        async head(key) {
          const stored = objects.get(key);
          const bytes = stored && (typeof stored.body === 'string' ? new TextEncoder().encode(stored.body) : stored.body);
          return stored ? { key, size: bytes.byteLength, customMetadata: stored.options.customMetadata, httpMetadata: stored.options.httpMetadata } : null;
        },
        async get(key) {
          const stored = objects.get(key);
          if (!stored) return null;
          const bytes = typeof stored.body === 'string' ? new TextEncoder().encode(stored.body) : stored.body;
          return {
            async text() { return typeof stored.body === 'string' ? stored.body : new TextDecoder().decode(bytes); },
            async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
          };
        },
        async delete(key) { objects.delete(key); }
      }
    },
    objects
  };
}
