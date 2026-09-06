import { archiveRawPayload } from '../raw.js';
import { randomId, stableId } from '../ids.js';
import { startImportRun, finishImportRun } from './common.js';

const SUPPORTED_EXPORT = 'kentaurai-reference-v1';
const SUPPORTED_GAMES = new Set(['V85', 'V86']);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function finiteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function percentToProbability(value) { const n = finiteNumber(value); return n == null ? null : n / 100; }
function normalizeOrdinal(value) {
  const n = finiteNumber(value); if (n != null) return n;
  if (value == null) return null;
  const text = String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  if (text === 'hog' || text === 'high') return 0.9;
  if (text === 'medel-hog' || text === 'medium-high') return 0.75;
  if (text === 'medel' || text === 'medium') return 0.5;
  if (text === 'lag' || text === 'low') return 0.25;
  return null;
}
function jsonValue(value) { return value == null ? null : JSON.stringify(value); }
function hasMeaningful(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.some(hasMeaningful);
  if (typeof value === 'object') return Object.values(value).some(hasMeaningful);
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}
function entryKey(leg, startNumber) { return `${Number(leg)}:${Number(startNumber)}`; }

function validateSystem(system, label, raceEntriesByLeg) {
  requireObject(system, label);
  const spikes = requireArray(system.spikes, `${label}.spikes`);
  if (spikes.length !== 3) throw new Error(`${label} must contain exactly three spikes`);
  const legs = requireArray(system.legs, `${label}.legs`);
  if (legs.length !== 8) throw new Error(`${label}.legs must contain eight legs`);
  const spikeKeys = new Set();
  for (const [index, spike] of spikes.entries()) {
    requireObject(spike, `${label}.spikes[${index}]`);
    const key = entryKey(spike.leg, spike.start_number);
    if (spikeKeys.has(key)) throw new Error(`${label} contains duplicate spike ${key}`);
    spikeKeys.add(key);
    if (!raceEntriesByLeg.get(Number(spike.leg))?.has(Number(spike.start_number))) throw new Error(`${label} spike ${key} does not exist in the round`);
  }
  for (const leg of legs) {
    requireObject(leg, `${label}.legs[]`);
    const selected = requireArray(leg.selected_horses, `${label}.legs[].selected_horses`);
    if (selected.length === 0) throw new Error(`${label} leg ${leg.leg} has no selections`);
    for (const horse of selected) {
      if (!raceEntriesByLeg.get(Number(leg.leg))?.has(Number(horse.start_number))) throw new Error(`${label} selection ${entryKey(leg.leg, horse.start_number)} does not exist`);
    }
  }
}

export function validateReferenceRound(payload) {
  requireObject(payload, 'payload');
  if (payload.export_version !== SUPPORTED_EXPORT) throw new Error(`unsupported export_version: ${payload.export_version}`);
  const round = requireObject(payload.round, 'round');
  const gameType = requireText(round.game_type, 'round.game_type').toUpperCase();
  if (!SUPPORTED_GAMES.has(gameType)) throw new Error('round.game_type must be V85 or V86');
  requireText(round.date, 'round.date'); requireText(round.track, 'round.track'); requireText(round.captured_at, 'round.captured_at');
  const races = requireArray(payload.races, 'races');
  if (races.length !== 8) throw new Error('reference round must contain eight legs');
  const raceEntriesByLeg = new Map(); const seenLegs = new Set();
  for (const [raceIndex, wrapper] of races.entries()) {
    requireObject(wrapper, `races[${raceIndex}]`);
    const leg = Number(wrapper.leg);
    if (!Number.isInteger(leg) || leg < 1 || leg > 8) throw new Error(`invalid leg: ${wrapper.leg}`);
    if (seenLegs.has(leg)) throw new Error(`duplicate leg: ${leg}`); seenLegs.add(leg);
    const race = requireObject(wrapper.race, `races[${raceIndex}].race`);
    requireText(race.track, `races[${raceIndex}].race.track`); requireText(race.date, `races[${raceIndex}].race.date`);
    const entries = requireArray(wrapper.entries, `races[${raceIndex}].entries`); const numbers = new Set();
    for (const [entryIndex, entry] of entries.entries()) {
      requireObject(entry, `races[${raceIndex}].entries[${entryIndex}]`);
      const number = Number(entry.start_number);
      if (!Number.isInteger(number) || number < 1) throw new Error(`invalid start_number in leg ${leg}`);
      if (numbers.has(number)) throw new Error(`duplicate start_number ${number} in leg ${leg}`); numbers.add(number);
      requireText(requireObject(entry.horse, 'horse').name, `leg ${leg} horse.name`);
    }
    raceEntriesByLeg.set(leg, numbers);
  }
  const analysis = requireObject(payload.analysis_snapshot, 'analysis_snapshot');
  const analysisLegs = requireArray(analysis.legs, 'analysis_snapshot.legs');
  if (analysisLegs.length !== 8) throw new Error('analysis_snapshot must contain eight legs');
  for (const leg of analysisLegs) {
    const probabilities = requireArray(leg.horses, `analysis leg ${leg.leg} horses`).map((horse) => finiteNumber(horse.own_win_probability)).filter((value) => value != null);
    const sum = probabilities.reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 100) > 0.001) throw new Error(`analysis probabilities for leg ${leg.leg} sum to ${sum}, expected 100`);
  }
  validateSystem(analysis.chosen_main_system, 'analysis_snapshot.chosen_main_system', raceEntriesByLeg);
  for (const [index, system] of requireArray(analysis.alternative_systems || [], 'analysis_snapshot.alternative_systems').entries()) validateSystem(system, `analysis_snapshot.alternative_systems[${index}]`, raceEntriesByLeg);
  requireArray(payload.sources || [], 'sources'); requireArray(payload.editorial_items || [], 'editorial_items');
  return payload;
}

