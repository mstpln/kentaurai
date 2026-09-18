import { stableFeatureJson } from './analysis-v3-foundations.js';
import { getOfficialHorseSnapshotsAsOf } from './import/official-snapshots.js';
import { XLABS_TELEMETRY_VERSION } from './import/xlabs-telemetry.js';
import { RACE_PROPOSITION_PARSER_VERSION } from './race-proposition-v1.js';

export const RELEVANT_HISTORY_CONTRACT_VERSION = 'kentaurai-relevant-history-v1';
export const RELEVANT_HISTORY_SELECTION_VERSION = 'kentaurai-relevant-history-selection-v1';

export const RELEVANT_HISTORY_DEFAULT_POLICY = Object.freeze({
  maxRows: 16,
  recentRows: 5,
  similarDistanceToleranceM: 250,
  restShortMaxDays: 14,
  restNormalMaxDays: 45
});

export const RELEVANT_HISTORY_REASON_ORDER = Object.freeze([
  'recent',
  'same_start_method',
  'similar_distance',
  'same_track_context',
  'similar_proposition',
  'same_equipment',
  'same_driver',
  'xlabs_representative',
  'rest_comparable',
  'error_pattern'
]);

const SQL_CHUNK_SIZE = 80;

function placeholders(values) { return values.map(() => '?').join(','); }
function chunks(values, size = SQL_CHUNK_SIZE) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function requireInstant(value, label = 'asOf') {
  const text = String(value ?? '').trim();
  const ms = Date.parse(text);
  if (!text || !Number.isFinite(ms)) throw new Error(`${label} must be a valid timestamp`);
  return { ms, iso: new Date(ms).toISOString() };
}

