import { stableId } from '../ids.js';
import { finishImportRun, startImportRun } from './common.js';
import { validateOfficialGamePayload } from './official-live.js';

const SOURCE_TYPE = 'official_provider';
const EXTERNAL_SOURCE = 'official';
const NORMALIZED_QUALITY = 'normalized_verified_subset';
const ENTRY_QUALITY = 'official_declared_start_scratch_unverified';

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

function personName(person) {
  if (!person || typeof person !== 'object') return null;
  const full = [maybeText(person.firstName), maybeText(person.lastName)].filter(Boolean).join(' ');
  return full || maybeText(person.shortName);
}

function scaledHundredths(value, label, max = null) {
  const raw = finiteNumber(value);
  if (raw == null) return null;
  if (raw < 0 || (max != null && raw > max)) throw new Error(`${label} is outside the verified range`);
  return raw / 100;
}

function observationId(entityType, entityId, sourceRecordId) {
  return stableId('obs', entityType, entityId, sourceRecordId);
}

async function recordObservation(env, counts, entityType, entityId, sourceRecordId, observedAt, fields, qualityStatus = NORMALIZED_QUALITY) {
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO normalized_observations
      (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    observationId(entityType, entityId, sourceRecordId),
    entityType,
    entityId,
    sourceRecordId,
    observedAt,
    JSON.stringify(fields),
    qualityStatus
  ).run();
  counts.inserted += Number(result.meta?.changes ?? 0);
}

async function resolveMappedEntity(env, externalTable, idColumn, entityTable, externalId) {
  const row = await env.DB.prepare(`
    SELECT x.${idColumn} AS id, e.canonical_name AS canonical_name
    FROM ${externalTable} x
    JOIN ${entityTable} e ON e.id = x.${idColumn}
    WHERE x.source_type = ? AND x.external_id = ?
    LIMIT 1
  `).bind(EXTERNAL_SOURCE, String(externalId)).first();
  return row || null;
}

async function upsertTrack(env, trackValue, ctx, { observe = false } = {}) {
  if (!trackValue || typeof trackValue !== 'object') return null;
  const ext = String(trackValue.id ?? '').trim();
  const name = maybeText(trackValue.name);
  if (!ext || !name) throw new Error('track id and name are required');

  const cached = ctx.trackCache.get(ext);
  if (cached) {
    if (observe && !ctx.observedTracks.has(ext)) {
      await recordObservation(env, ctx.counts, 'track', cached.id, ctx.sourceRecordId, ctx.observedAt, {
        externalId: ext,
        name,
        priorCanonicalName: cached.priorName,
        nameConflict: cached.nameConflict,
        countryCode: maybeText(trackValue.countryCode),
        sportSystemCode: maybeText(trackValue.sportSystemCode)
      }, cached.nameConflict ? 'source_conflict' : NORMALIZED_QUALITY);
      ctx.observedTracks.add(ext);
    }
    return cached.id;
  }

  const mapped = await resolveMappedEntity(env, 'track_external_ids', 'track_id', 'tracks', ext);
  let id = mapped?.id || null;
  let priorName = maybeText(mapped?.canonical_name);
  if (!id) {
    const byName = await env.DB.prepare('SELECT id, canonical_name FROM tracks WHERE canonical_name = ? LIMIT 1')
      .bind(name).first();
    id = byName?.id || stableId('track', EXTERNAL_SOURCE, ext);
    priorName = maybeText(byName?.canonical_name);
  }
  const nameConflict = priorName != null && priorName !== name;

  await env.DB.prepare(`
    INSERT INTO tracks (id, canonical_name, country_code)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      canonical_name = CASE WHEN tracks.canonical_name = excluded.canonical_name THEN excluded.canonical_name ELSE tracks.canonical_name END,
      country_code = COALESCE(excluded.country_code, tracks.country_code),
      updated_at = CURRENT_TIMESTAMP
  `).bind(id, name, maybeText(trackValue.countryCode)).run();
  await env.DB.prepare(`
    INSERT INTO track_external_ids (track_id, source_type, external_id)
    VALUES (?, ?, ?)
    ON CONFLICT(source_type, external_id) DO UPDATE SET track_id = excluded.track_id
  `).bind(id, EXTERNAL_SOURCE, ext).run();

  ctx.trackCache.set(ext, { id, priorName, nameConflict });
  if (observe) {
    await recordObservation(env, ctx.counts, 'track', id, ctx.sourceRecordId, ctx.observedAt, {
      externalId: ext,
      name,
      priorCanonicalName: priorName,
      nameConflict,
      countryCode: maybeText(trackValue.countryCode),
      sportSystemCode: maybeText(trackValue.sportSystemCode)
    }, nameConflict ? 'source_conflict' : NORMALIZED_QUALITY);
    ctx.observedTracks.add(ext);
  }
  return id;
}

