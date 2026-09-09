import { stableId } from '../ids.js';

export const FORM_FEATURE_VERSION = 'form-v1';
const HISTORY_LIMIT = 5;

function finiteOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateOnly(value) {
  return String(value).slice(0, 10);
}

function daysBetween(later, earlier) {
  const laterMs = Date.parse(`${dateOnly(later)}T00:00:00Z`);
  const earlierMs = Date.parse(`${dateOnly(earlier)}T00:00:00Z`);
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) return null;
  return Math.max(0, Math.floor((laterMs - earlierMs) / 86400000));
}

async function targetEntry(env, raceEntryId) {
  return env.DB.prepare(`
    SELECT re.id, re.horse_id, r.race_date, r.scheduled_start_at
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    WHERE re.id = ?
  `).bind(raceEntryId).first();
}

async function previousStarts(env, target, asOf) {
  const { results } = await env.DB.prepare(`
    SELECT
      r.race_date,
      r.scheduled_start_at,
      rr.placing,
      rr.gallop,
      rr.disqualified
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    JOIN race_results rr ON rr.race_entry_id = re.id
    WHERE re.horse_id = ?
      AND re.scratched = 0
      AND re.id <> ?
      AND (
        (r.scheduled_start_at IS NOT NULL AND r.scheduled_start_at < ?)
        OR (r.scheduled_start_at IS NULL AND r.race_date < ?)
      )
      AND (rr.placing IS NOT NULL OR rr.placing_text IS NOT NULL OR rr.result_status IS NOT NULL)
    ORDER BY COALESCE(r.scheduled_start_at, r.race_date || 'T23:59:59Z') DESC, r.race_number DESC, re.id ASC
    LIMIT ?
  `).bind(target.horse_id, target.id, asOf, dateOnly(asOf), HISTORY_LIMIT).all();
  return results;
}

function buildFeatures(starts, asOf) {
  const placings = starts.map((start) => finiteOrNull(start.placing)).filter((value) => value != null && value > 0);
  const startsCount = starts.length;
  const quality = startsCount >= 3 ? 'sufficient' : startsCount > 0 ? 'limited' : 'unavailable';
  const latestDate = starts[0]?.race_date ?? null;
  const values = {
    form_starts_5: startsCount,
    form_wins_5: placings.filter((placing) => placing === 1).length,
    form_top3_5: placings.filter((placing) => placing <= 3).length,
    form_avg_placing_5: placings.length ? placings.reduce((sum, placing) => sum + placing, 0) / placings.length : null,
    form_gallops_5: starts.filter((start) => Number(start.gallop) === 1).length,
    form_disqualifications_5: starts.filter((start) => Number(start.disqualified) === 1).length,
    form_days_since_last_start: latestDate ? daysBetween(asOf, latestDate) : null
  };
  return { values, quality, sampleSize: startsCount };
}

export async function calculateHorseFormFeatures(env, raceEntryId, options = {}) {
  const target = await targetEntry(env, raceEntryId);
  if (!target) throw new Error('race entry not found');

  const asOf = options.asOf || target.scheduled_start_at || `${target.race_date}T00:00:00Z`;
  if (!Number.isFinite(Date.parse(asOf))) throw new Error('asOf must be an ISO date/time');
  const starts = await previousStarts(env, target, asOf);
  const calculated = buildFeatures(starts, asOf);

  return {
    raceEntryId,
    featureVersion: FORM_FEATURE_VERSION,
    asOf,
    sampleSize: calculated.sampleSize,
    dataQuality: calculated.quality,
    features: calculated.values
  };
}

export async function persistHorseFormFeatures(env, raceEntryId, options = {}) {
  const result = await calculateHorseFormFeatures(env, raceEntryId, options);
  const provenance = JSON.stringify({
    calculation: FORM_FEATURE_VERSION,
    historyLimit: HISTORY_LIMIT,
    sampleSize: result.sampleSize,
    inputs: ['races', 'race_entries', 'race_results']
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
