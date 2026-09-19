import {
  ANALYSIS_V3_FOUNDATION_CONTRACTS,
  stableFeatureJson
} from './analysis-v3-foundations.js';
import {
  PERFORMANCE_FEATURE_CONTRACT_VERSION,
  PERFORMANCE_FEATURE_VERSIONS,
  buildPerformanceFeaturesV3ForEntries
} from './performance-features-v3.js';
import {
  EQUIPMENT_RESPONSE_CONTRACT_VERSION,
  EQUIPMENT_RESPONSE_FEATURE_VERSION,
  EQUIPMENT_STATE_VERSION,
  EQUIPMENT_CHANGE_VERSION,
  buildEquipmentResponseV1ForEntries
} from './equipment-response-v1.js';
import {
  PERSON_CONTEXT_CONTRACT_VERSION,
  PERSON_CONTEXT_FEATURE_VERSION,
  buildPersonContextV1ForEntries
} from './person-context-v1.js';
import {
  RACE_PRIOR_CONTRACT_VERSION,
  RACE_PRIOR_FEATURE_VERSION,
  buildRacePriorsV1ForEntries
} from './race-priors-v1.js';
import {
  RELEVANT_HISTORY_CONTRACT_VERSION,
  RELEVANT_HISTORY_SELECTION_VERSION,
  buildRelevantHistoryForEntries
} from './relevant-history-v1.js';
import { RACE_PROPOSITION_PARSER_VERSION } from './race-proposition-v1.js';
import {
  XLABS_EVIDENCE_PROFILE_CONTRACT,
  XLABS_EVIDENCE_PROFILE_VERSION,
  buildXlabsEvidenceProfilesForRace
} from './xlabs-evidence-profiles-v1.js';
import { XLABS_POSITION_RECONSTRUCTION_VERSION } from './xlabs-position-reconstruction-v1.js';
import { getOfficialHorseSnapshotsAsOf } from './import/official-snapshots.js';

export const ANALYSIS_PACK_V3_CONTRACT = 'kentaurai-analysis-pack-v3';
export const ANALYSIS_PACK_V3_VERSION = 'analysis-pack-v3-d1';
export const ANALYSIS_PACK_V3_MAX_FILE_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPE = 'application/json; charset=utf-8';
const SQL_CHUNK_SIZE = 48; // D1 allows at most 100 bound parameters; some Step 1 queries bind two ID lists plus fixed cutoffs.
const EDITORIAL_MARKET_RE = /(?:market|odds|bet|streck|rank|ranking|tip|spik|spike|pick|value|värde|probab|system|selection|recommend)/i;
const MARKET_KEY_PATTERNS = Object.freeze([
  /^(?:bet_percent|bet_percentage|bet_distribution|betting|betting_percent|betting_percentage|betting_snapshot|betting_snapshots)$/,
  /^(?:market_percent|market_percentage|market_rank|market_share|market_ownership|estimated_market_ownership|ownership_percentage)$/,
  /^(?:streck|streck_percent|streck_percentage)$/,
  /^(?:odds|official_odds|winner_odds|place_odds)$/,
  /(?:^|_)odds$/,
  /^(?:turnover|turnover_sek|jackpot|jackpot_sek)$/,
  /^(?:value_ratio|value_metric)$/,
  /^(?:external_rank|external_ranking|tip|tips|tip_rank|tip_ranking|pick|picks|spike|recommendation|recommendations|recommended|selection_reason)$/
]);

function chunks(values, size = SQL_CHUNK_SIZE) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function placeholders(values) { return values.map(() => '?').join(','); }

function requiredText(value, field, max = 240) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error(`${field} is required and must be at most ${max} characters`);
  return text;
}

function instant(value, field) {
  const text = String(value ?? '').trim();
  const ms = Date.parse(text);
  if (!text || !Number.isFinite(ms)) throw new Error(`${field} must be a valid timestamp`);
  return { ms, iso: new Date(ms).toISOString() };
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return null;
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function byteLength(text) { return new TextEncoder().encode(text).byteLength; }

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function hashValue(value) { return sha256Text(stableFeatureJson(value)); }

function ratio(numerator, denominator) { return denominator > 0 ? numerator / denominator : null; }

function maxIso(values) {
  const safe = values.filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  if (!safe.length) return null;
  return new Date(Math.max(...safe.map((value) => Date.parse(value)))).toISOString();
}

function normalizeMarketKey(key) {
  return String(key).trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[-\s]+/g, '_').toLowerCase();
}

export function findAnalysisPackMarketLeaks(value, path = '$', out = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findAnalysisPackMarketLeaks(item, `${path}[${index}]`, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizeMarketKey(key);
    if (MARKET_KEY_PATTERNS.some((pattern) => pattern.test(normalized))) out.push(`${path}.${key}`);
    findAnalysisPackMarketLeaks(nested, `${path}.${key}`, out);
  }
  return out;
}

export function assertAnalysisPackMarketBlind(value) {
  const leaks = findAnalysisPackMarketLeaks(value);
  if (leaks.length) throw new Error(`analysis pack contains denied current-market fields: ${leaks.slice(0, 10).join(', ')}`);
  return true;
}

