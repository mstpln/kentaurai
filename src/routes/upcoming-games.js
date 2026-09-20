import { parsePaceSeconds } from '../statistics/horse-form-index.js';
import { swedenDateKey } from '../statistics/core.js';
import { raceScopeCondition } from '../race-scope.js';
import { getCalendarYearDetailForm } from '../entity-detail-calendar-statistics.js';

function normalizeGameType(value) {
  const type = String(value || '').toUpperCase();
  return type === 'V85' || type === 'V86' ? type : null;
}

function clampLimit(value, fallback = 30, max = 100) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function numeric(value) {
  return value == null ? null : Number(value);
}

function canonicalStartMethod(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'auto' || key === 'autostart') return 'auto';
  if (key === 'volt' || key === 'volte' || key === 'voltstart') return 'volt';
  return key || 'unknown';
}

export function distanceGroupForMeters(value) {
  const meters = Number(value);
  if (!Number.isFinite(meters)) return { key:'unknown', label:'Okänd distans', min:null, max:null };
  const standards = [640, 1640, 2140, 2640, 3140, 3640, 4140];
  for (const standard of standards) {
    if (meters >= standard - 100 && meters <= standard + 100) {
      return { key:String(standard), label:`${standard}-gruppen`, min:standard - 100, max:standard + 100 };
    }
  }
  if (meters > 2640) return { key:'other-long', label:'Övrig lång distans', min:2641, max:null };
  return { key:'unknown', label:'Övrig distans', min:null, max:null };
}

function laneContext(startMethod, lane) {
  const method = canonicalStartMethod(startMethod);
  const number = Number(lane);
  if (method === 'auto') {
    if (number >= 1 && number <= 8) {
      return { key:'auto_front', label:'Framspår auto', explanation:'Tidigare autostarter från framspår 1–8.' };
    }
    if (number >= 9 && number <= 12) {
      return { key:'auto_back', label:'Bakspår auto', explanation:'Tidigare autostarter från bakspår 9–12.' };
    }
    return { key:'auto_unknown', label:'Spårtyp auto', explanation:'Historik för relevant spårtyp saknas eftersom dagens spår inte kan klassificeras.' };
  }
  if (method === 'volt') {
    if ([1, 6, 7].includes(number)) {
      return { key:'volt_advantage', label:'Fördelsspår volt', explanation:'Tidigare voltstarter från spår 1, 6 eller 7 inom sin volt.' };
    }
    if (Number.isInteger(number) && number > 0) {
      return { key:'volt_other', label:'Övriga spår volt', explanation:'Tidigare voltstarter från övriga spår inom sin volt.' };
    }
    return { key:'volt_unknown', label:'Spårtyp volt', explanation:'Historik för relevant spårtyp saknas eftersom dagens spår inte kan klassificeras.' };
  }
  return { key:'unknown', label:'Dagens spårtyp', explanation:'Spårtyp kan inte klassificeras utan verifierad startmetod.' };
}

function cutoffDateTime(roundDate, scheduledStartAt) {
  if (scheduledStartAt) return scheduledStartAt;
  return `${roundDate}T23:59:59Z`;
}

function priorRaceCondition(alias = 'hr') {
  return `(
    (${alias}.scheduled_start_at IS NOT NULL AND datetime(${alias}.scheduled_start_at) < datetime(?))
    OR (${alias}.scheduled_start_at IS NULL AND ${alias}.race_date < ?)
  )`;
}

function rollingYearStart(dateText) {
  const [year, month, day] = String(dateText).slice(0, 10).split('-').map(Number);
  const candidate = new Date(Date.UTC(year - 1, month - 1, day));
  return candidate.toISOString().slice(0, 10);
}

function rate(starts, wins) {
  const s = Number(starts || 0);
  const w = Number(wins || 0);
  return { starts:s, wins:w, winRate:s ? w / s : null };
}

function gallopMetric(starts, gallops) {
  const s = Number(starts || 0);
  const g = Number(gallops || 0);
  return { starts:s, gallops:g, gallopRate:s ? g / s : null };
}

