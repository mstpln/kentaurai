import {
  ANALYSIS_V3_FOUNDATION_CONTRACTS,
  ANALYSIS_V3_INITIAL_BACKOFF_POLICY,
  classifyEvidenceLevel,
  createEvidenceEnvelope,
  createFeatureProvenance,
  createFeatureVersionRegistry,
  estimateWithHierarchicalBackoff,
  stableFeatureJson
} from './analysis-v3-foundations.js';
import {
  RELEVANT_HISTORY_CONTRACT_VERSION,
  RELEVANT_HISTORY_SELECTION_VERSION,
  buildRelevantHistoryForEntries
} from './relevant-history-v1.js';
import { XLABS_TELEMETRY_VERSION } from './import/xlabs-telemetry.js';

export const EQUIPMENT_RESPONSE_CONTRACT_VERSION = 'kentaurai-equipment-response-v1';
export const EQUIPMENT_RESPONSE_FEATURE_VERSION = 'equipment_response_v1';
export const EQUIPMENT_STATE_VERSION = 'equipment_state_v1';
export const EQUIPMENT_CHANGE_VERSION = 'equipment_change_v1';

export const EQUIPMENT_RESPONSE_POLICY = Object.freeze({
  confidenceFullSample: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.minEffectiveSampleSize,
  trainerHistoryLimit: 200,
  stateDimensions: 6
});

const FEATURE_REGISTRY = createFeatureVersionRegistry([{
  family: 'equipment_response',
  version: EQUIPMENT_RESPONSE_FEATURE_VERSION,
  semantics: 'Descriptive historical response to canonical equipment state and verified equipment changes. Association only; no causal gain or composite score.',
  parameters: {
    stateVersion: EQUIPMENT_STATE_VERSION,
    changeVersion: EQUIPMENT_CHANGE_VERSION,
    backoffPolicy: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.version,
    trainerHistoryLimit: EQUIPMENT_RESPONSE_POLICY.trainerHistoryLimit
  }
}]);

const SQL_CHUNK_SIZE = 80;
const STATE_FIELDS = Object.freeze(['shoesFront', 'shoesRear', 'barefootFront', 'barefootRear', 'sulkyType', 'exactSulky']);
const CHANGE_FIELDS = Object.freeze([
  ['shoesFrontChanged', 'shoes_front'],
  ['shoesRearChanged', 'shoes_rear'],
  ['sulkyTypeChanged', 'sulky_type'],
  ['sulkyColourChanged', 'sulky_colour']
]);

export function getEquipmentResponseVersionRegistry() {
  return FEATURE_REGISTRY.snapshot();
}

function placeholders(values) { return values.map(() => '?').join(','); }
function chunks(values, size = SQL_CHUNK_SIZE) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}
function requireInstant(value, label = 'asOf') {
  const text = String(value ?? '').trim();
  const ms = Date.parse(text);
  if (!text || !Number.isFinite(ms)) throw new Error(`${label} must be a valid timestamp`);
  return { ms, iso: new Date(ms).toISOString() };
}
function integer(value, label, { min = 1, max = 10000 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return number;
}
function finite(value) {
  const number = Number(value);
  return value == null || !Number.isFinite(number) ? null : number;
}
function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return text || null;
}
function normalizeBoolean(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}
function observedMs(value) {
  const ms = Date.parse(String(value ?? ''));
  return Number.isFinite(ms) ? ms : null;
}
function eventMs(row) {
  const scheduled = Date.parse(String(row?.scheduled_start_at ?? row?.scheduledStartAt ?? ''));
  if (Number.isFinite(scheduled)) return scheduled;
  const date = row?.race_date ?? row?.raceDate;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const fallback = Date.parse(`${date}T23:59:59.999Z`);
  return Number.isFinite(fallback) ? fallback : null;
}
function parsePaceSeconds(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s*min\/km$/i, '');
  const match = text.match(/^(\d+)[.:](\d{2})[,.](\d)$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const tenths = Number(match[3]);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || !Number.isInteger(tenths) || seconds > 59) return null;
  return (minutes * 60) + seconds + (tenths / 10);
}
function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function roundConfidence(value) { return value == null ? null : Math.round(value * 1_000_000) / 1_000_000; }
function empiricalConfidence(sampleSize, coverage) {
  if (!(sampleSize > 0) || coverage == null) return null;
  return roundConfidence(Math.min(1, sampleSize / EQUIPMENT_RESPONSE_POLICY.confidenceFullSample) * coverage);
}

