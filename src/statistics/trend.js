import {
  addTrendRaceFilters,
  coreMetricSelectSql,
  mapCoreMetricRow,
  normalizeTrackId,
  normalizeTrendBreed,
  normalizeTrendCategory,
  normalizeTrendMinStarts,
  normalizeTrendRaceScope,
  normalizeTrendRaceType,
  normalizeTrendStartMethod,
  trendDateWindow
} from './core.js';
import {
  calculateHorseFormIndex,
  fieldPercentileScore,
  parsePaceSeconds,
  prizeDifficultyScore,
  relativeChallengeScore,
  resultPerformanceScore,
  weightedAvailable
} from './horse-form-index.js';

const CATEGORY_CONFIG = Object.freeze({
  horses: { entityTable: 'horses', relationColumn: 'horse_id' },
  trainers: { entityTable: 'trainers', relationColumn: 'trainer_id' },
  drivers: { entityTable: 'drivers', relationColumn: 'driver_id' }
});

async function validateTrack(env, trackId) {
  if (!trackId) return;
  const found = await env.DB.prepare('SELECT 1 AS ok FROM tracks WHERE id = ? LIMIT 1').bind(trackId).first();
  if (!found?.ok) throw new Error('track_id does not identify a stored track');
}

export function buildTrendQuery(options = {}) {
  const category = normalizeTrendCategory(options.category);
  const raceScope = normalizeTrendRaceScope(options.raceScope);
  const raceType = normalizeTrendRaceType(options.raceType);
  const breedType = normalizeTrendBreed(options.breedType);
  const startMethod = normalizeTrendStartMethod(options.startMethod);
  const minStarts = normalizeTrendMinStarts(options.minStarts);
  const trackId = normalizeTrackId(options.trackId);
  const window = trendDateWindow(options.period, options.asOfDate);
  const config = CATEGORY_CONFIG[category];
  const conditions = [
    're.scratched = 0',
    'r.race_date >= ?',
    'r.race_date <= ?'
  ];
  const bindings = [window.startDate, window.endDate];
  addTrendRaceFilters(conditions, bindings, { raceScope, raceType, breedType, startMethod, trackId });

  const minimumCondition = minStarts == null ? 'starts > 0' : 'starts >= ?';
  if (minStarts != null) bindings.push(minStarts);

  const sql = `
    WITH trend_stats AS (
      SELECT
        entity.id AS entity_id,
        entity.canonical_name AS name,
        ${coreMetricSelectSql('rr')}
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      JOIN ${config.entityTable} entity ON entity.id = re.${config.relationColumn}
      WHERE ${conditions.join(' AND ')}
      GROUP BY entity.id, entity.canonical_name
    )
    SELECT * FROM trend_stats
    WHERE ${minimumCondition}
    ORDER BY (wins * 1.0 / starts) DESC, wins DESC, starts DESC, entity_id ASC
    LIMIT 10
  `;

  return {
    sql,
    bindings,
    normalized: {
      category,
      period: window.period,
      startDate: window.startDate,
      endDate: window.endDate,
      raceScope,
      trackId,
      raceType,
      breedType,
      startMethod,
      minStarts
    }
  };
}


function stlDifficultyScore(value) {
  const scores = { class_iii:35, class_ii:45, class_i:55, bronze:65, silver:75, gold:90 };
  return value && Object.prototype.hasOwnProperty.call(scores, value) ? scores[value] : null;
}

