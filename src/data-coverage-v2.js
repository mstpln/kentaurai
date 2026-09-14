import { buildDataCoverageReport as buildLegacyDataCoverageReport } from './data-coverage.js';

export const DATA_COVERAGE_VERSION = 'kentaurai-data-coverage-v2';
const XLABS_VERIFIED_QUALITY = 'xlabs-telemetry-v1';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function metric(covered, eligible, note = null) {
  const safeCovered = finiteNumber(covered);
  const safeEligible = finiteNumber(eligible);
  return {
    covered: safeCovered,
    eligible: safeEligible,
    percent: safeEligible > 0 ? Number(((safeCovered / safeEligible) * 100).toFixed(1)) : null,
    ...(note ? { note } : {})
  };
}

function swedenDateKey(instant) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('generatedAt must be a valid date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function canonicalStartMethodSql(raceAlias = 'r') {
  return `CASE
    WHEN LOWER(COALESCE(${raceAlias}.start_method,'')) IN ('auto','autostart') THEN 'auto'
    WHEN LOWER(COALESCE(${raceAlias}.start_method,'')) IN ('volt','volte','voltstart') THEN 'volt'
    WHEN ${raceAlias}.start_method IS NULL OR TRIM(${raceAlias}.start_method) = '' THEN 'unknown'
    ELSE LOWER(${raceAlias}.start_method)
  END`;
}

function cleanRow(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]));
}