function evidenceMetric({ value, evidenceSource, known = 0, total = known, relevant = known, contextSampleSize = 0, asOf, confidence = undefined }) {
  const sampleSize = Math.max(0, Number.isInteger(known) ? known : 0);
  const relevantSampleSize = Math.min(sampleSize, Math.max(0, Number.isInteger(relevant) ? relevant : 0));
  const denominator = Math.max(0, Number.isInteger(total) ? total : 0);
  const coverage = denominator > 0 ? Math.min(1, sampleSize / denominator) : null;
  const evidenceLevel = classifyEvidenceLevel({
    directSampleSize: sampleSize,
    relevantDirectSampleSize: relevantSampleSize,
    contextSampleSize: Math.max(0, Number.isInteger(contextSampleSize) ? contextSampleSize : 0)
  });
  return createEvidenceEnvelope({
    value: value ?? null,
    evidenceSource,
    evidenceLevel,
    sampleSize,
    relevantSampleSize,
    coverage,
    confidence: confidence === undefined ? (value == null ? null : empiricalConfidence(sampleSize, coverage)) : confidence,
    asOf,
    featureVersion: EQUIPMENT_RESPONSE_FEATURE_VERSION
  });
}

function contextMetric({ value, evidenceSource, known = 0, total = known, asOf }) {
  const denominator = Math.max(0, Number.isInteger(total) ? total : 0);
  const coverage = denominator > 0 ? Math.min(1, known / denominator) : null;
  return createEvidenceEnvelope({
    value: value ?? null,
    evidenceSource,
    evidenceLevel: classifyEvidenceLevel({ directSampleSize: 0, relevantDirectSampleSize: 0, contextSampleSize: known }),
    sampleSize: 0,
    relevantSampleSize: 0,
    coverage,
    confidence: value == null ? null : empiricalConfidence(known, coverage),
    asOf,
    featureVersion: EQUIPMENT_RESPONSE_FEATURE_VERSION
  });
}

function parseChange(value) {
  if (value == null || value === '') return { version: EQUIPMENT_CHANGE_VERSION, status: 'unknown', type: null, dimensions: [], knownFields: 0 };
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return { version: EQUIPMENT_CHANGE_VERSION, status: 'unknown', type: null, dimensions: [], knownFields: 0 }; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: EQUIPMENT_CHANGE_VERSION, status: 'unknown', type: null, dimensions: [], knownFields: 0 };
  const dimensions = [];
  let knownFields = 0;
  for (const [rawField, canonicalField] of CHANGE_FIELDS) {
    if (typeof parsed[rawField] !== 'boolean') continue;
    knownFields += 1;
    if (parsed[rawField]) dimensions.push(canonicalField);
  }
  dimensions.sort();
  return {
    version: EQUIPMENT_CHANGE_VERSION,
    status: dimensions.length ? 'changed' : (knownFields > 0 ? 'unchanged' : 'unknown'),
    type: dimensions.length ? dimensions.join('+') : null,
    dimensions,
    knownFields
  };
}