function validateEightLegs(legs) {
  if (!Array.isArray(legs) || legs.length !== 8) throw new Error('analysis pack must contain exactly eight legs');
  const numbers = legs.map((leg) => Number(leg?.leg_number ?? leg?.legNumber)).sort((a, b) => a - b);
  if (numbers.some((number, index) => number !== index + 1)) throw new Error('analysis pack legs must be numbered 1 through 8 exactly once');
  const activeSeen = new Set();
  for (const leg of legs) {
    for (const entry of leg.entries || []) {
      if (entry?.current_facts?.analysis_eligible !== true) continue;
      const id = requiredText(entry.race_entry_id ?? entry.raceEntryId, 'race_entry_id');
      if (activeSeen.has(id)) throw new Error(`active race entry appears more than once in analysis pack: ${id}`);
      activeSeen.add(id);
    }
  }
}

function contentFile(name, payload) {
  const content = stableFeatureJson(payload);
  return { name, payload, content, bytes: byteLength(content) };
}

function splitLegPayload(leg, maxFileBytes) {
  const legNumber = Number(leg.leg_number ?? leg.legNumber);
  const whole = contentFile(`${String(legNumber).padStart(2, '0')}_leg_${legNumber}.json`, leg);
  if (whole.bytes <= maxFileBytes) return [whole];
  const entries = Array.isArray(leg.entries) ? leg.entries : [];
  const base = { ...leg, entries: undefined };
  delete base.entries;
  const parts = [];
  let current = [];
  for (const entry of entries) {
    const candidate = {
      ...base,
      split: { reason: 'max_file_bytes', part_index: parts.length + 1 },
      entries: [...current, entry]
    };
    const size = byteLength(stableFeatureJson(candidate));
    if (size <= maxFileBytes) {
      current.push(entry);
      continue;
    }
    if (!current.length) throw new Error(`one leg ${legNumber} entry exceeds maxFileBytes; refusing to truncate`);
    parts.push(current);
    current = [entry];
    const singleton = { ...base, split: { reason: 'max_file_bytes', part_index: parts.length + 1 }, entries: current };
    if (byteLength(stableFeatureJson(singleton)) > maxFileBytes) throw new Error(`one leg ${legNumber} entry exceeds maxFileBytes; refusing to truncate`);
  }
  if (current.length) parts.push(current);
  return parts.map((partEntries, index) => contentFile(
    `${String(legNumber).padStart(2, '0')}_leg_${legNumber}_part_${String(index + 1).padStart(3, '0')}.json`,
    { ...base, split: { reason: 'max_file_bytes', part_index: index + 1, part_count: parts.length }, entries: partEntries }
  ));
}

export async function buildAnalysisPackV3Files({
  round,
  legs,
  asOf,
  generatedAt = new Date().toISOString(),
  cutoffSource,
  warnings = [],
  sourceFamilyCoverage = {},
  sourceFreshness = {},
  featureVersions = {},
  parserVersions = {},
  reconstructionVersions = {},
  evidenceContractVersion = ANALYSIS_V3_FOUNDATION_CONTRACTS.evidenceEnvelope
} = {}, { maxFileBytes = ANALYSIS_PACK_V3_MAX_FILE_BYTES } = {}) {
  const effectiveAsOf = instant(asOf, 'asOf').iso;
  const generated = instant(generatedAt, 'generatedAt').iso;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1024) throw new Error('maxFileBytes must be an integer of at least 1024');
  validateEightLegs(legs);

  const roundPayload = {
    contract_version: ANALYSIS_PACK_V3_CONTRACT,
    pack_version: ANALYSIS_PACK_V3_VERSION,
    as_of: effectiveAsOf,
    contains_current_market: false,
    round,
    pre_market_cutoff: { source: cutoffSource || null },
    legs: legs.map((leg) => ({
      leg_number: Number(leg.leg_number ?? leg.legNumber),
      race_id: leg.race?.race_id ?? leg.race?.raceId ?? null,
      track: leg.race?.track ?? null,
      active_entries: (leg.entries || []).filter((entry) => entry?.current_facts?.analysis_eligible === true).length,
      total_entries: (leg.entries || []).length
    })),
    source_family_coverage: sourceFamilyCoverage,
    source_freshness: sourceFreshness,
    warnings: [...warnings]
  };

  const normalizedLegs = legs.map((leg) => ({
    contract_version: ANALYSIS_PACK_V3_CONTRACT,
    pack_version: ANALYSIS_PACK_V3_VERSION,
    as_of: effectiveAsOf,
    contains_current_market: false,
    ...leg
  }));
  assertAnalysisPackMarketBlind(roundPayload);
  normalizedLegs.forEach(assertAnalysisPackMarketBlind);

  const factsFingerprint = await hashValue({ round: roundPayload, legs: normalizedLegs });
  const packId = `pack_${(await sha256Text(`${requiredText(round?.round_id ?? round?.roundId, 'round_id')}|${effectiveAsOf}|${factsFingerprint}`)).slice(7, 31)}`;
  const files = [contentFile('00_round_pre_market.json', roundPayload)];
  if (files[0].bytes > maxFileBytes) throw new Error('round pre-market file exceeds maxFileBytes; refusing to truncate');
  for (const leg of normalizedLegs) files.push(...splitLegPayload(leg, maxFileBytes));

  const fileMetadata = [];
  for (const file of files) fileMetadata.push({ name: file.name, bytes: file.bytes, sha256: await sha256Text(file.content) });
  const manifest = {
    contract_version: ANALYSIS_PACK_V3_CONTRACT,
    pack_version: ANALYSIS_PACK_V3_VERSION,
    pack_id: packId,
    round_id: round.round_id ?? round.roundId,
    generated_at: generated,
    as_of: effectiveAsOf,
    facts_fingerprint: factsFingerprint,
    manifest_file: 'manifest.json',
    expected_files: fileMetadata,
    feature_versions: featureVersions,
    parser_versions: parserVersions,
    reconstruction_versions: reconstructionVersions,
    evidence_contract_version: evidenceContractVersion,
    contains_current_market: false,
    warnings: [...warnings],
    source_family_coverage: sourceFamilyCoverage,
    source_freshness: sourceFreshness
  };
  const manifestContent = stableFeatureJson(manifest);
  return {
    contractVersion: ANALYSIS_PACK_V3_CONTRACT,
    packId,
    factsFingerprint,
    manifest,
    manifestContent,
    files,
    fileMetadata
  };
}

