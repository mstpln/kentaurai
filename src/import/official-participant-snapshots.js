import { stableId } from '../ids.js';

const SOURCE_TYPE = 'official_provider';
const EXTERNAL_SOURCE = 'official';
const NORMALIZED_QUALITY = 'normalized_verified_subset';

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function nonNegativeIntegerOrNull(value, label) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer when present`);
  return value;
}

function statYear(value, label) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) throw new Error(`${label} must be a four-digit year`);
  return year;
}

function maybeText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function participantExternalId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric <= 0) return null;
  return text;
}

function recordTime(record, label) {
  if (!record) return { minutes: null, seconds: null, tenths: null };
  const time = objectOrNull(record.time);
  if (!time) return { minutes: null, seconds: null, tenths: null };
  const minutes = nonNegativeIntegerOrNull(time.minutes, `${label}.time.minutes`);
  const seconds = nonNegativeIntegerOrNull(time.seconds, `${label}.time.seconds`);
  const tenths = nonNegativeIntegerOrNull(time.tenths, `${label}.time.tenths`);
  if (seconds != null && seconds > 59) throw new Error(`${label}.time.seconds must be at most 59`);
  if (tenths != null && tenths > 9) throw new Error(`${label}.time.tenths must be at most 9`);
  return { minutes, seconds, tenths };
}

function normalizeRecord(recordValue, label) {
  const record = objectOrNull(recordValue);
  if (!record) return null;
  const time = recordTime(record, label);
  return {
    code: maybeText(record.code),
    startMethod: maybeText(record.startMethod),
    distanceGroup: maybeText(record.distance),
    minutes: time.minutes,
    seconds: time.seconds,
    tenths: time.tenths
  };
}

function placements(stats, label) {
  const placement = objectOrNull(stats?.placement);
  return {
    firsts: nonNegativeIntegerOrNull(placement?.['1'], `${label}.placement.1`),
    seconds: nonNegativeIntegerOrNull(placement?.['2'], `${label}.placement.2`),
    thirds: nonNegativeIntegerOrNull(placement?.['3'], `${label}.placement.3`)
  };
}

function normalizeStatistics(statsValue, label) {
  const stats = objectOrNull(statsValue);
  if (!stats) return null;
  const p = placements(stats, label);
  return {
    starts: nonNegativeIntegerOrNull(stats.starts, `${label}.starts`),
    earningsRaw: nonNegativeIntegerOrNull(stats.earnings, `${label}.earnings`),
    firsts: p.firsts,
    seconds: p.seconds,
    thirds: p.thirds,
    winPercentageHundredths: nonNegativeIntegerOrNull(stats.winPercentage, `${label}.winPercentage`),
    placePercentageHundredths: nonNegativeIntegerOrNull(stats.placePercentage, `${label}.placePercentage`),
    earningsPerStartRaw: nonNegativeIntegerOrNull(stats.earningsPerStart, `${label}.earningsPerStart`)
  };
}

function normalizeYears(statisticsValue, label) {
  const statistics = objectOrNull(statisticsValue);
  const years = objectOrNull(statistics?.years);
  if (!years) return [];
  return Object.entries(years)
    .map(([yearText, stats]) => ({ year: statYear(yearText, `${label}.years key`), stats: normalizeStatistics(stats, `${label}.years.${yearText}`), records: normalizeRecords(stats, `${label}.years.${yearText}`) }))
    .sort((a, b) => a.year - b.year);
}

function normalizeRecords(statsValue, label) {
  const stats = objectOrNull(statsValue);
  if (stats?.records == null) return [];
  if (!Array.isArray(stats.records)) throw new Error(`${label}.records must be an array when present`);
  return stats.records.map((record, index) => normalizeRecord(record, `${label}.records[${index}]`));
}

function raceBlocks(payload) {
  if (Array.isArray(payload?.races)) return payload.races;
  if (payload && typeof payload === 'object' && Array.isArray(payload.starts)) return [payload];
  throw new Error('official source does not contain race starts');
}

function stableJson(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function setUnique(map, key, value, label) {
  if (!key) return;
  const prior = map.get(key);
  if (prior && stableJson(prior) !== stableJson(value)) throw new Error(`official source contains conflicting ${label} values for the same participant`);
  if (!prior) map.set(key, value);
}

export function extractOfficialParticipantSnapshots(payload) {
  const horses = new Map();
  const drivers = new Map();
  const trainers = new Map();

  for (const race of raceBlocks(payload)) {
    if (!Array.isArray(race?.starts)) continue;
    for (const start of race.starts) {
      const horse = objectOrNull(start?.horse);
      if (horse) {
        const horseExternalId = participantExternalId(horse.id);
        if (horseExternalId) {
          const currentRecord = normalizeRecord(horse.record, 'horse.record');
          const life = normalizeStatistics(horse.statistics?.life, 'horse.statistics.life');
          const years = normalizeYears(horse.statistics, 'horse.statistics');
          const snapshot = {
            ageYears: nonNegativeIntegerOrNull(horse.age, 'horse.age'),
            currentRecord,
            life,
            years
          };
          setUnique(horses, horseExternalId, snapshot, 'horse snapshot');
        }

        const trainer = objectOrNull(horse.trainer);
        const trainerExternalId = participantExternalId(trainer?.id);
        if (trainerExternalId) {
          setUnique(trainers, trainerExternalId, { years: normalizeYears(trainer.statistics, 'trainer.statistics') }, 'trainer statistics');
        }
      }

      const driver = objectOrNull(start?.driver);
      const driverExternalId = participantExternalId(driver?.id);
      if (driverExternalId) {
        setUnique(drivers, driverExternalId, { years: normalizeYears(driver.statistics, 'driver.statistics') }, 'driver statistics');
      }
    }
  }
  return { horses, drivers, trainers };
}

async function mappedId(env, table, idColumn, externalId) {
  const row = await env.DB.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE source_type = ? AND external_id = ? LIMIT 1`)
    .bind(EXTERNAL_SOURCE, externalId).first();
  return row?.id || null;
}