function normalizeEquipmentRow(row) {
  if (!row || normalizeText(row.verification_status) === 'unknown') return null;
  const state = {
    shoesFront: normalizeText(row.shoes_front),
    shoesRear: normalizeText(row.shoes_rear),
    barefootFront: normalizeBoolean(row.barefoot_front),
    barefootRear: normalizeBoolean(row.barefoot_rear),
    sulkyType: normalizeText(row.sulky_type),
    exactSulky: normalizeText(row.exact_sulky)
  };
  const knownDimensions = STATE_FIELDS.filter((field) => state[field] != null).length;
  if (!knownDimensions) return null;
  return {
    state,
    stateKey: stableFeatureJson(state),
    knownDimensions,
    coverage: knownDimensions / EQUIPMENT_RESPONSE_POLICY.stateDimensions,
    verificationStatus: row.verification_status || null,
    change: parseChange(row.change_from_previous_json),
    observedAt: row.fetched_at || null,
    sourceRecordId: row.source_record_id || null
  };
}
function normalizeXlabsRow(row) {
  if (!row || row.quality_status !== XLABS_TELEMETRY_VERSION) return null;
  return { first200Time: row.first_200_time || null, last400Time: row.last_400_time || null, observedAt: row.fetched_at || null, sourceRecordId: row.source_record_id || null };
}
function latestAtOrBefore(rows, cutoffMs, normalizer) {
  for (const row of rows || []) {
    const ms = observedMs(row?.fetched_at);
    if (ms == null || ms > cutoffMs) continue;
    const value = normalizer(row);
    if (value) return value;
  }
  return null;
}
async function hashState(stateKey) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stateKey));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
async function stateWithHash(equipment, cache) {
  if (!equipment) return null;
  if (!cache.has(equipment.stateKey)) cache.set(equipment.stateKey, hashState(equipment.stateKey));
  return { ...equipment, stateHash: await cache.get(equipment.stateKey) };
}

async function loadTargets(env, entryIds) {
  const rows = [];
  for (const group of chunks(entryIds)) {
    const { results } = await env.DB.prepare(`
      SELECT re.id AS race_entry_id, re.race_id, re.horse_id, re.trainer_id, r.race_date, r.scheduled_start_at
      FROM race_entries re JOIN races r ON r.id = re.race_id
      WHERE re.id IN (${placeholders(group)})
    `).bind(...group).all();
    rows.push(...results);
  }
  const byId = new Map(rows.map((row) => [row.race_entry_id, row]));
  const missing = entryIds.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`target race entries were not found: ${missing.join(', ')}`);
  return entryIds.map((id) => byId.get(id));
}

async function loadHorseHistory(env, horseIds) {
  const rows = [];
  for (const group of chunks([...new Set(horseIds.filter(Boolean))])) {
    const { results } = await env.DB.prepare(`
      SELECT re.horse_id, re.trainer_id, re.id AS race_entry_id, re.race_id,
             r.race_date, r.scheduled_start_at, rr.placing, rr.gallop, rr.disqualified,
             rr.source_record_id AS result_source_record_id, sr.fetched_at AS result_observed_at
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN source_records sr ON sr.id = rr.source_record_id
      WHERE re.horse_id IN (${placeholders(group)}) AND re.scratched = 0 AND rr.result_status = 'official'
      ORDER BY re.horse_id, r.race_date, r.race_number, re.id
    `).bind(...group).all();
    rows.push(...results);
  }
  const byHorse = new Map();
  for (const row of rows) {
    if (!byHorse.has(row.horse_id)) byHorse.set(row.horse_id, []);
    byHorse.get(row.horse_id).push(row);
  }
  return byHorse;
}