async function upsertPerson(env, kind, personValue, ctx) {
  if (!personValue || typeof personValue !== 'object' || personValue.id == null) return null;
  const name = personName(personValue);
  if (!name) return null;
  const ext = String(personValue.id);
  const config = kind === 'driver'
    ? { table: 'drivers', externalTable: 'driver_external_ids', idColumn: 'driver_id' }
    : { table: 'trainers', externalTable: 'trainer_external_ids', idColumn: 'trainer_id' };
  const mapped = await resolveMappedEntity(env, config.externalTable, config.idColumn, config.table, ext);
  const id = mapped?.id || stableId(kind, EXTERNAL_SOURCE, ext);
  const priorName = maybeText(mapped?.canonical_name);
  const nameConflict = priorName != null && priorName !== name;
  const homeTrackId = personValue.homeTrack ? await upsertTrack(env, personValue.homeTrack, ctx) : null;

  if (kind === 'driver') {
    await env.DB.prepare(`
      INSERT INTO drivers (id, canonical_name, home_track_id)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_name = CASE WHEN drivers.canonical_name = excluded.canonical_name THEN excluded.canonical_name ELSE drivers.canonical_name END,
        home_track_id = COALESCE(excluded.home_track_id, drivers.home_track_id),
        updated_at = CURRENT_TIMESTAMP
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
    externalId: ext,
    name,
    priorCanonicalName: priorName,
    nameConflict,
    location: maybeText(personValue.location),
    birthYear: finiteNumber(personValue.birth),
    license: maybeText(personValue.license),
    homeTrackExternalId: personValue.homeTrack?.id == null ? null : String(personValue.homeTrack.id),
    homeTrackName: maybeText(personValue.homeTrack?.name)
  }, nameConflict ? 'source_conflict' : NORMALIZED_QUALITY);
  return id;
}

async function upsertHorse(env, horse, trainerId, ctx) {
  const ext = String(horse.id);
  const name = maybeText(horse.name);
  if (!name) throw new Error('horse name is required');
  const mapped = await resolveMappedEntity(env, 'horse_external_ids', 'horse_id', 'horses', ext);
  const id = mapped?.id || stableId('horse', EXTERNAL_SOURCE, ext);
  const priorName = maybeText(mapped?.canonical_name);
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
      sex = COALESCE(excluded.sex, horses.sex),
      color = COALESCE(excluded.color, horses.color),
      sire_name = COALESCE(excluded.sire_name, horses.sire_name),
      dam_name = COALESCE(excluded.dam_name, horses.dam_name),
      damsire_name = COALESCE(excluded.damsire_name, horses.damsire_name),
      breeder = COALESCE(excluded.breeder, horses.breeder),
      owner = COALESCE(excluded.owner, horses.owner),
      current_trainer_id = COALESCE(excluded.current_trainer_id, horses.current_trainer_id),
      home_track_id = COALESCE(excluded.home_track_id, horses.home_track_id),
      country_code = COALESCE(excluded.country_code, horses.country_code),
      career_earnings_sek = COALESCE(excluded.career_earnings_sek, horses.career_earnings_sek),
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    id,
    name,
    maybeText(horse.sex),
    maybeText(horse.color),
    maybeText(pedigree.father?.name),
    maybeText(pedigree.mother?.name),
    maybeText(pedigree.grandfather?.name),
    breeder,
    owner,
    trainerId,
    homeTrackId,
    maybeText(horse.nationality),
    careerEarningsSek
  ).run();
  await env.DB.prepare(`
    INSERT INTO horse_external_ids (horse_id, source_type, external_id)
    VALUES (?, ?, ?)
    ON CONFLICT(source_type, external_id) DO UPDATE SET horse_id = excluded.horse_id
  `).bind(id, EXTERNAL_SOURCE, ext).run();

  await recordObservation(env, ctx.counts, 'horse', id, ctx.sourceRecordId, ctx.observedAt, {
    externalId: ext,
    name,
    priorCanonicalName: priorName,
    nameConflict,
    ageYears: finiteNumber(horse.age),
    sex: maybeText(horse.sex),
    nationality: maybeText(horse.nationality),
    color: maybeText(horse.color),
    careerEarningsSek,
    homeTrackExternalId: horse.homeTrack?.id == null ? null : String(horse.homeTrack.id),
    homeTrackName: maybeText(horse.homeTrack?.name),
    owner,
    breeder,
    sireName: maybeText(pedigree.father?.name),
    damName: maybeText(pedigree.mother?.name),
    damsireName: maybeText(pedigree.grandfather?.name)
  }, nameConflict ? 'source_conflict' : NORMALIZED_QUALITY);
  return id;
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

function marketRank(starts, gameType, targetStart) {
  const target = finiteNumber(targetStart.pools?.[gameType]?.betDistribution);
  if (target == null) return null;
  return 1 + starts.filter((start) => {
    const value = finiteNumber(start.pools?.[gameType]?.betDistribution);
    return value != null && value > target;
  }).length;
}

async function ensureRoundAndRace(env, game, race, legNumber, ctx) {
  await env.DB.prepare(`
    INSERT INTO game_rounds (id, game_type, round_date, scheduled_start_at, status)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      game_type = excluded.game_type,
      round_date = excluded.round_date,
      scheduled_start_at = COALESCE(excluded.scheduled_start_at, game_rounds.scheduled_start_at),
      status = COALESCE(excluded.status, game_rounds.status),
      updated_at = CURRENT_TIMESTAMP
  `).bind(game.id, ctx.gameType, race.date, maybeText(game.races?.[0]?.scheduledStartTime), maybeText(game.status)).run();

  const trackId = await upsertTrack(env, race.track, ctx, { observe: true });
  await env.DB.prepare(`
    INSERT INTO races
      (id, track_id, race_date, race_number, scheduled_start_at, distance_m, start_method, race_name, status, source_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      track_id = excluded.track_id,
      race_date = excluded.race_date,
      race_number = excluded.race_number,
      scheduled_start_at = COALESCE(excluded.scheduled_start_at, races.scheduled_start_at),
      distance_m = excluded.distance_m,
      start_method = excluded.start_method,
      race_name = COALESCE(excluded.race_name, races.race_name),
      status = COALESCE(excluded.status, races.status),
      source_quality = excluded.source_quality,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    race.id,
    trackId,
    race.date,
    race.number,
    maybeText(race.scheduledStartTime),
    race.distance,
    race.startMethod,
    maybeText(race.name),
    maybeText(race.status),
    NORMALIZED_QUALITY
  ).run();
  await env.DB.prepare(`
    INSERT INTO race_external_ids (race_id, source_type, external_id)
    VALUES (?, ?, ?)
    ON CONFLICT(source_type, external_id) DO UPDATE SET race_id = excluded.race_id
  `).bind(race.id, EXTERNAL_SOURCE, race.id).run();
  await env.DB.prepare(`
    INSERT INTO game_legs (game_round_id, leg_number, race_id)
    VALUES (?, ?, ?)
    ON CONFLICT(game_round_id, leg_number) DO UPDATE SET race_id = excluded.race_id
  `).bind(game.id, legNumber, race.id).run();

  await recordObservation(env, ctx.counts, 'race', race.id, ctx.sourceRecordId, ctx.observedAt, {
    externalId: race.id,
    legNumber,
    trackExternalId: String(race.track.id),
    date: race.date,
    raceNumber: race.number,
    distanceM: race.distance,
    startMethod: race.startMethod,
    scheduledStartAt: maybeText(race.scheduledStartTime),
    startTime: maybeText(race.startTime),
    raceName: maybeText(race.name),
    status: maybeText(race.status),
    prizeText: maybeText(race.prize),
    terms: Array.isArray(race.terms) ? race.terms : null,
    observedStartCount: race.starts.length
  });
}

async function insertEquipment(env, raceEntryId, horse, ctx) {
  const shoes = horse.shoes && typeof horse.shoes === 'object' ? horse.shoes : null;
  const sulky = horse.sulky && typeof horse.sulky === 'object' ? horse.sulky : null;
  if (!shoes && !sulky) return;
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
    stableId('eq', raceEntryId, ctx.sourceRecordId),
    raceEntryId,
    frontHasShoe == null ? null : (frontHasShoe ? 'shod' : 'barefoot'),
    rearHasShoe == null ? null : (rearHasShoe ? 'shod' : 'barefoot'),
    frontHasShoe == null ? null : Number(!frontHasShoe),
    rearHasShoe == null ? null : Number(!rearHasShoe),
    sulkyReported ? maybeText(sulky?.type?.text) : null,
    sulkyReported ? maybeText(sulky?.type?.code) : null,
    Object.values(changes).some((value) => value != null) ? JSON.stringify(changes) : null,
    shoesReported || sulkyReported ? 'reported' : 'unknown',
    ctx.sourceRecordId
  ).run();
  ctx.counts.inserted += Number(result.meta?.changes ?? 0);
}

async function insertOdds(env, raceEntryId, marketType, rawValue, ctx) {
  const odds = scaledHundredths(rawValue, `${marketType} odds`);
  if (odds == null) return;
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO odds_snapshots
      (id, race_entry_id, captured_at, market_type, odds, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    stableId('odds', raceEntryId, ctx.observedAt, marketType),
    raceEntryId,
    ctx.observedAt,
    marketType,
    odds,
    ctx.sourceRecordId
  ).run();
  ctx.counts.inserted += Number(result.meta?.changes ?? 0);
}

async function mapOneStart(env, game, race, legNumber, start, ctx) {
  const trainerId = await upsertPerson(env, 'trainer', start.horse?.trainer, ctx);
  const driverId = await upsertPerson(env, 'driver', start.driver, ctx);
  const horseId = await upsertHorse(env, start.horse, trainerId, ctx);
  const raceEntryId = stableId('entry', race.id, horseId);
  const pos = startPosition(race, start);

  await env.DB.prepare(`
    INSERT INTO race_entries
      (id, race_id, horse_id, driver_id, trainer_id, start_number, actual_lane, start_tier,
       handicap_m, actual_start_distance_m, scratched, scratch_reason, data_quality)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      driver_id = excluded.driver_id,
      trainer_id = excluded.trainer_id,
      start_number = excluded.start_number,
      actual_lane = excluded.actual_lane,
      start_tier = excluded.start_tier,
      handicap_m = excluded.handicap_m,
      actual_start_distance_m = excluded.actual_start_distance_m,
      data_quality = excluded.data_quality,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    raceEntryId,
    race.id,
    horseId,
    driverId,
    trainerId,
    start.number,
    pos.lane,
    pos.tier,
    pos.handicapM,
    pos.actualDistance,
    ENTRY_QUALITY
  ).run();

  await recordObservation(env, ctx.counts, 'race_entry', raceEntryId, ctx.sourceRecordId, ctx.observedAt, {
    externalStartId: start.id,
    raceExternalId: race.id,
    horseExternalId: String(start.horse.id),
    driverExternalId: start.driver?.id == null ? null : String(start.driver.id),
    trainerExternalId: start.horse?.trainer?.id == null ? null : String(start.horse.trainer.id),
    startNumber: start.number,
    postPosition: finiteNumber(start.postPosition),
    actualStartDistanceM: pos.actualDistance,
    handicapM: pos.handicapM,
    startTier: pos.tier,
    scratchSemanticsVerified: false
  });

  await insertEquipment(env, raceEntryId, start.horse, ctx);
  const distributionRaw = finiteNumber(start.pools?.[ctx.gameType]?.betDistribution);
  if (distributionRaw != null) {
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO betting_snapshots
        (id, game_round_id, leg_number, race_entry_id, captured_at, bet_percent, market_rank, source_record_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      stableId('bet', game.id, legNumber, raceEntryId, ctx.observedAt),
      game.id,
      legNumber,
      raceEntryId,
      ctx.observedAt,
      scaledHundredths(distributionRaw, `${ctx.gameType} betDistribution`, 10000),
      marketRank(race.starts, ctx.gameType, start),
      ctx.sourceRecordId
    ).run();
    ctx.counts.inserted += Number(result.meta?.changes ?? 0);
  }
  await insertOdds(env, raceEntryId, 'vinnare', start.pools?.vinnare?.odds, ctx);
  await insertOdds(env, raceEntryId, 'plats_min', start.pools?.plats?.minOdds, ctx);
  await insertOdds(env, raceEntryId, 'plats_max', start.pools?.plats?.maxOdds, ctx);
}

function workItems(races) {
  const items = [];
  races.forEach((race, raceIndex) => {
    race.starts.forEach((start, startIndex) => {
      items.push({ race, legNumber: raceIndex + 1, start, startIndex });
    });
  });
  return items;
}

function parseCursor(value, total) {
  const cursor = value == null ? 0 : Number(value);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor > total) {
    throw new Error(`cursor must be an integer between 0 and ${total}`);
  }
  return cursor;
}

async function finalizeNormalization(env, payload, validated, source, sourceRecordId, totalEntries) {
  const run = await startImportRun(env, 'official_provider_normalize', {
    gameId: validated.gameId,
    gameType: validated.gameType,
    sourceRecordId,
    stage: 'finalize'
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  try {
    const legs = await env.DB.prepare('SELECT COUNT(*) AS n FROM game_legs WHERE game_round_id = ?')
      .bind(validated.gameId).first();
    if (Number(legs?.n ?? 0) !== 8) throw new Error('normalization is incomplete: expected eight mapped game legs');

    const entries = await env.DB.prepare(`
      SELECT COUNT(DISTINCT re.id) AS n
      FROM race_entries re
      JOIN game_legs gl ON gl.race_id = re.race_id
      WHERE gl.game_round_id = ?
    `).bind(validated.gameId).first();
    if (Number(entries?.n ?? 0) < totalEntries) {
      throw new Error(`normalization is incomplete: expected at least ${totalEntries} mapped entries`);
    }

    const { results: tracks } = await env.DB.prepare(`
      SELECT DISTINCT r.track_id
      FROM game_legs gl
      JOIN races r ON r.id = gl.race_id
      WHERE gl.game_round_id = ? AND r.track_id IS NOT NULL
    `).bind(validated.gameId).all();
    const primaryTrackId = tracks.length === 1 ? tracks[0].track_id : null;
    await env.DB.prepare('UPDATE game_rounds SET primary_track_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(primaryTrackId, validated.gameId).run();

    await recordObservation(env, counts, 'game_round', validated.gameId, sourceRecordId, source.fetched_at, {
      externalId: validated.gameId,
      gameType: validated.gameType,
      roundDate: validated.roundDate,
      status: validated.status,
      scheduledStartAt: maybeText(validated.races[0]?.scheduledStartTime),
      primaryTrackId,
      providerVersion: finiteNumber(payload.version),
      poolTimestamp: maybeText(validated.pool.timestamp),
      poolTurnoverRaw: finiteNumber(validated.pool.turnover),
      poolSystemCount: finiteNumber(validated.pool.systemCount),
      poolPayoutsRaw: validated.pool.payouts && typeof validated.pool.payouts === 'object' ? validated.pool.payouts : null
    });

    await env.DB.prepare('UPDATE source_records SET quality_status = ? WHERE id = ?')
      .bind(NORMALIZED_QUALITY, sourceRecordId).run();

    const betting = await env.DB.prepare('SELECT COUNT(*) AS n FROM betting_snapshots WHERE game_round_id = ?')
      .bind(validated.gameId).first();
    const odds = await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM odds_snapshots os
      JOIN race_entries re ON re.id = os.race_entry_id
      JOIN game_legs gl ON gl.race_id = re.race_id
      WHERE gl.game_round_id = ?
    `).bind(validated.gameId).first();
    const equipment = await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM equipment e
      JOIN race_entries re ON re.id = e.race_entry_id
      JOIN game_legs gl ON gl.race_id = re.race_id
      WHERE gl.game_round_id = ? AND e.source_record_id = ?
    `).bind(validated.gameId, sourceRecordId).first();

    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId,
      gameRoundId: validated.gameId,
      gameType: validated.gameType,
      raceCount: 8,
      entryCount: totalEntries,
      bettingSnapshotCount: Number(betting?.n ?? 0),
      oddsSnapshotCount: Number(odds?.n ?? 0),
      equipmentSnapshotCount: Number(equipment?.n ?? 0),
      qualityStatus: NORMALIZED_QUALITY,
      scratchSemanticsVerified: false,
      done: true,
      reused: false
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}

export async function normalizeCapturedOfficialGameChunk(env, sourceRecordId, cursorValue = 0) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');

  const source = await env.DB.prepare(`
    SELECT source_type, external_id, fetched_at, raw_object_key, quality_status
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
  if (source.external_id !== `game:${validated.gameId}`) throw new Error('source record does not match the official game payload');
  const items = workItems(validated.races);
  const cursor = parseCursor(cursorValue, items.length);

  if (source.quality_status === NORMALIZED_QUALITY) {
    return {
      sourceRecordId: id,
      gameRoundId: validated.gameId,
      qualityStatus: NORMALIZED_QUALITY,
      totalEntries: items.length,
      nextCursor: null,
      done: true,
      reused: true
    };
  }
  if (source.quality_status !== 'captured_unmapped') {
    throw new Error(`source record has unsupported quality status: ${source.quality_status}`);
  }

  if (cursor === items.length) {
    return finalizeNormalization(env, payload, validated, source, id, items.length);
  }

  const item = items[cursor];
  const run = await startImportRun(env, 'official_provider_normalize', {
    gameId: validated.gameId,
    gameType: validated.gameType,
    sourceRecordId: id,
    stage: 'entry',
    cursor,
    legNumber: item.legNumber,
    startNumber: item.start.number
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const ctx = {
    sourceRecordId: id,
    observedAt: source.fetched_at,
    gameType: validated.gameType,
    counts,
    trackCache: new Map(),
    observedTracks: new Set()
  };

  try {
    await ensureRoundAndRace(env, payload, item.race, item.legNumber, ctx);
    await mapOneStart(env, payload, item.race, item.legNumber, item.start, ctx);
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId: id,
      gameRoundId: validated.gameId,
      gameType: validated.gameType,
      processedLeg: item.legNumber,
      processedStartNumber: item.start.number,
      cursor,
      nextCursor: cursor + 1,
      totalEntries: items.length,
      qualityStatus: 'captured_unmapped',
      scratchSemanticsVerified: false,
      done: false,
      reused: false
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