async function insertHorseSnapshot(env, source, horseId, snapshot) {
  const record = snapshot.currentRecord;
  const life = snapshot.life;
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO horse_official_snapshots
      (id, horse_id, observed_at, age_years, record_code, record_start_method, record_distance_group,
       record_minutes, record_seconds, record_tenths, life_starts, life_earnings_raw,
       life_firsts, life_seconds, life_thirds, life_win_percentage_hundredths,
       life_place_percentage_hundredths, life_earnings_per_start_raw, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stableId('official-horse-snapshot', horseId, source.id), horseId, source.fetched_at,
    snapshot.ageYears, record?.code ?? null, record?.startMethod ?? null, record?.distanceGroup ?? null,
    record?.minutes ?? null, record?.seconds ?? null, record?.tenths ?? null,
    life?.starts ?? null, life?.earningsRaw ?? null, life?.firsts ?? null, life?.seconds ?? null,
    life?.thirds ?? null, life?.winPercentageHundredths ?? null, life?.placePercentageHundredths ?? null,
    life?.earningsPerStartRaw ?? null, source.id
  ).run();
  return Number(result.meta?.changes ?? 0);
}

async function insertHorseYear(env, source, horseId, year) {
  const s = year.stats;
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO horse_official_year_snapshots
      (id, horse_id, stat_year, observed_at, starts, earnings_raw, firsts, seconds, thirds,
       win_percentage_hundredths, place_percentage_hundredths, earnings_per_start_raw, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stableId('official-horse-year-snapshot', horseId, source.id, year.year), horseId, year.year, source.fetched_at,
    s?.starts ?? null, s?.earningsRaw ?? null, s?.firsts ?? null, s?.seconds ?? null, s?.thirds ?? null,
    s?.winPercentageHundredths ?? null, s?.placePercentageHundredths ?? null, s?.earningsPerStartRaw ?? null, source.id
  ).run();
  return Number(result.meta?.changes ?? 0);
}

async function insertHorseRecord(env, source, horseId, scope, year, index, record) {
  if (!record) return 0;
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO horse_official_record_snapshots
      (id, horse_id, record_scope, stat_year, source_index, observed_at, record_code, start_method,
       distance_group, minutes, seconds, tenths, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stableId('official-horse-record-snapshot', horseId, source.id, scope, year ?? 'current', index),
    horseId, scope, year, index, source.fetched_at, record.code, record.startMethod, record.distanceGroup,
    record.minutes, record.seconds, record.tenths, source.id
  ).run();
  return Number(result.meta?.changes ?? 0);
}