async function loadTrainerHistory(env, trainersByCutoff, limit) {
  const out = new Map();
  for (const [cutoffIso, trainerIds] of trainersByCutoff) {
    const unique = [...new Set(trainerIds.filter(Boolean))];
    for (const group of chunks(unique)) {
      const { results } = await env.DB.prepare(`
        WITH ranked AS (
          SELECT re.trainer_id, re.horse_id, re.id AS race_entry_id, re.race_id,
                 r.race_date, r.scheduled_start_at, rr.placing, rr.gallop, rr.disqualified,
                 rr.source_record_id AS result_source_record_id, sr.fetched_at AS result_observed_at,
                 ROW_NUMBER() OVER (PARTITION BY re.trainer_id ORDER BY COALESCE(r.scheduled_start_at, r.race_date || 'T23:59:59.999Z') DESC, re.id DESC) AS rn
          FROM race_entries re
          JOIN races r ON r.id = re.race_id
          JOIN race_results rr ON rr.race_entry_id = re.id
          JOIN source_records sr ON sr.id = rr.source_record_id
          WHERE re.trainer_id IN (${placeholders(group)})
            AND re.scratched = 0 AND rr.result_status = 'official'
            AND julianday(COALESCE(r.scheduled_start_at, r.race_date || 'T23:59:59.999Z')) < julianday(?)
            AND julianday(sr.fetched_at) <= julianday(?)
        )
        SELECT * FROM ranked WHERE rn <= ? ORDER BY trainer_id, rn
      `).bind(...group, cutoffIso, cutoffIso, limit).all();
      for (const row of results) {
        const key = `${cutoffIso}|${row.trainer_id}`;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(row);
      }
    }
  }
  return out;
}

async function loadEquipmentRows(env, entryIds) {
  const ids = [...new Set(entryIds)];
  const out = new Map(ids.map((id) => [id, []]));
  for (const group of chunks(ids)) {
    const { results } = await env.DB.prepare(`
      SELECT e.*, sr.fetched_at
      FROM equipment e JOIN source_records sr ON sr.id = e.source_record_id
      WHERE e.race_entry_id IN (${placeholders(group)})
      ORDER BY e.race_entry_id, julianday(sr.fetched_at) DESC, e.id DESC
    `).bind(...group).all();
    for (const row of results) out.get(row.race_entry_id)?.push(row);
  }
  return out;
}
async function loadXlabsRows(env, entryIds) {
  const ids = [...new Set(entryIds)];
  const out = new Map(ids.map((id) => [id, []]));
  for (const group of chunks(ids)) {
    const { results } = await env.DB.prepare(`
      SELECT x.*, sr.fetched_at
      FROM xlabs_data x JOIN source_records sr ON sr.id = x.source_record_id
      WHERE x.race_entry_id IN (${placeholders(group)})
      ORDER BY x.race_entry_id, julianday(sr.fetched_at) DESC, x.id DESC
    `).bind(...group).all();
    for (const row of results) out.get(row.race_entry_id)?.push(row);
  }
  return out;
}

