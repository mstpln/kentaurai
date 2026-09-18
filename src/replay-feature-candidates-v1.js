import { getRacePropositionsAsOf, RACE_PROPOSITION_PARSER_VERSION } from './race-proposition-v1.js';
import { XLABS_POSITION_RECONSTRUCTION_VERSION } from './xlabs-position-reconstruction-v1.js';

export const REPLAY_START_POINTS_DYNAMICS_VERSION = 'replay-start-points-dynamics-v1';
export const REPLAY_RACE_TERMS_VERSION = 'replay-race-terms-v1';
export const REPLAY_POSITION_EVIDENCE_VERSION = 'replay-position-evidence-v1';

const CHUNK_SIZE = 70;
const DAY_MS = 86_400_000;

function chunks(values, size = CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function exactIso(value, field = 'asOf') {
  const text = String(value ?? '').trim();
  const ms = Date.parse(text);
  if (!text || !Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return { iso: new Date(ms).toISOString(), ms };
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadTargets(env, raceEntryIds) {
  const ids = [...new Set((raceEntryIds || []).filter(Boolean).map(String))];
  const out = new Map();
  for (const group of chunks(ids)) {
    const { results } = await env.DB.prepare(`
      SELECT re.id AS race_entry_id,re.horse_id,re.race_id
      FROM race_entries re
      WHERE re.id IN (${placeholders(group)})
    `).bind(...group).all();
    for (const row of results || []) out.set(row.race_entry_id, row);
  }
  if (out.size !== ids.length) throw new Error('replay feature target entries were not all found');
  return { ids, targets: out };
}

export async function buildReplayStartPointsDynamicsV1ForEntries(env, raceEntryIds, asOf) {
  if (!env?.DB) throw new Error('DB is not configured');
  const cutoff = exactIso(asOf);
  const { ids, targets } = await loadTargets(env, raceEntryIds);
  if (!ids.length) return new Map();
  const horseIds = [...new Set(ids.map((id) => targets.get(id).horse_id).filter(Boolean))];
  const byHorse = new Map(horseIds.map((id) => [id, []]));

  for (const group of chunks(horseIds)) {
    const { results } = await env.DB.prepare(`
      SELECT id,horse_id,points,observed_at,source_record_id
      FROM horse_start_points
      WHERE horse_id IN (${placeholders(group)})
        AND julianday(observed_at) <= julianday(?)
      ORDER BY horse_id,julianday(observed_at) DESC,id DESC
    `).bind(...group, cutoff.iso).all();
    for (const row of results || []) byHorse.get(row.horse_id)?.push(row);
  }

  const currentByEntry = new Map();
  for (const id of ids) {
    const rows = byHorse.get(targets.get(id).horse_id) || [];
    const current = rows[0] || null;
    const previousDifferent = current ? rows.find((row) => Number(row.points) !== Number(current.points)) || null : null;
    currentByEntry.set(id, { rows, current, previousDifferent });
  }

  const known = ids
    .map((id) => ({ id, points: finiteOrNull(currentByEntry.get(id).current?.points) }))
    .filter((row) => row.points != null);
  const out = new Map();
  for (const id of ids) {
    const { rows, current, previousDifferent } = currentByEntry.get(id);
    const currentPoints = finiteOrNull(current?.points);
    const previousPoints = finiteOrNull(previousDifferent?.points);
    const fieldRank = currentPoints == null ? null : 1 + known.filter((row) => row.points > currentPoints).length;
    const absoluteDelta = currentPoints == null || previousPoints == null ? null : currentPoints - previousPoints;
    const relativeDelta = absoluteDelta == null || previousPoints === 0 ? null : absoluteDelta / previousPoints;
    out.set(id, {
      contract_version: 'kentaurai-replay-feature-v1',
      feature_version: REPLAY_START_POINTS_DYNAMICS_VERSION,
      as_of: cutoff.iso,
      race_entry_id: id,
      horse_id: targets.get(id).horse_id,
      current_points: currentPoints,
      current_observed_at: current?.observed_at || null,
      previous_different_points: previousPoints,
      previous_different_observed_at: previousDifferent?.observed_at || null,
      absolute_delta: absoluteDelta,
      relative_delta: relativeDelta,
      observation_count_as_of: rows.length,
      freshness_days: current ? (cutoff.ms - Date.parse(current.observed_at)) / DAY_MS : null,
      field_known_count: known.length,
      field_rank: fieldRank,
      field_percentile: fieldRank == null ? null : known.length <= 1 ? 1 : 1 - ((fieldRank - 1) / (known.length - 1)),
      source_refs: [current, previousDifferent]
        .filter(Boolean)
        .map((row) => ({ source_record_id: row.source_record_id, observed_at: row.observed_at }))
    });
  }
  return out;
}

export async function buildReplayRaceTermsV1ForEntries(env, raceEntryIds, asOf) {
  if (!env?.DB) throw new Error('DB is not configured');
  const cutoff = exactIso(asOf);
  const { ids, targets } = await loadTargets(env, raceEntryIds);
  if (!ids.length) return new Map();
  const raceIds = [...new Set(ids.map((id) => targets.get(id).race_id).filter(Boolean))];
  const propositions = await getRacePropositionsAsOf(env, raceIds, cutoff.iso);
  const out = new Map();
  for (const id of ids) {
    const raceId = targets.get(id).race_id;
    const proposition = propositions.get(raceId) || null;
    out.set(id, {
      contract_version: 'kentaurai-replay-feature-v1',
      feature_version: REPLAY_RACE_TERMS_VERSION,
      parser_version: RACE_PROPOSITION_PARSER_VERSION,
      as_of: cutoff.iso,
      race_entry_id: id,
      race_id: raceId,
      parse_status: proposition?.parseStatus || 'unavailable',
      facts: proposition?.facts || null,
      unparsed_fragment_count: Array.isArray(proposition?.unparsedFragments) ? proposition.unparsedFragments.length : 0,
      ambiguous_fragment_count: Array.isArray(proposition?.ambiguousFragments) ? proposition.ambiguousFragments.length : 0,
      observed_at: proposition?.observedAt || null,
      source_record_id: proposition?.sourceRecordId || null
    });
  }
  return out;
}

export async function buildReplayPositionEvidenceV1ForEntries(env, raceEntryIds, asOf) {
  if (!env?.DB) throw new Error('DB is not configured');
  const cutoff = exactIso(asOf);
  const { ids, targets } = await loadTargets(env, raceEntryIds);
  if (!ids.length) return new Map();
  const horseIds = [...new Set(ids.map((id) => targets.get(id).horse_id).filter(Boolean))];
  const aggregateByHorse = new Map();

  for (const group of chunks(horseIds)) {
    const { results } = await env.DB.prepare(`
      WITH candidates AS (
        SELECT
          re.horse_id,
          re.id AS historical_entry_id,
          r.id AS historical_race_id,
          COALESCE(r.scheduled_start_at, r.race_date || 'T23:59:59Z') AS event_at,
          s.id AS source_record_id,
          s.fetched_at,
          rts.frame_coverage,
          rts.checkpoint_count,
          rts.ranked_checkpoint_count,
          rts.longitudinal_confidence,
          rts.lateral_confidence,
          rts.reconstruction_status,
          ROW_NUMBER() OVER (
            PARTITION BY re.id
            ORDER BY julianday(s.fetched_at) DESC,s.id DESC
          ) AS source_rank
        FROM race_entries re
        JOIN races r ON r.id=re.race_id
        JOIN race_trajectory_summaries rts
          ON rts.race_entry_id=re.id
         AND rts.reconstruction_version=?
        JOIN source_records s ON s.id=rts.source_record_id
        WHERE re.horse_id IN (${placeholders(group)})
          AND julianday(COALESCE(r.scheduled_start_at, r.race_date || 'T23:59:59Z')) < julianday(?)
          AND julianday(s.fetched_at) <= julianday(?)
      ),
      selected AS (
        SELECT * FROM candidates WHERE source_rank=1
      ),
      checkpoint_per_start AS (
        SELECT
          sel.horse_id,
          sel.historical_entry_id,
          AVG(CASE
            WHEN rpc.position_rank IS NOT NULL AND rpc.active_field_size > 1
            THEN (1.0 * (rpc.position_rank - 1)) / (rpc.active_field_size - 1)
            ELSE NULL
          END) AS mean_relative_rank,
          AVG(CASE WHEN rpc.positions_gained_since_previous IS NOT NULL THEN rpc.positions_gained_since_previous END) AS mean_positions_gained,
          AVG(CASE WHEN rpc.relative_lateral_offset_m IS NOT NULL THEN ABS(rpc.relative_lateral_offset_m) END) AS mean_abs_lateral_offset_m
        FROM selected sel
        LEFT JOIN race_position_checkpoints rpc
          ON rpc.race_entry_id=sel.historical_entry_id
         AND rpc.source_record_id=sel.source_record_id
         AND rpc.reconstruction_version=?
        GROUP BY sel.horse_id,sel.historical_entry_id
      )
      SELECT
        sel.horse_id,
        COUNT(*) AS reconstructed_starts,
        SUM(CASE WHEN sel.reconstruction_status='usable' THEN 1 ELSE 0 END) AS usable_starts,
        SUM(CASE WHEN sel.reconstruction_status='partial' THEN 1 ELSE 0 END) AS partial_starts,
        AVG(sel.frame_coverage) AS mean_frame_coverage,
        AVG(sel.longitudinal_confidence) AS mean_longitudinal_confidence,
        AVG(sel.lateral_confidence) AS mean_lateral_confidence,
        AVG(CASE WHEN sel.checkpoint_count > 0 THEN 1.0 * sel.ranked_checkpoint_count / sel.checkpoint_count END) AS mean_ranked_checkpoint_share,
        AVG(cps.mean_relative_rank) AS mean_relative_rank,
        AVG(cps.mean_positions_gained) AS mean_positions_gained,
        AVG(cps.mean_abs_lateral_offset_m) AS mean_abs_lateral_offset_m,
        MAX(sel.fetched_at) AS latest_source_fetched_at
      FROM selected sel
      LEFT JOIN checkpoint_per_start cps
        ON cps.horse_id=sel.horse_id AND cps.historical_entry_id=sel.historical_entry_id
      GROUP BY sel.horse_id
    `).bind(
      XLABS_POSITION_RECONSTRUCTION_VERSION,
      ...group,
      cutoff.iso,
      cutoff.iso,
      XLABS_POSITION_RECONSTRUCTION_VERSION
    ).all();
    for (const row of results || []) aggregateByHorse.set(row.horse_id, row);
  }

  const out = new Map();
  for (const id of ids) {
    const horseId = targets.get(id).horse_id;
    const row = aggregateByHorse.get(horseId) || null;
    out.set(id, {
      contract_version: 'kentaurai-replay-feature-v1',
      feature_version: REPLAY_POSITION_EVIDENCE_VERSION,
      reconstruction_version: XLABS_POSITION_RECONSTRUCTION_VERSION,
      as_of: cutoff.iso,
      race_entry_id: id,
      horse_id: horseId,
      reconstructed_starts: row ? Number(row.reconstructed_starts) : 0,
      usable_starts: row ? Number(row.usable_starts) : 0,
      partial_starts: row ? Number(row.partial_starts) : 0,
      mean_frame_coverage: finiteOrNull(row?.mean_frame_coverage),
      mean_longitudinal_confidence: finiteOrNull(row?.mean_longitudinal_confidence),
      mean_lateral_confidence: finiteOrNull(row?.mean_lateral_confidence),
      mean_ranked_checkpoint_share: finiteOrNull(row?.mean_ranked_checkpoint_share),
      mean_relative_rank: finiteOrNull(row?.mean_relative_rank),
      mean_positions_gained: finiteOrNull(row?.mean_positions_gained),
      mean_abs_lateral_offset_m: finiteOrNull(row?.mean_abs_lateral_offset_m),
      latest_source_fetched_at: row?.latest_source_fetched_at || null,
      named_trip_labels_enabled: false,
      missing_is_neutral: true
    });
  }
  return out;
}