async function loadRoundIdentity(env, roundId) {
  const id = requiredText(roundId, 'round_id');
  const round = await env.DB.prepare(`
    SELECT gr.id,gr.game_type,gr.round_date,gr.scheduled_start_at,gr.bet_stop_at,
      (SELECT MIN(r.scheduled_start_at) FROM game_legs gl JOIN races r ON r.id=gl.race_id WHERE gl.game_round_id=gr.id) AS first_leg_start
    FROM game_rounds gr
    WHERE gr.id=? AND gr.game_type IN ('V85','V86')
    LIMIT 1
  `).bind(id).first();
  if (!round) throw new Error('V85/V86 round was not found');
  const { results: rows } = await env.DB.prepare(`
    SELECT gl.leg_number,r.id AS race_id,r.track_id,re.id AS race_entry_id,re.horse_id,re.driver_id,re.trainer_id
    FROM game_legs gl
    JOIN races r ON r.id=gl.race_id
    JOIN race_entries re ON re.race_id=r.id
    WHERE gl.game_round_id=?
    ORDER BY gl.leg_number,re.start_number,re.id
  `).bind(id).all();
  const legNumbers = [...new Set(rows.map((row) => Number(row.leg_number)))];
  if (legNumbers.length !== 8 || legNumbers.some((number, index) => number !== index + 1)) throw new Error('round must contain exactly eight ordered legs');
  if (!rows.length) throw new Error('round has no race entries');
  return { round, rows };
}

function resolveCutoff(round, requestedAsOf) {
  const requested = instant(requestedAsOf ?? new Date().toISOString(), 'asOf');
  const candidates = [
    ['bet_stop_at', round.bet_stop_at],
    ['round_scheduled_start', round.scheduled_start_at],
    ['first_leg_start', round.first_leg_start]
  ];
  const selected = candidates.find(([, value]) => value && Number.isFinite(Date.parse(value)));
  if (!selected) throw new Error('round has no verified pre-market cutoff');
  const cutoff = instant(selected[1], selected[0]);
  return {
    requestedAsOf: requested.iso,
    effectiveAsOf: new Date(Math.min(requested.ms, cutoff.ms)).toISOString(),
    cutoffAt: cutoff.iso,
    cutoffSource: selected[0],
    clamped: requested.ms > cutoff.ms
  };
}

async function loadLatestObservations(env, entityType, entityIds, asOf) {
  const ids = [...new Set(entityIds.filter(Boolean).map(String))];
  const out = new Map();
  for (const group of chunks(ids)) {
    const { results } = await env.DB.prepare(`
      WITH ranked AS (
        SELECT o.*,ROW_NUMBER() OVER (PARTITION BY o.entity_id ORDER BY julianday(o.observed_at) DESC,o.id DESC) AS rn
        FROM normalized_observations o
        JOIN source_records sr ON sr.id=o.source_record_id
        WHERE o.entity_type=? AND o.entity_id IN (${placeholders(group)})
          AND sr.source_type='official_provider'
          AND julianday(o.observed_at)<=julianday(?)
          AND julianday(sr.fetched_at)<=julianday(?)
      )
      SELECT * FROM ranked WHERE rn=1
    `).bind(entityType, ...group, asOf, asOf).all();
    for (const row of results) out.set(String(row.entity_id), {
      fields: parseJson(row.fields_json, {}),
      observedAt: row.observed_at,
      sourceRecordId: row.source_record_id,
      qualityStatus: row.quality_status
    });
  }
  return out;
}

async function loadFirstPrizeAsOf(env, raceIds, asOf) {
  const out = new Map();
  for (const group of chunks(raceIds)) {
    const { results } = await env.DB.prepare(`
      WITH ranked AS (
        SELECT c.*,sr.fetched_at,ROW_NUMBER() OVER (PARTITION BY c.race_id ORDER BY julianday(c.observed_at) DESC,c.observation_id DESC) AS rn
        FROM official_race_first_prize_candidates c
        JOIN normalized_observations o ON o.id=c.observation_id
        JOIN source_records sr ON sr.id=o.source_record_id
        WHERE c.race_id IN (${placeholders(group)})
          AND julianday(c.observed_at)<=julianday(?)
          AND julianday(sr.fetched_at)<=julianday(?)
      ) SELECT * FROM ranked WHERE rn=1
    `).bind(...group, asOf, asOf).all();
    for (const row of results) out.set(row.race_id, {
      firstPrizeSek: finiteOrNull(row.first_prize_sek), observedAt: row.observed_at, fetchedAt: row.fetched_at, observationId: row.observation_id
    });
  }
  return out;
}

