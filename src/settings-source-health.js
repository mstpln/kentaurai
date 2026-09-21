const HISTORICAL_STALE_MS = 15 * 60 * 1000;
const RUN_STALE_MS = 30 * 60 * 1000;
const MAX_AUTOMATIC_ERRORS = 3;

function isoTime(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function newestIso(...values) {
  let best = null;
  let bestTime = -Infinity;
  for (const value of values.flat().filter(Boolean)) {
    const time = isoTime(value);
    if (time !== null && time > bestTime) {
      best = value;
      bestTime = time;
    }
  }
  return best;
}

function daysInclusive(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.floor((end - start) / 86400000) + 1;
}

function historicalProcessing(job, nowMs) {
  if (!job) {
    return {
      status: 'never_run',
      progressPercent: null,
      totalDates: null,
      processedDates: 0,
      remainingDates: null,
      processedRaces: 0,
      reusedRaces: 0,
      unavailableDates: 0,
      unavailableRaces: 0,
      currentDate: null,
      nextRaceIndex: 0,
      consecutiveErrors: 0,
      lastRunAt: null,
      lastError: null,
      retryAfter: null
    };
  }

  const totalDates = daysInclusive(job.start_date, job.end_date);
  const processedDates = Math.max(0, Number(job.processed_dates || 0));
  const completed = job.status === 'completed';
  const progressPercent = totalDates
    ? Math.max(0, Math.min(100, completed ? 100 : (processedDates / totalDates) * 100))
    : null;
  const retryAfterMs = isoTime(job.retry_after);
  const lastActivityMs = isoTime(job.last_run_at || job.updated_at || job.created_at);
  const retryScheduled = job.status === 'running'
    && retryAfterMs !== null
    && retryAfterMs > nowMs;
  const waiting = retryScheduled && Number(job.consecutive_errors || 0) === 0;
  const stale = job.status === 'running'
    && !retryScheduled
    && lastActivityMs !== null
    && nowMs - lastActivityMs > HISTORICAL_STALE_MS;

  let status = 'running';
  if (completed) status = 'completed';
  else if (job.status === 'failed' || stale) status = 'action_required';
  else if (waiting) status = 'waiting';

  return {
    status,
    progressPercent,
    totalDates,
    processedDates,
    remainingDates: totalDates == null ? null : Math.max(0, totalDates - processedDates),
    processedRaces: Math.max(0, Number(job.processed_races || 0)),
    reusedRaces: Math.max(0, Number(job.reused_races || 0)),
    unavailableDates: Math.max(0, Number(job.unavailable_dates || 0)),
    unavailableRaces: Math.max(0, Number(job.unavailable_races || 0)),
    currentDate: completed ? null : job.next_date,
    nextRaceIndex: Math.max(0, Number(job.next_race_index || 0)),
    consecutiveErrors: Math.max(0, Number(job.consecutive_errors || 0)),
    lastRunAt: job.last_run_at || null,
    lastError: job.last_error || null,
    retryAfter: job.retry_after || null,
    stale
  };
}

function jobIssue(sourceId, job, processing, nowMs, scope) {
  if (!job) return null;
  const checkpoint = `${job.next_date || 'none'}:${Number(job.next_race_index || 0)}`;
  const prefix = `${sourceId}:${scope}:${job.id}:${checkpoint}`;

  if (job.status === 'failed') {
    return {
      key: `${prefix}:action_required`,
      sourceId,
      severity: 'action_required',
      label: 'Åtgärd krävs',
      message: 'Automatiska försök har stoppats och importen behöver åtgärdas innan den kan fortsätta.',
      error: job.last_error || null,
      at: job.last_run_at || job.updated_at || job.created_at || null
    };
  }

  if (processing?.stale) {
    return {
      key: `${prefix}:stale`,
      sourceId,
      severity: 'action_required',
      label: 'Åtgärd krävs',
      message: 'Importen står som pågående men har inte registrerat ny aktivitet inom förväntad tid.',
      error: job.last_error || null,
      at: job.last_run_at || job.updated_at || job.created_at || null
    };
  }

  if (job.status === 'running' && Number(job.consecutive_errors || 0) > 0) {
    return {
      key: `${prefix}:retrying`,
      sourceId,
      severity: 'error_retrying',
      label: 'Fel upptäckt · nytt försök pågår',
      message: 'Senaste försöket misslyckades. KentaurAI försöker igen automatiskt och ingen manuell åtgärd krävs ännu.',
      error: job.last_error || null,
      at: job.last_run_at || job.updated_at || job.created_at || null
    };
  }

  return null;
}

function runIssue(sourceId, run, nowMs) {
  if (!run) return null;
  const status = String(run.status || '').toLowerCase();
  const errors = Number(run.error_count || 0);
  const failed = errors > 0 || status.includes('fail') || status.includes('error');
  const startedMs = isoTime(run.started_at);
  const running = status.includes('run') || status.includes('start') || status.includes('pending');
  const stale = running && startedMs !== null && nowMs - startedMs > RUN_STALE_MS;

  if (!failed && !stale) return null;

  let parsedError = null;
  if (run.error_json) {
    try { parsedError = JSON.parse(run.error_json)?.message || null; } catch {}
  }

  return {
    key: `${sourceId}:run:${run.source_type}:${run.id}:${stale ? 'stale' : 'error'}`,
    sourceId,
    severity: stale ? 'action_required' : 'error_retrying',
    label: stale ? 'Åtgärd krävs' : 'Fel upptäckt',
    message: stale
      ? 'En schemalagd körning står fortfarande som pågående och har inte avslutats inom förväntad tid.'
      : 'En schemalagd körning misslyckades. Nästa försök sker automatiskt enligt schemat.',
    error: parsedError,
    at: run.finished_at || run.started_at || null
  };
}

function strongestIssue(issues) {
  return [...issues].sort((a, b) => {
    const rank = { action_required: 2, error_retrying: 1 };
    const severity = (rank[b.severity] || 0) - (rank[a.severity] || 0);
    if (severity) return severity;
    return (isoTime(b.at) || 0) - (isoTime(a.at) || 0);
  })[0] || null;
}

function sourceStatus(hasEvidence, issues) {
  const strongest = strongestIssue(issues);
  if (strongest?.severity === 'action_required') return 'action_required';
  if (strongest) return 'error_retrying';
  return hasEvidence ? 'working' : 'never_run';
}

async function latestHistoricalOfficial(env) {
  return env.DB.prepare(`
    SELECT id, start_date, end_date, next_date, next_race_index, status,
           processed_dates, processed_races, reused_races, consecutive_errors,
           last_error, last_run_at,
           CASE WHEN consecutive_errors > 0 THEN lease_until ELSE NULL END AS retry_after,
           created_at, updated_at
    FROM historical_backfill_jobs
    WHERE start_date <> end_date
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `).first();
}

async function latestHistoricalXlabs(env) {
  return env.DB.prepare(`
    SELECT id, start_date, end_date, next_date, next_race_index, status,
           processed_dates, processed_races, reused_races, unavailable_dates,
           unavailable_races, consecutive_errors, last_error, last_run_at,
           retry_after, created_at, updated_at
    FROM xlabs_backfill_jobs
    WHERE scope = 'historical_all'
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  `).first();
}

async function latestDailyXlabs(env) {
  return env.DB.prepare(`
    SELECT id, start_date, end_date, next_date, next_race_index, status,
           processed_dates, processed_races, reused_races, unavailable_dates,
           unavailable_races, consecutive_errors, last_error, last_run_at,
           retry_after, created_at, updated_at
    FROM xlabs_backfill_jobs
    WHERE scope = 'daily_v85_v86'
    ORDER BY end_date DESC, datetime(created_at) DESC, id DESC
    LIMIT 1
  `).first();
}

async function latestRun(env, sourceType) {
  return env.DB.prepare(`
    SELECT id, source_type, started_at, finished_at, status, error_count, error_json
    FROM import_runs
    WHERE source_type = ?
    ORDER BY datetime(started_at) DESC, id DESC
    LIMIT 1
  `).bind(sourceType).first();
}

async function latestFamilyRun(env, family) {
  const pattern = family === 'xlabs' ? '%xlab%' : '%official%';
  return env.DB.prepare(`
    SELECT id, source_type, started_at, finished_at, status, error_count, error_json
    FROM import_runs
    WHERE lower(source_type) LIKE ?
    ORDER BY datetime(started_at) DESC, id DESC
    LIMIT 1
  `).bind(pattern).first();
}

function sourceCard({ id, historicalJob, historicalProcessingState, supportingJobs = [], runs = [], fallbackRun, nowMs }) {
  const issues = [];
  const historicalIssue = jobIssue(id, historicalJob, historicalProcessingState, nowMs, 'historical');
  if (historicalIssue) issues.push(historicalIssue);

  for (const { job, scope } of supportingJobs) {
    const processing = historicalProcessing(job, nowMs);
    const issue = jobIssue(id, job, processing, nowMs, scope);
    if (issue) issues.push(issue);
  }
  for (const run of runs) {
    const issue = runIssue(id, run, nowMs);
    if (issue) issues.push(issue);
  }

  const lastActivityAt = newestIso(
    historicalJob?.last_run_at,
    historicalJob?.updated_at,
    ...supportingJobs.map(({ job }) => job?.last_run_at || job?.updated_at),
    ...runs.map((run) => run?.finished_at || run?.started_at),
    fallbackRun?.finished_at || fallbackRun?.started_at
  );

  const hasEvidence = Boolean(historicalJob || supportingJobs.some(({ job }) => job) || runs.some(Boolean) || fallbackRun);
  if (!historicalJob && !supportingJobs.some(({ job }) => job) && !runs.some(Boolean) && fallbackRun) {
    const fallbackIssue = runIssue(id, fallbackRun, nowMs);
    if (fallbackIssue) issues.push(fallbackIssue);
  }

  const status = sourceStatus(hasEvidence, issues);
  const issue = strongestIssue(issues);
  return {
    id,
    status,
    lastRunAt: lastActivityAt,
    message: status === 'working'
      ? 'Senaste registrerade aktivitet är utan aktuellt fel.'
      : status === 'never_run'
        ? 'Ingen körning registrerad ännu.'
        : issue?.message || 'Ett fel kräver uppmärksamhet.',
    processing: historicalProcessingState,
    issue,
    alerts: issues
  };
}

export async function getSettingsSourceHealth(env, options = {}) {
  if (!env?.DB) throw new Error('DB is not configured');
  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : Number.isFinite(options.nowMs)
      ? options.nowMs
      : Date.now();

  const [
    officialHistorical,
    xlabsHistorical,
    xlabsDaily,
    officialCapture,
    officialNormalize,
    officialFallback,
    xlabsFallback
  ] = await Promise.all([
    latestHistoricalOfficial(env),
    latestHistoricalXlabs(env),
    latestDailyXlabs(env),
    latestRun(env, 'official_live_scheduled_capture'),
    latestRun(env, 'official_live_normalize_auto'),
    latestFamilyRun(env, 'official'),
    latestFamilyRun(env, 'xlabs')
  ]);

  const officialProcessing = historicalProcessing(officialHistorical, nowMs);
  const xlabsProcessing = historicalProcessing(xlabsHistorical, nowMs);

  const official = sourceCard({
    id: 'official',
    historicalJob: officialHistorical,
    historicalProcessingState: officialProcessing,
    runs: [officialCapture, officialNormalize].filter(Boolean),
    fallbackRun: officialFallback,
    nowMs
  });

  const xlabs = sourceCard({
    id: 'xlabs',
    historicalJob: xlabsHistorical,
    historicalProcessingState: xlabsProcessing,
    supportingJobs: xlabsDaily ? [{ job: xlabsDaily, scope: 'daily' }] : [],
    fallbackRun: xlabsFallback,
    nowMs
  });

  const alerts = [...official.alerts, ...xlabs.alerts];
  return { sources: [official, xlabs], alerts };
}

export async function getSettingsAlertState(env, health = null) {
  const current = health || await getSettingsSourceHealth(env);
  const keys = [...new Set((current.alerts || []).map((alert) => alert.key).filter(Boolean))];
  if (!keys.length) {
    await env.DB.prepare('DELETE FROM settings_alert_acknowledgements').run();
    return { hasActiveAlerts: false, hasUnacknowledged: false, activeCount: 0, unacknowledgedCount: 0 };
  }

  const placeholders = keys.map(() => '?').join(',');
  await env.DB.prepare(`
    DELETE FROM settings_alert_acknowledgements
    WHERE alert_key NOT IN (${placeholders})
  `).bind(...keys).run();
  const { results } = await env.DB.prepare(`
    SELECT alert_key
    FROM settings_alert_acknowledgements
    WHERE alert_key IN (${placeholders})
  `).bind(...keys).all();
  const acknowledged = new Set(results.map((row) => row.alert_key));
  const unacknowledgedCount = keys.filter((key) => !acknowledged.has(key)).length;
  return {
    hasActiveAlerts: true,
    hasUnacknowledged: unacknowledgedCount > 0,
    activeCount: keys.length,
    unacknowledgedCount
  };
}

export async function acknowledgeSettingsAlerts(env) {
  const health = await getSettingsSourceHealth(env);
  const keys = [...new Set((health.alerts || []).map((alert) => alert.key).filter(Boolean))];
  if (keys.length) {
    await env.DB.batch(keys.map((key) => env.DB.prepare(`
      INSERT INTO settings_alert_acknowledgements (alert_key, acknowledged_at)
      VALUES (?, ?)
      ON CONFLICT(alert_key) DO UPDATE SET acknowledged_at = excluded.acknowledged_at
    `).bind(key, new Date().toISOString())));
  }
  return {
    acknowledgedCount: keys.length,
    alert: await getSettingsAlertState(env, health)
  };
}

export const SETTINGS_SOURCE_HEALTH_LIMITS = {
  historicalStaleMs: HISTORICAL_STALE_MS,
  runStaleMs: RUN_STALE_MS,
  maxAutomaticErrors: MAX_AUTOMATIC_ERRORS
};
