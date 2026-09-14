import { stableId } from '../ids.js';

const SOURCE_TYPE = 'official_provider';
const EXTERNAL_SOURCE = 'official';
const NORMALIZED_QUALITY = 'normalized_verified_subset';
const SNAPSHOT_QUALITY = 'verified_official_snapshot';

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

function optionalInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max} when present`);
  }
  return value;
}

function yearNumber(value, label) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1800 || year > 2200) throw new Error(`${label} must be a four-digit year`);
  return year;
}

function placement(block, place) {
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  return optionalInteger(block[String(place)] ?? block[place], `placement.${place}`);
}

function hasAnyValue(object) {
  return Object.values(object).some((value) => value != null);
}

export function parseOfficialRecord(value, label = 'official record') {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object when present`);
  const time = value.time == null ? null : value.time;
  if (time != null && (typeof time !== 'object' || Array.isArray(time))) throw new Error(`${label}.time must be an object when present`);
  const record = {
    code: maybeText(value.code),
    startMethod: maybeText(value.startMethod),
    distanceGroup: maybeText(value.distance),
    timeMinutes: optionalInteger(time?.minutes, `${label}.time.minutes`),
    timeSeconds: optionalInteger(time?.seconds, `${label}.time.seconds`, { min: 0, max: 59 }),
    timeTenths: optionalInteger(time?.tenths, `${label}.time.tenths`, { min: 0, max: 9 }),
    place: optionalInteger(value.place, `${label}.place`)
  };
  return hasAnyValue(record) ? record : null;
}

export function parseHorseAggregate(value, label = 'horse statistics') {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object when present`);
  const aggregate = {
    starts: optionalInteger(value.starts, `${label}.starts`),
    earningsRaw: optionalInteger(value.earnings, `${label}.earnings`),
    wins: placement(value.placement, 1),
    seconds: placement(value.placement, 2),
    thirds: placement(value.placement, 3),
    winPercentageRaw: optionalInteger(value.winPercentage, `${label}.winPercentage`),
    placePercentageRaw: optionalInteger(value.placePercentage, `${label}.placePercentage`),
    earningsPerStartRaw: optionalInteger(value.earningsPerStart, `${label}.earningsPerStart`),
    startPoints: optionalInteger(value.startPoints, `${label}.startPoints`)
  };
  return hasAnyValue(aggregate) ? aggregate : null;
}

export function parsePersonAnnualAggregate(value, label = 'person statistics') {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object when present`);
  const aggregate = {
    starts: optionalInteger(value.starts, `${label}.starts`),
    earningsRaw: optionalInteger(value.earnings, `${label}.earnings`),
    wins: placement(value.placement, 1),
    seconds: placement(value.placement, 2),
    thirds: placement(value.placement, 3),
    winPercentageRaw: optionalInteger(value.winPercentage, `${label}.winPercentage`)
  };
  return hasAnyValue(aggregate) ? aggregate : null;
}

