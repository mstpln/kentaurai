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
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) { if (args.length > D1_MAX_BOUND_PARAMETERS) throw new Error(`D1_ERROR: too many SQL variables (${args.length} > ${D1_MAX_BOUND_PARAMETERS})`); this.args = args; return this; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: result.lastInsertRowid == null ? null : Number(result.lastInsertRowid) } };
  }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
}

class D1Adapter {
  constructor(db) { this.db = db; }
  prepare(sql) { const terms = maxCompoundSelectTerms(sql); if (terms > D1_MAX_COMPOUND_SELECT_TERMS) throw new Error(`D1_ERROR: too many terms in compound SELECT (${terms} > ${D1_MAX_COMPOUND_SELECT_TERMS})`); return new StatementAdapter(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
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
    '../../migrations/0035_race_scope_evidence.sql'
  ]) {
    db.exec(readFileSync(new URL(migration, import.meta.url), 'utf8'));
  }

  const objects = new Map();
  return {
    db,
    env: {
      DB: new D1Adapter(db),
      V85_LINE_PRICE_SEK: '0.50',
      V86_LINE_PRICE_SEK: '0.25',
      RAW_BUCKET: {
        async put(key, body, options) { objects.set(key, { body, options }); },
        async get(key) {
          const stored = objects.get(key);
          if (!stored) return null;
          return { async text() { return stored.body; } };
        }
      }
    },
    objects
  };
}