function safeHistoryRows(rows, cutoffMs, targetEntryId, targetRaceId) {
  return (rows || []).filter((row) => {
    if (row.race_entry_id === targetEntryId || row.race_id === targetRaceId) return false;
    const event = eventMs(row);
    const observed = observedMs(row.result_observed_at);
    return event != null && event < cutoffMs && observed != null && observed <= cutoffMs;
  });
}
function placingStats(rows) {
  const values = rows.map((row) => finite(row.placing)).filter((value) => value != null && value > 0);
  return { known: values.length, total: rows.length, winRate: values.length ? values.filter((value) => value === 1).length / values.length : null, top3Rate: values.length ? values.filter((value) => value <= 3).length / values.length : null };
}
function gallopStats(rows) {
  const values = rows.map((row) => normalizeBoolean(row.gallop)).filter((value) => value != null);
  return { known: values.length, total: rows.length, rate: values.length ? values.filter(Boolean).length / values.length : null };
}
function paceStats(rows, accessor) {
  const values = rows.map(accessor).map(parsePaceSeconds).filter((value) => value != null);
  return { known: values.length, total: rows.length, mean: mean(values) };
}
function sourceRef(sourceRecordId, selectedAt, timeBasis) {
  const ms = observedMs(selectedAt);
  return !sourceRecordId || ms == null ? null : { source_record_id: sourceRecordId, selected_at: new Date(ms).toISOString(), time_basis: timeBasis };
}
function dedupeSourceRefs(refs) {
  const map = new Map();
  for (const ref of refs.filter(Boolean)) map.set(`${ref.source_record_id}|${ref.selected_at}|${ref.time_basis}`, ref);
  return [...map.values()].sort((a, b) => `${a.source_record_id}|${a.selected_at}|${a.time_basis}`.localeCompare(`${b.source_record_id}|${b.selected_at}|${b.time_basis}`));
}
function rateEstimate(directValue, directN, priorValue, priorN, level) {
  return estimateWithHierarchicalBackoff({
    directValue,
    directSampleSize: directN,
    backoffCandidates: directN > 0 && priorValue != null && priorN > 0 ? [{ level, value: priorValue, sampleSize: priorN, effectiveSampleSize: priorN }] : []
  });
}
function zeroShrunkDelta(value, directN) {
  return estimateWithHierarchicalBackoff({
    directValue: value,
    directSampleSize: directN,
    backoffCandidates: directN > 0 && value != null ? [{ level: 'no_change_prior', value: 0, sampleSize: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.minEffectiveSampleSize, effectiveSampleSize: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.minEffectiveSampleSize }] : []
  });
}
function associationDelta(directValue, baselineValue) { return directValue == null || baselineValue == null ? null : directValue - baselineValue; }
function currentEquipmentView(equipment, sameStateCount) {
  if (!equipment) {
    return {
      state_version: EQUIPMENT_STATE_VERSION, state_hash: null, state: null, known_dimensions: 0, dimension_coverage: 0,
      history_status: 'unknown_current',
      change: { version: EQUIPMENT_CHANGE_VERSION, status: 'unknown', type: null, dimensions: [] },
      verification_status: null, observed_at: null, source_record_id: null
    };
  }
  return {
    state_version: EQUIPMENT_STATE_VERSION,
    state_hash: equipment.stateHash,
    state: {
      shoes_front: equipment.state.shoesFront,
      shoes_rear: equipment.state.shoesRear,
      barefoot_front: equipment.state.barefootFront,
      barefoot_rear: equipment.state.barefootRear,
      sulky_type: equipment.state.sulkyType,
      exact_sulky: equipment.state.exactSulky
    },
    known_dimensions: equipment.knownDimensions,
    dimension_coverage: equipment.coverage,
    history_status: sameStateCount > 0 ? 'observed' : 'first_seen',
    change: { version: equipment.change.version, status: equipment.change.status, type: equipment.change.type, dimensions: [...equipment.change.dimensions] },
    verification_status: equipment.verificationStatus,
    observed_at: equipment.observedAt,
    source_record_id: equipment.sourceRecordId
  };
}