async function loadPropositionsAsOf(env, raceIds, asOf) {
  const out = new Map();
  for (const group of chunks(raceIds)) {
    const { results } = await env.DB.prepare(`
      WITH ranked AS (
        SELECT p.*,sr.fetched_at,ROW_NUMBER() OVER (PARTITION BY p.race_id ORDER BY julianday(p.observed_at) DESC,p.id DESC) AS rn
        FROM race_proposition_facts p
        JOIN source_records sr ON sr.id=p.source_record_id
        WHERE p.race_id IN (${placeholders(group)})
          AND p.parser_version=?
          AND julianday(p.observed_at)<=julianday(?)
          AND julianday(sr.fetched_at)<=julianday(?)
      ) SELECT * FROM ranked WHERE rn=1
    `).bind(...group, RACE_PROPOSITION_PARSER_VERSION, asOf, asOf).all();
    for (const row of results) out.set(row.race_id, {
      parser_version: row.parser_version,
      parse_status: row.parse_status,
      facts: parseJson(row.facts_json, {}),
      unparsed_fragments: parseJson(row.unparsed_fragments_json, []),
      ambiguous_fragments: parseJson(row.ambiguous_fragments_json, []),
      observed_at: row.observed_at,
      source_fetched_at: row.fetched_at,
      source_record_id: row.source_record_id
    });
  }
  return out;
}

function editorialAllowed(row) {
  const combined = `${row.signal_type || ''} ${row.value_text || ''}`;
  if (EDITORIAL_MARKET_RE.test(combined)) return false;
  if (String(row.fact_or_opinion || '').toLowerCase() === 'fact') return true;
  const role = String(row.speaker_role || '').trim().toLowerCase();
  return role === 'trainer' || role === 'driver';
}

async function loadEditorialSignalsAsOf(env, rows, asOf) {
  const entryIds = [...new Set(rows.map((row) => row.race_entry_id))];
  const horseIds = [...new Set(rows.map((row) => row.horse_id).filter(Boolean))];
  const out = new Map(entryIds.map((id) => [id, []]));
  if (!entryIds.length) return out;
  const entryToHorse = new Map(rows.map((row) => [row.race_entry_id, row.horse_id]));
  const all = [];
  for (const entryGroup of chunks(entryIds)) {
    const horseGroup = [...new Set(entryGroup.map((entryId) => entryToHorse.get(entryId)).filter(Boolean))];
    const horseClause = horseGroup.length ? ` OR ei.horse_id IN (${placeholders(horseGroup)})` : '';
    const { results } = await env.DB.prepare(`
      SELECT ei.race_entry_id,ei.horse_id,ei.published_at,ei.rights_status,ei.speaker_role,es.signal_type,es.value_text,
             es.polarity,es.strength,es.fact_or_opinion,es.confidence,sr.fetched_at
      FROM editorial_signals es
      JOIN editorial_items ei ON ei.id=es.editorial_item_id
      JOIN source_records sr ON sr.id=ei.source_record_id
      WHERE (ei.race_entry_id IN (${placeholders(entryGroup)})${horseClause})
        AND julianday(COALESCE(ei.published_at,sr.fetched_at))<=julianday(?)
        AND julianday(sr.fetched_at)<=julianday(?)
      ORDER BY sr.fetched_at,COALESCE(ei.published_at,sr.fetched_at),es.id
    `).bind(...entryGroup, ...horseGroup, asOf, asOf).all();
    all.push(...results);
  }
  for (const row of all.filter(editorialAllowed)) {
    for (const entryId of entryIds) {
      if (row.race_entry_id !== entryId && row.horse_id !== entryToHorse.get(entryId)) continue;
      out.get(entryId).push({
        source_class: 'editorial',
        published_at: row.published_at || null,
        available_at: row.fetched_at || null,
        signal_type: row.signal_type,
        value: row.value_text || null,
        polarity: row.polarity || null,
        strength: finiteOrNull(row.strength),
        fact_or_opinion: row.fact_or_opinion,
        confidence: finiteOrNull(row.confidence),
        rights_status: row.rights_status || null
      });
    }
  }
  return out;
}