async function insertPersonYear(env, source, kind, personId, year) {
  const table = kind === 'driver' ? 'driver_official_year_snapshots' : 'trainer_official_year_snapshots';
  const idColumn = kind === 'driver' ? 'driver_id' : 'trainer_id';
  const s = year.stats;
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO ${table}
      (id, ${idColumn}, stat_year, observed_at, starts, earnings_raw, firsts, seconds, thirds,
       win_percentage_hundredths, source_record_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stableId(`official-${kind}-year-snapshot`, personId, source.id, year.year), personId, year.year, source.fetched_at,
    s?.starts ?? null, s?.earningsRaw ?? null, s?.firsts ?? null, s?.seconds ?? null, s?.thirds ?? null,
    s?.winPercentageHundredths ?? null, source.id
  ).run();
  return Number(result.meta?.changes ?? 0);
}

async function markSource(env, sourceRecordId, status, counts, errorMessage = null) {
  await env.DB.prepare(`
    INSERT INTO official_participant_snapshot_source_sync
      (source_record_id, status, horse_snapshot_count, horse_year_snapshot_count, horse_record_snapshot_count,
       driver_year_snapshot_count, trainer_year_snapshot_count, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_record_id) DO UPDATE SET
      status = excluded.status,
      horse_snapshot_count = excluded.horse_snapshot_count,
      horse_year_snapshot_count = excluded.horse_year_snapshot_count,
      horse_record_snapshot_count = excluded.horse_record_snapshot_count,
      driver_year_snapshot_count = excluded.driver_year_snapshot_count,
      trainer_year_snapshot_count = excluded.trainer_year_snapshot_count,
      error_message = excluded.error_message,
      processed_at = CURRENT_TIMESTAMP
  `).bind(
    sourceRecordId, status, counts.horseSnapshots, counts.horseYears, counts.horseRecords,
    counts.driverYears, counts.trainerYears, errorMessage
  ).run();
}

export async function syncOfficialParticipantSnapshotsFromSource(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');

  const priorSync = await env.DB.prepare(`
    SELECT status, horse_snapshot_count, horse_year_snapshot_count, horse_record_snapshot_count,
           driver_year_snapshot_count, trainer_year_snapshot_count
    FROM official_participant_snapshot_source_sync WHERE source_record_id = ? LIMIT 1
  `).bind(id).first();
  if (priorSync?.status === 'complete') {
    return {
      sourceRecordId: id, status: 'complete', reused: true,
      horseSnapshotCount: priorSync.horse_snapshot_count,
      horseYearSnapshotCount: priorSync.horse_year_snapshot_count,
      horseRecordSnapshotCount: priorSync.horse_record_snapshot_count,
      driverYearSnapshotCount: priorSync.driver_year_snapshot_count,
      trainerYearSnapshotCount: priorSync.trainer_year_snapshot_count
    };
  }

  const source = await env.DB.prepare(`
    SELECT id, source_type, fetched_at, raw_object_key, quality_status
    FROM source_records WHERE id = ? LIMIT 1
  `).bind(id).first();
  if (!source || source.source_type !== SOURCE_TYPE || source.quality_status !== NORMALIZED_QUALITY || !source.raw_object_key) {
    throw new Error('source record is not a normalized official raw capture');
  }

  const counts = { horseSnapshots: 0, horseYears: 0, horseRecords: 0, driverYears: 0, trainerYears: 0 };
  try {
    const object = await env.RAW_BUCKET.get(source.raw_object_key);
    if (!object) throw new Error('captured raw object was not found');
    let payload;
    try { payload = JSON.parse(await object.text()); }
    catch (error) { throw new Error(`captured raw object is not valid JSON: ${error.message}`); }

    const extracted = extractOfficialParticipantSnapshots(payload);
    for (const [externalId, snapshot] of extracted.horses.entries()) {
      const horseId = await mappedId(env, 'horse_external_ids', 'horse_id', externalId);
      if (!horseId) continue;
      counts.horseSnapshots += await insertHorseSnapshot(env, source, horseId, snapshot);
      if (snapshot.currentRecord) counts.horseRecords += await insertHorseRecord(env, source, horseId, 'current', null, 0, snapshot.currentRecord);
      for (const year of snapshot.years) {
        counts.horseYears += await insertHorseYear(env, source, horseId, year);
        for (let index = 0; index < year.records.length; index += 1) {
          counts.horseRecords += await insertHorseRecord(env, source, horseId, 'year', year.year, index, year.records[index]);
        }
      }
    }
    for (const [externalId, snapshot] of extracted.drivers.entries()) {
      const driverId = await mappedId(env, 'driver_external_ids', 'driver_id', externalId);
      if (!driverId) continue;
      for (const year of snapshot.years) counts.driverYears += await insertPersonYear(env, source, 'driver', driverId, year);
    }
    for (const [externalId, snapshot] of extracted.trainers.entries()) {
      const trainerId = await mappedId(env, 'trainer_external_ids', 'trainer_id', externalId);
      if (!trainerId) continue;
      for (const year of snapshot.years) counts.trainerYears += await insertPersonYear(env, source, 'trainer', trainerId, year);
    }

    await markSource(env, id, 'complete', counts);
    return {
      sourceRecordId: id, status: 'complete', reused: false,
      horseSnapshotCount: counts.horseSnapshots,
      horseYearSnapshotCount: counts.horseYears,
      horseRecordSnapshotCount: counts.horseRecords,
      driverYearSnapshotCount: counts.driverYears,
      trainerYearSnapshotCount: counts.trainerYears
    };
  } catch (error) {
    await markSource(env, id, 'failed', counts, String(error?.message || error).slice(0, 500));
    throw error;
  }
}