function raceBlocks(payload) {
  if (Array.isArray(payload?.races)) return payload.races.map((race) => Array.isArray(race?.starts) ? race.starts : []);
  return [Array.isArray(payload?.starts) ? payload.starts : []];
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sameFact(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function collectUnique(map, key, fact, label) {
  const prior = map.get(key);
  if (prior && !sameFact(prior, fact)) throw new Error(`official source contains conflicting ${label} values for ${key}`);
  if (!prior) map.set(key, fact);
}

export function collectOfficialSnapshotFacts(payload) {
  const horseProfiles = new Map();
  const horseStats = new Map();
  const horseRecords = new Map();
  const personStats = new Map();

  for (const starts of raceBlocks(payload)) {
    for (const start of starts) {
      const horse = start?.horse;
      const horseExternalId = participantExternalId(horse?.id);
      if (horseExternalId) {
        const ageYears = optionalInteger(horse?.age, 'horse.age');
        if (ageYears != null) collectUnique(horseProfiles, horseExternalId, { externalId: horseExternalId, ageYears }, 'horse age');

        const currentRecord = parseOfficialRecord(horse?.record, 'horse.record');
        if (currentRecord) collectUnique(horseRecords, `${horseExternalId}|current|0`, {
          externalId: horseExternalId, recordScope: 'current', statYear: null, ordinal: 0, ...currentRecord
        }, 'horse current record');

        const statistics = horse?.statistics;
        if (statistics != null && (typeof statistics !== 'object' || Array.isArray(statistics))) throw new Error('horse.statistics must be an object when present');
        const life = parseHorseAggregate(statistics?.life, 'horse.statistics.life');
        if (life) collectUnique(horseStats, `${horseExternalId}|life`, {
          externalId: horseExternalId, snapshotScope: 'life', statYear: null, ...life
        }, 'horse lifetime statistics');
        const lifeRecords = statistics?.life?.records;
        if (lifeRecords != null && !Array.isArray(lifeRecords)) throw new Error('horse.statistics.life.records must be an array when present');
        (lifeRecords || []).forEach((recordValue, index) => {
          const record = parseOfficialRecord(recordValue, `horse.statistics.life.records[${index}]`);
          if (record) collectUnique(horseRecords, `${horseExternalId}|life|${index}`, {
            externalId: horseExternalId, recordScope: 'life', statYear: null, ordinal: index, ...record
          }, 'horse lifetime record');
        });

        const years = statistics?.years;
        if (years != null && (typeof years !== 'object' || Array.isArray(years))) throw new Error('horse.statistics.years must be an object when present');
        for (const [yearKey, yearValue] of Object.entries(years || {})) {
          const year = yearNumber(yearKey, 'horse statistics year');
          const aggregate = parseHorseAggregate(yearValue, `horse.statistics.years.${yearKey}`);
          if (aggregate) collectUnique(horseStats, `${horseExternalId}|year:${year}`, {
            externalId: horseExternalId, snapshotScope: `year:${year}`, statYear: year, ...aggregate
          }, 'horse annual statistics');
          const records = yearValue?.records;
          if (records != null && !Array.isArray(records)) throw new Error(`horse.statistics.years.${yearKey}.records must be an array when present`);
          (records || []).forEach((recordValue, index) => {
            const record = parseOfficialRecord(recordValue, `horse.statistics.years.${yearKey}.records[${index}]`);
            if (record) collectUnique(horseRecords, `${horseExternalId}|year:${year}|${index}`, {
              externalId: horseExternalId, recordScope: 'year', statYear: year, ordinal: index, ...record
            }, 'horse annual record');
          });
        }
      }

      for (const [personType, person] of [['driver', start?.driver], ['trainer', start?.horse?.trainer]]) {
        const externalId = participantExternalId(person?.id);
        if (!externalId) continue;
        const years = person?.statistics?.years;
        if (years != null && (typeof years !== 'object' || Array.isArray(years))) throw new Error(`${personType}.statistics.years must be an object when present`);
        for (const [yearKey, yearValue] of Object.entries(years || {})) {
          const year = yearNumber(yearKey, `${personType} statistics year`);
          const aggregate = parsePersonAnnualAggregate(yearValue, `${personType}.statistics.years.${yearKey}`);
          if (aggregate) collectUnique(personStats, `${personType}|${externalId}|${year}`, {
            personType, externalId, statYear: year, ...aggregate
          }, `${personType} annual statistics`);
        }
      }
    }
  }
  return { horseProfiles, horseStats, horseRecords, personStats };
}

async function mappedId(env, table, idColumn, externalId) {
  const row = await env.DB.prepare(`SELECT ${idColumn} AS id FROM ${table} WHERE source_type = ? AND external_id = ? LIMIT 1`)
    .bind(EXTERNAL_SOURCE, externalId).first();
  return row?.id || null;
}

async function insertHorseProfile(env, source, horseId, fact) {
  return env.DB.prepare(`
    INSERT OR IGNORE INTO horse_profile_snapshots
      (id, horse_id, observed_at, age_years, source_record_id, quality_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(stableId('horse-profile-snapshot', horseId, source.id), horseId, source.fetched_at, fact.ageYears, source.id, SNAPSHOT_QUALITY).run();
}

async function insertHorseStat(env, source, horseId, fact) {
  return env.DB.prepare(`
    INSERT OR IGNORE INTO horse_stat_snapshots
      (id, horse_id, observed_at, snapshot_scope, stat_year, starts, earnings_raw, wins, seconds, thirds,
       win_percentage_raw, place_percentage_raw, earnings_per_start_raw, start_points, source_record_id, quality_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stableId('horse-stat-snapshot', horseId, source.id, fact.snapshotScope), horseId, source.fetched_at,
    fact.snapshotScope, fact.statYear, fact.starts, fact.earningsRaw, fact.wins, fact.seconds, fact.thirds,
    fact.winPercentageRaw, fact.placePercentageRaw, fact.earningsPerStartRaw, fact.startPoints, source.id, SNAPSHOT_QUALITY
  ).run();
}

async function insertHorseRecord(env, source, horseId, fact) {
  const scopeKey = fact.recordScope === 'year' ? `year:${fact.statYear}` : fact.recordScope;
  return env.DB.prepare(`
    INSERT OR IGNORE INTO horse_record_snapshots
      (id, horse_id, observed_at, record_scope, stat_year, record_ordinal, code, start_method, distance_group,
       time_minutes, time_seconds, time_tenths, place, source_record_id, quality_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stableId('horse-record-snapshot', horseId, source.id, scopeKey, fact.ordinal), horseId, source.fetched_at,
    fact.recordScope, fact.statYear, fact.ordinal, fact.code, fact.startMethod, fact.distanceGroup,
    fact.timeMinutes, fact.timeSeconds, fact.timeTenths, fact.place, source.id, SNAPSHOT_QUALITY
  ).run();
}

async function insertPersonStat(env, source, personId, fact) {
  return env.DB.prepare(`
    INSERT OR IGNORE INTO person_stat_snapshots
      (id, person_type, person_id, observed_at, stat_year, starts, earnings_raw, wins, seconds, thirds,
       win_percentage_raw, source_record_id, quality_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    stableId('person-stat-snapshot', fact.personType, personId, source.id, fact.statYear), fact.personType, personId,
    source.fetched_at, fact.statYear, fact.starts, fact.earningsRaw, fact.wins, fact.seconds, fact.thirds,
    fact.winPercentageRaw, source.id, SNAPSHOT_QUALITY
  ).run();
}

async function markSource(env, sourceRecordId, status, counts, errorMessage = null) {
  await env.DB.prepare(`
    INSERT INTO official_snapshot_source_sync
      (source_record_id, status, horse_profile_count, horse_stat_count, horse_record_count, person_stat_count,
       skipped_unmapped_count, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_record_id) DO UPDATE SET
      status = excluded.status,
      horse_profile_count = excluded.horse_profile_count,
      horse_stat_count = excluded.horse_stat_count,
      horse_record_count = excluded.horse_record_count,
      person_stat_count = excluded.person_stat_count,
      skipped_unmapped_count = excluded.skipped_unmapped_count,
      error_message = excluded.error_message,
      processed_at = CURRENT_TIMESTAMP
  `).bind(
    sourceRecordId, status, counts.horseProfiles, counts.horseStats, counts.horseRecords, counts.personStats,
    counts.skippedUnmapped, errorMessage
  ).run();
}

export async function syncOfficialSnapshotsFromSource(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');

  const existingSync = await env.DB.prepare('SELECT status FROM official_snapshot_source_sync WHERE source_record_id = ? LIMIT 1').bind(id).first();
  if (existingSync?.status === 'complete') return { sourceRecordId: id, status: 'complete', reused: true };

  const source = await env.DB.prepare(`
    SELECT id, source_type, fetched_at, raw_object_key, quality_status
    FROM source_records WHERE id = ? LIMIT 1
  `).bind(id).first();
  if (!source || source.source_type !== SOURCE_TYPE || source.quality_status !== NORMALIZED_QUALITY || !source.raw_object_key) {
    throw new Error('source record is not a normalized official raw capture');
  }

  const counts = { horseProfiles: 0, horseStats: 0, horseRecords: 0, personStats: 0, skippedUnmapped: 0 };
  try {
    const object = await env.RAW_BUCKET.get(source.raw_object_key);
    if (!object) throw new Error('captured raw object was not found');
    let payload;
    try { payload = JSON.parse(await object.text()); }
    catch (error) { throw new Error(`captured raw object is not valid JSON: ${error.message}`); }
    const facts = collectOfficialSnapshotFacts(payload);

    const horseIds = new Map();
    const externalHorseIds = new Set([
      ...[...facts.horseProfiles.values()].map((fact) => fact.externalId),
      ...[...facts.horseStats.values()].map((fact) => fact.externalId),
      ...[...facts.horseRecords.values()].map((fact) => fact.externalId)
    ]);
    for (const externalId of externalHorseIds) {
      const horseId = await mappedId(env, 'horse_external_ids', 'horse_id', externalId);
      if (horseId) horseIds.set(externalId, horseId); else counts.skippedUnmapped += 1;
    }

    for (const fact of facts.horseProfiles.values()) {
      const horseId = horseIds.get(fact.externalId); if (!horseId) continue;
      await insertHorseProfile(env, source, horseId, fact); counts.horseProfiles += 1;
    }
    for (const fact of facts.horseStats.values()) {
      const horseId = horseIds.get(fact.externalId); if (!horseId) continue;
      await insertHorseStat(env, source, horseId, fact); counts.horseStats += 1;
    }
    for (const fact of facts.horseRecords.values()) {
      const horseId = horseIds.get(fact.externalId); if (!horseId) continue;
      await insertHorseRecord(env, source, horseId, fact); counts.horseRecords += 1;
    }
    for (const fact of facts.personStats.values()) {
      const table = fact.personType === 'driver' ? 'driver_external_ids' : 'trainer_external_ids';
      const column = fact.personType === 'driver' ? 'driver_id' : 'trainer_id';
      const personId = await mappedId(env, table, column, fact.externalId);
      if (!personId) { counts.skippedUnmapped += 1; continue; }
      await insertPersonStat(env, source, personId, fact); counts.personStats += 1;
    }

    await markSource(env, id, 'complete', counts);
    return { sourceRecordId: id, status: 'complete', ...counts, reused: false };
  } catch (error) {
    await markSource(env, id, 'failed', counts, String(error?.message || error).slice(0, 500));
    throw error;
  }
}

export async function syncOnePendingOfficialSnapshotSource(env) {
  if (!env.DB || !env.RAW_BUCKET?.get) return { status: 'not_configured' };
  const source = await env.DB.prepare(`
    SELECT sr.id
    FROM source_records sr
    LEFT JOIN official_snapshot_source_sync os ON os.source_record_id = sr.id
    WHERE sr.source_type = ?
      AND sr.quality_status = ?
      AND sr.raw_object_key IS NOT NULL
      AND os.source_record_id IS NULL
    ORDER BY sr.fetched_at ASC, sr.id ASC
    LIMIT 1
  `).bind(SOURCE_TYPE, NORMALIZED_QUALITY).first();
  if (!source?.id) return { status: 'idle' };
  try { return await syncOfficialSnapshotsFromSource(env, source.id); }
  catch (error) {
    console.error('official snapshot source sync failed', error);
    return { sourceRecordId: source.id, status: 'failed', message: String(error?.message || error) };
  }
}

function requireAsOf(value) {
  const text = String(value || '').trim();
  if (!text || !Number.isFinite(Date.parse(text))) throw new Error('asOf must be a valid timestamp');
  return new Date(Date.parse(text)).toISOString();
}

function placeholders(values) { return values.map(() => '?').join(','); }

function statFromRow(row) {
  if (!row) return null;
  return {
    starts: row.starts == null ? null : Number(row.starts),
    earningsRaw: row.earnings_raw == null ? null : Number(row.earnings_raw),
    wins: row.wins == null ? null : Number(row.wins),
    seconds: row.seconds == null ? null : Number(row.seconds),
    thirds: row.thirds == null ? null : Number(row.thirds),
    winPercentageRaw: row.win_percentage_raw == null ? null : Number(row.win_percentage_raw),
    placePercentageRaw: row.place_percentage_raw == null ? null : Number(row.place_percentage_raw),
    earningsPerStartRaw: row.earnings_per_start_raw == null ? null : Number(row.earnings_per_start_raw),
    startPoints: row.start_points == null ? null : Number(row.start_points),
    observedAt: row.observed_at,
    sourceRecordId: row.source_record_id
  };
}

export async function getOfficialHorseSnapshotsAsOf(env, horseIds, asOf) {
  if (!env.DB) throw new Error('DB is not configured');
  const ids = [...new Set((horseIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const cutoff = requireAsOf(asOf);
  const year = new Date(cutoff).getUTCFullYear();
  const ph = placeholders(ids);
  const result = new Map(ids.map((id) => [id, {
    age: null, currentRecord: null, officialStatistics: { year: null, life: null },
    coverage: { ownKnownStarts: 0, officialLifeStarts: null, gap: null, ratio: null, status: 'no_official_life' }
  }]));

  const { results: profiles } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT hps.*, ROW_NUMBER() OVER (PARTITION BY horse_id ORDER BY datetime(observed_at) DESC, id DESC) AS rn
      FROM horse_profile_snapshots hps
      WHERE horse_id IN (${ph}) AND datetime(observed_at) <= datetime(?)
    ) SELECT * FROM ranked WHERE rn = 1
  `).bind(...ids, cutoff).all();
  for (const row of profiles) result.get(row.horse_id).age = {
    years: row.age_years == null ? null : Number(row.age_years), observedAt: row.observed_at, sourceRecordId: row.source_record_id
  };

  const scope = `year:${year}`;
  const { results: stats } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT hss.*, ROW_NUMBER() OVER (PARTITION BY horse_id, snapshot_scope ORDER BY datetime(observed_at) DESC, id DESC) AS rn
      FROM horse_stat_snapshots hss
      WHERE horse_id IN (${ph}) AND snapshot_scope IN ('life', ?) AND datetime(observed_at) <= datetime(?)
    ) SELECT * FROM ranked WHERE rn = 1
  `).bind(...ids, scope, cutoff).all();
  for (const row of stats) {
    if (row.snapshot_scope === 'life') result.get(row.horse_id).officialStatistics.life = statFromRow(row);
    else result.get(row.horse_id).officialStatistics.year = statFromRow(row);
  }

  const { results: records } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT hrs.*, ROW_NUMBER() OVER (PARTITION BY horse_id ORDER BY datetime(observed_at) DESC, id DESC) AS rn
      FROM horse_record_snapshots hrs
      WHERE horse_id IN (${ph}) AND record_scope = 'current' AND datetime(observed_at) <= datetime(?)
    ) SELECT * FROM ranked WHERE rn = 1
  `).bind(...ids, cutoff).all();
  for (const row of records) result.get(row.horse_id).currentRecord = {
    code: row.code || null, startMethod: row.start_method || null, distanceGroup: row.distance_group || null,
    time: { minutes: row.time_minutes == null ? null : Number(row.time_minutes), seconds: row.time_seconds == null ? null : Number(row.time_seconds), tenths: row.time_tenths == null ? null : Number(row.time_tenths) },
    place: row.place == null ? null : Number(row.place), observedAt: row.observed_at, sourceRecordId: row.source_record_id
  };

  const { results: own } = await env.DB.prepare(`
    SELECT re.horse_id, COUNT(*) AS n
    FROM race_entries re
    JOIN race_results rr ON rr.race_entry_id = re.id
    JOIN source_records sr ON sr.id = rr.source_record_id
    WHERE re.horse_id IN (${ph})
      AND re.scratched = 0
      AND rr.result_status = 'official'
      AND datetime(sr.fetched_at) <= datetime(?)
    GROUP BY re.horse_id
  `).bind(...ids, cutoff).all();
  for (const row of own) result.get(row.horse_id).coverage.ownKnownStarts = Number(row.n);
  for (const value of result.values()) {
    const officialStarts = value.officialStatistics.life?.starts ?? null;
    value.coverage.officialLifeStarts = officialStarts;
    if (officialStarts == null) continue;
    const ownStarts = value.coverage.ownKnownStarts;
    value.coverage.gap = officialStarts - ownStarts;
    value.coverage.ratio = officialStarts > 0 ? ownStarts / officialStarts : null;
    value.coverage.status = ownStarts > officialStarts ? 'source_conflict' : ownStarts === officialStarts ? 'complete' : 'partial';
  }
  return result;
}

export async function getOfficialPersonAnnualSnapshotsAsOf(env, personType, personIds, asOf, statYear = null) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!['driver', 'trainer'].includes(personType)) throw new Error('personType must be driver or trainer');
  const ids = [...new Set((personIds || []).filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const cutoff = requireAsOf(asOf);
  const year = statYear == null ? new Date(cutoff).getUTCFullYear() : yearNumber(statYear, 'statYear');
  const { results } = await env.DB.prepare(`
    WITH ranked AS (
      SELECT pss.*, ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY datetime(observed_at) DESC, id DESC) AS rn
      FROM person_stat_snapshots pss
      WHERE person_type = ? AND person_id IN (${placeholders(ids)}) AND stat_year = ? AND datetime(observed_at) <= datetime(?)
    ) SELECT * FROM ranked WHERE rn = 1
  `).bind(personType, ...ids, year, cutoff).all();
  const out = new Map(ids.map((id) => [id, null]));
  for (const row of results) out.set(row.person_id, {
    starts: row.starts == null ? null : Number(row.starts), earningsRaw: row.earnings_raw == null ? null : Number(row.earnings_raw),
    wins: row.wins == null ? null : Number(row.wins), seconds: row.seconds == null ? null : Number(row.seconds),
    thirds: row.thirds == null ? null : Number(row.thirds), winPercentageRaw: row.win_percentage_raw == null ? null : Number(row.win_percentage_raw),
    statYear: Number(row.stat_year), observedAt: row.observed_at, sourceRecordId: row.source_record_id
  });
  return out;
}