function integer(value, label, { min = 1, max = 1000 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} must be an integer between ${min} and ${max}`);
  return number;
}

function nonNegativeNumber(value, label, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max) throw new Error(`${label} must be a finite number between 0 and ${max}`);
  return number;
}

function normalizePolicy(options = {}) {
  const maxRows = integer(options.maxRows ?? RELEVANT_HISTORY_DEFAULT_POLICY.maxRows, 'maxRows', { max: 100 });
  const recentRows = integer(options.recentRows ?? RELEVANT_HISTORY_DEFAULT_POLICY.recentRows, 'recentRows', { max: 100 });
  if (recentRows > maxRows) throw new Error('recentRows cannot exceed maxRows');
  const similarDistanceToleranceM = nonNegativeNumber(options.similarDistanceToleranceM ?? RELEVANT_HISTORY_DEFAULT_POLICY.similarDistanceToleranceM, 'similarDistanceToleranceM', 5000);
  const restShortMaxDays = nonNegativeNumber(options.restShortMaxDays ?? RELEVANT_HISTORY_DEFAULT_POLICY.restShortMaxDays, 'restShortMaxDays', 3650);
  const restNormalMaxDays = nonNegativeNumber(options.restNormalMaxDays ?? RELEVANT_HISTORY_DEFAULT_POLICY.restNormalMaxDays, 'restNormalMaxDays', 3650);
  if (restNormalMaxDays < restShortMaxDays) throw new Error('restNormalMaxDays cannot be less than restShortMaxDays');
  return Object.freeze({ maxRows, recentRows, similarDistanceToleranceM, restShortMaxDays, restNormalMaxDays });
}

function dateBoundaryMs(date, endOfDay) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const suffix = endOfDay ? '23:59:59.999' : '00:00:00.000';
  const ms = Date.parse(`${date}T${suffix}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function raceEventMs(row, { target = false } = {}) {
  const scheduled = Date.parse(String(row?.scheduled_start_at ?? ''));
  if (Number.isFinite(scheduled)) return scheduled;
  return dateBoundaryMs(row?.race_date, !target);
}

function targetCutoffMs(row, requestedAsOfMs) {
  const eventMs = raceEventMs(row, { target: true });
  return eventMs == null ? requestedAsOfMs : Math.min(eventMs, requestedAsOfMs);
}

function sourceObservedMs(row) {
  const ms = Date.parse(String(row?.result_observed_at ?? ''));
  return Number.isFinite(ms) ? ms : null;
}

function stableRowKey(row) { return `${row.race_id}|${row.race_entry_id}`; }
function compareHistoryDesc(a, b) {
  const delta = b.eventMs - a.eventMs;
  return delta || stableRowKey(a).localeCompare(stableRowKey(b));
}
function compareHistoryAsc(a, b) {
  const delta = a.eventMs - b.eventMs;
  return delta || stableRowKey(a).localeCompare(stableRowKey(b));
}

function addReason(row, reason) {
  if (!row.inclusionReasons.includes(reason)) row.inclusionReasons.push(reason);
}
function sortReasons(row) {
  row.inclusionReasons.sort((a, b) => RELEVANT_HISTORY_REASON_ORDER.indexOf(a) - RELEVANT_HISTORY_REASON_ORDER.indexOf(b));
}

function normalizedEquipment(row) {
  if (!row || String(row.verification_status || '').toLowerCase() === 'unknown') return null;
  return {
    shoesFront: row.shoes_front ?? null,
    shoesRear: row.shoes_rear ?? null,
    barefootFront: row.barefoot_front == null ? null : Number(row.barefoot_front) === 1,
    barefootRear: row.barefoot_rear == null ? null : Number(row.barefoot_rear) === 1,
    sulkyType: row.sulky_type ?? null,
    exactSulky: row.exact_sulky ?? null,
    verificationStatus: row.verification_status || null,
    observedAt: row.fetched_at || null,
    sourceRecordId: row.source_record_id || null
  };
}

function equipmentMatch(target, historical) {
  if (!target || !historical) return false;
  const fields = ['shoesFront', 'shoesRear', 'barefootFront', 'barefootRear', 'sulkyType', 'exactSulky'];
  const known = fields.filter((field) => target[field] != null);
  return known.length > 0 && known.every((field) => historical[field] != null && historical[field] === target[field]);
}

function normalizedXlabs(row) {
  if (!row || row.quality_status !== XLABS_TELEMETRY_VERSION) return null;
  return {
    first200Time: row.first_200_time || null,
    last200Time: row.last_200_time || null,
    last400Time: row.last_400_time || null,
    last500Time: row.last_500_time || null,
    last800Time: row.last_800_time || null,
    last1000Time: row.last_1000_time || null,
    actualDistanceM: row.actual_distance_m == null ? null : Number(row.actual_distance_m),
    extraDistanceM: row.extra_distance_m == null ? null : Number(row.extra_distance_m),
    convertedKmTime: row.converted_km_time || null,
    qualityStatus: row.quality_status,
    observedAt: row.fetched_at || null,
    sourceRecordId: row.source_record_id || null
  };
}

function normalizedProposition(row) {
  if (!row) return null;
  let facts;
  try { facts = JSON.parse(row.facts_json); } catch { return null; }
  return {
    parserVersion: row.parser_version,
    parseStatus: row.parse_status,
    observedAt: row.observed_at,
    sourceRecordId: row.source_record_id,
    sourceObservationId: row.source_observation_id,
    facts
  };
}

function propositionSignature(value) {
  if (!value || value.parseStatus !== 'parsed' || !value.facts || typeof value.facts !== 'object') return null;
  const facts = Object.fromEntries(Object.entries(value.facts).filter(([, item]) => item != null));
  return Object.keys(facts).length ? stableFeatureJson(facts) : null;
}

function latestObservedAtOrBefore(rows, cutoffMs, normalizer, timeKey = 'fetched_at') {
  for (const row of rows || []) {
    const observed = Date.parse(String(row?.[timeKey] ?? ''));
    if (!Number.isFinite(observed) || observed > cutoffMs) continue;
    const normalized = normalizer(row);
    if (normalized) return normalized;
  }
  return null;
}

function restBucket(days, policy) {
  if (days == null || !Number.isFinite(days) || days < 0) return null;
  if (days <= policy.restShortMaxDays) return 'short';
  if (days <= policy.restNormalMaxDays) return 'normal';
  return 'long';
}
function differenceDays(laterMs, earlierMs) {
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs) || laterMs < earlierMs) return null;
  return (laterMs - earlierMs) / 86400000;
}

