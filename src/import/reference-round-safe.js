import { stableId } from '../ids.js';
import { startImportRun, finishImportRun } from './common.js';
import {
  importReferenceRound as importReferenceRoundBase,
  summarizeReferenceRound as summarizeReferenceRoundBase
} from './reference-round.js';

const SUPPORTED_EXPORT = 'kentaurai-reference-v1';
const SUPPORTED_GAMES = new Set(['V85', 'V86']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function key(leg, startNumber) {
  return `${Number(leg)}:${Number(startNumber)}`;
}

function validateSystem(system, label, entriesByLeg) {
  object(system, label);
  const legs = array(system.legs, `${label}.legs`);
  const spikes = array(system.spikes, `${label}.spikes`);
  if (legs.length !== 8) throw new Error(`${label}.legs must contain eight legs`);
  if (spikes.length !== 3) throw new Error(`${label} must contain exactly three spikes`);

  const selectionsByLeg = new Map();
  const seenLegs = new Set();
  let expectedRows = 1;

  for (const [index, legData] of legs.entries()) {
    object(legData, `${label}.legs[${index}]`);
    const leg = Number(legData.leg);
    if (!Number.isInteger(leg) || leg < 1 || leg > 8) {
      throw new Error(`${label} has invalid leg ${legData.leg}`);
    }
    if (seenLegs.has(leg)) throw new Error(`${label} contains duplicate leg ${leg}`);
    seenLegs.add(leg);

    const selected = array(legData.selected_horses, `${label}.legs[${index}].selected_horses`);
    if (selected.length === 0) throw new Error(`${label} leg ${leg} has no selections`);

    const selectedNumbers = new Set();
    for (const horse of selected) {
      object(horse, `${label} leg ${leg} selection`);
      const startNumber = Number(horse.start_number);
      if (!Number.isInteger(startNumber) || !entriesByLeg.get(leg)?.has(startNumber)) {
        throw new Error(`${label} selection ${key(leg, horse.start_number)} does not exist in the round`);
      }
      if (selectedNumbers.has(startNumber)) {
        throw new Error(`${label} leg ${leg} contains duplicate selection ${startNumber}`);
      }
      selectedNumbers.add(startNumber);
    }
    selectionsByLeg.set(leg, selectedNumbers);
    expectedRows *= selectedNumbers.size;
  }

  for (let leg = 1; leg <= 8; leg += 1) {
    if (!seenLegs.has(leg)) throw new Error(`${label} is missing leg ${leg}`);
  }

  const spikeLegs = new Set();
  for (const [index, spike] of spikes.entries()) {
    object(spike, `${label}.spikes[${index}]`);
    const leg = Number(spike.leg);
    const startNumber = Number(spike.start_number);
    if (!Number.isInteger(leg) || leg < 1 || leg > 8 || !entriesByLeg.get(leg)?.has(startNumber)) {
      throw new Error(`${label} spike ${key(spike.leg, spike.start_number)} does not exist in the round`);
    }
    if (spikeLegs.has(leg)) throw new Error(`${label} spikes must be in three different legs`);
    spikeLegs.add(leg);

    const selected = selectionsByLeg.get(leg);
    if (!selected?.has(startNumber)) {
      throw new Error(`${label} spike ${key(leg, startNumber)} is not selected in that leg`);
    }
    if (selected.size !== 1) {
      throw new Error(`${label} spike leg ${leg} must contain exactly one selected horse`);
    }
  }

  const rows = Number(system.rows);
  if (!Number.isInteger(rows) || rows < 1) throw new Error(`${label}.rows must be a positive integer`);
  if (rows !== expectedRows) {
    throw new Error(`${label}.rows is ${rows}, expected ${expectedRows} from the selections`);
  }
}

export function validateReferenceRound(payload) {
  object(payload, 'payload');
  if (payload.export_version !== SUPPORTED_EXPORT) {
    throw new Error(`unsupported export_version: ${payload.export_version}`);
  }

  const round = object(payload.round, 'round');
  const gameType = text(round.game_type, 'round.game_type').toUpperCase();
  if (!SUPPORTED_GAMES.has(gameType)) throw new Error('round.game_type must be V85 or V86');
  text(round.date, 'round.date');
  text(round.track, 'round.track');
  text(round.captured_at, 'round.captured_at');

  const races = array(payload.races, 'races');
  if (races.length !== 8) throw new Error('reference round must contain eight legs');

  const entriesByLeg = new Map();
  const scratchedByKey = new Map();
  const raceLegs = new Set();

  for (const [raceIndex, wrapper] of races.entries()) {
    object(wrapper, `races[${raceIndex}]`);
    const leg = Number(wrapper.leg);
    if (!Number.isInteger(leg) || leg < 1 || leg > 8) throw new Error(`invalid leg: ${wrapper.leg}`);
    if (raceLegs.has(leg)) throw new Error(`duplicate leg: ${leg}`);
    raceLegs.add(leg);

    const race = object(wrapper.race, `races[${raceIndex}].race`);
    text(race.track, `races[${raceIndex}].race.track`);
    text(race.date, `races[${raceIndex}].race.date`);

    const numbers = new Set();
    for (const [entryIndex, entry] of array(wrapper.entries, `races[${raceIndex}].entries`).entries()) {
      object(entry, `races[${raceIndex}].entries[${entryIndex}]`);
      const startNumber = Number(entry.start_number);
      if (!Number.isInteger(startNumber) || startNumber < 1) throw new Error(`invalid start_number in leg ${leg}`);
      if (numbers.has(startNumber)) throw new Error(`duplicate start_number ${startNumber} in leg ${leg}`);
      numbers.add(startNumber);
      text(object(entry.horse, 'horse').name, `leg ${leg} horse.name`);
      scratchedByKey.set(key(leg, startNumber), Boolean(entry.scratched));
    }
    entriesByLeg.set(leg, numbers);
  }

  for (let leg = 1; leg <= 8; leg += 1) {
    if (!raceLegs.has(leg)) throw new Error(`reference round is missing leg ${leg}`);
  }

  const analysis = object(payload.analysis_snapshot, 'analysis_snapshot');
  const analysisLegs = array(analysis.legs, 'analysis_snapshot.legs');
  if (analysisLegs.length !== 8) throw new Error('analysis_snapshot must contain eight legs');
  const seenAnalysisLegs = new Set();

  for (const legAnalysis of analysisLegs) {
    const leg = Number(legAnalysis.leg);
    if (!entriesByLeg.has(leg)) throw new Error(`analysis references invalid leg ${legAnalysis.leg}`);
    if (seenAnalysisLegs.has(leg)) throw new Error(`analysis contains duplicate leg ${leg}`);
    seenAnalysisLegs.add(leg);

    const analysisNumbers = new Set();
    let sum = 0;
    for (const horse of array(legAnalysis.horses, `analysis leg ${leg} horses`)) {
      object(horse, `analysis leg ${leg} horse`);
      const startNumber = Number(horse.start_number);
      if (!Number.isInteger(startNumber) || !entriesByLeg.get(leg).has(startNumber)) {
        throw new Error(`analysis horse ${key(leg, horse.start_number)} does not exist in the round`);
      }
      if (analysisNumbers.has(startNumber)) throw new Error(`analysis leg ${leg} contains duplicate horse ${startNumber}`);
      analysisNumbers.add(startNumber);

      const probability = finite(horse.own_win_probability);
      const scratched = scratchedByKey.get(key(leg, startNumber));
      if (!scratched && probability == null) {
        throw new Error(`analysis horse ${key(leg, startNumber)} is missing win probability`);
      }
      if (probability != null && (probability < 0 || probability > 100)) {
        throw new Error(`analysis horse ${key(leg, startNumber)} has invalid win probability`);
      }
      if (probability != null) sum += probability;
    }

    if (analysisNumbers.size !== entriesByLeg.get(leg).size) {
      throw new Error(`analysis leg ${leg} must include every race entry`);
    }
    if (Math.abs(sum - 100) > 0.001) {
      throw new Error(`analysis probabilities for leg ${leg} sum to ${sum}, expected 100`);
    }
  }

  validateSystem(analysis.chosen_main_system, 'analysis_snapshot.chosen_main_system', entriesByLeg);
  for (const [index, system] of array(analysis.alternative_systems || [], 'analysis_snapshot.alternative_systems').entries()) {
    validateSystem(system, `analysis_snapshot.alternative_systems[${index}]`, entriesByLeg);
  }

  array(payload.sources || [], 'sources');
  array(payload.editorial_items || [], 'editorial_items');
  return payload;
}

export function summarizeReferenceRound(payload) {
  validateReferenceRound(payload);
  return summarizeReferenceRoundBase(payload);
}

async function sha256Hex(textValue) {
  const bytes = new TextEncoder().encode(textValue);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function importReferenceRound(env, payload) {
  validateReferenceRound(payload);
  const summary = summarizeReferenceRoundBase(payload);
  const capturedAt = payload.round.captured_at;
  const roundId = payload.round.round_id || stableId('round', payload.round.game_type, payload.round.date, payload.round.track);
  const referenceExportId = stableId('refexport', roundId, payload.export_version, capturedAt);

  const existing = await env.DB.prepare(`
    SELECT rre.id, rre.source_record_id, sr.raw_object_key, sr.content_hash
    FROM reference_round_exports rre
    JOIN source_records sr ON sr.id = rre.source_record_id
    WHERE rre.id = ?
    LIMIT 1
  `).bind(referenceExportId).first();

  if (existing) {
    const hash = await sha256Hex(JSON.stringify(payload));
    if (existing.content_hash && existing.content_hash !== hash) {
      throw new Error('reference export conflict: same round/version/timestamp has different content');
    }
    const run = await startImportRun(env, 'reference_round', { ...summary, reused: true });
    const counts = { inserted: 0, updated: 0, skipped: 1, errors: 0 };
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      referenceExportId,
      gameRoundId: roundId,
      rawObjectKey: existing.raw_object_key,
      counts,
      summary,
      reused: true
    };
  }

  const result = await importReferenceRoundBase(env, payload);
  return { ...result, reused: false };
}
