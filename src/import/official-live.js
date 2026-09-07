import { stableId } from '../ids.js';
import { finishImportRun, startImportRun } from './common.js';

const SOURCE_TYPE = 'official_provider';
const EXTERNAL_SOURCE = 'official';
const NORMALIZED_QUALITY = 'normalized_verified_subset';
const ENTRY_QUALITY = 'official_declared_start_scratch_unverified';
const SUPPORTED_GAMES = new Set(['V85', 'V86']);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}
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
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}
function externalId(value, label) {
  if (value == null || String(value).trim() === '') throw new Error(`${label} is required`);
  return String(value).trim();
}
function personName(person) {
  if (!person || typeof person !== 'object') return null;
  const full = [maybeText(person.firstName), maybeText(person.lastName)].filter(Boolean).join(' ');
  return full || maybeText(person.shortName);
}
function gameTypeFromId(gameId) {
  const gameType = gameId.split('_', 1)[0].toUpperCase();
  if (!SUPPORTED_GAMES.has(gameType)) throw new Error('official game id must be V85 or V86');
  return gameType;
}
function scaledHundredths(value, label, max = null) {
  const raw = finiteNumber(value);
  if (raw == null) return null;
  if (raw < 0 || (max != null && raw > max)) throw new Error(`${label} is outside the verified range`);
  return raw / 100;
}
function sourceObservationId(entityType, entityId, sourceRecordId) {
  return stableId('obs', entityType, entityId, sourceRecordId);
}

async function recordObservation(env, counts, entityType, entityId, sourceRecordId, observedAt, fields, qualityStatus = NORMALIZED_QUALITY) {
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO normalized_observations
      (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sourceObservationId(entityType, entityId, sourceRecordId), entityType, entityId,
    sourceRecordId, observedAt, JSON.stringify(fields), qualityStatus
  ).run();
  counts.inserted += Number(result.meta?.changes ?? 0);
}

async function resolveExternalMapping(env, table, idColumn, external) {
  const row = await env.DB.prepare(`
    SELECT ${idColumn} AS id FROM ${table}
    WHERE source_type = ? AND external_id = ? LIMIT 1
  `).bind(EXTERNAL_SOURCE, external).first();
  return row?.id || null;
}

async function existingName(env, table, id) {
  if (!id) return null;
  const row = await env.DB.prepare(`SELECT canonical_name FROM ${table} WHERE id = ? LIMIT 1`).bind(id).first();
  return maybeText(row?.canonical_name);
}

async function upsertTrack(env, trackValue, ctx, { observe = false } = {}) {
  if (!trackValue) return null;
  const track = requireObject(trackValue, 'track');
  const ext = externalId(track.id, 'track.id');
  const name = requireText(track.name, 'track.name');
  let id = await resolveExternalMapping(env, 'track_external_ids', 'track_id', ext);
  if (!id) {
    const byName = await env.DB.prepare('SELECT id FROM tracks WHERE canonical_name = ? LIMIT 1').bind(name).first();
    id = byName?.id || stableId('track', EXTERNAL_SOURCE, ext);
  }
  const priorName = await existingName(env, 'tracks', id);
  const nameConflict = priorName != null && priorName !== name;

  await env.DB.prepare(`
    INSERT INTO tracks (id, canonical_name, country_code)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      canonical_name = CASE WHEN tracks.canonical_name = excluded.canonical_name THEN excluded.canonical_name ELSE tracks.canonical_name END,
      country_code = COALESCE(excluded.country_code, tracks.country_code),
      updated_at = CURRENT_TIMESTAMP
  `).bind(id, name, maybeText(track.countryCode)).run();
  await env.DB.prepare(`
    INSERT INTO track_external_ids (track_id, source_type, external_id)
    VALUES (?, ?, ?)
    ON CONFLICT(source_type, external_id) DO UPDATE SET track_id = excluded.track_id
  `).bind(id, EXTERNAL_SOURCE, ext).run();

  if (observe) {
    await recordObservation(env, ctx.counts, 'track', id, ctx.sourceRecordId, ctx.observedAt, {
      externalId: ext, name, priorCanonicalName: priorName, nameConflict,
      countryCode: maybeText(track.countryCode), sportSystemCode: maybeText(track.sportSystemCode)
    }, nameConflict ? 'source_conflict' : NORMALIZED_QUALITY);
  }
  return id;
}