async function loadTargetEntries(env, entryIds) {
  const rows = [];
  for (const group of chunks(entryIds)) {
    const { results } = await env.DB.prepare(`
      SELECT re.id AS race_entry_id, re.race_id, re.horse_id, re.driver_id, re.trainer_id,
             re.start_number, re.actual_lane, re.start_tier, re.handicap_m, re.actual_start_distance_m, re.scratched,
             r.race_date, r.race_number, r.scheduled_start_at, r.distance_m, r.start_method, r.first_prize_sek,
             r.race_name, r.track_id, t.canonical_name AS track_name
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      LEFT JOIN tracks t ON t.id = r.track_id
      WHERE re.id IN (${placeholders(group)})
    `).bind(...group).all();
    rows.push(...results);
  }
  const byId = new Map(rows.map((row) => [row.race_entry_id, row]));
  const missing = entryIds.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`target race entries were not found: ${missing.join(', ')}`);
  return entryIds.map((id) => byId.get(id));
}

async function loadHistory(env, horseIds) {
  const rows = [];
  for (const group of chunks(horseIds)) {
    const { results } = await env.DB.prepare(`
      SELECT re.horse_id, re.id AS race_entry_id, re.race_id, re.driver_id, re.trainer_id,
             re.start_number, re.actual_lane, re.start_tier, re.handicap_m, re.actual_start_distance_m,
             r.race_date, r.race_number, r.scheduled_start_at, r.distance_m, r.start_method, r.first_prize_sek,
             r.race_name, r.track_id, t.canonical_name AS track_name,
             d.canonical_name AS driver_name, tr.canonical_name AS trainer_name,
             rr.placing, rr.placing_text, rr.finish_time, rr.km_time, rr.prize_sek, rr.gallop, rr.disqualified,
             rr.source_record_id AS result_source_record_id, sr.fetched_at AS result_observed_at
      FROM race_entries re
      JOIN races r ON r.id = re.race_id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN source_records sr ON sr.id = rr.source_record_id
      LEFT JOIN tracks t ON t.id = r.track_id
      LEFT JOIN drivers d ON d.id = re.driver_id
      LEFT JOIN trainers tr ON tr.id = re.trainer_id
      WHERE re.horse_id IN (${placeholders(group)})
        AND re.scratched = 0
        AND rr.result_status = 'official'
      ORDER BY re.horse_id, r.race_date, r.race_number, re.id
    `).bind(...group).all();
    rows.push(...results);
  }
  return rows;
}

async function loadEquipmentRows(env, entryIds) {
  const out = new Map(entryIds.map((id) => [id, []]));
  for (const group of chunks(entryIds)) {
    const { results } = await env.DB.prepare(`
      SELECT e.*, sr.fetched_at
      FROM equipment e
      JOIN source_records sr ON sr.id = e.source_record_id
      WHERE e.race_entry_id IN (${placeholders(group)})
      ORDER BY e.race_entry_id, julianday(sr.fetched_at) DESC, e.id DESC
    `).bind(...group).all();
    for (const row of results) out.get(row.race_entry_id)?.push(row);
  }
  return out;
}

async function loadXlabsRows(env, entryIds) {
  const out = new Map(entryIds.map((id) => [id, []]));
  for (const group of chunks(entryIds)) {
    const { results } = await env.DB.prepare(`
      SELECT x.*, sr.fetched_at
      FROM xlabs_data x
      JOIN source_records sr ON sr.id = x.source_record_id
      WHERE x.race_entry_id IN (${placeholders(group)})
      ORDER BY x.race_entry_id, julianday(sr.fetched_at) DESC, x.id DESC
    `).bind(...group).all();
    for (const row of results) out.get(row.race_entry_id)?.push(row);
  }
  return out;
}