async function getHorseFormTrendLeaderboard(env, normalized) {
  const conditions = ['re.scratched = 0', 'r.race_date >= ?', 'r.race_date <= ?'];
  const bindings = [normalized.startDate, normalized.endDate];
  addTrendRaceFilters(conditions, bindings, normalized);
  const minimum = normalized.minStarts == null ? 1 : normalized.minStarts;
  const { results: targetRows } = await env.DB.prepare(`
    WITH filtered AS (
      SELECT
        h.id AS entity_id,
        h.canonical_name AS name,
        re.id AS race_entry_id,
        r.id AS race_id,
        r.race_date,
        r.race_number,
        r.scheduled_start_at,
        r.first_prize_sek,
        r.distance_m,
        re.actual_start_distance_m,
        rr.placing,
        rr.disqualified,
        rr.gallop,
        rr.prize_sek,
        rsc.stl_class
      FROM races r INDEXED BY idx_races_date
      JOIN race_entries re ON re.race_id = r.id
      JOIN race_results rr ON rr.race_entry_id = re.id
      JOIN horses h ON h.id = re.horse_id
      LEFT JOIN race_stl_classifications rsc ON rsc.race_id = r.id
      WHERE ${conditions.join(' AND ')}
    ),
    eligible AS (
      SELECT
        entity_id,
        COUNT(*) AS starts,
        COUNT(*) AS result_starts,
        SUM(CASE WHEN placing = 1 THEN 1 ELSE 0 END) AS wins,
        SUM(CASE WHEN placing = 2 THEN 1 ELSE 0 END) AS seconds,
        SUM(CASE WHEN placing = 3 THEN 1 ELSE 0 END) AS thirds,
        SUM(CASE WHEN placing BETWEEN 1 AND 3 THEN 1 ELSE 0 END) AS top3,
        SUM(CASE WHEN gallop = 1 THEN 1 ELSE 0 END) AS gallops,
        SUM(CASE WHEN gallop IS NOT NULL THEN 1 ELSE 0 END) AS gallop_verified_starts,
        SUM(CASE WHEN disqualified = 1 THEN 1 ELSE 0 END) AS disqualifications,
        SUM(CASE WHEN prize_sek IS NOT NULL THEN 1 ELSE 0 END) AS prize_verified_starts,
        SUM(prize_sek) AS total_prize_sek
      FROM filtered
      GROUP BY entity_id
      HAVING COUNT(*) >= ?
    ),
    ranked AS (
      SELECT
        f.*,
        e.starts,e.result_starts,e.wins,e.seconds,e.thirds,e.top3,e.gallops,
        e.gallop_verified_starts,e.disqualifications,e.prize_verified_starts,e.total_prize_sek,
        ROW_NUMBER() OVER (
          PARTITION BY f.entity_id
          ORDER BY f.race_date DESC,COALESCE(f.race_number,0) DESC,f.race_entry_id DESC
        ) AS rn
      FROM filtered f
      JOIN eligible e ON e.entity_id = f.entity_id
    )
    SELECT * FROM ranked WHERE rn <= 5 ORDER BY entity_id,rn
  `).bind(...bindings, minimum).all();

  const targets = targetRows || [];
  if (!targets.length) return [];
  const raceIds = [...new Set(targets.map(row => row.race_id))];
  const raceIdsJson = JSON.stringify(raceIds);

  const [{ results: fieldRows }, { results: opponentRows }] = await Promise.all([
    env.DB.prepare(`
      WITH latest_x AS (
        SELECT x.*,ROW_NUMBER() OVER (
          PARTITION BY x.race_entry_id
          ORDER BY julianday(sr.fetched_at) DESC,x.source_record_id DESC
        ) rn
        FROM xlabs_data x
        JOIN source_records sr ON sr.id=x.source_record_id
        WHERE x.quality_status='xlabs-telemetry-v1'
          AND sr.source_type='xlabs_race_json'
          AND substr(sr.fetched_at,1,10)<=?
      )
      SELECT re.race_id,re.id race_entry_id,re.horse_id,re.actual_start_distance_m,r.distance_m,
        rr.placing,rr.disqualified,rr.km_time,x.last_400_time,x.extra_distance_m
      FROM race_entries re
      JOIN races r ON r.id=re.race_id
      LEFT JOIN race_results rr ON rr.race_entry_id=re.id
      LEFT JOIN latest_x x ON x.race_entry_id=re.id AND x.rn=1
      WHERE re.scratched=0 AND re.race_id IN (SELECT value FROM json_each(?))
      ORDER BY re.race_id,re.start_number,re.id
    `).bind(normalized.endDate,raceIdsJson).all(),
    env.DB.prepare(`
      SELECT re.race_id,re.horse_id,
        (
          SELECT hss.start_points FROM horse_stat_snapshots hss
          JOIN official_snapshot_source_sync os ON os.source_record_id=hss.source_record_id AND os.status='complete'
          JOIN source_records sr ON sr.id=hss.source_record_id
          WHERE hss.horse_id=re.horse_id AND hss.snapshot_scope='life'
            AND julianday(hss.observed_at)<=julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59Z'))
            AND julianday(sr.fetched_at)<=julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59Z'))
          ORDER BY julianday(hss.observed_at) DESC,hss.id DESC LIMIT 1
        ) start_points,
        (
          SELECT hss.earnings_raw FROM horse_stat_snapshots hss
          JOIN official_snapshot_source_sync os ON os.source_record_id=hss.source_record_id AND os.status='complete'
          JOIN source_records sr ON sr.id=hss.source_record_id
          WHERE hss.horse_id=re.horse_id AND hss.snapshot_scope='life'
            AND julianday(hss.observed_at)<=julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59Z'))
            AND julianday(sr.fetched_at)<=julianday(COALESCE(r.scheduled_start_at,r.race_date||'T23:59:59Z'))
          ORDER BY julianday(hss.observed_at) DESC,hss.id DESC LIMIT 1
        ) earnings_raw
      FROM race_entries re JOIN races r ON r.id=re.race_id
      WHERE re.scratched=0 AND re.race_id IN (SELECT value FROM json_each(?))
    `).bind(raceIdsJson).all()
  ]);

  const byRace = new Map();
  for (const row of fieldRows || []) {
    if (!byRace.has(row.race_id)) byRace.set(row.race_id, []);
    byRace.get(row.race_id).push(row);
  }
  const contextByRace = new Map();
  for (const row of opponentRows || []) {
    if (!contextByRace.has(row.race_id)) contextByRace.set(row.race_id, []);
    contextByRace.get(row.race_id).push(row);
  }
  const byHorse = new Map();
  for (const row of targets) {
    if (!byHorse.has(row.entity_id)) byHorse.set(row.entity_id, []);
    byHorse.get(row.entity_id).push(row);
  }

  const median = values => values.length ? values[Math.floor((values.length - 1) / 2)] : null;
  const items = [];
  for (const [horseId, horseRows] of byHorse) {
    const scored = horseRows.map(target => {
      const field = byRace.get(target.race_id) || [];
      const targetField = field.find(row => row.race_entry_id === target.race_entry_id) || null;
      const resultScore = resultPerformanceScore({
        placing:target.placing,
        disqualified:target.disqualified,
        fieldSize:field.length
      });

      const context = contextByRace.get(target.race_id) || [];
      const self = context.find(row => row.horse_id === horseId) || null;
      const opponents = context.filter(row => row.horse_id !== horseId);
      const pointValues = opponents.filter(row => row.start_points != null).map(row => Number(row.start_points)).filter(Number.isFinite).sort((a,b)=>a-b);
      const earningValues = opponents.filter(row => row.earnings_raw != null).map(row => Number(row.earnings_raw)).filter(Number.isFinite).sort((a,b)=>a-b);
      const difficultyScore = weightedAvailable([
        { value:prizeDifficultyScore(target.first_prize_sek), weight:0.55 },
        { value:stlDifficultyScore(target.stl_class), weight:0.15 },
        { value:relativeChallengeScore(median(pointValues), self?.start_points), weight:0.20 },
        { value:relativeChallengeScore(median(earningValues), self?.earnings_raw), weight:0.10 }
      ]);

      const extraValues = field.map(row => {
        const distance = Number(row.actual_start_distance_m ?? row.distance_m);
        const extra = Number(row.extra_distance_m);
        return Number.isFinite(extra) && distance > 0 ? (extra / distance) * 100 : null;
      }).filter(value => value != null);
      const targetDistance = Number(targetField?.actual_start_distance_m ?? targetField?.distance_m);
      const targetExtra = Number(targetField?.extra_distance_m);
      const workScore = fieldPercentileScore(
        Number.isFinite(targetExtra) && targetDistance > 0 ? (targetExtra / targetDistance) * 100 : null,
        extraValues
      );

      const officialPaces = field.map(row => parsePaceSeconds(row.km_time)).filter(value => value != null);
      const closingPaces = field.map(row => parsePaceSeconds(row.last_400_time)).filter(value => value != null);
      const officialScore = fieldPercentileScore(parsePaceSeconds(targetField?.km_time),officialPaces,{lowerIsBetter:true});
      const closingScore = fieldPercentileScore(parsePaceSeconds(targetField?.last_400_time),closingPaces,{lowerIsBetter:true});
      const speedScore = weightedAvailable([{value:officialScore,weight:0.5},{value:closingScore,weight:0.5}]);
      return {
        raceEntryId:target.race_entry_id,
        raceId:target.race_id,
        raceDate:target.race_date,
        resultScore,difficultyScore,workScore,speedScore
      };
    });

    const form = calculateHorseFormIndex(scored);
    const first = horseRows[0];
    const core = mapCoreMetricRow({
      starts:first.starts,
      result_starts:first.result_starts,
      wins:first.wins,
      seconds:first.seconds,
      thirds:first.thirds,
      top3:first.top3,
      gallops:first.gallops,
      gallop_verified_starts:first.gallop_verified_starts,
      disqualifications:first.disqualifications,
      prize_verified_starts:first.prize_verified_starts,
      prize_sek:first.total_prize_sek
    });
    items.push({
      id:horseId,
      name:first.name,
      formScore:form.score,
      formUsedStarts:form.usedStarts,
      recentPlacings:horseRows.map(row => Number(row.disqualified) === 1 ? 'd' : (row.placing == null ? null : Number(row.placing))),
      ...core
    });
  }

  return items
    .filter(item => item.formScore != null)
    .sort((a,b) => b.formScore - a.formScore || b.formUsedStarts - a.formUsedStarts || (b.winRate || 0) - (a.winRate || 0) || String(a.id).localeCompare(String(b.id)))
    .slice(0,10)
    .map((item,index)=>({rank:index+1,...item}));
}

