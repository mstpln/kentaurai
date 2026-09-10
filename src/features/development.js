import { stableId } from '../ids.js';

export const DEVELOPMENT_FEATURE_VERSION = 'development-v1';
const HISTORY_LIMIT = 6;
const SPLIT = 3;

function dateOnly(value) {
  return String(value).slice(0, 10);
}

function numeric(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function targetEntry(env, raceEntryId) {
  return env.DB.prepare(`
    SELECT re.id, re.horse_id, r.race_date, r.scheduled_start_at
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    WHERE re.id = ?
  `).bind(raceEntryId).first();
}

async function history(env, target, asOf) {
  const { results } = await env.DB.prepare(`
    SELECT r.race_date, r.scheduled_start_at, r.first_prize_sek, rr.placing, rr.prize_sek, rr.gallop, rr.disqualified
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.horse_id = ?
      AND re.scratched = 0
      AND re.id <> ?
      AND (
        (r.scheduled_start_at IS NOT NULL AND datetime(r.scheduled_start_at) < datetime(?))
        OR (r.scheduled_start_at IS NULL AND r.race_date < ?)
      )
      AND (rr.placing IS NOT NULL OR rr.placing_text IS NOT NULL OR rr.result_status IS NOT NULL)
    ORDER BY COALESCE(datetime(r.scheduled_start_at), datetime(r.race_date || 'T23:59:59Z')) DESC, r.race_number DESC, re.id ASC
    LIMIT ?
  `).bind(target.horse_id, target.id, asOf, dateOnly(asOf), HISTORY_LIMIT).all();
  return results;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function summarize(rows) {
  const placings = rows.map((row) => numeric(row.placing)).filter((value) => value != null && value > 0);
  const classPrizes = rows.map((row) => numeric(row.first_prize_sek)).filter((value) => value != null && value >= 0);
  const earnings = rows.map((row) => numeric(row.prize_sek)).filter((value) => value != null && value >= 0);
  return {
    starts: rows.length,
    avgPlacing: average(placings),
    wins: placings.filter((value) => value === 1).length,
    top3: placings.filter((value) => value <= 3).length,
    avgFirstPrize: average(classPrizes),
    earnings: earnings.length ? earnings.reduce((sum, value) => sum + value, 0) : null,
    gallops: rows.filter((row) => Number(row.gallop) === 1).length,
    disqualifications: rows.filter((row) => Number(row.disqualified) === 1).length
  };
}

function delta(recent, previous) {
  if (recent == null || previous == null) return null;
  return recent - previous;
}

function ratio(recent, previous) {
  if (recent == null || previous == null || previous === 0) return null;
  return recent / previous;
}

function calculate(rows) {
  const recentRows = rows.slice(0, SPLIT);
  const previousRows = rows.slice(SPLIT, HISTORY_LIMIT);
  const recent = summarize(recentRows);
  const previous = summarize(previousRows);
  const quality = rows.length >= HISTORY_LIMIT ? 'sufficient' : rows.length > 0 ? 'limited' : 'unavailable';

  return {
    dataQuality: quality,
    sampleSize: rows.length,
    recentSampleSize: recentRows.length,
    previousSampleSize: previousRows.length,
    features: {
      development_recent_avg_placing_3: recent.avgPlacing,
      development_previous_avg_placing_3: previous.avgPlacing,
      development_avg_placing_delta: delta(recent.avgPlacing, previous.avgPlacing),
      development_recent_top3_rate_3: recent.starts ? recent.top3 / recent.starts : null,
      development_previous_top3_rate_3: previous.starts ? previous.top3 / previous.starts : null,
      development_top3_rate_delta: recent.starts && previous.starts ? (recent.top3 / recent.starts) - (previous.top3 / previous.starts) : null,
      development_recent_avg_first_prize_3: recent.avgFirstPrize,
      development_previous_avg_first_prize_3: previous.avgFirstPrize,
      development_class_exposure_ratio: ratio(recent.avgFirstPrize, previous.avgFirstPrize),
      development_recent_earnings_3: recent.earnings,
      development_previous_earnings_3: previous.earnings,
      development_earnings_ratio: ratio(recent.earnings, previous.earnings),
      development_recent_gallops_3: recent.gallops,
      development_previous_gallops_3: previous.gallops,
      development_recent_disqualifications_3: recent.disqualifications,
      development_previous_disqualifications_3: previous.disqualifications
    }
  };
}

export async function calculateDevelopmentFeatures(env, raceEntryId, options = {}) {
  const target = await targetEntry(env, raceEntryId);
  if (!target) throw new Error('race entry not found');

  const targetAsOf = target.scheduled_start_at || `${target.race_date}T00:00:00Z`;
  const asOf = options.asOf || targetAsOf;
  const asOfMs = Date.parse(asOf);
  const targetMs = Date.parse(targetAsOf);
  if (!Number.isFinite(asOfMs)) throw new Error('asOf must be an ISO date/time');
  if (!Number.isFinite(targetMs)) throw new Error('target race start must be a valid ISO date/time');
  if (asOfMs > targetMs) throw new Error('asOf cannot be after the target race start');

  const rows = await history(env, target, asOf);
  return { raceEntryId, featureVersion: DEVELOPMENT_FEATURE_VERSION, asOf, ...calculate(rows) };
}

export async function persistDevelopmentFeatures(env, raceEntryId, options = {}) {
  const result = await calculateDevelopmentFeatures(env, raceEntryId, options);
  const provenance = JSON.stringify({
    calculation: DEVELOPMENT_FEATURE_VERSION,
    historyLimit: HISTORY_LIMIT,
    split: `${SPLIT}+${SPLIT}`,
    sampleSize: result.sampleSize,
    recentSampleSize: result.recentSampleSize,
    previousSampleSize: result.previousSampleSize,
    inputs: ['races.first_prize_sek', 'race_entries', 'race_results']
  });

  let writes = 0;
  for (const [featureName, numericValue] of Object.entries(result.features)) {
    const id = stableId('feature', raceEntryId, result.featureVersion, result.asOf, featureName);
    const write = await env.DB.prepare(`
      INSERT OR IGNORE INTO analysis_features
        (id, race_entry_id, feature_version, as_of, feature_name, numeric_value, data_quality, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, raceEntryId, result.featureVersion, result.asOf, featureName, numericValue, result.dataQuality, provenance).run();
    writes += Number(write.meta?.changes ?? 0);
  }
  return { ...result, writes };
}