async function loadTrajectories(env, entryIds, asOf) {
  const ids = [...new Set(entryIds.filter(Boolean).map(String))];
  const out = new Map(ids.map((id) => [id, null]));
  if (!ids.length) return out;
  const selected = [];
  for (const group of chunks(ids)) {
    const { results } = await env.DB.prepare(`
      WITH ranked AS (
        SELECT s.*,sr.fetched_at,
          ROW_NUMBER() OVER (PARTITION BY s.race_entry_id ORDER BY julianday(sr.fetched_at) DESC,s.source_record_id DESC) AS rn
        FROM race_trajectory_summaries s
        JOIN source_records sr ON sr.id=s.source_record_id
        WHERE s.race_entry_id IN (${placeholders(group)}) AND s.reconstruction_version=?
          AND julianday(sr.fetched_at)<=julianday(?)
      ) SELECT * FROM ranked WHERE rn=1
    `).bind(...group, XLABS_POSITION_RECONSTRUCTION_VERSION, asOf).all();
    selected.push(...results);
  }
  const sourceIds = [...new Set(selected.map((row) => row.source_record_id))];
  const checkpoints = [];
  const episodes = [];
  for (const group of chunks(sourceIds)) {
    const cp = await env.DB.prepare(`
      SELECT * FROM race_position_checkpoints
      WHERE source_record_id IN (${placeholders(group)}) AND reconstruction_version=?
      ORDER BY race_entry_id,frame_index,checkpoint_key
    `).bind(...group, XLABS_POSITION_RECONSTRUCTION_VERSION).all();
    checkpoints.push(...cp.results);
    const ep = await env.DB.prepare(`
      SELECT * FROM race_trajectory_episodes
      WHERE source_record_id IN (${placeholders(group)}) AND reconstruction_version=?
      ORDER BY race_entry_id,start_frame_index,episode_type,id
    `).bind(...group, XLABS_POSITION_RECONSTRUCTION_VERSION).all();
    episodes.push(...ep.results);
  }
  for (const summary of selected) {
    const entryId = summary.race_entry_id;
    const sourceId = summary.source_record_id;
    out.set(entryId, {
      source_record_id: sourceId,
      source_selected_at: summary.fetched_at,
      reconstruction_version: summary.reconstruction_version,
      summary: {
        total_frame_count: Number(summary.total_frame_count),
        observed_frame_count: Number(summary.observed_frame_count),
        frame_coverage: Number(summary.frame_coverage),
        checkpoint_count: Number(summary.checkpoint_count),
        ranked_checkpoint_count: Number(summary.ranked_checkpoint_count),
        lateral_checkpoint_count: Number(summary.lateral_checkpoint_count),
        episode_count: Number(summary.episode_count),
        longitudinal_confidence: Number(summary.longitudinal_confidence),
        lateral_confidence: finiteOrNull(summary.lateral_confidence),
        reconstruction_status: summary.reconstruction_status
      },
      checkpoints: checkpoints.filter((row) => row.race_entry_id === entryId && row.source_record_id === sourceId).map((row) => ({
        checkpoint_key: row.checkpoint_key,
        checkpoint_m: finiteOrNull(row.checkpoint_m),
        observed_at: row.observed_at,
        leader_progress_m: Number(row.leader_progress_m),
        distance_to_finish_m: Number(row.distance_to_finish_m),
        position_rank: row.position_rank == null ? null : Number(row.position_rank),
        meters_behind_leader: finiteOrNull(row.meters_behind_leader),
        relative_lateral_offset_m: finiteOrNull(row.relative_lateral_offset_m),
        positions_gained_since_previous: row.positions_gained_since_previous == null ? null : Number(row.positions_gained_since_previous),
        gap_gain_m_since_previous: finiteOrNull(row.gap_gain_m_since_previous),
        field_coverage: Number(row.field_coverage),
        local_target_coverage: Number(row.local_target_coverage),
        longitudinal_confidence: Number(row.longitudinal_confidence),
        lateral_confidence: finiteOrNull(row.lateral_confidence)
      })),
      episodes: episodes.filter((row) => row.race_entry_id === entryId && row.source_record_id === sourceId).map((row) => ({
        episode_type: row.episode_type,
        start_checkpoint_key: row.start_checkpoint_key,
        end_checkpoint_key: row.end_checkpoint_key,
        duration_ms: Number(row.duration_ms),
        progress_span_m: Number(row.progress_span_m),
        confidence: Number(row.confidence),
        details: parseJson(row.details_json, {})
      }))
    });
  }
  return out;
}

function compactEquipmentFeature(value) {
  if (!value) return null;
  const { currentEquipment: _current, ...feature } = value;
  return feature;
}

function ageFact(snapshot, horseObservation) {
  if (snapshot?.age?.years != null) return {
    years: snapshot.age.years,
    observed_at: snapshot.age.observedAt,
    source_record_id: snapshot.age.sourceRecordId,
    source: 'official_snapshot'
  };
  const years = finiteOrNull(horseObservation?.fields?.ageYears);
  if (years == null) return null;
  return {
    years,
    observed_at: horseObservation.observedAt,
    source_record_id: horseObservation.sourceRecordId,
    source: 'official_observation'
  };
}

