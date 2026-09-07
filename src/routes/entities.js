const ENTITY_CONFIG = {
  horses: {
    table: 'horses',
    idColumn: 'id',
    nameColumn: 'canonical_name',
    externalTable: 'horse_external_ids',
    externalIdColumn: 'horse_id',
    label: 'häst'
  },
  trainers: {
    table: 'trainers',
    idColumn: 'id',
    nameColumn: 'canonical_name',
    externalTable: 'trainer_external_ids',
    externalIdColumn: 'trainer_id',
    label: 'tränare'
  },
  drivers: {
    table: 'drivers',
    idColumn: 'id',
    nameColumn: 'canonical_name',
    externalTable: 'driver_external_ids',
    externalIdColumn: 'driver_id',
    label: 'kusk'
  }
};

function configFor(type) {
  const config = ENTITY_CONFIG[type];
  if (!config) throw new Error('unsupported entity type');
  return config;
}

function sanitizeQuery(value) {
  return String(value || '').trim().slice(0, 80);
}

function clampLimit(value, fallback = 50, max = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export async function getEntitySummary(env) {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM horses) AS horses,
      (SELECT COUNT(*) FROM trainers) AS trainers,
      (SELECT COUNT(*) FROM drivers) AS drivers,
      (SELECT COUNT(*) FROM races) AS races,
      (SELECT COUNT(*) FROM race_entries) AS entries,
      (SELECT COUNT(*) FROM race_results) AS results
  `).first();
  const results = Number(row?.results ?? 0);
  return {
    counts: {
      horses: Number(row?.horses ?? 0),
      trainers: Number(row?.trainers ?? 0),
      drivers: Number(row?.drivers ?? 0),
      races: Number(row?.races ?? 0),
      entries: Number(row?.entries ?? 0),
      results
    },
    trends: {
      available: results > 0,
      reason: results > 0 ? null : 'Historiska resultat är ännu inte importerade.'
    }
  };
}

export async function searchEntities(env, query, limitValue) {
  const q = sanitizeQuery(query);
  if (!q) return [];
  const limit = clampLimit(limitValue, 20, 40);
  const like = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const { results } = await env.DB.prepare(`
    SELECT type, id, name FROM (
      SELECT 'horse' AS type, id, canonical_name AS name FROM horses WHERE canonical_name LIKE ? ESCAPE '\\'
      UNION ALL
      SELECT 'trainer' AS type, id, canonical_name AS name FROM trainers WHERE canonical_name LIKE ? ESCAPE '\\'
      UNION ALL
      SELECT 'driver' AS type, id, canonical_name AS name FROM drivers WHERE canonical_name LIKE ? ESCAPE '\\'
    )
    ORDER BY name COLLATE NOCASE ASC
    LIMIT ?
  `).bind(like, like, like, limit).all();
  return results;
}

export async function listEntities(env, type, options = {}) {
  const config = configFor(type);
  const q = sanitizeQuery(options.q);
  const limit = clampLimit(options.limit, 50, 100);
  const like = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const filter = q ? `WHERE e.${config.nameColumn} LIKE ? ESCAPE '\\'` : '';
  const sql = `
    SELECT
      e.${config.idColumn} AS id,
      e.${config.nameColumn} AS name,
      x.external_id AS external_id
    FROM ${config.table} e
    LEFT JOIN ${config.externalTable} x
      ON x.${config.externalIdColumn} = e.${config.idColumn}
      AND x.source_type = 'official'
    ${filter}
    ORDER BY e.${config.nameColumn} COLLATE NOCASE ASC
    LIMIT ?
  `;
  const statement = env.DB.prepare(sql);
  const { results } = q
    ? await statement.bind(like, limit).all()
    : await statement.bind(limit).all();
  return { type, label: config.label, items: results };
}

async function getHorseDetail(env, id) {
  const horse = await env.DB.prepare(`
    SELECT
      h.id,
      h.canonical_name AS name,
      h.sex,
      h.birth_year,
      h.breed,
      h.color,
      h.sire_name,
      h.dam_name,
      h.damsire_name,
      h.breeder,
      h.owner,
      h.country_code,
      h.career_earnings_sek,
      t.id AS trainer_id,
      t.canonical_name AS trainer_name,
      tr.canonical_name AS home_track_name,
      x.external_id AS external_id
    FROM horses h
    LEFT JOIN trainers t ON t.id = h.current_trainer_id
    LEFT JOIN tracks tr ON tr.id = h.home_track_id
    LEFT JOIN horse_external_ids x ON x.horse_id = h.id AND x.source_type = 'official'
    WHERE h.id = ?
    LIMIT 1
  `).bind(id).first();
  if (!horse) return null;
  const { results: starts } = await env.DB.prepare(`
    SELECT
      re.id AS entry_id,
      r.id AS race_id,
      r.race_date,
      r.race_number,
      r.distance_m,
      r.start_method,
      re.start_number,
      re.actual_lane,
      re.handicap_m,
      re.actual_start_distance_m,
      d.id AS driver_id,
      d.canonical_name AS driver_name,
      tr.canonical_name AS track_name,
      rr.placing,
      rr.placing_text,
      rr.finish_time,
      rr.km_time,
      rr.prize_sek,
      rr.official_odds
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    LEFT JOIN tracks tr ON tr.id = r.track_id
    LEFT JOIN drivers d ON d.id = re.driver_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.horse_id = ?
    ORDER BY r.race_date DESC, r.race_number DESC
    LIMIT 50
  `).bind(id).all();
  return { type: 'horse', entity: horse, starts };
}

async function getPersonDetail(env, type, id) {
  const driver = type === 'drivers';
  const table = driver ? 'drivers' : 'trainers';
  const externalTable = driver ? 'driver_external_ids' : 'trainer_external_ids';
  const externalIdColumn = driver ? 'driver_id' : 'trainer_id';
  const person = await env.DB.prepare(`
    SELECT
      p.id,
      p.canonical_name AS name,
      p.country_code,
      ${driver ? 'tr.canonical_name AS home_track_name,' : 'NULL AS home_track_name,'}
      x.external_id AS external_id
    FROM ${table} p
    ${driver ? 'LEFT JOIN tracks tr ON tr.id = p.home_track_id' : ''}
    LEFT JOIN ${externalTable} x ON x.${externalIdColumn} = p.id AND x.source_type = 'official'
    WHERE p.id = ?
    LIMIT 1
  `).bind(id).first();
  if (!person) return null;

  const relationColumn = driver ? 'driver_id' : 'trainer_id';
  const { results: starts } = await env.DB.prepare(`
    SELECT
      re.id AS entry_id,
      r.id AS race_id,
      r.race_date,
      r.race_number,
      r.distance_m,
      r.start_method,
      h.id AS horse_id,
      h.canonical_name AS horse_name,
      tr.canonical_name AS track_name,
      re.start_number,
      rr.placing,
      rr.placing_text,
      rr.km_time,
      rr.prize_sek,
      rr.official_odds
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    JOIN horses h ON h.id = re.horse_id
    LEFT JOIN tracks tr ON tr.id = r.track_id
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.${relationColumn} = ?
    ORDER BY r.race_date DESC, r.race_number DESC
    LIMIT 100
  `).bind(id).all();

  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*) AS starts,
      SUM(CASE WHEN rr.placing = 1 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN rr.placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
      SUM(COALESCE(rr.prize_sek, 0)) AS prize_sek
    FROM race_entries re
    LEFT JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.${relationColumn} = ? AND rr.race_entry_id IS NOT NULL
  `).bind(id).first();

  const startsWithResults = Number(stats?.starts ?? 0);
  return {
    type: driver ? 'driver' : 'trainer',
    entity: person,
    stats: {
      starts: startsWithResults,
      wins: Number(stats?.wins ?? 0),
      top3: Number(stats?.top3 ?? 0),
      prizeSek: Number(stats?.prize_sek ?? 0),
      winRate: startsWithResults ? Number(stats?.wins ?? 0) / startsWithResults : null,
      top3Rate: startsWithResults ? Number(stats?.top3 ?? 0) / startsWithResults : null
    },
    starts
  };
}

export async function getEntityDetail(env, type, id) {
  configFor(type);
  const normalizedId = String(id || '').trim();
  if (!normalizedId) return null;
  if (type === 'horses') return getHorseDetail(env, normalizedId);
  return getPersonDetail(env, type, normalizedId);
}