function formatBest(rows, field, predicate = () => true) {
  let best = null;
  let count = 0;
  for (const row of rows) {
    if (!predicate(row)) continue;
    const seconds = parsePaceSeconds(row[field]);
    if (seconds == null) continue;
    count += 1;
    if (!best || seconds < best.seconds) best = { seconds, value:row[field] };
  }
  return { value:best?.value || null, observationCount:count };
}

export async function listUpcomingGames(env, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const gameType = normalizeGameType(options.gameType);
  const asOfDate = String(options.asOfDate || swedenDateKey());
  const asOfNow = String(options.asOfNow || new Date().toISOString());
  const limit = clampLimit(options.limit);
  const bindings = [asOfDate, asOfDate, asOfNow];
  const typeFilter = gameType ? 'AND gr.game_type = ?' : '';
  if (gameType) bindings.push(gameType);
  bindings.push(limit);

  const { results } = await env.DB.prepare(`
    SELECT
      gr.id,
      gr.game_type,
      gr.round_date,
      COALESCE(gr.scheduled_start_at,(
        SELECT MIN(rstart.scheduled_start_at)
        FROM game_legs glstart JOIN races rstart ON rstart.id=glstart.race_id
        WHERE glstart.game_round_id=gr.id
      )) AS scheduled_start_at,
      gr.bet_stop_at,
      gr.status,
      (SELECT COUNT(*) FROM systems sx WHERE sx.game_round_id = gr.id) AS system_count,
      (
        SELECT GROUP_CONCAT(name, ' · ')
        FROM (
          SELECT DISTINCT t.canonical_name AS name
          FROM game_legs glt
          JOIN races rt ON rt.id = glt.race_id
          LEFT JOIN tracks t ON t.id = rt.track_id
          WHERE glt.game_round_id = gr.id AND t.canonical_name IS NOT NULL
          ORDER BY t.canonical_name COLLATE NOCASE ASC
        )
      ) AS track_names,
      (
        SELECT COUNT(*)
        FROM game_legs glc
        WHERE glc.game_round_id = gr.id
      ) AS leg_count,
      (
        SELECT COUNT(DISTINCT glr.leg_number)
        FROM game_legs glr
        JOIN race_entries rew ON rew.race_id = glr.race_id
        JOIN race_results rrw ON rrw.race_entry_id = rew.id AND rrw.placing = 1
        WHERE glr.game_round_id = gr.id
      ) AS settled_legs,
      (
        SELECT COUNT(*)
        FROM game_legs gla
        JOIN race_entries rea ON rea.race_id = gla.race_id
        WHERE gla.game_round_id = gr.id AND rea.scratched = 0
      ) AS active_entries,
      (
        SELECT COUNT(*)
        FROM game_legs glx
        JOIN race_entries rex ON rex.race_id = glx.race_id
        WHERE glx.game_round_id = gr.id
          AND rex.scratched = 0
          AND EXISTS (
            SELECT 1
            FROM race_entries hist_re
            JOIN races hist_r ON hist_r.id = hist_re.race_id
            JOIN xlabs_data xd ON xd.race_entry_id = hist_re.id
            JOIN source_records xsr ON xsr.id = xd.source_record_id
            WHERE hist_re.horse_id = rex.horse_id
              AND hist_re.scratched = 0
              AND hist_r.race_date < gr.round_date
              AND xd.quality_status = 'xlabs-telemetry-v1'
              AND xsr.source_type = 'xlabs_race_json'
          )
      ) AS xlabs_entries,
      (
        SELECT MAX(fetched_at)
        FROM (
          SELECT sr1.fetched_at AS fetched_at
          FROM game_legs gl1
          JOIN normalized_observations no1 ON no1.entity_type = 'race' AND no1.entity_id = gl1.race_id
          JOIN source_records sr1 ON sr1.id = no1.source_record_id
          WHERE gl1.game_round_id = gr.id
          UNION ALL
          SELECT COALESCE(sr2.fetched_at, bs2.captured_at) AS fetched_at
          FROM betting_snapshots bs2
          LEFT JOIN source_records sr2 ON sr2.id = bs2.source_record_id
          WHERE bs2.game_round_id = gr.id
        )
      ) AS latest_fetched_at
    FROM game_rounds gr
    WHERE gr.game_type IN ('V85','V86')
      AND (
        gr.round_date > ?
        OR (
          gr.round_date = ?
          AND datetime(COALESCE(
            gr.bet_stop_at,
            gr.scheduled_start_at,
            (SELECT MIN(rnow.scheduled_start_at) FROM game_legs glnow JOIN races rnow ON rnow.id=glnow.race_id WHERE glnow.game_round_id=gr.id),
            gr.round_date || 'T23:59:59Z'
          )) > datetime(?)
        )
      )
      ${typeFilter}
      AND (SELECT COUNT(*) FROM game_legs gl8 WHERE gl8.game_round_id = gr.id) = 8
      AND (
        SELECT COUNT(DISTINCT gls.leg_number)
        FROM game_legs gls
        JOIN race_entries res ON res.race_id = gls.race_id
        JOIN race_results rrs ON rrs.race_entry_id = res.id AND rrs.placing = 1
        WHERE gls.game_round_id = gr.id
      ) < 8
    ORDER BY gr.round_date ASC, COALESCE(gr.scheduled_start_at, gr.bet_stop_at, '') ASC, gr.id ASC
    LIMIT ?
  `).bind(...bindings).all();

  return {
    gameType,
    asOfDate,
    asOfNow,
    items:(results || []).map((row) => ({
      id:row.id,
      gameType:row.game_type,
      roundDate:row.round_date,
      scheduledStartAt:row.scheduled_start_at,
      betStopAt:row.bet_stop_at,
      roundStatus:row.status,
      trackNames:row.track_names || null,
      legCount:Number(row.leg_count || 0),
      settledLegs:Number(row.settled_legs || 0),
      systemCount:Number(row.system_count || 0),
      systemRegistered:Number(row.system_count || 0) > 0,
      xlabsCoverage:{
        covered:Number(row.xlabs_entries || 0),
        activeEntries:Number(row.active_entries || 0)
      },
      latestFetchedAt:row.latest_fetched_at || null
    }))
  };
}