function currentFacts(row, observation, horseObservation, driverObservation, trainerObservation, snapshot, equipment) {
  const fields = observation.fields || {};
  const scratchVerified = fields.scratchSemanticsVerified === true;
  const scratched = scratchVerified ? boolOrNull(fields.scratched) : null;
  return {
    observation: { observed_at: observation.observedAt, source_record_id: observation.sourceRecordId, quality_status: observation.qualityStatus },
    start_number: finiteOrNull(fields.startNumber),
    actual_lane: finiteOrNull(fields.postPosition),
    start_tier: finiteOrNull(fields.startTier),
    handicap_m: finiteOrNull(fields.handicapM),
    actual_start_distance_m: finiteOrNull(fields.actualStartDistanceM),
    scratched,
    scratch_status_verified: scratchVerified,
    analysis_eligible: scratched !== true,
    horse: {
      id: row.horse_id,
      name: fields.horseName || horseObservation?.fields?.name || null,
      age: ageFact(snapshot, horseObservation),
      sex: horseObservation?.fields?.sex || null,
      career_earnings_sek: finiteOrNull(horseObservation?.fields?.careerEarningsSek),
      current_record: snapshot?.currentRecord || null,
      official_statistics: snapshot?.officialStatistics || { year: null, life: null },
      history_coverage: snapshot?.coverage || null
    },
    driver: { id: row.driver_id || null, name: fields.driverName || driverObservation?.fields?.name || null },
    trainer: { id: row.trainer_id || null, name: fields.trainerName || trainerObservation?.fields?.name || null },
    equipment: equipment?.currentEquipment || null
  };
}

function raceFact(row, observation, trackObservation, proposition, firstPrize, entryFacts) {
  const fields = observation.fields || {};
  const active = entryFacts.filter((entry) => entry.analysis_eligible === true).length;
  const verifiedActive = entryFacts.filter((entry) => entry.scratch_status_verified && entry.scratched === false).length;
  const unknownScratch = entryFacts.filter((entry) => !entry.scratch_status_verified).length;
  return {
    race_id: row.race_id,
    observation: { observed_at: observation.observedAt, source_record_id: observation.sourceRecordId, quality_status: observation.qualityStatus },
    race_number: finiteOrNull(fields.raceNumber),
    scheduled_start_at: fields.scheduledStartAt || null,
    distance_m: finiteOrNull(fields.distanceM),
    start_method: fields.startMethod || null,
    race_name: fields.raceName || null,
    status: fields.status || null,
    first_prize_sek: firstPrize?.firstPrizeSek ?? null,
    first_prize_observed_at: firstPrize?.observedAt ?? null,
    proposition: proposition || null,
    track: {
      id: row.track_id || null,
      external_id: fields.trackExternalId || null,
      name: trackObservation?.fields?.name || null,
      country_code: trackObservation?.fields?.countryCode || null,
      observed_at: trackObservation?.observedAt || null
    },
    field: {
      total_entries: entryFacts.length,
      analysis_eligible_entries: active,
      verified_active_entries: verifiedActive,
      unknown_scratch_entries: unknownScratch
    }
  };
}

function sourceRefTimes(value, out = []) {
  if (Array.isArray(value)) { value.forEach((item) => sourceRefTimes(item, out)); return out; }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value.source_refs)) for (const ref of value.source_refs) if (ref?.selected_at) out.push(ref.selected_at);
  for (const nested of Object.values(value)) sourceRefTimes(nested, out);
  return out;
}

function coverageCounter(numerator, denominator) {
  return { observed: numerator, eligible: denominator, share: ratio(numerator, denominator) };
}

function manifestVersions() {
  return {
    featureVersions: {
      performance_contract: PERFORMANCE_FEATURE_CONTRACT_VERSION,
      ...PERFORMANCE_FEATURE_VERSIONS,
      equipment_response_contract: EQUIPMENT_RESPONSE_CONTRACT_VERSION,
      equipment_response: EQUIPMENT_RESPONSE_FEATURE_VERSION,
      equipment_state: EQUIPMENT_STATE_VERSION,
      equipment_change: EQUIPMENT_CHANGE_VERSION,
      person_context_contract: PERSON_CONTEXT_CONTRACT_VERSION,
      person_context: PERSON_CONTEXT_FEATURE_VERSION,
      race_priors_contract: RACE_PRIOR_CONTRACT_VERSION,
      race_priors: RACE_PRIOR_FEATURE_VERSION,
      relevant_history_contract: RELEVANT_HISTORY_CONTRACT_VERSION,
      relevant_history_selection: RELEVANT_HISTORY_SELECTION_VERSION,
      xlabs_evidence_contract: XLABS_EVIDENCE_PROFILE_CONTRACT,
      xlabs_evidence: XLABS_EVIDENCE_PROFILE_VERSION
    },
    parserVersions: { race_proposition: RACE_PROPOSITION_PARSER_VERSION },
    reconstructionVersions: { xlabs_position: XLABS_POSITION_RECONSTRUCTION_VERSION }
  };
}