export async function getTrendLeaderboard(env, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const query = buildTrendQuery(options);
  await validateTrack(env, query.normalized.trackId);
  if (query.normalized.category === 'horses') {
    return {
      category:'horses',
      filters: {
        period: query.normalized.period,
        startDate: query.normalized.startDate,
        endDate: query.normalized.endDate,
        raceScope: query.normalized.raceScope,
        trackId: query.normalized.trackId,
        raceType: query.normalized.raceType,
        breedType: query.normalized.breedType,
        startMethod: query.normalized.startMethod,
        minStarts: query.normalized.minStarts
      },
      rankingMetric:'horse_form_index_v1',
      items: await getHorseFormTrendLeaderboard(env, query.normalized)
    };
  }
  const { results } = await env.DB.prepare(query.sql).bind(...query.bindings).all();
  return {
    category: query.normalized.category,
    filters: {
      period: query.normalized.period,
      startDate: query.normalized.startDate,
      endDate: query.normalized.endDate,
      raceScope: query.normalized.raceScope,
      trackId: query.normalized.trackId,
      raceType: query.normalized.raceType,
      breedType: query.normalized.breedType,
      startMethod: query.normalized.startMethod,
      minStarts: query.normalized.minStarts
    },
    items: results.map((row, index) => ({
      rank: index + 1,
      id: row.entity_id,
      name: row.name,
      ...mapCoreMetricRow(row)
    }))
  };
}

export async function getTrendFilterOptions(env) {
  if (!env.DB) throw new Error('DB is not configured');
  const { results } = await env.DB.prepare(`
    SELECT DISTINCT t.id, t.canonical_name AS name
    FROM tracks t
    JOIN races r ON r.track_id = t.id
    JOIN race_entries re ON re.race_id = r.id AND re.scratched = 0
    JOIN race_results rr ON rr.race_entry_id = re.id
    ORDER BY t.canonical_name COLLATE NOCASE ASC, t.id ASC
  `).all();
  return { tracks: results };
}