export async function getUpcomingGameRound(env, roundId) {
  if (!env.DB) throw new Error('DB is not configured');
  const id = String(roundId || '').trim();
  if (!id) return null;
  const round = await env.DB.prepare(`
    SELECT gr.id, gr.game_type, gr.round_date, gr.scheduled_start_at, gr.bet_stop_at, gr.status,
      (SELECT COUNT(*) FROM systems sx WHERE sx.game_round_id=gr.id) system_count
    FROM game_rounds gr
    WHERE gr.id=? AND gr.game_type IN ('V85','V86')
    LIMIT 1
  `).bind(id).first();
  if (!round) return null;
  const { results:legs } = await env.DB.prepare(`
    SELECT gl.leg_number, r.id race_id, r.race_number, r.race_name, r.distance_m, r.start_method,
      r.scheduled_start_at, t.id track_id, t.canonical_name track_name,
      SUM(CASE WHEN re.scratched=0 THEN 1 ELSE 0 END) active_entries,
      SUM(CASE WHEN re.scratched=1 THEN 1 ELSE 0 END) scratched_entries
    FROM game_legs gl
    JOIN races r ON r.id=gl.race_id
    LEFT JOIN tracks t ON t.id=r.track_id
    LEFT JOIN race_entries re ON re.race_id=r.id
    WHERE gl.game_round_id=?
    GROUP BY gl.leg_number,r.id,r.race_number,r.race_name,r.distance_m,r.start_method,r.scheduled_start_at,t.id,t.canonical_name
    ORDER BY gl.leg_number
  `).bind(id).all();
  if ((legs || []).length !== 8) return null;
  return {
    id:round.id,
    gameType:round.game_type,
    roundDate:round.round_date,
    scheduledStartAt:round.scheduled_start_at,
    betStopAt:round.bet_stop_at,
    roundStatus:round.status,
    systemCount:Number(round.system_count || 0),
    systemRegistered:Number(round.system_count || 0) > 0,
    legs:(legs || []).map((row) => ({
      legNumber:Number(row.leg_number),
      raceId:row.race_id,
      raceNumber:row.race_number == null ? null : Number(row.race_number),
      raceName:row.race_name || null,
      trackId:row.track_id || null,
      trackName:row.track_name || null,
      distanceM:row.distance_m == null ? null : Number(row.distance_m),
      startMethod:canonicalStartMethod(row.start_method),
      scheduledStartAt:row.scheduled_start_at || null,
      activeEntries:Number(row.active_entries || 0),
      scratchedEntries:Number(row.scratched_entries || 0)
    }))
  };
}