async function loadPropositionRows(env, raceIds) {
  const out = new Map(raceIds.map((id) => [id, []]));
  for (const group of chunks(raceIds)) {
    const { results } = await env.DB.prepare(`
      SELECT rpf.*
      FROM race_proposition_facts rpf
      WHERE rpf.race_id IN (${placeholders(group)}) AND rpf.parser_version = ?
      ORDER BY rpf.race_id, julianday(rpf.observed_at) DESC, rpf.id DESC
    `).bind(...group, RACE_PROPOSITION_PARSER_VERSION).all();
    for (const row of results) out.get(row.race_id)?.push(row);
  }
  return out;
}

async function loadOfficialReferences(env, targets, cutoffByEntry) {
  const groups = new Map();
  for (const target of targets) {
    const cutoff = cutoffByEntry.get(target.race_entry_id);
    const key = new Date(cutoff).toISOString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(target);
  }
  const byEntry = new Map();
  for (const [cutoff, group] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const horseIds = [...new Set(group.map((target) => target.horse_id).filter(Boolean))];
    const snapshots = await getOfficialHorseSnapshotsAsOf(env, horseIds, cutoff);
    for (const target of group) byEntry.set(target.race_entry_id, snapshots.get(target.horse_id) || null);
  }
  return byEntry;
}

function annotateReasons(rows, target, targetEquipment, targetProposition, targetCutoff, policy) {
  const ascending = [...rows].sort(compareHistoryAsc);
  let previousMs = null;
  for (const row of ascending) {
    row.restDaysBeforeStart = previousMs == null ? null : differenceDays(row.eventMs, previousMs);
    previousMs = row.eventMs;
  }
  const descending = [...rows].sort(compareHistoryDesc);
  const targetRestDays = descending.length ? differenceDays(targetCutoff, descending[0].eventMs) : null;
  const targetRestBucket = restBucket(targetRestDays, policy);
  const targetDistance = target.actual_start_distance_m ?? target.distance_m;
  const targetPropositionSignature = propositionSignature(targetProposition);

  for (const row of descending) {
    row.inclusionReasons = [];
    if (target.start_method && row.start_method && target.start_method === row.start_method) addReason(row, 'same_start_method');
    const historicalDistance = row.actual_start_distance_m ?? row.distance_m;
    if (targetDistance != null && historicalDistance != null && Math.abs(Number(targetDistance) - Number(historicalDistance)) <= policy.similarDistanceToleranceM) addReason(row, 'similar_distance');
    if (target.track_id && row.track_id && target.track_id === row.track_id) addReason(row, 'same_track_context');
    const historicalSignature = propositionSignature(row.proposition);
    if (targetPropositionSignature && historicalSignature && targetPropositionSignature === historicalSignature) addReason(row, 'similar_proposition');
    if (equipmentMatch(targetEquipment, row.equipment)) addReason(row, 'same_equipment');
    if (target.driver_id && row.driver_id && target.driver_id === row.driver_id) addReason(row, 'same_driver');
    if (row.xlabs) addReason(row, 'xlabs_representative');
    if (targetRestBucket && restBucket(row.restDaysBeforeStart, policy) === targetRestBucket) addReason(row, 'rest_comparable');
    if (Number(row.gallop) === 1 || Number(row.disqualified) === 1) addReason(row, 'error_pattern');
  }
  for (const row of descending.slice(0, policy.recentRows)) addReason(row, 'recent');
  return { targetRestDays, targetRestBucket };
}

function selectionCandidateCompare(a, b) {
  const reasonDelta = b.inclusionReasons.length - a.inclusionReasons.length;
  return reasonDelta || compareHistoryDesc(a, b);
}