export function summarizeReferenceRound(payload) {
  validateReferenceRound(payload);
  const entries = payload.races.flatMap((race) => race.entries);
  return { exportVersion: payload.export_version, gameType: payload.round.game_type, roundId: payload.round.round_id || null, raceCount: payload.races.length, entryCount: entries.length, scratchedCount: entries.filter((entry) => entry.scratched).length, sourceCount: payload.sources.length, editorialItemCount: payload.editorial_items.length, recentStartCount: entries.reduce((sum, entry) => sum + (entry.recent_starts?.length || 0), 0), analysisLegCount: payload.analysis_snapshot.legs.length, systemCount: 1 + (payload.analysis_snapshot.alternative_systems?.length || 0) };
}

async function upsertTrack(env, name) {
  const id = stableId('track', name);
  await env.DB.prepare(`INSERT INTO tracks (id, canonical_name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET canonical_name = excluded.canonical_name, updated_at = CURRENT_TIMESTAMP`).bind(id, name).run();
  return id;
}
async function upsertPerson(env, table, externalTable, prefix, name, externalId) {
  if (!name) return null;
  const id = externalId != null ? stableId(prefix, 'official', externalId) : stableId(prefix, name);
  await env.DB.prepare(`INSERT INTO ${table} (id, canonical_name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET canonical_name = excluded.canonical_name, updated_at = CURRENT_TIMESTAMP`).bind(id, name).run();
  if (externalId != null) {
    const idColumn = `${prefix}_id`;
    await env.DB.prepare(`INSERT INTO ${externalTable} (${idColumn}, source_type, external_id) VALUES (?, 'official', ?) ON CONFLICT(source_type, external_id) DO UPDATE SET ${idColumn} = excluded.${idColumn}`).bind(id, String(externalId)).run();
  }
  return id;
}
async function upsertHorse(env, horse, trainerId, trackId) {
  const id = horse.external_id != null ? stableId('horse', 'official', horse.external_id) : stableId('horse', horse.name, horse.birth_year || 'unknown');
  await env.DB.prepare(`INSERT INTO horses (id, canonical_name, sex, birth_year, breed, sire_name, dam_name, damsire_name, current_trainer_id, home_track_id, country_code, career_earnings_sek, record_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET canonical_name = excluded.canonical_name, sex = COALESCE(excluded.sex, horses.sex), birth_year = COALESCE(excluded.birth_year, horses.birth_year), breed = COALESCE(excluded.breed, horses.breed), sire_name = COALESCE(excluded.sire_name, horses.sire_name), dam_name = COALESCE(excluded.dam_name, horses.dam_name), damsire_name = COALESCE(excluded.damsire_name, horses.damsire_name), current_trainer_id = COALESCE(excluded.current_trainer_id, horses.current_trainer_id), home_track_id = COALESCE(excluded.home_track_id, horses.home_track_id), country_code = COALESCE(excluded.country_code, horses.country_code), career_earnings_sek = COALESCE(excluded.career_earnings_sek, horses.career_earnings_sek), record_text = COALESCE(excluded.record_text, horses.record_text), updated_at = CURRENT_TIMESTAMP`).bind(id, horse.name, horse.sex ?? null, horse.birth_year ?? null, horse.breed ?? null, horse.sire ?? null, horse.dam ?? null, horse.damsire ?? null, trainerId, trackId, horse.country ?? null, horse.career_earnings_sek ?? null, horse.record ?? null).run();
  if (horse.external_id != null) await env.DB.prepare(`INSERT INTO horse_external_ids (horse_id, source_type, external_id) VALUES (?, 'official', ?) ON CONFLICT(source_type, external_id) DO UPDATE SET horse_id = excluded.horse_id`).bind(id, String(horse.external_id)).run();
  return id;
}
async function storeObservation(env, roundId, raceEntryId, type, observedAt, payload, sourceRefs = null, quality = 'reference_only') {
  const id = stableId('refobs', roundId, raceEntryId || 'round', type, observedAt || 'unknown-time', JSON.stringify(payload));
  await env.DB.prepare(`INSERT OR IGNORE INTO reference_observations (id, game_round_id, current_race_entry_id, observation_type, observed_at, payload_json, source_refs_json, quality_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, roundId, raceEntryId, type, observedAt, JSON.stringify(payload), sourceRefs ? JSON.stringify(sourceRefs) : null, quality).run();
}

export async function importReferenceRound(env, payload) {
  validateReferenceRound(payload);
  const summary = summarizeReferenceRound(payload);
  const run = await startImportRun(env, 'reference_round', summary);
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    const capturedAt = payload.round.captured_at;
    const externalRoundId = payload.round.round_id || stableId('roundext', payload.round.game_type, payload.round.date, payload.round.track);
    const raw = await archiveRawPayload(env, { sourceType: 'reference_round', externalId: `${externalRoundId}:${payload.export_version}`, fetchedAt: capturedAt, payload, qualityStatus: 'reference_export', rightsStatus: 'private_reference', metadata: { gameType: payload.round.game_type, roundDate: payload.round.date, sourceCount: payload.sources.length } });
    const roundTrackId = await upsertTrack(env, payload.round.track);
    const roundId = payload.round.round_id || stableId('round', payload.round.game_type, payload.round.date, payload.round.track);
    await env.DB.prepare(`INSERT INTO game_rounds (id, game_type, round_date, primary_track_id, scheduled_start_at, bet_stop_at, jackpot_sek, turnover_sek, currency, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reference') ON CONFLICT(id) DO UPDATE SET scheduled_start_at = COALESCE(excluded.scheduled_start_at, game_rounds.scheduled_start_at), bet_stop_at = COALESCE(excluded.bet_stop_at, game_rounds.bet_stop_at), jackpot_sek = COALESCE(excluded.jackpot_sek, game_rounds.jackpot_sek), turnover_sek = COALESCE(excluded.turnover_sek, game_rounds.turnover_sek), currency = COALESCE(excluded.currency, game_rounds.currency), updated_at = CURRENT_TIMESTAMP`).bind(roundId, payload.round.game_type, payload.round.date, roundTrackId, payload.round.scheduled_start ?? null, payload.round.bet_stop ?? null, payload.round.jackpot ?? null, payload.round.turnover ?? null, payload.round.currency || 'SEK').run();
    const entryByKey = new Map(); const raceByLeg = new Map();
    for (const wrapper of payload.races) {
      const leg = Number(wrapper.leg); const race = wrapper.race; const trackId = await upsertTrack(env, race.track);
      const raceId = race.race_id || stableId('race', race.track, race.date, race.race_number || leg); raceByLeg.set(leg, { raceId, wrapper });
      await env.DB.prepare(`INSERT INTO races (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, field_size, starters_declared, first_prize_sek, race_name, main_class, class_flags_json, status, source_quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reference', 'reference') ON CONFLICT(id) DO UPDATE SET scheduled_start_at = COALESCE(excluded.scheduled_start_at, races.scheduled_start_at), distance_m = COALESCE(excluded.distance_m, races.distance_m), start_method = COALESCE(excluded.start_method, races.start_method), field_size = COALESCE(excluded.field_size, races.field_size), starters_declared = COALESCE(excluded.starters_declared, races.starters_declared), first_prize_sek = COALESCE(excluded.first_prize_sek, races.first_prize_sek), race_name = COALESCE(excluded.race_name, races.race_name), main_class = COALESCE(excluded.main_class, races.main_class), class_flags_json = COALESCE(excluded.class_flags_json, races.class_flags_json), updated_at = CURRENT_TIMESTAMP`).bind(raceId, trackId, race.date, race.race_number ?? null, race.scheduled_start ?? null, race.distance_m ?? null, race.start_method ?? null, race.field_size ?? null, race.starters_declared ?? null, race.first_prize_sek ?? null, race.race_name ?? null, race.main_class ?? null, jsonValue(race.class_flags || [])).run();
      if (race.race_id) await env.DB.prepare(`INSERT INTO race_external_ids (race_id, source_type, external_id) VALUES (?, 'official', ?) ON CONFLICT(source_type, external_id) DO UPDATE SET race_id = excluded.race_id`).bind(raceId, String(race.race_id)).run();
      await env.DB.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?) ON CONFLICT(game_round_id, leg_number) DO UPDATE SET race_id = excluded.race_id`).bind(roundId, leg, raceId).run();
      const conditions = race.conditions || {};
      await env.DB.prepare(`INSERT INTO race_conditions (race_id, track_status, temperature_c, wind_mps, wind_direction, precipitation_mm, weather_text, source_record_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(race_id) DO UPDATE SET track_status = excluded.track_status, temperature_c = excluded.temperature_c, wind_mps = excluded.wind_mps, wind_direction = excluded.wind_direction, precipitation_mm = excluded.precipitation_mm, weather_text = excluded.weather_text, source_record_id = excluded.source_record_id, updated_at = CURRENT_TIMESTAMP`).bind(raceId, conditions.track_status ?? null, conditions.temperature_c ?? null, conditions.wind_mps ?? null, conditions.wind_direction ?? null, conditions.precipitation_mm ?? null, conditions.weather ?? null, raw.sourceRecordId).run();
      for (const entry of wrapper.entries) {
        const trainerId = await upsertPerson(env, 'trainers', 'trainer_external_ids', 'trainer', entry.trainer?.name || entry.horse?.trainer || null, entry.trainer?.external_id ?? null);
        const driverId = await upsertPerson(env, 'drivers', 'driver_external_ids', 'driver', entry.driver?.name || null, entry.driver?.external_id ?? null);
        const horseTrackId = entry.horse?.home_track ? await upsertTrack(env, entry.horse.home_track) : null;
        const horseId = await upsertHorse(env, entry.horse, trainerId, horseTrackId); const raceEntryId = stableId('entry', raceId, horseId);
        entryByKey.set(entryKey(leg, entry.start_number), { raceEntryId, horseId, raceId, entry, leg });
        const pos = entry.start_position || {};
        await env.DB.prepare(`INSERT INTO race_entries (id, race_id, horse_id, driver_id, trainer_id, start_number, actual_lane, start_tier, handicap_m, actual_start_distance_m, springspar, inner_lane, back_row, scratched, scratch_reason, data_quality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reference') ON CONFLICT(id) DO UPDATE SET driver_id = excluded.driver_id, trainer_id = excluded.trainer_id, start_number = excluded.start_number, actual_lane = excluded.actual_lane, start_tier = excluded.start_tier, handicap_m = excluded.handicap_m, actual_start_distance_m = excluded.actual_start_distance_m, springspar = excluded.springspar, inner_lane = excluded.inner_lane, back_row = excluded.back_row, scratched = excluded.scratched, scratch_reason = excluded.scratch_reason, updated_at = CURRENT_TIMESTAMP`).bind(raceEntryId, raceId, horseId, driverId, trainerId, entry.start_number, pos.actual_lane ?? null, pos.tier ?? null, pos.handicap_m ?? 0, pos.actual_start_distance_m ?? null, pos.springspar == null ? null : Number(Boolean(pos.springspar)), pos.inner_lane == null ? null : Number(Boolean(pos.inner_lane)), pos.back_row == null ? null : Number(Boolean(pos.back_row)), Number(Boolean(entry.scratched)), entry.scratch_reason ?? null).run();
        const equipment = entry.equipment_today || {};
        await env.DB.prepare(`INSERT INTO equipment (id, race_entry_id, shoes_front, shoes_rear, barefoot_front, barefoot_rear, sulky_type, headgear, earplugs, other_equipment, change_from_previous_json, verification_status, source_record_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(race_entry_id, source_record_id) DO UPDATE SET shoes_front = excluded.shoes_front, shoes_rear = excluded.shoes_rear, barefoot_front = excluded.barefoot_front, barefoot_rear = excluded.barefoot_rear, sulky_type = excluded.sulky_type, headgear = excluded.headgear, earplugs = excluded.earplugs, other_equipment = excluded.other_equipment, change_from_previous_json = excluded.change_from_previous_json, verification_status = excluded.verification_status`).bind(stableId('eq', raceEntryId, raw.sourceRecordId), raceEntryId, equipment.shoes_front ?? null, equipment.shoes_rear ?? null, equipment.barefoot_front == null ? null : Number(Boolean(equipment.barefoot_front)), equipment.barefoot_rear == null ? null : Number(Boolean(equipment.barefoot_rear)), equipment.sulky ?? null, equipment.headgear ?? null, equipment.earplugs ?? null, equipment.other ?? null, jsonValue(equipment.change_from_previous), equipment.verification_status || 'unknown', raw.sourceRecordId).run();
        const market = entry.market || {};
        for (const snapshot of market.betting_snapshots || []) {
          if (!snapshot.captured_at) { await storeObservation(env, roundId, raceEntryId, 'undated_betting_snapshot', null, snapshot, entry.source_refs || null, 'time_unknown'); continue; }
          await env.DB.prepare(`INSERT INTO betting_snapshots (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(game_round_id, leg_number, race_entry_id, captured_at) DO UPDATE SET bet_percent = excluded.bet_percent, market_rank = excluded.market_rank, source_record_id = excluded.source_record_id`).bind(stableId('bet', roundId, leg, raceEntryId, snapshot.captured_at), roundId, leg, raceEntryId, snapshot.captured_at, snapshot.percent ?? null, snapshot.rank ?? market.betting_rank ?? null, raw.sourceRecordId).run();
        }
        for (const snapshot of market.odds_snapshots || []) if (snapshot.captured_at) await env.DB.prepare(`INSERT INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds, source_record_id) VALUES (?, ?, ?, 'winner', ?, ?) ON CONFLICT(race_entry_id, captured_at, market_type) DO UPDATE SET odds = excluded.odds, source_record_id = excluded.source_record_id`).bind(stableId('odds', raceEntryId, 'winner', snapshot.captured_at), raceEntryId, snapshot.captured_at, snapshot.odds ?? null, raw.sourceRecordId).run();
        if (market.place_odds != null && market.place_odds_captured_at) await env.DB.prepare(`INSERT INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds, source_record_id) VALUES (?, ?, ?, 'place', ?, ?) ON CONFLICT(race_entry_id, captured_at, market_type) DO UPDATE SET odds = excluded.odds, source_record_id = excluded.source_record_id`).bind(stableId('odds', raceEntryId, 'place', market.place_odds_captured_at), raceEntryId, market.place_odds_captured_at, market.place_odds, raw.sourceRecordId).run();
        if (pos.post_win_percent_matched != null) await env.DB.prepare(`INSERT INTO analysis_features (id, race_entry_id, feature_version, as_of, feature_name, numeric_value, data_quality, provenance_json) VALUES (?, ?, 'reference-v1', ?, 'post_win_percent_matched', ?, 'reference', ?) ON CONFLICT(race_entry_id, feature_version, as_of, feature_name) DO UPDATE SET numeric_value = excluded.numeric_value, provenance_json = excluded.provenance_json`).bind(stableId('feat', raceEntryId, 'reference-v1', capturedAt, 'post-win-percent'), raceEntryId, capturedAt, pos.post_win_percent_matched, jsonValue({ source_refs: entry.source_refs || [] })).run();
        if (hasMeaningful(entry.historical_stats_used)) await env.DB.prepare(`INSERT INTO analysis_features (id, race_entry_id, feature_version, as_of, feature_name, text_value, data_quality, provenance_json) VALUES (?, ?, 'reference-v1', ?, 'historical_stats_used', ?, 'reference', ?) ON CONFLICT(race_entry_id, feature_version, as_of, feature_name) DO UPDATE SET text_value = excluded.text_value, provenance_json = excluded.provenance_json`).bind(stableId('feat', raceEntryId, 'reference-v1', capturedAt, 'historical-stats'), raceEntryId, capturedAt, JSON.stringify(entry.historical_stats_used), jsonValue({ source_refs: entry.source_refs || [] })).run();
        for (const [index, start] of (entry.recent_starts || []).entries()) await storeObservation(env, roundId, raceEntryId, 'reference_recent_start', start.date || null, { sequence: index, ...start }, start.source_refs || entry.source_refs || null, start.date ? 'partial_reference' : 'identity_incomplete');
        counts.inserted += 1;
      }
    }
    const sourceMap = new Map((payload.sources || []).map((source) => [source.source_id, source]));
    for (const [index, item] of (payload.editorial_items || []).entries()) {
      const hasStartNumber = item.start_number != null; const resolved = hasStartNumber ? entryByKey.get(entryKey(item.leg, item.start_number)) : null; const raceInfo = raceByLeg.get(Number(item.leg));
      if (hasStartNumber && !resolved) { counts.skipped += 1; continue; } if (!raceInfo) { counts.skipped += 1; continue; }
      const source = sourceMap.get(item.source_id) || {}; const editorialId = stableId('edi', roundId, item.leg, item.start_number ?? 'race', item.source_id || 'source', index);
      await env.DB.prepare(`INSERT OR IGNORE INTO editorial_items (id, race_entry_id, horse_id, race_id, game_round_id, speaker_name, speaker_role, published_at, source_name, source_url, summary_text, rights_status, source_record_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'structured_only', ?)`).bind(editorialId, resolved?.raceEntryId ?? null, resolved?.horseId ?? null, raceInfo.raceId, roundId, item.speaker ?? null, item.speaker_role ?? null, item.published_at ?? null, source.name || 'private_editorial_source', source.url || null, item.summary ?? null, raw.sourceRecordId).run();
      for (const [signalIndex, signal] of (item.signals || []).entries()) await env.DB.prepare(`INSERT OR IGNORE INTO editorial_signals (id, editorial_item_id, signal_type, value_text, polarity, strength, fact_or_opinion, confidence, evidence_excerpt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(stableId('sig', editorialId, signal.type || 'other', signalIndex), editorialId, signal.type || 'other', signal.value == null ? null : String(signal.value), signal.polarity ?? null, normalizeOrdinal(signal.strength), signal.fact_or_opinion || 'mixed', normalizeOrdinal(signal.confidence), signal.evidence_excerpt == null ? null : String(signal.evidence_excerpt).slice(0, 400)).run();
    }
    const analysis = payload.analysis_snapshot; const modelVersionId = stableId('model', 'reference', roundId, analysis.captured_at || capturedAt);
    await env.DB.prepare(`INSERT OR IGNORE INTO model_versions (id, created_at, feature_version, prompt_version, ai_provider, ai_model, config_json, notes) VALUES (?, ?, 'reference-v1', 'reference-export-v1', 'external_reference', NULL, ?, ?)`).bind(modelVersionId, analysis.captured_at || capturedAt, JSON.stringify({ imported: true, export_version: payload.export_version }), analysis.method_note || null).run();
    const predictionByKey = new Map();
    for (const legAnalysis of analysis.legs) {
      const leg = Number(legAnalysis.leg); const raceInfo = raceByLeg.get(leg); if (!raceInfo) continue; const analysisId = stableId('analysis', roundId, leg, analysis.captured_at || capturedAt, 'reference');
      await env.DB.prepare(`INSERT OR IGNORE INTO ai_race_analyses (id, race_id, model_version_id, data_snapshot_at, market_blind, scenarios_json, race_shape_summary, conclusion, data_quality, created_at, analysis_origin, method_note) VALUES (?, ?, ?, ?, 0, NULL, ?, 'Imported pre-race reference analysis', 'reference', ?, 'reference_import', ?)`).bind(analysisId, raceInfo.raceId, modelVersionId, analysis.captured_at || capturedAt, raceInfo.wrapper.race.race_picture_note || null, analysis.captured_at || capturedAt, analysis.method_note || null).run();
      for (const horsePrediction of legAnalysis.horses || []) {
        const resolved = entryByKey.get(entryKey(leg, horsePrediction.start_number)); if (!resolved) { counts.skipped += 1; continue; }
        const value = horsePrediction.value_assessment || {}; const probability = percentToProbability(horsePrediction.own_win_probability); predictionByKey.set(entryKey(leg, horsePrediction.start_number), probability);
        await env.DB.prepare(`INSERT OR IGNORE INTO ai_horse_predictions (id, ai_race_analysis_id, race_entry_id, win_probability, uncertainty_low, uncertainty_high, raw_rank, abcd_group, value_ratio, scenario_robustness, reasoning_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`).bind(stableId('pred', analysisId, resolved.raceEntryId), analysisId, resolved.raceEntryId, probability, percentToProbability(horsePrediction.uncertainty_low), percentToProbability(horsePrediction.uncertainty_high), horsePrediction.rank ?? null, horsePrediction.abcd ?? null, finiteNumber(value.value_ratio), JSON.stringify({ value_assessment: horsePrediction.value_assessment ?? null, spike_candidate: horsePrediction.spike_candidate ?? null, data_quality: horsePrediction.data_quality ?? null, scenario_notes: horsePrediction.scenario_notes ?? null, reasoning_summary: horsePrediction.reasoning_summary ?? null, scratched: horsePrediction.scratched ?? null })).run();
      }
    }
    const systems = [{ type: 'main', data: analysis.chosen_main_system }, ...(analysis.alternative_systems || []).map((data, index) => ({ type: `alternative_${index + 1}`, data }))];
    for (const { type, data } of systems) {
      const systemId = stableId('system', roundId, type, data.label || data.budget_sek, analysis.captured_at || capturedAt); const linePrice = data.rows ? finiteNumber(data.cost_sek ?? data.budget_sek) / Number(data.rows) : null;
      await env.DB.prepare(`INSERT OR IGNORE INTO systems (id, game_round_id, model_version_id, system_type, budget_sek, row_count, line_price_sek, spike_count, estimated_hit_probability, estimated_market_ownership, value_metric, risk_profile, created_at, metrics_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 3, ?, ?, ?, ?, ?, ?, ?)`).bind(systemId, roundId, modelVersionId, type, data.budget_sek, data.rows, Number.isFinite(linePrice) ? linePrice : null, percentToProbability(data.hit_probability_pct), percentToProbability(data.collective_ownership_pct), finiteNumber(data.probability_over_ownership), type === 'main' ? 'balanced_reference' : 'alternative_reference', analysis.captured_at || capturedAt, JSON.stringify({ label: data.label || null, cost_sek: data.cost_sek ?? null, hit_probability_pct: data.hit_probability_pct ?? null, collective_ownership_pct: data.collective_ownership_pct ?? null, probability_over_ownership: data.probability_over_ownership ?? null, ev_index: data.ev_index ?? null, legs: data.legs || [] }), data.note || null).run();
      const spikeKeys = new Set((data.spikes || []).map((spike) => entryKey(spike.leg, spike.start_number)));
      for (const legData of data.legs || []) for (const selection of legData.selected_horses || []) {
        const key = entryKey(legData.leg, selection.start_number); const resolved = entryByKey.get(key); if (!resolved) continue;
        await env.DB.prepare(`INSERT OR IGNORE INTO system_selections (system_id, leg_number, race_entry_id, is_spike, own_probability, market_percent, selection_reason) VALUES (?, ?, ?, ?, ?, ?, 'reference_import')`).bind(systemId, Number(legData.leg), resolved.raceEntryId, spikeKeys.has(key) ? 1 : 0, predictionByKey.get(key) ?? null, resolved.entry.market?.betting_percent ?? null).run();
      }
    }
    const referenceExportId = stableId('refexport', roundId, payload.export_version, capturedAt);
    await env.DB.prepare(`INSERT OR IGNORE INTO reference_round_exports (id, game_round_id, source_record_id, export_version, captured_at, source_count, race_count, entry_count, source_manifest_json, analysis_snapshot_json, known_gaps_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(referenceExportId, roundId, raw.sourceRecordId, payload.export_version, capturedAt, payload.sources.length, payload.races.length, summary.entryCount, JSON.stringify(payload.sources || []), JSON.stringify(payload.analysis_snapshot || {}), JSON.stringify(payload.analysis_snapshot?.other_data_used?.known_gaps || [])).run();
    counts.inserted += payload.editorial_items.length + analysis.legs.length + systems.length + 1;
    await finishImportRun(env, run.id, counts);
    return { importRunId: run.id, referenceExportId, gameRoundId: roundId, rawObjectKey: raw.objectKey, counts, summary };
  } catch (error) {
    counts.errors += 1; await finishImportRun(env, run.id, counts, error); throw error;
  }
}