export async function getUpcomingGameLeg(env, roundId, legNumber) {
  if (!env.DB) throw new Error('DB is not configured');
  const round = await getUpcomingGameRound(env, roundId);
  if (!round) return null;
  const leg = round.legs.find((item) => item.legNumber === Number(legNumber));
  if (!leg) return null;
  const targetStart = cutoffDateTime(round.roundDate, leg.scheduledStartAt || round.scheduledStartAt);

  const { results:entries } = await env.DB.prepare(`
    SELECT re.id race_entry_id,re.horse_id,re.driver_id,re.trainer_id,re.start_number,re.actual_lane,re.start_tier,
      re.handicap_m,re.scratched,h.canonical_name horse_name,h.sex,
      d.canonical_name driver_name,tr.canonical_name trainer_name,
      (
        SELECT bs.bet_percent
        FROM betting_snapshots bs
        WHERE bs.game_round_id=? AND bs.leg_number=? AND bs.race_entry_id=re.id
        ORDER BY datetime(bs.captured_at) DESC,bs.id DESC LIMIT 1
      ) bet_percent
    FROM race_entries re
    JOIN horses h ON h.id=re.horse_id
    LEFT JOIN drivers d ON d.id=re.driver_id
    LEFT JOIN trainers tr ON tr.id=re.trainer_id
    WHERE re.race_id=?
    ORDER BY re.start_number ASC,re.id ASC
  `).bind(round.id, leg.legNumber, leg.raceId).all();

  const { results:history } = await env.DB.prepare(`
    SELECT cur.id current_entry_id,hr.start_method,xd.first_200_time,xd.last_400_time,
      xsr.fetched_at
    FROM race_entries cur
    JOIN race_entries hre ON hre.horse_id=cur.horse_id AND hre.id<>cur.id AND hre.scratched=0
    JOIN races hr ON hr.id=hre.race_id
    JOIN xlabs_data xd ON xd.race_entry_id=hre.id
    JOIN source_records xsr ON xsr.id=xd.source_record_id
    WHERE cur.race_id=?
      AND xd.quality_status='xlabs-telemetry-v1'
      AND xsr.source_type='xlabs_race_json'
      AND ${priorRaceCondition('hr')}
    ORDER BY cur.id,hr.race_date DESC,hr.race_number DESC,xsr.fetched_at DESC,xd.id DESC
  `).bind(leg.raceId, targetStart, round.roundDate).all();

  const byEntry = new Map();
  for (const row of history || []) {
    if (!byEntry.has(row.current_entry_id)) byEntry.set(row.current_entry_id, []);
    byEntry.get(row.current_entry_id).push(row);
  }

  return {
    round:{ id:round.id, gameType:round.gameType, roundDate:round.roundDate, betStopAt:round.betStopAt },
    leg,
    entries:(entries || []).map((row) => {
      const rows = byEntry.get(row.race_entry_id) || [];
      return {
        raceEntryId:row.race_entry_id,
        horseId:row.horse_id,
        horseName:row.horse_name,
        sex:row.sex || null,
        driverId:row.driver_id || null,
        driverName:row.driver_name || null,
        trainerId:row.trainer_id || null,
        trainerName:row.trainer_name || null,
        startNumber:row.start_number == null ? null : Number(row.start_number),
        lane:row.actual_lane == null ? null : Number(row.actual_lane),
        startTier:row.start_tier == null ? null : Number(row.start_tier),
        handicapM:row.handicap_m == null ? 0 : Number(row.handicap_m),
        scratched:Number(row.scratched) === 1,
        betPercent:numeric(row.bet_percent),
        fastestFirst200:formatBest(rows, 'first_200_time', (item) => canonicalStartMethod(item.start_method) === leg.startMethod),
        fastestLast400:formatBest(rows, 'last_400_time')
      };
    })
  };
}