export async function buildEquipmentResponseV1ForEntries(env, raceEntryIds, asOf, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (!Array.isArray(raceEntryIds)) throw new Error('raceEntryIds must be an array');
  const requested = requireInstant(asOf);
  const entryIds = [...new Set(raceEntryIds.map((value) => String(value ?? '').trim()).filter(Boolean))];
  if (!entryIds.length) return new Map();
  const trainerHistoryLimit = integer(options.trainerHistoryLimit ?? EQUIPMENT_RESPONSE_POLICY.trainerHistoryLimit, 'trainerHistoryLimit', { max: 1000 });

  const targets = await loadTargets(env, entryIds);
  const relevantHistory = options.relevantHistory instanceof Map
    ? options.relevantHistory
    : await buildRelevantHistoryForEntries(env, entryIds, requested.iso, options.relevantHistoryOptions || {});
  const cutoffByEntry = new Map(entryIds.map((entryId) => [entryId, requireInstant(relevantHistory.get(entryId)?.targetCutoff, `targetCutoff for ${entryId}`)]));
  const horseHistory = await loadHorseHistory(env, targets.map((target) => target.horse_id));

  const baseEntryIds = new Set(entryIds);
  for (const target of targets) for (const row of horseHistory.get(target.horse_id) || []) baseEntryIds.add(row.race_entry_id);
  let equipmentRows = await loadEquipmentRows(env, [...baseEntryIds]);

  const hashCache = new Map();
  const currentEquipmentByEntry = new Map();
  const trainerCutoffs = new Map();
  for (const target of targets) {
    const cutoff = cutoffByEntry.get(target.race_entry_id);
    const current = await stateWithHash(latestAtOrBefore(equipmentRows.get(target.race_entry_id), cutoff.ms, normalizeEquipmentRow), hashCache);
    currentEquipmentByEntry.set(target.race_entry_id, current);
    if (current?.change?.status === 'changed' && current.change.type && target.trainer_id) {
      if (!trainerCutoffs.has(cutoff.iso)) trainerCutoffs.set(cutoff.iso, []);
      trainerCutoffs.get(cutoff.iso).push(target.trainer_id);
    }
  }

  const trainerHistory = await loadTrainerHistory(env, trainerCutoffs, trainerHistoryLimit);
  const trainerEntryIds = [...trainerHistory.values()].flat().map((row) => row.race_entry_id);
  const missingTrainerEquipmentIds = [...new Set(trainerEntryIds)].filter((id) => !equipmentRows.has(id));
  if (missingTrainerEquipmentIds.length) equipmentRows = new Map([...equipmentRows, ...await loadEquipmentRows(env, missingTrainerEquipmentIds)]);

  const horseHistoryEntryIds = targets.flatMap((target) => (horseHistory.get(target.horse_id) || []).map((row) => row.race_entry_id));
  const xlabsRows = await loadXlabsRows(env, horseHistoryEntryIds);
  const out = new Map();

  for (const target of targets) {
    const entryId = target.race_entry_id;
    const cutoff = cutoffByEntry.get(entryId);
    const current = currentEquipmentByEntry.get(entryId) || null;
    const safeRows = safeHistoryRows(horseHistory.get(target.horse_id), cutoff.ms, entryId, target.race_id);
    const decorated = [];
    for (const row of safeRows) {
      decorated.push({
        ...row,
        equipment: await stateWithHash(latestAtOrBefore(equipmentRows.get(row.race_entry_id), cutoff.ms, normalizeEquipmentRow), hashCache),
        xlabs: latestAtOrBefore(xlabsRows.get(row.race_entry_id), cutoff.ms, normalizeXlabsRow)
      });
    }

    const equipmentKnownRows = decorated.filter((row) => row.equipment != null);
    const sameStateRows = current ? equipmentKnownRows.filter((row) => row.equipment.stateKey === current.stateKey) : [];
    const horsePlacement = placingStats(decorated);
    const horseGallop = gallopStats(decorated);
    const sameStatePlacement = placingStats(sameStateRows);
    const sameStateGallop = gallopStats(sameStateRows);
    const sameStateFirst200 = paceStats(sameStateRows, (row) => row.xlabs?.first200Time);
    const sameStateLast400 = paceStats(sameStateRows, (row) => row.xlabs?.last400Time);

    const targetChangeType = current?.change?.status === 'changed' ? current.change.type : null;
    const sameChangeRows = targetChangeType ? equipmentKnownRows.filter((row) => row.equipment.change.status === 'changed' && row.equipment.change.type === targetChangeType) : [];
    const sameChangeIds = new Set(sameChangeRows.map((row) => row.race_entry_id));
    const baselineRows = sameChangeRows.length ? decorated.filter((row) => !sameChangeIds.has(row.race_entry_id)) : decorated;
    const changePlacement = placingStats(sameChangeRows);
    const changeGallop = gallopStats(sameChangeRows);
    const baselinePlacement = placingStats(baselineRows);
    const baselineGallop = gallopStats(baselineRows);
    const top3Delta = associationDelta(changePlacement.top3Rate, baselinePlacement.top3Rate);
    const gallopDelta = associationDelta(changeGallop.rate, baselineGallop.rate);

    const trainerRows = [];
    const trainerRowsRaw = targetChangeType && target.trainer_id ? trainerHistory.get(`${cutoff.iso}|${target.trainer_id}`) || [] : [];
    for (const row of trainerRowsRaw) {
      if (row.horse_id === target.horse_id) continue;
      const equipment = await stateWithHash(latestAtOrBefore(equipmentRows.get(row.race_entry_id), cutoff.ms, normalizeEquipmentRow), hashCache);
      if (equipment?.change?.status === 'changed' && equipment.change.type === targetChangeType) trainerRows.push({ ...row, equipment });
    }
    const trainerPlacement = placingStats(trainerRows);
    const trainerGallop = gallopStats(trainerRows);

    const metrics = {
      same_state_win_rate: evidenceMetric({ value: sameStatePlacement.winRate, evidenceSource: 'horse_same_equipment_state_history', known: sameStatePlacement.known, total: sameStatePlacement.total, asOf: cutoff.iso }),
      same_state_top3_rate: evidenceMetric({ value: sameStatePlacement.top3Rate, evidenceSource: 'horse_same_equipment_state_history', known: sameStatePlacement.known, total: sameStatePlacement.total, asOf: cutoff.iso }),
      same_state_gallop_rate: evidenceMetric({ value: sameStateGallop.rate, evidenceSource: 'horse_same_equipment_state_history', known: sameStateGallop.known, total: sameStateGallop.total, asOf: cutoff.iso }),
      same_state_xlabs_first200_km_seconds: evidenceMetric({ value: sameStateFirst200.mean, evidenceSource: 'xlabs_direct_same_equipment_state_history', known: sameStateFirst200.known, total: sameStateFirst200.total, asOf: cutoff.iso }),
      same_state_xlabs_last400_km_seconds: evidenceMetric({ value: sameStateLast400.mean, evidenceSource: 'xlabs_direct_same_equipment_state_history', known: sameStateLast400.known, total: sameStateLast400.total, asOf: cutoff.iso }),
      same_change_type_top3_rate: evidenceMetric({ value: changePlacement.top3Rate, evidenceSource: 'horse_same_verified_change_type_history', known: changePlacement.known, total: changePlacement.total, asOf: cutoff.iso }),
      same_change_type_gallop_rate: evidenceMetric({ value: changeGallop.rate, evidenceSource: 'horse_same_verified_change_type_history', known: changeGallop.known, total: changeGallop.total, asOf: cutoff.iso }),
      change_top3_association_delta_vs_horse_baseline: evidenceMetric({ value: top3Delta, evidenceSource: 'horse_same_verified_change_type_vs_own_baseline', known: changePlacement.known, total: changePlacement.total, asOf: cutoff.iso }),
      change_gallop_association_delta_vs_horse_baseline: evidenceMetric({ value: gallopDelta, evidenceSource: 'horse_same_verified_change_type_vs_own_baseline', known: changeGallop.known, total: changeGallop.total, asOf: cutoff.iso }),
      trainer_same_change_type_top3_rate: contextMetric({ value: trainerPlacement.top3Rate, evidenceSource: 'trainer_same_verified_change_type_context', known: trainerPlacement.known, total: trainerPlacement.total, asOf: cutoff.iso }),
      trainer_same_change_type_gallop_rate: contextMetric({ value: trainerGallop.rate, evidenceSource: 'trainer_same_verified_change_type_context', known: trainerGallop.known, total: trainerGallop.total, asOf: cutoff.iso })
    };

    const estimates = {
      shrunk_same_state_win_rate: rateEstimate(sameStatePlacement.winRate, sameStatePlacement.known, horsePlacement.winRate, horsePlacement.known, 'horse_all_safe_history'),
      shrunk_same_state_top3_rate: rateEstimate(sameStatePlacement.top3Rate, sameStatePlacement.known, horsePlacement.top3Rate, horsePlacement.known, 'horse_all_safe_history'),
      shrunk_same_state_gallop_rate: rateEstimate(sameStateGallop.rate, sameStateGallop.known, horseGallop.rate, horseGallop.known, 'horse_all_safe_history'),
      shrunk_change_top3_association_delta: zeroShrunkDelta(top3Delta, changePlacement.known),
      shrunk_change_gallop_association_delta: zeroShrunkDelta(gallopDelta, changeGallop.known)
    };

    const refs = [];
    if (current) refs.push(sourceRef(current.sourceRecordId, current.observedAt, 'equipment_observed_at'));
    // Family provenance must include every fact that materially contributes to a
    // baseline, backoff estimate, state/change membership, or direct metric.
    for (const row of decorated) {
      refs.push(sourceRef(row.result_source_record_id, row.result_observed_at, 'result_observed_at'));
      if (row.equipment) refs.push(sourceRef(row.equipment.sourceRecordId, row.equipment.observedAt, 'equipment_observed_at'));
    }
    for (const row of sameStateRows) if (row.xlabs) refs.push(sourceRef(row.xlabs.sourceRecordId, row.xlabs.observedAt, 'xlabs_observed_at'));
    for (const row of trainerRows) {
      refs.push(sourceRef(row.result_source_record_id, row.result_observed_at, 'result_observed_at'));
      if (row.equipment) refs.push(sourceRef(row.equipment.sourceRecordId, row.equipment.observedAt, 'equipment_observed_at'));
    }

    const history = relevantHistory.get(entryId);
    const provenance = createFeatureProvenance({
      featureFamily: 'equipment_response',
      featureVersion: EQUIPMENT_RESPONSE_FEATURE_VERSION,
      asOf: cutoff.iso,
      sourceRefs: dedupeSourceRefs(refs),
      inputVersions: {
        relevantHistory: history?.contractVersion || RELEVANT_HISTORY_CONTRACT_VERSION,
        relevantHistorySelection: history?.selectionVersion || RELEVANT_HISTORY_SELECTION_VERSION,
        evidence: ANALYSIS_V3_FOUNDATION_CONTRACTS.evidenceEnvelope,
        hierarchicalBackoff: ANALYSIS_V3_FOUNDATION_CONTRACTS.hierarchicalBackoff
      },
      parameters: {
        stateVersion: EQUIPMENT_STATE_VERSION,
        changeVersion: EQUIPMENT_CHANGE_VERSION,
        trainerHistoryLimit,
        backoffPolicy: ANALYSIS_V3_INITIAL_BACKOFF_POLICY.version
      }
    });

    out.set(entryId, {
      contractVersion: EQUIPMENT_RESPONSE_CONTRACT_VERSION,
      featureVersion: EQUIPMENT_RESPONSE_FEATURE_VERSION,
      requestedAsOf: requested.iso,
      effectiveAsOf: cutoff.iso,
      raceEntryId: entryId,
      horseId: target.horse_id,
      trainerId: target.trainer_id || null,
      currentEquipment: currentEquipmentView(current, sameStateRows.length),
      samples: {
        safeHorseStarts: decorated.length,
        equipmentKnownHorseStarts: equipmentKnownRows.length,
        sameStateStarts: sameStateRows.length,
        sameChangeTypeStarts: sameChangeRows.length,
        changeBaselineStarts: baselineRows.length,
        changeBaselinePlacingSamples: baselinePlacement.known,
        changeBaselineGallopSamples: baselineGallop.known,
        trainerSameChangeTypeStarts: trainerRows.length
      },
      metrics,
      estimates,
      provenance
    });
  }
  return out;
}
