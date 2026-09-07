import { validateOfficialGamePayload } from '../import/official-live.js';

const SOURCE_TYPE = 'official_provider';
const EXTERNAL_SOURCE = 'official';
const NORMALIZED_QUALITY = 'normalized_verified_subset';
const CONFLICT_QUALITY = 'source_conflict';

function maybeText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scaledHundredths(value) {
  const raw = finiteNumber(value);
  return raw == null ? null : raw / 100;
}

function personName(person) {
  if (!person || typeof person !== 'object') return null;
  const full = [maybeText(person.firstName), maybeText(person.lastName)].filter(Boolean).join(' ');
  return full || maybeText(person.shortName);
}

function valuesEqual(expected, actual) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(expected - actual) < 1e-9;
  }
  return expected === actual;
}

function addCheck(checks, id, expected, actual) {
  checks.push({ id, pass: valuesEqual(expected, actual), expected, actual });
}

function parseFieldsJson(row) {
  if (!row?.fields_json) return null;
  try {
    const parsed = JSON.parse(row.fields_json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function addConflictAwareNameChecks(checks, prefix, expectedName, canonicalName, observation) {
  const fields = parseFieldsJson(observation);
  addCheck(checks, `${prefix}.source_name`, expectedName, maybeText(fields?.name));
  const hasConflict = fields?.nameConflict === true;
  if (hasConflict) {
    addCheck(checks, `${prefix}.conflict_status`, CONFLICT_QUALITY, observation?.quality_status ?? null);
    addCheck(checks, `${prefix}.canonical_preserved`, maybeText(fields?.priorCanonicalName), canonicalName);
  } else {
    addCheck(checks, `${prefix}.canonical_name`, expectedName, canonicalName);
    addCheck(checks, `${prefix}.observation_status`, NORMALIZED_QUALITY, observation?.quality_status ?? null);
  }
}

function expectedShoeState(shoes, end) {
  if (!shoes || shoes.reported !== true || typeof shoes?.[end]?.hasShoe !== 'boolean') return null;
  return shoes[end].hasShoe ? 'shod' : 'barefoot';
}

function expectedBarefoot(shoes, end) {
  if (!shoes || shoes.reported !== true || typeof shoes?.[end]?.hasShoe !== 'boolean') return null;
  return Number(!shoes[end].hasShoe);
}

function rawCounts(races, gameType) {
  let entries = 0;
  let betting = 0;
  let odds = 0;
  let equipment = 0;
  for (const race of races) {
    for (const start of race.starts) {
      entries += 1;
      if (finiteNumber(start.pools?.[gameType]?.betDistribution) != null) betting += 1;
      if (finiteNumber(start.pools?.vinnare?.odds) != null) odds += 1;
      if (finiteNumber(start.pools?.plats?.minOdds) != null) odds += 1;
      if (finiteNumber(start.pools?.plats?.maxOdds) != null) odds += 1;
      if ((start.horse?.shoes && typeof start.horse.shoes === 'object') || (start.horse?.sulky && typeof start.horse.sulky === 'object')) {
        equipment += 1;
      }
    }
  }
  return { entries, betting, odds, equipment };
}

function expectedObservationCounts(races) {
  const tracks = new Set();
  const horses = new Set();
  const drivers = new Set();
  const trainers = new Set();
  let entries = 0;
  for (const race of races) {
    tracks.add(String(race.track.id));
    for (const start of race.starts) {
      entries += 1;
      horses.add(String(start.horse.id));
      if (start.driver?.id != null && personName(start.driver)) drivers.add(String(start.driver.id));
      if (start.horse?.trainer?.id != null && personName(start.horse.trainer)) trainers.add(String(start.horse.trainer.id));
    }
  }
  return {
    game_round: 1,
    track: tracks.size,
    race: races.length,
    race_entry: entries,
    horse: horses.size,
    driver: drivers.size,
    trainer: trainers.size
  };
}

function findVoltSample(races) {
  for (const race of races) {
    if (race.startMethod !== 'volte') continue;
    for (const start of race.starts) {
      const raceDistance = finiteNumber(race.distance);
      const startDistance = finiteNumber(start.distance);
      if (raceDistance != null && startDistance != null && startDistance > raceDistance) {
        return { race, start };
      }
    }
  }
  return null;
}

async function getRepresentativeEntry(env, raceId, horseExternalId, sourceRecordId) {
  return env.DB.prepare(`
    SELECT
      re.id AS race_entry_id,
      re.start_number,
      re.actual_lane,
      re.start_tier,
      re.handicap_m,
      re.actual_start_distance_m,
      h.id AS horse_id,
      h.canonical_name AS horse_name,
      h.career_earnings_sek,
      hei.external_id AS horse_external_id,
      d.id AS driver_id,
      d.canonical_name AS driver_name,
      dei.external_id AS driver_external_id,
      tr.id AS trainer_id,
      tr.canonical_name AS trainer_name,
      tei.external_id AS trainer_external_id,
      e.shoes_front,
      e.shoes_rear,
      e.barefoot_front,
      e.barefoot_rear,
      e.sulky_type,
      e.exact_sulky,
      e.verification_status,
      bs.bet_percent,
      bs.market_rank,
      (SELECT os.odds FROM odds_snapshots os
       WHERE os.race_entry_id = re.id AND os.source_record_id = ? AND os.market_type = 'vinnare'
       LIMIT 1) AS winner_odds,
      (SELECT os.odds FROM odds_snapshots os
       WHERE os.race_entry_id = re.id AND os.source_record_id = ? AND os.market_type = 'plats_min'
       LIMIT 1) AS place_min_odds,
      (SELECT os.odds FROM odds_snapshots os
       WHERE os.race_entry_id = re.id AND os.source_record_id = ? AND os.market_type = 'plats_max'
       LIMIT 1) AS place_max_odds
    FROM race_entries re
    JOIN horses h ON h.id = re.horse_id
    JOIN horse_external_ids hei ON hei.horse_id = h.id AND hei.source_type = ?
    LEFT JOIN drivers d ON d.id = re.driver_id
    LEFT JOIN driver_external_ids dei ON dei.driver_id = d.id AND dei.source_type = ?
    LEFT JOIN trainers tr ON tr.id = re.trainer_id
    LEFT JOIN trainer_external_ids tei ON tei.trainer_id = tr.id AND tei.source_type = ?
    LEFT JOIN equipment e ON e.race_entry_id = re.id AND e.source_record_id = ?
    LEFT JOIN betting_snapshots bs ON bs.race_entry_id = re.id AND bs.source_record_id = ?
    WHERE re.race_id = ? AND hei.external_id = ?
    LIMIT 1
  `).bind(
    sourceRecordId,
    sourceRecordId,
    sourceRecordId,
    EXTERNAL_SOURCE,
    EXTERNAL_SOURCE,
    EXTERNAL_SOURCE,
    sourceRecordId,
    sourceRecordId,
    raceId,
    String(horseExternalId)
  ).first();
}

async function getRepresentativeObservations(env, sourceRecordId, race, entry) {
  const { results } = await env.DB.prepare(`
    SELECT entity_type, entity_id, fields_json, quality_status
    FROM normalized_observations
    WHERE source_record_id = ? AND (
      (entity_type = 'track' AND entity_id = ?) OR
      (entity_type = 'race' AND entity_id = ?) OR
      (entity_type = 'race_entry' AND entity_id = ?) OR
      (entity_type = 'horse' AND entity_id = ?) OR
      (entity_type = 'driver' AND entity_id = ?) OR
      (entity_type = 'trainer' AND entity_id = ?)
    )
  `).bind(
    sourceRecordId,
    race.track_id,
    race.id,
    entry.race_entry_id,
    entry.horse_id,
    entry.driver_id,
    entry.trainer_id
  ).all();
  return new Map(results.map((row) => [`${row.entity_type}:${row.entity_id}`, row]));
}

export async function verifyCapturedOfficialNormalization(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');

  const source = await env.DB.prepare(`
    SELECT id, source_type, external_id, fetched_at, raw_object_key, quality_status
    FROM source_records
    WHERE id = ? AND source_type = ?
    LIMIT 1
  `).bind(id, SOURCE_TYPE).first();
  if (!source?.raw_object_key) throw new Error('captured official source record was not found');

  const object = await env.RAW_BUCKET.get(source.raw_object_key);
  if (!object) throw new Error('captured raw object was not found');
  let payload;
  try {
    payload = JSON.parse(await object.text());
  } catch (error) {
    throw new Error(`captured raw object is not valid JSON: ${error.message}`);
  }

  const validated = validateOfficialGamePayload(payload);
  if (source.external_id !== `game:${validated.gameId}`) {
    throw new Error('source record does not match the official game payload');
  }

  const firstRace = validated.races[0];
  const firstStart = firstRace.starts[0];
  const voltSample = findVoltSample(validated.races);
  const countsExpected = rawCounts(validated.races, validated.gameType);
  const observationCountsExpected = expectedObservationCounts(validated.races);
  const rawTrackIds = new Set(validated.races.map((race) => String(race.track.id)));

  const round = await env.DB.prepare(`
    SELECT
      gr.id,
      gr.game_type,
      gr.round_date,
      gr.primary_track_id,
      gr.scheduled_start_at,
      gr.status,
      (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id = gr.id) AS leg_count
    FROM game_rounds gr
    WHERE gr.id = ?
    LIMIT 1
  `).bind(validated.gameId).first();
  if (!round) throw new Error('normalized game round was not found');

  const race = await env.DB.prepare(`
    SELECT
      r.id,
      r.track_id,
      r.race_date,
      r.race_number,
      r.scheduled_start_at,
      r.distance_m,
      r.start_method,
      r.race_name,
      r.status,
      t.canonical_name AS track_name,
      tx.external_id AS track_external_id
    FROM races r
    LEFT JOIN tracks t ON t.id = r.track_id
    LEFT JOIN track_external_ids tx ON tx.track_id = t.id AND tx.source_type = ?
    WHERE r.id = ?
    LIMIT 1
  `).bind(EXTERNAL_SOURCE, firstRace.id).first();
  if (!race) throw new Error('representative normalized race was not found');

  const entry = await getRepresentativeEntry(env, firstRace.id, firstStart.horse.id, id);
  if (!entry) throw new Error('representative normalized race entry was not found');

  const observations = await getRepresentativeObservations(env, id, race, entry);
  const trackObservation = observations.get(`track:${race.track_id}`) || null;
  const raceObservation = observations.get(`race:${race.id}`) || null;
  const entryObservation = observations.get(`race_entry:${entry.race_entry_id}`) || null;
  const horseObservation = observations.get(`horse:${entry.horse_id}`) || null;
  const driverObservation = entry.driver_id ? observations.get(`driver:${entry.driver_id}`) || null : null;
  const trainerObservation = entry.trainer_id ? observations.get(`trainer:${entry.trainer_id}`) || null : null;

  const voltEntry = voltSample
    ? await getRepresentativeEntry(env, voltSample.race.id, voltSample.start.horse.id, id)
    : null;

  const counts = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(DISTINCT re.id)
       FROM race_entries re
       JOIN game_legs gl ON gl.race_id = re.race_id
       WHERE gl.game_round_id = ?) AS entry_count,
      (SELECT COUNT(*) FROM betting_snapshots WHERE source_record_id = ?) AS betting_count,
      (SELECT COUNT(*) FROM odds_snapshots WHERE source_record_id = ?) AS odds_count,
      (SELECT COUNT(*) FROM equipment WHERE source_record_id = ?) AS equipment_count
  `).bind(validated.gameId, id, id, id).first();
  const { results: observationCountRows } = await env.DB.prepare(`
    SELECT entity_type, COUNT(*) AS n
    FROM normalized_observations
    WHERE source_record_id = ?
    GROUP BY entity_type
  `).bind(id).all();
  const observationCounts = Object.fromEntries(observationCountRows.map((row) => [row.entity_type, Number(row.n)]));

  const checks = [];
  addCheck(checks, 'source.quality_status', NORMALIZED_QUALITY, source.quality_status);
  addCheck(checks, 'round.id', validated.gameId, round.id);
  addCheck(checks, 'round.game_type', validated.gameType, round.game_type);
  addCheck(checks, 'round.round_date', validated.roundDate, round.round_date);
  addCheck(checks, 'round.status', validated.status, round.status);
  addCheck(checks, 'round.leg_count', 8, Number(round.leg_count));
  if (rawTrackIds.size > 1) addCheck(checks, 'round.primary_track_for_multitrack', null, round.primary_track_id);

  addCheck(checks, 'race.id', firstRace.id, race.id);
  addCheck(checks, 'race.distance_m', Number(firstRace.distance), Number(race.distance_m));
  addCheck(checks, 'race.start_method', firstRace.startMethod, race.start_method);
  addCheck(checks, 'race.track_external_id', String(firstRace.track.id), String(race.track_external_id));
  addConflictAwareNameChecks(checks, 'race.track_name', firstRace.track.name, race.track_name, trackObservation);
  const raceFields = parseFieldsJson(raceObservation);
  addCheck(checks, 'race.observation_status', NORMALIZED_QUALITY, raceObservation?.quality_status ?? null);
  addCheck(checks, 'race.source_distance_m', Number(firstRace.distance), finiteNumber(raceFields?.distanceM));
  addCheck(checks, 'race.source_start_method', firstRace.startMethod, maybeText(raceFields?.startMethod));

  addCheck(checks, 'entry.horse_external_id', String(firstStart.horse.id), String(entry.horse_external_id));
  addConflictAwareNameChecks(checks, 'entry.horse_name', firstStart.horse.name, entry.horse_name, horseObservation);
  addCheck(checks, 'entry.horse_money_sek', finiteNumber(firstStart.horse.money), finiteNumber(entry.career_earnings_sek));
  addCheck(checks, 'entry.driver_external_id', firstStart.driver?.id == null ? null : String(firstStart.driver.id), entry.driver_external_id == null ? null : String(entry.driver_external_id));
  if (firstStart.driver?.id != null && personName(firstStart.driver)) {
    addConflictAwareNameChecks(checks, 'entry.driver_name', personName(firstStart.driver), entry.driver_name, driverObservation);
  } else {
    addCheck(checks, 'entry.driver_name', null, entry.driver_name);
  }
  addCheck(checks, 'entry.trainer_external_id', firstStart.horse?.trainer?.id == null ? null : String(firstStart.horse.trainer.id), entry.trainer_external_id == null ? null : String(entry.trainer_external_id));
  if (firstStart.horse?.trainer?.id != null && personName(firstStart.horse.trainer)) {
    addConflictAwareNameChecks(checks, 'entry.trainer_name', personName(firstStart.horse.trainer), entry.trainer_name, trainerObservation);
  } else {
    addCheck(checks, 'entry.trainer_name', null, entry.trainer_name);
  }
  addCheck(checks, 'entry.start_number', Number(firstStart.number), Number(entry.start_number));
  addCheck(checks, 'entry.actual_lane', finiteNumber(firstStart.postPosition), finiteNumber(entry.actual_lane));
  addCheck(checks, 'entry.actual_start_distance_m', finiteNumber(firstStart.distance), finiteNumber(entry.actual_start_distance_m));
  const entryFields = parseFieldsJson(entryObservation);
  addCheck(checks, 'entry.observation_status', NORMALIZED_QUALITY, entryObservation?.quality_status ?? null);
  addCheck(checks, 'entry.source_start_id', firstStart.id, maybeText(entryFields?.externalStartId));
  addCheck(checks, 'entry.source_start_number', Number(firstStart.number), finiteNumber(entryFields?.startNumber));
  addCheck(checks, 'entry.bet_percent', scaledHundredths(firstStart.pools?.[validated.gameType]?.betDistribution), finiteNumber(entry.bet_percent));
  addCheck(checks, 'entry.winner_odds', scaledHundredths(firstStart.pools?.vinnare?.odds), finiteNumber(entry.winner_odds));
  addCheck(checks, 'entry.place_min_odds', scaledHundredths(firstStart.pools?.plats?.minOdds), finiteNumber(entry.place_min_odds));
  addCheck(checks, 'entry.place_max_odds', scaledHundredths(firstStart.pools?.plats?.maxOdds), finiteNumber(entry.place_max_odds));
  addCheck(checks, 'entry.shoes_front', expectedShoeState(firstStart.horse?.shoes, 'front'), entry.shoes_front);
  addCheck(checks, 'entry.shoes_rear', expectedShoeState(firstStart.horse?.shoes, 'back'), entry.shoes_rear);
  addCheck(checks, 'entry.barefoot_front', expectedBarefoot(firstStart.horse?.shoes, 'front'), entry.barefoot_front == null ? null : Number(entry.barefoot_front));
  addCheck(checks, 'entry.barefoot_rear', expectedBarefoot(firstStart.horse?.shoes, 'back'), entry.barefoot_rear == null ? null : Number(entry.barefoot_rear));
  addCheck(checks, 'entry.sulky_type', firstStart.horse?.sulky?.reported === true ? maybeText(firstStart.horse?.sulky?.type?.text) : null, entry.sulky_type);
  addCheck(checks, 'entry.sulky_code', firstStart.horse?.sulky?.reported === true ? maybeText(firstStart.horse?.sulky?.type?.code) : null, entry.exact_sulky);

  if (voltSample && voltEntry) {
    const expectedHandicap = Number(voltSample.start.distance) - Number(voltSample.race.distance);
    addCheck(checks, 'volt.actual_start_distance_m', Number(voltSample.start.distance), Number(voltEntry.actual_start_distance_m));
    addCheck(checks, 'volt.handicap_m', expectedHandicap, Number(voltEntry.handicap_m));
    addCheck(checks, 'volt.start_tier', 1 + (expectedHandicap / 20), Number(voltEntry.start_tier));
  }

  addCheck(checks, 'counts.entries', countsExpected.entries, Number(counts?.entry_count ?? 0));
  addCheck(checks, 'counts.betting_snapshots', countsExpected.betting, Number(counts?.betting_count ?? 0));
  addCheck(checks, 'counts.odds_snapshots', countsExpected.odds, Number(counts?.odds_count ?? 0));
  addCheck(checks, 'counts.equipment_snapshots', countsExpected.equipment, Number(counts?.equipment_count ?? 0));
  for (const [entityType, expectedCount] of Object.entries(observationCountsExpected)) {
    addCheck(checks, `counts.observations.${entityType}`, expectedCount, observationCounts[entityType] ?? 0);
  }

  const failed = checks.filter((check) => !check.pass);
  return {
    ok: failed.length === 0,
    sourceRecordId: id,
    gameRoundId: validated.gameId,
    verifiedAt: new Date().toISOString(),
    checkCount: checks.length,
    passedCount: checks.length - failed.length,
    failedCount: failed.length,
    representative: {
      raceId: firstRace.id,
      horseExternalId: String(firstStart.horse.id),
      voltSampleIncluded: Boolean(voltSample)
    },
    checks
  };
}