export async function getUpcomingLegHorseForms(env, roundId, legNumber, options = {}) {
  const data = await getUpcomingGameLeg(env, roundId, legNumber);
  if (!data) return null;
  const asOfDate = String(options.asOfDate || swedenDateKey());
  const forms = [];
  for (const entry of data.entries.filter((item) => !item.scratched)) {
    const form = await getCalendarYearDetailForm(env, 'horses', entry.horseId, {
      asOfDate,
      year:Number(asOfDate.slice(0, 4)),
      raceScope:'all',
      startMethod:'all',
      distanceGroup:'all'
    });
    forms.push({
      raceEntryId:entry.raceEntryId,
      horseId:entry.horseId,
      score:form?.formLast?.score ?? null,
      usedStarts:form?.formLast?.usedStarts ?? 0
    });
  }
  return { roundId:data.round.id, legNumber:data.leg.legNumber, forms };
}

function laneSql(context) {
  if (context.key === 'auto_front') return "(LOWER(COALESCE(hr.start_method,'')) IN ('auto','autostart') AND hre.actual_lane BETWEEN 1 AND 8)";
  if (context.key === 'auto_back') return "(LOWER(COALESCE(hr.start_method,'')) IN ('auto','autostart') AND hre.actual_lane BETWEEN 9 AND 12)";
  if (context.key === 'volt_advantage') return "(LOWER(COALESCE(hr.start_method,'')) IN ('volt','volte','voltstart') AND hre.actual_lane IN (1,6,7))";
  if (context.key === 'volt_other') return "(LOWER(COALESCE(hr.start_method,'')) IN ('volt','volte','voltstart') AND hre.actual_lane IS NOT NULL AND hre.actual_lane NOT IN (1,6,7))";
  return '0=1';
}

function distanceSql(group) {
  if (group.min != null && group.max != null) return `hr.distance_m BETWEEN ${Number(group.min)} AND ${Number(group.max)}`;
  if (group.key === 'other-long') {
    return `hr.distance_m > 2640
      AND NOT (hr.distance_m BETWEEN 2540 AND 2740)
      AND NOT (hr.distance_m BETWEEN 3040 AND 3240)
      AND NOT (hr.distance_m BETWEEN 3540 AND 3740)
      AND NOT (hr.distance_m BETWEEN 4040 AND 4240)`;
  }
  return '0=1';
}