export async function createPreMarketAnalysisPackV3(env, roundId, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const { round, rows } = await loadRoundIdentity(env, roundId);
  const cutoff = resolveCutoff(round, options.asOf ?? new Date().toISOString());
  const asOf = cutoff.effectiveAsOf;
  const raceIds = [...new Set(rows.map((row) => row.race_id))];
  const entryIds = [...new Set(rows.map((row) => row.race_entry_id))];
  const horseIds = [...new Set(rows.map((row) => row.horse_id).filter(Boolean))];
  const driverIds = [...new Set(rows.map((row) => row.driver_id).filter(Boolean))];
  const trainerIds = [...new Set(rows.map((row) => row.trainer_id).filter(Boolean))];
  const trackIds = [...new Set(rows.map((row) => row.track_id).filter(Boolean))];

  const [raceObs,entryObs,horseObs,driverObs,trainerObs,trackObs,firstPrizes,propositions,snapshots] = await Promise.all([
    loadLatestObservations(env,'race',raceIds,asOf),loadLatestObservations(env,'race_entry',entryIds,asOf),
    loadLatestObservations(env,'horse',horseIds,asOf),loadLatestObservations(env,'driver',driverIds,asOf),
    loadLatestObservations(env,'trainer',trainerIds,asOf),loadLatestObservations(env,'track',trackIds,asOf),
    loadFirstPrizeAsOf(env,raceIds,asOf),loadPropositionsAsOf(env,raceIds,asOf),getOfficialHorseSnapshotsAsOf(env,horseIds,asOf)
  ]);
  const missingRaceObs = raceIds.filter((id) => !raceObs.has(id));
  const missingEntryObs = entryIds.filter((id) => !entryObs.has(id));
  if (missingRaceObs.length) throw new Error(`pre-market pack cannot use mutable race state without an as-of official observation: ${missingRaceObs.join(', ')}`);
  if (missingEntryObs.length) throw new Error(`pre-market pack cannot use mutable entry state without an as-of official observation: ${missingEntryObs.join(', ')}`);

  const eligibleIds = entryIds.filter((id) => {
    const fields = entryObs.get(id)?.fields || {};
    return !(fields.scratchSemanticsVerified === true && boolOrNull(fields.scratched) === true);
  });
  const [history,performance,equipment,personContext,racePriors,editorial] = await Promise.all([
    buildRelevantHistoryForEntries(env,eligibleIds,asOf),
    buildPerformanceFeaturesV3ForEntries(env,eligibleIds,asOf),
    buildEquipmentResponseV1ForEntries(env,eligibleIds,asOf),
    buildPersonContextV1ForEntries(env,eligibleIds,asOf),
    buildRacePriorsV1ForEntries(env,eligibleIds,asOf),
    loadEditorialSignalsAsOf(env,rows,asOf)
  ]);
  const xlabsByRace = new Map();
  for (const raceId of raceIds) xlabsByRace.set(raceId, await buildXlabsEvidenceProfilesForRace(env,{raceId,asOf,frontContenderEntryIds:[]}));
  const historyIds = [...new Set([...history.values()].flatMap((item) => item.relevantHistoryUnion.map((start) => start.raceEntryId)))];
  const trajectories = await loadTrajectories(env,historyIds,asOf);

  const warnings = [];
  if (cutoff.clamped) warnings.push({ code: 'as_of_clamped_to_pre_market_cutoff', requested_as_of: cutoff.requestedAsOf, effective_as_of: asOf, cutoff_source: cutoff.cutoffSource });
  const unknownScratch = entryIds.filter((id) => entryObs.get(id)?.fields?.scratchSemanticsVerified !== true);
  if (unknownScratch.length) warnings.push({ code: 'scratch_status_unverified', affected_entries: unknownScratch.length });
  const missingSnapshots = horseIds.filter((id) => !snapshots.get(id)?.officialStatistics?.life && !snapshots.get(id)?.currentRecord && !snapshots.get(id)?.age);
  if (missingSnapshots.length) warnings.push({ code: 'official_snapshot_missing', affected_horses: missingSnapshots.length });

  const legs = [];
  let historiesSelected = 0;
  let historiesWithTrajectory = 0;
  for (let legNumber = 1; legNumber <= 8; legNumber += 1) {
    const legRows = rows.filter((row) => Number(row.leg_number) === legNumber);
    const raceId = legRows[0].race_id;
    const xRace = xlabsByRace.get(raceId);
    const profileByEntry = new Map((xRace?.profiles || []).map((profile) => [profile.race_entry_id, profile]));
    const entries = legRows.map((row) => {
      const id = row.race_entry_id;
      const eq = equipment.get(id) || null;
      const facts = currentFacts(row,entryObs.get(id),horseObs.get(row.horse_id),driverObs.get(row.driver_id),trainerObs.get(row.trainer_id),snapshots.get(row.horse_id),eq);
      if (!facts.analysis_eligible) return {
        race_entry_id:id,horse_id:row.horse_id,current_facts:facts,features:null,xlabs:null,history_aggregates:null,relevant_history:[],history_selection:null,current_signals:editorial.get(id)||[]
      };
      const hist = history.get(id);
      const relevantHistory = (hist?.relevantHistoryUnion || []).map((start) => {
        const reconstruction = trajectories.get(start.raceEntryId) || null;
        historiesSelected += 1;
        if (reconstruction) historiesWithTrajectory += 1;
        return { ...start, trajectory_reconstruction: reconstruction };
      });
      const measuredHistory = relevantHistory.filter((start) => start.trajectory_reconstruction != null).length;
      return {
        race_entry_id:id,
        horse_id:row.horse_id,
        current_facts:facts,
        features:{
          performance:performance.get(id)||null,
          equipment_response:compactEquipmentFeature(eq),
          person_context:personContext.get(id)||null,
          race_priors:racePriors.get(id)||null
        },
        xlabs:{
          evidence_profile:profileByEntry.get(id)||null,
          relevant_history_reconstruction_coverage:coverageCounter(measuredHistory,relevantHistory.length)
        },
        history_aggregates:hist?.fullHistoryAggregates||null,
        official_history_reference:hist?.officialHistoryReference||null,
        relevant_history:relevantHistory,
        history_selection:hist?{contract_version:hist.contractVersion,selection_version:hist.selectionVersion,counts:hist.counts,policy:hist.policy}:null,
        current_signals:editorial.get(id)||[]
      };
    });
    const raceRow = legRows[0];
    const facts = entries.map((entry) => entry.current_facts);
    legs.push({
      leg_number:legNumber,
      race:raceFact(raceRow,raceObs.get(raceId),trackObs.get(raceRow.track_id),propositions.get(raceId)||null,firstPrizes.get(raceId)||null,facts),
      xlabs_diagnostics:xRace?{coverage:xRace.coverage,population_shift:xRace.population_shift,separation:xRace.separation}:null,
      entries,
      warnings:facts.some((fact)=>!fact.scratch_status_verified)?[{code:'scratch_status_unverified'}]:[]
    });
  }

  const eligibleCount = eligibleIds.length;
  const equipmentKnown = eligibleIds.filter((id) => equipment.get(id)?.currentEquipment?.state != null).length;
  const historyKnown = eligibleIds.filter((id) => (history.get(id)?.counts?.totalSafe || 0) > 0).length;
  const snapshotKnown = eligibleIds.filter((id) => {
    const snapshot=snapshots.get(rows.find((row)=>row.race_entry_id===id)?.horse_id);
    return Boolean(snapshot?.officialStatistics?.life||snapshot?.currentRecord||snapshot?.age);
  }).length;
  const xlabsKnown = eligibleIds.filter((id) => {
    const raceId=rows.find((row)=>row.race_entry_id===id)?.race_id;
    const profile=(xlabsByRace.get(raceId)?.profiles||[]).find((item)=>item.race_entry_id===id);
    return profile && Object.values(profile.features||{}).some((feature)=>(feature?.measurement_depth?.measured_starts||0)>0);
  }).length;
  const signalKnown = eligibleIds.filter((id)=>(editorial.get(id)||[]).length>0).length;
  const sourceFamilyCoverage = {
    official_race_observations:coverageCounter(raceObs.size,raceIds.length),
    official_entry_observations:coverageCounter(entryObs.size,entryIds.length),
    official_horse_snapshots:coverageCounter(snapshotKnown,eligibleCount),
    relevant_history:coverageCounter(historyKnown,eligibleCount),
    current_equipment:coverageCounter(equipmentKnown,eligibleCount),
    xlabs_measured_history:coverageCounter(xlabsKnown,eligibleCount),
    trajectory_reconstruction_selected_history:coverageCounter(historiesWithTrajectory,historiesSelected),
    editorial_signals:coverageCounter(signalKnown,eligibleCount)
  };
  const sourceFreshness = {
    official_current:maxIso([...raceObs.values(),...entryObs.values(),...horseObs.values(),...driverObs.values(),...trainerObs.values(),...trackObs.values()].map((value)=>value.observedAt)),
    official_snapshots:maxIso([...snapshots.values()].flatMap((snapshot)=>[
      snapshot?.age?.observedAt,snapshot?.currentRecord?.observedAt,snapshot?.officialStatistics?.year?.observedAt,snapshot?.officialStatistics?.life?.observedAt
    ])),
    xlabs:maxIso([...xlabsByRace.values()].flatMap((value)=>sourceRefTimes(value))),
    editorial:maxIso([...editorial.values()].flatMap((signals)=>signals.map((signal)=>signal.available_at)))
  };
  const versions = manifestVersions();
  return buildAnalysisPackV3Files({
    round:{
      round_id:round.id,
      game_type:round.game_type,
      round_date:round.round_date,
      pre_market_cutoff_at:cutoff.cutoffAt,
      pre_market_cutoff_source:cutoff.cutoffSource
    },
    legs,
    asOf,
    generatedAt:options.generatedAt??new Date().toISOString(),
    cutoffSource:cutoff.cutoffSource,
    warnings,
    sourceFamilyCoverage,
    sourceFreshness,
    featureVersions:versions.featureVersions,
    parserVersions:versions.parserVersions,
    reconstructionVersions:versions.reconstructionVersions,
    evidenceContractVersion:ANALYSIS_V3_FOUNDATION_CONTRACTS.evidenceEnvelope
  }, { maxFileBytes:options.maxFileBytes??ANALYSIS_PACK_V3_MAX_FILE_BYTES });
}

export async function createAnalysisPackV3Response(env, roundId, { file = null, asOf = null } = {}) {
  const pack = await createPreMarketAnalysisPackV3(env,roundId,{asOf});
  const requested = file == null || file === '' ? 'manifest.json' : requiredText(file,'file',160);
  const content = requested === 'manifest.json' ? pack.manifestContent : pack.files.find((item)=>item.name===requested)?.content;
  if (content == null) return new Response(stableFeatureJson({error:'file_not_found',available_files:['manifest.json',...pack.files.map((item)=>item.name)]}),{status:404,headers:{'content-type':CONTENT_TYPE,'cache-control':'no-store'}});
  return new Response(content,{status:200,headers:{'content-type':CONTENT_TYPE,'cache-control':'no-store','content-disposition':`attachment; filename="${requested}"`}});
}