async function upsertPerson(env, kind, personValue, ctx) {
  if (!personValue || typeof personValue !== 'object') return null;
  const name = personName(personValue);
  if (!name || personValue.id == null) return null;
  const ext = externalId(personValue.id, `${kind}.id`);
  const config = kind === 'driver'
    ? { table: 'drivers', externalTable: 'driver_external_ids', idColumn: 'driver_id' }
    : { table: 'trainers', externalTable: 'trainer_external_ids', idColumn: 'trainer_id' };
  let id = await resolveExternalMapping(env, config.externalTable, config.idColumn, ext);
  if (!id) id = stableId(kind, EXTERNAL_SOURCE, ext);
  const priorName = await existingName(env, config.table, id);
  const nameConflict = priorName != null && priorName !== name;
  const homeTrackId = personValue.homeTrack ? await upsertTrack(env, personValue.homeTrack, ctx) : null;

  if (kind === 'driver') {
    await env.DB.prepare(`
      INSERT INTO drivers (id, canonical_name, home_track_id)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_name = CASE WHEN drivers.canonical_name = excluded.canonical_name THEN excluded.canonical_name ELSE drivers.canonical_name END,
        home_track_id = COALESCE(excluded.home_track_id, drivers.home_track_id), updated_at = CURRENT_TIMESTAMP
    `).bind(id, name, homeTrackId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO trainers (id, canonical_name)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_name = CASE WHEN trainers.canonical_name = excluded.canonical_name THEN excluded.canonical_name ELSE trainers.canonical_name END,
        updated_at = CURRENT_TIMESTAMP
    `).bind(id, name).run();
  }
  await env.DB.prepare(`
    INSERT INTO ${config.externalTable} (${config.idColumn}, source_type, external_id)
    VALUES (?, ?, ?)
    ON CONFLICT(source_type, external_id) DO UPDATE SET ${config.idColumn} = excluded.${config.idColumn}
  `).bind(id, EXTERNAL_SOURCE, ext).run();

  await recordObservation(env, ctx.counts, kind, id, ctx.sourceRecordId, ctx.observedAt, {
    externalId: ext, name, priorCanonicalName: priorName, nameConflict,
    location: maybeText(personValue.location), birthYear: finiteNumber(personValue.birth),
    license: maybeText(personValue.license),
    homeTrackExternalId: personValue.homeTrack?.id == null ? null : String(personValue.homeTrack.id),
    homeTrackName: maybeText(personValue.homeTrack?.name)
  }, nameConflict ? 'source_conflict' : NORMALIZED_QUALITY);
  return id;
}

async function upsertHorse(env, horseValue, trainerId, ctx) {
  const horse = requireObject(horseValue, 'horse');
  const ext = externalId(horse.id, 'horse.id');
  const name = requireText(horse.name, 'horse.name');
  let id = await resolveExternalMapping(env, 'horse_external_ids', 'horse_id', ext);
  if (!id) id = stableId('horse', EXTERNAL_SOURCE, ext);
  const priorName = await existingName(env, 'horses', id);
  const nameConflict = priorName != null && priorName !== name;
  const homeTrackId = horse.homeTrack ? await upsertTrack(env, horse.homeTrack, ctx) : null;
  const pedigree = horse.pedigree && typeof horse.pedigree === 'object' ? horse.pedigree : {};
  const owner = maybeText(horse.owner?.name);
  const breeder = maybeText(horse.breeder?.name);
  const careerEarningsSek = finiteNumber(horse.money);

  await env.DB.prepare(`
    INSERT INTO horses
      (id, canonical_name, sex, color, sire_name, dam_name, damsire_name, breeder, owner,
       current_trainer_id, home_track_id, country_code, career_earnings_sek)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      canonical_name = CASE WHEN horses.canonical_name = excluded.canonical_name THEN excluded.canonical_name ELSE horses.canonical_name END,
      sex = COALESCE(excluded.sex, horses.sex), color = COALESCE(excluded.color, horses.color),
      sire_name = COALESCE(excluded.sire_name, horses.sire_name), dam_name = COALESCE(excluded.dam_name, horses.dam_name),
      damsire_name = COALESCE(excluded.damsire_name, horses.damsire_name), breeder = COALESCE(excluded.breeder, horses.breeder),
      owner = COALESCE(excluded.owner, horses.owner), current_trainer_id = COALESCE(excluded.current_trainer_id, horses.current_trainer_id),
      home_track_id = COALESCE(excluded.home_track_id, horses.home_track_id), country_code = COALESCE(excluded.country_code, horses.country_code),
      career_earnings_sek = COALESCE(excluded.career_earnings_sek, horses.career_earnings_sek), updated_at = CURRENT_TIMESTAMP
  `).bind(
    id, name, maybeText(horse.sex), maybeText(horse.color), maybeText(pedigree.father?.name),
    maybeText(pedigree.mother?.name), maybeText(pedigree.grandfather?.name), breeder, owner,
    trainerId, homeTrackId, maybeText(horse.nationality), careerEarningsSek
  ).run();
  await env.DB.prepare(`
    INSERT INTO horse_external_ids (horse_id, source_type, external_id)
    VALUES (?, ?, ?)
    ON CONFLICT(source_type, external_id) DO UPDATE SET horse_id = excluded.horse_id
  `).bind(id, EXTERNAL_SOURCE, ext).run();

  await recordObservation(env, ctx.counts, 'horse', id, ctx.sourceRecordId, ctx.observedAt, {
    externalId: ext, name, priorCanonicalName: priorName, nameConflict,
    ageYears: finiteNumber(horse.age), sex: maybeText(horse.sex), nationality: maybeText(horse.nationality),
    color: maybeText(horse.color), careerEarningsSek,
    homeTrackExternalId: horse.homeTrack?.id == null ? null : String(horse.homeTrack.id),
    homeTrackName: maybeText(horse.homeTrack?.name), owner, breeder,
    sireName: maybeText(pedigree.father?.name), damName: maybeText(pedigree.mother?.name),
    damsireName: maybeText(pedigree.grandfather?.name)
  }, nameConflict ? 'source_conflict' : NORMALIZED_QUALITY);
  return id;
}

function validateStart(startValue, raceIndex, startIndex) {
  const start = requireObject(startValue, `races[${raceIndex}].starts[${startIndex}]`);
  requireText(start.id, `races[${raceIndex}].starts[${startIndex}].id`);
  positiveInteger(start.number, `races[${raceIndex}].starts[${startIndex}].number`);
  if (start.postPosition != null) positiveInteger(start.postPosition, `races[${raceIndex}].starts[${startIndex}].postPosition`);
  if (start.distance != null) positiveInteger(start.distance, `races[${raceIndex}].starts[${startIndex}].distance`);
  const horse = requireObject(start.horse, `races[${raceIndex}].starts[${startIndex}].horse`);
  externalId(horse.id, `races[${raceIndex}].starts[${startIndex}].horse.id`);
  requireText(horse.name, `races[${raceIndex}].starts[${startIndex}].horse.name`);
  return start;
}

export function validateOfficialGamePayload(payload) {
  const game = requireObject(payload, 'official game');
  const gameId = requireText(game.id, 'official game.id');
  const gameType = gameTypeFromId(gameId);
  const status = requireText(game.status, 'official game.status');
  const pool = requireObject(game.pools?.[gameType], `official game.pools.${gameType}`);
  if (pool.betType != null && String(pool.betType).toUpperCase() !== gameType) throw new Error(`official game pool betType must be ${gameType}`);
  const races = requireArray(game.races, 'official game.races');
  if (races.length !== 8) throw new Error('official V85/V86 game must contain exactly eight races');

  const raceIds = new Set();
  const startIds = new Set();
  let roundDate = null;
  races.forEach((raceValue, raceIndex) => {
    const race = requireObject(raceValue, `races[${raceIndex}]`);
    const raceId = requireText(race.id, `races[${raceIndex}].id`);
    if (raceIds.has(raceId)) throw new Error(`duplicate race id: ${raceId}`);
    raceIds.add(raceId);
    const raceDate = requireText(race.date, `races[${raceIndex}].date`);
    if (roundDate == null) roundDate = raceDate;
    if (roundDate !== raceDate) throw new Error('all official game races must have the same date');
    positiveInteger(race.number, `races[${raceIndex}].number`);
    positiveInteger(race.distance, `races[${raceIndex}].distance`);
    const startMethod = requireText(race.startMethod, `races[${raceIndex}].startMethod`);
    if (startMethod !== 'auto' && startMethod !== 'volte') throw new Error(`unsupported start method: ${startMethod}`);
    const track = requireObject(race.track, `races[${raceIndex}].track`);
    externalId(track.id, `races[${raceIndex}].track.id`);
    requireText(track.name, `races[${raceIndex}].track.name`);
    const starts = requireArray(race.starts, `races[${raceIndex}].starts`);
    if (starts.length === 0) throw new Error(`races[${raceIndex}].starts must not be empty`);
    const startNumbers = new Set();
    let distributionSum = 0;
    let distributionCount = 0;
    starts.forEach((startValue, startIndex) => {
      const start = validateStart(startValue, raceIndex, startIndex);
      if (startIds.has(start.id)) throw new Error(`duplicate start id: ${start.id}`);
      startIds.add(start.id);
      const number = Number(start.number);
      if (startNumbers.has(number)) throw new Error(`duplicate start number ${number} in race ${raceId}`);
      startNumbers.add(number);
      const distribution = finiteNumber(start.pools?.[gameType]?.betDistribution);
      if (distribution != null) {
        scaledHundredths(distribution, `${gameType} betDistribution`, 10000);
        distributionSum += distribution;
        distributionCount += 1;
      }
    });
    if (distributionCount === starts.length && Math.abs(distributionSum - 10000) > 5) {
      throw new Error(`${gameType} betDistribution for race ${raceId} does not sum to 100%`);
    }
  });
  return { gameId, gameType, status, pool, races, roundDate };
}

function startPosition(race, start) {
  const actualDistance = finiteNumber(start.distance);
  const raceDistance = finiteNumber(race.distance);
  const lane = finiteNumber(start.postPosition);
  if (race.startMethod !== 'volte') return { actualDistance, lane, handicapM: 0, tier: null };
  if (actualDistance == null || raceDistance == null) return { actualDistance, lane, handicapM: 0, tier: null };
  const handicapM = actualDistance - raceDistance;
  if (handicapM < 0 || handicapM % 20 !== 0) throw new Error(`unsupported voltstart distance difference for start ${start.id}`);
  return { actualDistance, lane, handicapM, tier: 1 + (handicapM / 20) };
}

function marketRanks(starts, gameType) {
  const values = starts.map((start) => ({ id: start.id, raw: finiteNumber(start.pools?.[gameType]?.betDistribution) }))
    .filter((item) => item.raw != null);
  const result = new Map();
  for (const item of values) result.set(item.id, 1 + values.filter((other) => other.raw > item.raw).length);
  return result;
}

async function insertEquipment(env, raceEntryId, horse, ctx) {
  const shoes = horse.shoes && typeof horse.shoes === 'object' ? horse.shoes : null;
  const sulky = horse.sulky && typeof horse.sulky === 'object' ? horse.sulky : null;
  if (!shoes && !sulky) return 0;
  const shoesReported = shoes?.reported === true;
  const sulkyReported = sulky?.reported === true;
  const frontHasShoe = shoesReported && typeof shoes?.front?.hasShoe === 'boolean' ? shoes.front.hasShoe : null;
  const rearHasShoe = shoesReported && typeof shoes?.back?.hasShoe === 'boolean' ? shoes.back.hasShoe : null;
  const changes = {
    shoesFrontChanged: typeof shoes?.front?.changed === 'boolean' ? shoes.front.changed : null,
    shoesRearChanged: typeof shoes?.back?.changed === 'boolean' ? shoes.back.changed : null,
    sulkyTypeChanged: typeof sulky?.type?.changed === 'boolean' ? sulky.type.changed : null,
    sulkyColourChanged: typeof sulky?.colour?.changed === 'boolean' ? sulky.colour.changed : null
  };
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO equipment
      (id, race_entry_id, shoes_front, shoes_rear, barefoot_front, barefoot_rear,
       sulky_type, exact_sulky, change_from_previous_json, verification_status, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stableId('eq', raceEntryId, ctx.sourceRecordId), raceEntryId,
    frontHasShoe == null ? null : (frontHasShoe ? 'shod' : 'barefoot'),
    rearHasShoe == null ? null : (rearHasShoe ? 'shod' : 'barefoot'),
    frontHasShoe == null ? null : Number(!frontHasShoe), rearHasShoe == null ? null : Number(!rearHasShoe),
    sulkyReported ? maybeText(sulky?.type?.text) : null, sulkyReported ? maybeText(sulky?.type?.code) : null,
    Object.values(changes).some((value) => value != null) ? JSON.stringify(changes) : null,
    shoesReported || sulkyReported ? 'reported' : 'unknown', ctx.sourceRecordId
  ).run();
  const inserted = Number(result.meta?.changes ?? 0);
  ctx.counts.inserted += inserted;
  return inserted;
}

async function insertOddsSnapshot(env, raceEntryId, marketType, rawValue, ctx) {
  const odds = scaledHundredths(rawValue, `${marketType} odds`);
  if (odds == null) return 0;
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO odds_snapshots (id, race_entry_id, captured_at, market_type, odds, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(stableId('odds', raceEntryId, ctx.observedAt, marketType), raceEntryId, ctx.observedAt, marketType, odds, ctx.sourceRecordId).run();
  const inserted = Number(result.meta?.changes ?? 0);
  ctx.counts.inserted += inserted;
  return inserted;
}

async function mapRace(env, game, race, legNumber, ctx) {
  const trackId = await upsertTrack(env, race.track, ctx, { observe: true });
  const raceId = requireText(race.id, `leg ${legNumber} race.id`);
  await env.DB.prepare(`
    INSERT INTO races
      (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, race_name, status, source_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      track_id = excluded.track_id, race_date = excluded.race_date, race_number = excluded.race_number,
      scheduled_start_at = COALESCE(excluded.scheduled_start_at, races.scheduled_start_at),
      distance_m = excluded.distance_m, start_method = excluded.start_method,
      race_name = COALESCE(excluded.race_name, races.race_name), status = COALESCE(excluded.status, races.status),
      source_quality = excluded.source_quality, updated_at = CURRENT_TIMESTAMP
  `).bind(
    raceId, trackId, race.date, race.number, maybeText(race.scheduledStartTime), race.distance,
    race.startMethod, maybeText(race.name), maybeText(race.status), NORMALIZED_QUALITY
  ).run();
  await env.DB.prepare(`
    INSERT INTO race_external_ids (race_id, source_type, external_id) VALUES (?, ?, ?)
    ON CONFLICT(source_type, external_id) DO UPDATE SET race_id = excluded.race_id
  `).bind(raceId, EXTERNAL_SOURCE, raceId).run();
  await env.DB.prepare(`
    INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, ?, ?)
    ON CONFLICT(game_round_id, leg_number) DO UPDATE SET race_id = excluded.race_id
  `).bind(game.id, legNumber, raceId).run();
  await recordObservation(env, ctx.counts, 'race', raceId, ctx.sourceRecordId, ctx.observedAt, {
    externalId: raceId, legNumber, trackExternalId: String(race.track.id), date: race.date,
    raceNumber: race.number, distanceM: race.distance, startMethod: race.startMethod,
    scheduledStartAt: maybeText(race.scheduledStartTime), startTime: maybeText(race.startTime),
    raceName: maybeText(race.name), status: maybeText(race.status), prizeText: maybeText(race.prize),
    terms: Array.isArray(race.terms) ? race.terms : null, observedStartCount: race.starts.length
  });

  const ranks = marketRanks(race.starts, ctx.gameType);
  let entryCount = 0; let bettingSnapshotCount = 0; let oddsSnapshotCount = 0; let equipmentSnapshotCount = 0;
  for (const start of race.starts) {
    const trainerId = await upsertPerson(env, 'trainer', start.horse?.trainer, ctx);
    const driverId = await upsertPerson(env, 'driver', start.driver, ctx);
    const horseId = await upsertHorse(env, start.horse, trainerId, ctx);
    const raceEntryId = stableId('entry', raceId, horseId);
    const pos = startPosition(race, start);
    await env.DB.prepare(`
      INSERT INTO race_entries
        (id, race_id, horse_id, driver_id, trainer_id, start_number, actual_lane, start_tier,
         handicap_m, actual_start_distance_m, scratched, scratch_reason, data_quality)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
      ON CONFLICT(id) DO UPDATE SET
        driver_id = excluded.driver_id, trainer_id = excluded.trainer_id, start_number = excluded.start_number,
        actual_lane = excluded.actual_lane, start_tier = excluded.start_tier, handicap_m = excluded.handicap_m,
        actual_start_distance_m = excluded.actual_start_distance_m, data_quality = excluded.data_quality,
        updated_at = CURRENT_TIMESTAMP
    `).bind(raceEntryId, raceId, horseId, driverId, trainerId, start.number, pos.lane, pos.tier, pos.handicapM, pos.actualDistance, ENTRY_QUALITY).run();
    await recordObservation(env, ctx.counts, 'race_entry', raceEntryId, ctx.sourceRecordId, ctx.observedAt, {
      externalStartId: start.id, raceExternalId: raceId, horseExternalId: String(start.horse.id),
      driverExternalId: start.driver?.id == null ? null : String(start.driver.id),
      trainerExternalId: start.horse?.trainer?.id == null ? null : String(start.horse.trainer.id),
      startNumber: start.number, postPosition: finiteNumber(start.postPosition), actualStartDistanceM: pos.actualDistance,
      handicapM: pos.handicapM, startTier: pos.tier, scratchSemanticsVerified: false
    });
    entryCount += 1;
    equipmentSnapshotCount += await insertEquipment(env, raceEntryId, start.horse, ctx);

    const distributionRaw = finiteNumber(start.pools?.[ctx.gameType]?.betDistribution);
    if (distributionRaw != null) {
      const result = await env.DB.prepare(`
        INSERT OR IGNORE INTO betting_snapshots
          (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        stableId('bet', game.id, legNumber, raceEntryId, ctx.observedAt), game.id, legNumber, raceEntryId,
        ctx.observedAt, scaledHundredths(distributionRaw, `${ctx.gameType} betDistribution`, 10000),
        ranks.get(start.id) ?? null, ctx.sourceRecordId
      ).run();
      const inserted = Number(result.meta?.changes ?? 0);
      ctx.counts.inserted += inserted; bettingSnapshotCount += inserted;
    }
    oddsSnapshotCount += await insertOddsSnapshot(env, raceEntryId, 'vinnare', start.pools?.vinnare?.odds, ctx);
    oddsSnapshotCount += await insertOddsSnapshot(env, raceEntryId, 'plats_min', start.pools?.plats?.minOdds, ctx);
    oddsSnapshotCount += await insertOddsSnapshot(env, raceEntryId, 'plats_max', start.pools?.plats?.maxOdds, ctx);
  }
  return { raceId, trackId, entryCount, bettingSnapshotCount, oddsSnapshotCount, equipmentSnapshotCount };
}