function selectRelevant(rows, policy) {
  const ordered = [...rows].sort(compareHistoryDesc);
  const selected = new Map();
  for (const row of ordered.filter((candidate) => candidate.inclusionReasons.includes('recent'))) {
    if (selected.size >= policy.maxRows) break;
    selected.set(row.race_entry_id, row);
  }
  for (const reason of RELEVANT_HISTORY_REASON_ORDER.slice(1)) {
    if (selected.size >= policy.maxRows) break;
    const candidate = ordered
      .filter((row) => row.inclusionReasons.includes(reason) && !selected.has(row.race_entry_id))
      .sort(selectionCandidateCompare)[0];
    if (candidate) selected.set(candidate.race_entry_id, candidate);
  }
  if (selected.size < policy.maxRows) {
    const remaining = ordered
      .filter((row) => row.inclusionReasons.length > 0 && !selected.has(row.race_entry_id))
      .sort(selectionCandidateCompare);
    for (const row of remaining) {
      if (selected.size >= policy.maxRows) break;
      selected.set(row.race_entry_id, row);
    }
  }
  const finalRows = [...selected.values()].sort(compareHistoryDesc);
  for (const row of finalRows) sortReasons(row);
  return finalRows;
}

function rate(numerator, denominator) { return denominator > 0 ? numerator / denominator : null; }
function aggregateHistory(rows) {
  const methodCounts = {};
  let wins = 0;
  let seconds = 0;
  let thirds = 0;
  let top3 = 0;
  let placingKnown = 0;
  let prizeKnownStarts = 0;
  let prizeSekSum = 0;
  let gallopKnownStarts = 0;
  let gallops = 0;
  let disqualificationKnownStarts = 0;
  let disqualified = 0;
  let kmTimeKnownStarts = 0;
  let xlabsStarts = 0;
  let equipmentKnownStarts = 0;
  for (const row of rows) {
    if (row.start_method) methodCounts[row.start_method] = (methodCounts[row.start_method] || 0) + 1;
    if (row.placing != null) {
      const place = Number(row.placing);
      placingKnown += 1;
      if (place === 1) wins += 1;
      if (place === 2) seconds += 1;
      if (place === 3) thirds += 1;
      if (place >= 1 && place <= 3) top3 += 1;
    }
    if (row.prize_sek != null) { prizeKnownStarts += 1; prizeSekSum += Number(row.prize_sek); }
    if (row.gallop != null) { gallopKnownStarts += 1; if (Number(row.gallop) === 1) gallops += 1; }
    if (row.disqualified != null) { disqualificationKnownStarts += 1; if (Number(row.disqualified) === 1) disqualified += 1; }
    if (row.km_time) kmTimeKnownStarts += 1;
    if (row.xlabs) xlabsStarts += 1;
    if (row.equipment) equipmentKnownStarts += 1;
  }
  const chronological = [...rows].sort(compareHistoryAsc);
  return {
    starts: rows.length,
    wins,
    seconds,
    thirds,
    top3,
    placingKnown,
    winRate: rate(wins, placingKnown),
    top3Rate: rate(top3, placingKnown),
    prizeKnownStarts,
    prizeSekSum: prizeKnownStarts ? prizeSekSum : null,
    gallopKnownStarts,
    gallops,
    gallopRate: rate(gallops, gallopKnownStarts),
    disqualificationKnownStarts,
    disqualified,
    disqualificationRate: rate(disqualified, disqualificationKnownStarts),
    kmTimeKnownStarts,
    xlabsStarts,
    equipmentKnownStarts,
    startMethodCounts: Object.fromEntries(Object.entries(methodCounts).sort(([a], [b]) => a.localeCompare(b))),
    firstStartAt: chronological.length ? new Date(chronological[0].eventMs).toISOString() : null,
    latestStartAt: chronological.length ? new Date(chronological.at(-1).eventMs).toISOString() : null
  };
}

function outputResult(row) {
  return {
    placing: row.placing == null ? null : Number(row.placing),
    placingText: row.placing_text || null,
    finishTime: row.finish_time || null,
    kmTime: row.km_time || null,
    prizeSek: row.prize_sek == null ? null : Number(row.prize_sek),
    gallop: row.gallop == null ? null : Number(row.gallop) === 1,
    disqualified: row.disqualified == null ? null : Number(row.disqualified) === 1,
    sourceRecordId: row.result_source_record_id || null,
    observedAt: row.result_observed_at || null
  };
}