async function contextualEligibility(env) {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) AS active_entries,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id=re.id) THEN 1 ELSE 0 END) AS result_entries,
      SUM(CASE WHEN ${canonicalStartMethodSql('r')}='volt' THEN 1 ELSE 0 END) AS volt_entries,
      SUM(CASE WHEN ${canonicalStartMethodSql('r')}='auto' THEN 1 ELSE 0 END) AS auto_entries,
      SUM(CASE WHEN re.actual_lane IS NOT NULL THEN 1 ELSE 0 END) AS actual_lane_covered,
      SUM(CASE WHEN ${canonicalStartMethodSql('r')}='volt' AND re.start_tier IS NOT NULL THEN 1 ELSE 0 END) AS start_tier_covered,
      SUM(CASE WHEN ${canonicalStartMethodSql('r')}='volt' AND re.springspar IS NOT NULL THEN 1 ELSE 0 END) AS springspar_covered,
      SUM(CASE WHEN ${canonicalStartMethodSql('r')}='auto' AND re.back_row IS NOT NULL THEN 1 ELSE 0 END) AS back_row_covered
    FROM race_entries re
    JOIN races r ON r.id=re.race_id
    WHERE COALESCE(re.scratched,0)=0
  `).first();
  const active = finiteNumber(row?.active_entries);
  const result = finiteNumber(row?.result_entries);
  const volt = finiteNumber(row?.volt_entries);
  const auto = finiteNumber(row?.auto_entries);
  return {
    populations: {
      active_entries: active,
      completed_result_entries: result,
      volt_entries: volt,
      auto_entries: auto,
      ineligible_for_result_fields: Math.max(0, active - result),
      ineligible_for_volt_only_fields: Math.max(0, active - volt),
      ineligible_for_auto_only_fields: Math.max(0, active - auto)
    },
    fields: {
      actual_lane: metric(row?.actual_lane_covered, active, 'Eligible: all non-scratched entries.'),
      start_tier: metric(row?.start_tier_covered, volt, 'Eligible only for verified volt-start context.'),
      springspar: metric(row?.springspar_covered, volt, 'Eligible only for verified volt-start context.'),
      back_row: metric(row?.back_row_covered, auto, 'Eligible only for verified auto-start context.')
    }
  };
}

async function groupedXlabsCoverage(env, expression, { join = '', where = '', note = null } = {}) {
  const { results } = await env.DB.prepare(`
    SELECT ${expression} AS bucket,
      COUNT(DISTINCT re.id) AS eligible,
      COUNT(DISTINCT CASE WHEN x.race_entry_id IS NOT NULL THEN re.id END) AS covered
    FROM race_entries re
    JOIN races r ON r.id=re.race_id
    LEFT JOIN xlabs_data x ON x.race_entry_id=re.id AND x.quality_status=?
    ${join}
    WHERE COALESCE(re.scratched,0)=0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id=re.id)
      ${where}
    GROUP BY bucket
    ORDER BY bucket
  `).bind(XLABS_VERIFIED_QUALITY).all();
  return (results || []).map((row) => ({
    bucket: row.bucket == null || row.bucket === '' ? 'unknown' : String(row.bucket),
    ...metric(row.covered, row.eligible, note)
  }));
}

async function anonymousTrackCoverage(env) {
  const { results } = await env.DB.prepare(`
    SELECT r.track_id AS private_track_id,
      COUNT(DISTINCT re.id) AS eligible,
      COUNT(DISTINCT CASE WHEN x.race_entry_id IS NOT NULL THEN re.id END) AS covered
    FROM race_entries re
    JOIN races r ON r.id=re.race_id
    LEFT JOIN xlabs_data x ON x.race_entry_id=re.id AND x.quality_status=?
    WHERE COALESCE(re.scratched,0)=0
      AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id=re.id)
    GROUP BY r.track_id
  `).bind(XLABS_VERIFIED_QUALITY).all();
  const rows = (results || []).map((row) => ({
    eligible: finiteNumber(row.eligible), covered: finiteNumber(row.covered)
  })).sort((a, b) => b.eligible - a.eligible || b.covered - a.covered);
  const bands = { zero: 0, low_0_25: 0, medium_25_75: 0, high_75_100: 0, full_100: 0 };
  const anonymous = rows.map((row, index) => {
    const value = metric(row.covered, row.eligible);
    if (value.percent === 0) bands.zero += 1;
    else if (value.percent < 25) bands.low_0_25 += 1;
    else if (value.percent < 75) bands.medium_25_75 += 1;
    else if (value.percent < 100) bands.high_75_100 += 1;
    else bands.full_100 += 1;
    return { track_bucket: `anonymous_track_${String(index + 1).padStart(2, '0')}`, ...value };
  });
  return {
    note: 'Track identities are deliberately anonymized; buckets are ordered by eligible completed-entry volume and are not stable identifiers.',
    track_count: rows.length,
    coverage_bands: bands,
    by_track_anonymous: anonymous
  };
}

async function horseXlabsDepth(env) {
  const row = await env.DB.prepare(`
    WITH completed AS (
      SELECT re.horse_id, re.id AS race_entry_id
      FROM race_entries re
      WHERE COALESCE(re.scratched,0)=0 AND re.horse_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM race_results rr WHERE rr.race_entry_id=re.id)
    ), measured AS (
      SELECT c.horse_id,
        COUNT(DISTINCT CASE WHEN x.race_entry_id IS NOT NULL THEN c.race_entry_id END) AS measured_starts
      FROM completed c
      LEFT JOIN xlabs_data x ON x.race_entry_id=c.race_entry_id AND x.quality_status=?
      GROUP BY c.horse_id
    )
    SELECT COUNT(*) AS eligible_horses,
      SUM(CASE WHEN measured_starts>=1 THEN 1 ELSE 0 END) AS at_least_1,
      SUM(CASE WHEN measured_starts>=3 THEN 1 ELSE 0 END) AS at_least_3,
      SUM(CASE WHEN measured_starts>=5 THEN 1 ELSE 0 END) AS at_least_5,
      SUM(CASE WHEN measured_starts>=10 THEN 1 ELSE 0 END) AS at_least_10
    FROM measured
  `).bind(XLABS_VERIFIED_QUALITY).first();
  const eligible = finiteNumber(row?.eligible_horses);
  return {
    eligible_horses_with_completed_starts: eligible,
    at_least_1_measured_start: metric(row?.at_least_1, eligible),
    at_least_3_measured_starts: metric(row?.at_least_3, eligible),
    at_least_5_measured_starts: metric(row?.at_least_5, eligible),
    at_least_10_measured_starts: metric(row?.at_least_10, eligible)
  };
}

async function xlabsSelectionBias(env) {
  const [byYear, byMethod, byDistance, byRaceType, byStlClass, tracks, horseDepth] = await Promise.all([
    groupedXlabsCoverage(env, "SUBSTR(r.race_date,1,4)"),
    groupedXlabsCoverage(env, canonicalStartMethodSql('r')),
    groupedXlabsCoverage(env, `CASE
      WHEN r.distance_m IS NULL THEN 'unknown'
      WHEN r.distance_m<=1740 THEN 'diagnostic_short_<=1740'
      WHEN r.distance_m<2400 THEN 'diagnostic_middle_1741_2399'
      ELSE 'diagnostic_long_>=2400' END`, { note: 'Diagnostic coverage bucket only; not a model distance class.' }),
    groupedXlabsCoverage(env, "COALESCE(rtc.race_type,'unclassified')", {
      join: 'LEFT JOIN race_type_classifications rtc ON rtc.race_id=r.id',
      note: 'Race-type buckets are non-exclusive when a race has multiple verified classifications.'
    }),
    groupedXlabsCoverage(env, "COALESCE(rsc.stl_class,'unclassified')", {
      join: 'LEFT JOIN race_stl_classifications rsc ON rsc.race_id=r.id'
    }),
    anonymousTrackCoverage(env),
    horseXlabsDepth(env)
  ]);
  return {
    definition: 'Coverage among completed non-scratched entries; covered requires verified xlabs-telemetry-v1 normalized measurements.',
    by_year: byYear,
    by_start_method: byMethod,
    by_distance_diagnostic: byDistance,
    by_race_type: byRaceType,
    by_stl_class: byStlClass,
    tracks,
    horse_measurement_depth: horseDepth
  };
}

function classifyBackfillError(value) {
  const text = String(value || '').toLowerCase();
  if (!text) return 'none';
  if (text.includes('429') || text.includes('rate limit') || text.includes('retry-after')) return 'source_rate_limited';
  if (text.includes('401') || text.includes('403') || text.includes('forbidden') || text.includes('access denied')) return 'source_access_denied';
  if (text.includes('timeout') || text.includes('timed out') || text.includes('network') || text.includes('fetch failed') || text.includes('upstream')) return 'source_transport_failure';
  if (text.includes('404') || text.includes('not found')) return 'source_not_found';
  if (text.includes('identity') || text.includes('provenance') || text.includes('mismatch') || text.includes('another track') || text.includes('another race')) return 'identity_or_provenance_failure';
  if (text.includes('no coverage') || text.includes('source gap') || text.includes('duplicate target') || text.includes('insufficient_frame_coverage')) return 'source_coverage_gap';
  if (text.includes('json') || text.includes('schema') || text.includes('invalid') || text.includes('malformed') || text.includes('must be')) return 'validation_or_schema_failure';
  return 'technical_unknown';
}

function safeJob(row, includeScope = false) {
  const clean = cleanRow(row);
  return {
    ...(includeScope ? { scope: clean.scope } : {}),
    status: clean.status,
    start_date: clean.start_date,
    end_date: clean.end_date,
    next_date: clean.next_date,
    next_race_index: finiteNumber(clean.next_race_index),
    processed_dates: finiteNumber(clean.processed_dates),
    processed_races: finiteNumber(clean.processed_races),
    reused_races: finiteNumber(clean.reused_races),
    ...(includeScope ? {
      unavailable_dates: finiteNumber(clean.unavailable_dates),
      unavailable_races: finiteNumber(clean.unavailable_races),
      retry_after: clean.retry_after || null
    } : {}),
    consecutive_errors: finiteNumber(clean.consecutive_errors),
    last_error_category: classifyBackfillError(clean.last_error),
    last_run_at: clean.last_run_at || null,
    updated_at: clean.updated_at || null
  };
}

async function backfillDiagnostics(env) {
  const [historical, xlabs] = await Promise.all([
    env.DB.prepare(`
      SELECT start_date,end_date,next_date,next_race_index,status,processed_dates,processed_races,reused_races,
             consecutive_errors,last_error,last_run_at,updated_at
      FROM historical_backfill_jobs ORDER BY created_at
    `).all(),
    env.DB.prepare(`
      SELECT scope,start_date,end_date,next_date,next_race_index,status,processed_dates,processed_races,reused_races,
             unavailable_dates,unavailable_races,consecutive_errors,last_error,last_run_at,retry_after,updated_at
      FROM xlabs_backfill_jobs ORDER BY scope,created_at
    `).all()
  ]);
  const officialJobs = (historical.results || []).map((row) => safeJob(row, false));
  const xlabsJobs = (xlabs.results || []).map((row) => safeJob(row, true));
  const failed = [...officialJobs, ...xlabsJobs].filter((row) => row.status === 'failed');
  return {
    read_only: true,
    note: 'Diagnostics expose cursor/status and classified error categories only. Raw error text and job IDs are intentionally omitted.',
    historical_official: officialJobs,
    xlabs: xlabsJobs,
    failed_job_count: failed.length,
    failed_error_categories: [...new Set(failed.map((row) => row.last_error_category))].sort()
  };
}

async function currentRoundCoverage(env, generatedAt) {
  const date = swedenDateKey(generatedAt);
  const round = await env.DB.prepare(`
    SELECT id,game_type,round_date,
      (SELECT COUNT(*) FROM game_legs gl WHERE gl.game_round_id=gr.id) AS leg_count
    FROM game_rounds gr
    WHERE game_type IN ('V85','V86') AND round_date>=?
    ORDER BY round_date,game_type,id
    LIMIT 1
  `).bind(date).first();
  if (!round) return {
    status: 'not_available',
    reason: 'no_upcoming_v85_v86_round_in_storage',
    front_contender_profiles: { status: 'not_available', reason: 'front_contender_profile_not_built' }
  };
  const row = await env.DB.prepare(`
    SELECT COUNT(DISTINCT re.id) AS active_entries,
      COUNT(DISTINCT CASE WHEN h.current_start_points IS NOT NULL THEN re.id END) AS current_start_points,
      COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM equipment e WHERE e.race_entry_id=re.id) THEN re.id END) AS equipment,
      COUNT(DISTINCT CASE WHEN re.horse_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM race_entries hre
        JOIN races hr ON hr.id=hre.race_id
        JOIN xlabs_data x ON x.race_entry_id=hre.id AND x.quality_status=?
        WHERE hre.horse_id=re.horse_id AND COALESCE(hre.scratched,0)=0 AND hr.race_date<gr.round_date
      ) THEN re.id END) AS prior_xlabs
    FROM game_rounds gr
    JOIN game_legs gl ON gl.game_round_id=gr.id
    JOIN race_entries re ON re.race_id=gl.race_id
    LEFT JOIN horses h ON h.id=re.horse_id
    WHERE gr.id=? AND COALESCE(re.scratched,0)=0
  `).bind(XLABS_VERIFIED_QUALITY, round.id).first();
  const eligible = finiteNumber(row?.active_entries);
  return {
    status: 'available',
    game_type: round.game_type,
    round_date: round.round_date,
    leg_count: finiteNumber(round.leg_count),
    active_entries: eligible,
    current_start_points: metric(row?.current_start_points, eligible),
    current_entry_equipment: metric(row?.equipment, eligible),
    horses_with_prior_verified_xlabs: metric(row?.prior_xlabs, eligible),
    front_contender_profiles: { status: 'not_available', reason: 'front_contender_profile_not_built' }
  };
}

export async function buildDataCoverageReport(env, generatedAt = new Date().toISOString()) {
  if (!env.DB) throw new Error('DB is not configured');
  const base = await buildLegacyDataCoverageReport(env, generatedAt);
  const [contextual, xlabsBias, currentRound, backfills] = await Promise.all([
    contextualEligibility(env),
    xlabsSelectionBias(env),
    currentRoundCoverage(env, generatedAt),
    backfillDiagnostics(env)
  ]);
  return {
    ...base,
    contract_version: DATA_COVERAGE_VERSION,
    scope: {
      ...base.scope,
      purpose: 'Measure stored data with explicit eligibility, source-gap and operational diagnostics before v3 feature design.',
      denominator_note: 'Coverage v2 names contextual eligible populations explicitly where a field is not meaningful for every row.',
      missingness_note: 'Ineligible context, observed source absence and technical backfill failure are reported separately when KentaurAI can prove the distinction.'
    },
    coverage: {
      ...base.coverage,
      contextual_eligibility: contextual,
      xlabs_selection_bias: xlabsBias,
      current_round_participants: currentRound
    },
    backfills: {
      summary_v1_compatible: base.backfills,
      diagnostics: backfills
    }
  };
}

export async function createDataCoverageExportResponse(env, generatedAt = new Date().toISOString()) {
  const report = await buildDataCoverageReport(env, generatedAt);
  const stamp = generatedAt.slice(0, 10);
  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="kentaurai-data-coverage_${stamp}.json"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