export async function syncOnePendingOfficialParticipantSnapshotSource(env) {
  if (!env.DB || !env.RAW_BUCKET?.get) return { status: 'not_configured' };
  const source = await env.DB.prepare(`
    SELECT sr.id
    FROM source_records sr
    LEFT JOIN official_participant_snapshot_source_sync ps ON ps.source_record_id = sr.id
    WHERE sr.source_type = ?
      AND sr.quality_status = ?
      AND sr.raw_object_key IS NOT NULL
      AND ps.source_record_id IS NULL
    ORDER BY sr.fetched_at DESC, sr.id DESC
    LIMIT 1
  `).bind(SOURCE_TYPE, NORMALIZED_QUALITY).first();
  if (!source?.id) return { status: 'idle' };
  try { return await syncOfficialParticipantSnapshotsFromSource(env, source.id); }
  catch (error) {
    console.error('official participant snapshot source sync failed', error);
    return { sourceRecordId: source.id, status: 'failed', message: String(error?.message || error) };
  }
}

export async function getOfficialHorseSnapshotAsOf(env, horseId, asOf) {
  const id = String(horseId || '').trim();
  const cutoff = String(asOf || '').trim();
  if (!id || !cutoff) throw new Error('horseId and asOf are required');
  const horse = await env.DB.prepare(`
    SELECT * FROM horse_official_snapshots
    WHERE horse_id = ? AND observed_at <= ?
    ORDER BY observed_at DESC, source_record_id DESC
    LIMIT 1
  `).bind(id, cutoff).first();
  if (!horse) return null;
  const { results: years } = await env.DB.prepare(`
    SELECT * FROM horse_official_year_snapshots
    WHERE horse_id = ? AND observed_at <= ?
    ORDER BY stat_year DESC, observed_at DESC, source_record_id DESC
  `).bind(id, cutoff).all();
  const latestYears = [];
  const seenYears = new Set();
  for (const row of years || []) {
    if (seenYears.has(row.stat_year)) continue;
    seenYears.add(row.stat_year);
    latestYears.push(row);
  }
  const { results: records } = await env.DB.prepare(`
    SELECT * FROM horse_official_record_snapshots
    WHERE horse_id = ? AND observed_at = ? AND source_record_id = ?
    ORDER BY record_scope, stat_year, source_index
  `).bind(id, horse.observed_at, horse.source_record_id).all();
  return { horse, years: latestYears, records: records || [] };
}