function outputHistoryRow(row) {
  return {
    raceEntryId: row.race_entry_id,
    raceId: row.race_id,
    raceDate: row.race_date,
    scheduledStartAt: row.scheduled_start_at || null,
    trackId: row.track_id || null,
    trackName: row.track_name || null,
    distanceM: row.distance_m == null ? null : Number(row.distance_m),
    startMethod: row.start_method || null,
    firstPrizeSek: row.first_prize_sek == null ? null : Number(row.first_prize_sek),
    raceName: row.race_name || null,
    startNumber: row.start_number == null ? null : Number(row.start_number),
    actualLane: row.actual_lane == null ? null : Number(row.actual_lane),
    startTier: row.start_tier == null ? null : Number(row.start_tier),
    handicapM: row.handicap_m == null ? null : Number(row.handicap_m),
    actualStartDistanceM: row.actual_start_distance_m == null ? null : Number(row.actual_start_distance_m),
    driverId: row.driver_id || null,
    driverName: row.driver_name || null,
    trainerId: row.trainer_id || null,
    trainerName: row.trainer_name || null,
    restDaysBeforeStart: row.restDaysBeforeStart,
    result: outputResult(row),
    equipment: row.equipment || null,
    xlabs: row.xlabs || null,
    proposition: row.proposition || null,
    inclusionReasons: [...row.inclusionReasons]
  };
}

function officialReference(snapshot) {
  const coverage = snapshot?.coverage;
  if (!coverage) return null;
  return {
    officialLifeStarts: coverage.officialLifeStarts,
    ownKnownStarts: coverage.ownKnownStarts,
    gap: coverage.gap,
    ratio: coverage.ratio,
    status: coverage.status,
    snapshotObservedAt: snapshot?.officialStatistics?.life?.observedAt || null
  };
}

export async function buildRelevantHistoryForEntries(env, raceEntryIds, asOf, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (!Array.isArray(raceEntryIds)) throw new Error('raceEntryIds must be an array');
  const entryIds = [...new Set(raceEntryIds.filter(Boolean).map(String))];
  if (!entryIds.length) return new Map();
  const requestedAsOf = requireInstant(asOf);
  const policy = normalizePolicy(options);
  const targets = await loadTargetEntries(env, entryIds);
  const cutoffByEntry = new Map(targets.map((target) => [target.race_entry_id, targetCutoffMs(target, requestedAsOf.ms)]));
  const horseIds = [...new Set(targets.map((target) => target.horse_id).filter(Boolean))];
  const historyRows = await loadHistory(env, horseIds);
  const historiesByHorse = new Map(horseIds.map((id) => [id, []]));
  for (const row of historyRows) historiesByHorse.get(row.horse_id)?.push(row);

  const allEntryIds = [...new Set([...entryIds, ...historyRows.map((row) => row.race_entry_id)])];
  const allRaceIds = [...new Set([...targets.map((row) => row.race_id), ...historyRows.map((row) => row.race_id)])];
  const [equipmentRows, xlabsRows, propositionRows, officialReferences] = await Promise.all([
    loadEquipmentRows(env, allEntryIds),
    loadXlabsRows(env, allEntryIds),
    loadPropositionRows(env, allRaceIds),
    loadOfficialReferences(env, targets, cutoffByEntry)
  ]);

  const out = new Map();
  for (const target of targets) {
    const cutoff = cutoffByEntry.get(target.race_entry_id);
    const targetEquipment = latestObservedAtOrBefore(equipmentRows.get(target.race_entry_id), cutoff, normalizedEquipment);
    const targetProposition = latestObservedAtOrBefore(propositionRows.get(target.race_id), cutoff, normalizedProposition, 'observed_at');
    const safe = (historiesByHorse.get(target.horse_id) || [])
      .filter((row) => row.race_entry_id !== target.race_entry_id && row.race_id !== target.race_id)
      .map((row) => ({ ...row, eventMs: raceEventMs(row), inclusionReasons: [] }))
      .filter((row) => Number.isFinite(row.eventMs) && row.eventMs < cutoff)
      .filter((row) => sourceObservedMs(row) != null && sourceObservedMs(row) <= cutoff)
      .sort(compareHistoryDesc);

    for (const row of safe) {
      row.equipment = latestObservedAtOrBefore(equipmentRows.get(row.race_entry_id), cutoff, normalizedEquipment);
      row.xlabs = latestObservedAtOrBefore(xlabsRows.get(row.race_entry_id), cutoff, normalizedXlabs);
      row.proposition = latestObservedAtOrBefore(propositionRows.get(row.race_id), cutoff, normalizedProposition, 'observed_at');
    }

    const rest = annotateReasons(safe, target, targetEquipment, targetProposition, cutoff, policy);
    const relevant = selectRelevant(safe, policy);
    const included = relevant.length;
    out.set(target.race_entry_id, {
      contractVersion: RELEVANT_HISTORY_CONTRACT_VERSION,
      selectionVersion: RELEVANT_HISTORY_SELECTION_VERSION,
      asOf: requestedAsOf.iso,
      targetCutoff: new Date(cutoff).toISOString(),
      policy,
      target: {
        raceEntryId: target.race_entry_id,
        horseId: target.horse_id,
        raceId: target.race_id,
        raceDate: target.race_date,
        scheduledStartAt: target.scheduled_start_at || null,
        trackId: target.track_id || null,
        distanceM: target.distance_m == null ? null : Number(target.distance_m),
        actualStartDistanceM: target.actual_start_distance_m == null ? null : Number(target.actual_start_distance_m),
        startMethod: target.start_method || null,
        driverId: target.driver_id || null,
        trainerId: target.trainer_id || null,
        equipment: targetEquipment,
        proposition: targetProposition,
        restDaysBeforeStart: rest.targetRestDays,
        restBucket: rest.targetRestBucket
      },
      counts: { totalSafe: safe.length, included, omitted: safe.length - included },
      fullHistoryAggregates: aggregateHistory(safe),
      officialHistoryReference: officialReference(officialReferences.get(target.race_entry_id) || null),
      relevantHistoryUnion: relevant.map(outputHistoryRow)
    });
  }
  return out;
}