export async function normalizeOfficialGame(env, payload, { sourceRecordId } = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!sourceRecordId) throw new Error('sourceRecordId is required');
  const validated = validateOfficialGamePayload(payload);
  const run = await startImportRun(env, 'official_provider_normalize', {
    gameId: validated.gameId, gameType: validated.gameType, sourceRecordId
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    const source = await env.DB.prepare(`
      SELECT source_type, external_id, fetched_at, quality_status FROM source_records WHERE id = ? LIMIT 1
    `).bind(sourceRecordId).first();
    if (!source) throw new Error('source record was not found');
    if (source.source_type !== SOURCE_TYPE || source.external_id !== `game:${validated.gameId}`) throw new Error('source record does not match the official game payload');
    if (source.quality_status === NORMALIZED_QUALITY) {
      counts.skipped = 1; await finishImportRun(env, run.id, counts);
      return { importRunId: run.id, sourceRecordId, gameRoundId: validated.gameId, qualityStatus: NORMALIZED_QUALITY, reused: true };
    }
    if (source.quality_status !== 'captured_unmapped') throw new Error(`source record has unsupported quality status: ${source.quality_status}`);

    const ctx = { sourceRecordId, observedAt: source.fetched_at, gameType: validated.gameType, counts };
    const scheduledStartAt = maybeText(validated.races[0]?.scheduledStartTime);
    await env.DB.prepare(`
      INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, status)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        game_type = excluded.game_type, round_date = excluded.round_date,
        scheduled_start_at = COALESCE(excluded.scheduled_start_at, game_rounds.scheduled_start_at),
        status = COALESCE(excluded.status, game_rounds.status), updated_at = CURRENT_TIMESTAMP
    `).bind(validated.gameId, validated.gameType, validated.roundDate, scheduledStartAt, validated.status).run();

    const mappedRaces = []; const raceTrackIds = new Set();
    for (let index = 0; index < validated.races.length; index += 1) {
      const mapped = await mapRace(env, payload, validated.races[index], index + 1, ctx);
      mappedRaces.push(mapped); raceTrackIds.add(mapped.trackId);
    }
    const primaryTrackId = raceTrackIds.size === 1 ? [...raceTrackIds][0] : null;
    await env.DB.prepare('UPDATE game_rounds SET primary_track_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(primaryTrackId, validated.gameId).run();
    await recordObservation(env, counts, 'game_round', validated.gameId, sourceRecordId, source.fetched_at, {
      externalId: validated.gameId, gameType: validated.gameType, roundDate: validated.roundDate,
      status: validated.status, scheduledStartAt, primaryTrackId, providerVersion: finiteNumber(payload.version),
      poolTimestamp: maybeText(validated.pool.timestamp), poolTurnoverRaw: finiteNumber(validated.pool.turnover),
      poolSystemCount: finiteNumber(validated.pool.systemCount),
      poolPayoutsRaw: validated.pool.payouts && typeof validated.pool.payouts === 'object' ? validated.pool.payouts : null
    });
    await env.DB.prepare('UPDATE source_records SET quality_status = ? WHERE id = ?').bind(NORMALIZED_QUALITY, sourceRecordId).run();
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id, sourceRecordId, gameRoundId: validated.gameId, gameType: validated.gameType,
      raceCount: mappedRaces.length, entryCount: mappedRaces.reduce((sum, race) => sum + race.entryCount, 0),
      bettingSnapshotCount: mappedRaces.reduce((sum, race) => sum + race.bettingSnapshotCount, 0),
      oddsSnapshotCount: mappedRaces.reduce((sum, race) => sum + race.oddsSnapshotCount, 0),
      equipmentSnapshotCount: mappedRaces.reduce((sum, race) => sum + race.equipmentSnapshotCount, 0),
      qualityStatus: NORMALIZED_QUALITY, scratchSemanticsVerified: false, reused: false
    };
  } catch (error) {
    counts.errors = 1; await finishImportRun(env, run.id, counts, error); throw error;
  }
}

export async function normalizeCapturedOfficialGame(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const source = await env.DB.prepare(`
    SELECT raw_object_key FROM source_records WHERE id = ? AND source_type = ? LIMIT 1
  `).bind(String(sourceRecordId || ''), SOURCE_TYPE).first();
  if (!source?.raw_object_key) throw new Error('captured official source record was not found');
  const object = await env.RAW_BUCKET.get(source.raw_object_key);
  if (!object) throw new Error('captured raw object was not found');
  const rawText = await object.text();
  let payload;
  try { payload = JSON.parse(rawText); }
  catch (error) { throw new Error(`captured raw object is not valid JSON: ${error.message}`); }
  return normalizeOfficialGame(env, payload, { sourceRecordId });
}