export async function getUpcomingEntryFacts(env, roundId, legNumber, raceEntryId, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const round = await getUpcomingGameRound(env, roundId);
  if (!round) return null;
  const leg = round.legs.find((item) => item.legNumber === Number(legNumber));
  if (!leg) return null;
  const entry = await env.DB.prepare(`
    SELECT re.id,re.horse_id,re.driver_id,re.trainer_id,re.actual_lane,re.start_number,
      h.canonical_name horse_name,d.canonical_name driver_name,tr.canonical_name trainer_name
    FROM race_entries re
    JOIN horses h ON h.id=re.horse_id
    LEFT JOIN drivers d ON d.id=re.driver_id
    LEFT JOIN trainers tr ON tr.id=re.trainer_id
    WHERE re.id=? AND re.race_id=? LIMIT 1
  `).bind(String(raceEntryId), leg.raceId).first();
  if (!entry) return null;

  const asOfDate = String(options.asOfDate || swedenDateKey());
  const targetStart = cutoffDateTime(round.roundDate, leg.scheduledStartAt || round.scheduledStartAt);
  const priorDate = round.roundDate;
  const twelveMonthStart = rollingYearStart(asOfDate);
  const method = canonicalStartMethod(leg.startMethod);
  const methodCondition = method === 'auto'
    ? "LOWER(COALESCE(hr.start_method,'')) IN ('auto','autostart')"
    : method === 'volt'
      ? "LOWER(COALESCE(hr.start_method,'')) IN ('volt','volte','voltstart')"
      : '0=1';
  const group = distanceGroupForMeters(leg.distanceM);
  const lane = laneContext(method, entry.actual_lane);
  const highPrize = raceScopeCondition('high_prize', 'hr');
  const weekday = raceScopeCondition('weekday', 'hr');

  const metrics = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN hr.race_date>=? THEN 1 ELSE 0 END) win12_starts,
      SUM(CASE WHEN hr.race_date>=? AND rr.placing=1 THEN 1 ELSE 0 END) win12_wins,
      SUM(CASE WHEN rr.gallop IS NOT NULL THEN 1 ELSE 0 END) gallop_starts,
      SUM(CASE WHEN rr.gallop=1 THEN 1 ELSE 0 END) gallops,
      SUM(CASE WHEN hre.driver_id=? THEN 1 ELSE 0 END) driver_starts,
      SUM(CASE WHEN hre.driver_id=? AND rr.placing=1 THEN 1 ELSE 0 END) driver_wins,
      SUM(CASE WHEN hr.track_id=? THEN 1 ELSE 0 END) track_starts,
      SUM(CASE WHEN hr.track_id=? AND rr.placing=1 THEN 1 ELSE 0 END) track_wins,
      SUM(CASE WHEN ${methodCondition} THEN 1 ELSE 0 END) method_starts,
      SUM(CASE WHEN ${methodCondition} AND rr.placing=1 THEN 1 ELSE 0 END) method_wins,
      SUM(CASE WHEN ${distanceSql(group)} THEN 1 ELSE 0 END) distance_starts,
      SUM(CASE WHEN ${distanceSql(group)} AND rr.placing=1 THEN 1 ELSE 0 END) distance_wins,
      SUM(CASE WHEN ${laneSql(lane)} THEN 1 ELSE 0 END) lane_starts,
      SUM(CASE WHEN ${laneSql(lane)} AND rr.placing=1 THEN 1 ELSE 0 END) lane_wins,
      SUM(CASE WHEN ${highPrize} THEN 1 ELSE 0 END) high_starts,
      SUM(CASE WHEN ${highPrize} AND rr.placing=1 THEN 1 ELSE 0 END) high_wins,
      SUM(CASE WHEN ${weekday} THEN 1 ELSE 0 END) weekday_starts,
      SUM(CASE WHEN ${weekday} AND rr.placing=1 THEN 1 ELSE 0 END) weekday_wins
    FROM race_entries hre
    JOIN races hr ON hr.id=hre.race_id
    JOIN race_results rr ON rr.race_entry_id=hre.id
    WHERE hre.horse_id=?
      AND hre.scratched=0
      AND ${priorRaceCondition('hr')}
  `).bind(
    twelveMonthStart,twelveMonthStart,
    entry.driver_id,entry.driver_id,
    leg.trackId,leg.trackId,
    entry.horse_id,targetStart,priorDate
  ).first();

  const formOptions = {
    asOfDate,
    year:Number(asOfDate.slice(0, 4)),
    raceScope:'all',
    startMethod:'all',
    distanceGroup:'all'
  };
  const [driverForm, trainerForm] = await Promise.all([
    entry.driver_id ? getCalendarYearDetailForm(env, 'drivers', entry.driver_id, formOptions) : Promise.resolve(null),
    entry.trainer_id ? getCalendarYearDetailForm(env, 'trainers', entry.trainer_id, formOptions) : Promise.resolve(null)
  ]);

  return {
    roundId:round.id,
    legNumber:leg.legNumber,
    raceEntryId:entry.id,
    horse:{ id:entry.horse_id, name:entry.horse_name },
    driver:{ id:entry.driver_id || null, name:entry.driver_name || null, form:driverForm?.formLast?.score ?? null },
    trainer:{ id:entry.trainer_id || null, name:entry.trainer_name || null, form:trainerForm?.formLast?.score ?? null },
    metrics:{
      rolling12Months:rate(metrics?.win12_starts, metrics?.win12_wins),
      gallop:gallopMetric(metrics?.gallop_starts, metrics?.gallops),
      currentDriver:rate(metrics?.driver_starts, metrics?.driver_wins),
      currentTrack:rate(metrics?.track_starts, metrics?.track_wins),
      sameStartMethod:rate(metrics?.method_starts, metrics?.method_wins),
      sameDistanceGroup:{ ...rate(metrics?.distance_starts, metrics?.distance_wins), key:group.key, label:group.label, minM:group.min, maxM:group.max },
      laneType:{ ...rate(metrics?.lane_starts, metrics?.lane_wins), ...lane },
      highPrize:rate(metrics?.high_starts, metrics?.high_wins),
      weekday:rate(metrics?.weekday_starts, metrics?.weekday_wins)
    }
  };
}