export async function getReplayHistoryStateRefsV1(env, raceEntryIds, asOf) {
  if (!env?.DB) throw new Error('DB is not configured');
  if (!Array.isArray(raceEntryIds)) throw new Error('raceEntryIds must be an array');
  const entryIds = [...new Set(raceEntryIds.filter(Boolean).map(String))];
  if (!entryIds.length) return new Map();
  const requestedAsOf = requireInstant(asOf);
  const targets = await loadTargetEntries(env, entryIds);
  const cutoffByEntry = new Map(targets.map((target) => [target.race_entry_id, targetCutoffMs(target, requestedAsOf.ms)]));
  const horseIds = [...new Set(targets.map((target) => target.horse_id).filter(Boolean))];
  const historyRows = await loadHistory(env, horseIds);
  const historiesByHorse = new Map(horseIds.map((id) => [id, []]));
  for (const row of historyRows) historiesByHorse.get(row.horse_id)?.push(row);

  const out = new Map();
  for (const target of targets) {
    const cutoff = cutoffByEntry.get(target.race_entry_id);
    const rows = (historiesByHorse.get(target.horse_id) || [])
      .filter((row) => row.race_entry_id !== target.race_entry_id && row.race_id !== target.race_id)
      .map((row) => ({ ...row, eventMs: raceEventMs(row) }))
      .filter((row) => Number.isFinite(row.eventMs) && row.eventMs < cutoff)
      .filter((row) => sourceObservedMs(row) != null && sourceObservedMs(row) <= cutoff)
      .sort(compareHistoryDesc)
      .map((row) => ({
        race_id: String(row.race_id),
        race_entry_id: String(row.race_entry_id),
        result_source_record_id: row.result_source_record_id || null,
        result_observed_at: row.result_observed_at || null
      }));
    out.set(target.race_entry_id, {
      forecast_as_of: new Date(cutoff).toISOString(),
      rows
    });
  }
  return out;
}
