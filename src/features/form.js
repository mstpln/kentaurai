import { stableId } from '../ids.js';

export const FORM_FEATURE_VERSION = 'form-v2';
const HISTORY_LIMIT = 5;

function finiteOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolean01OrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return number === 0 || number === 1 ? number : null;
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
        (r.scheduled_start_at IS NOT NULL AND datetime(r.scheduled_start_at) < datetime(?))
        OR (r.scheduled_start_at IS NULL AND r.race_date < ?)
      )
      AND (rr.placing IS NOT NULL OR rr.placing_text IS NOT NULL OR rr.result_status IS NOT NULL)
    ORDER BY COALESCE(datetime(r.scheduled_start_at), datetime(r.race_date || 'T23:59:59Z')) DESC, r.race_number DESC, re.id ASC
    LIMIT ?
  `).bind(target.horse_id, target.id, asOf, dateOnly(asOf), HISTORY_LIMIT).all();
  return results;
}

function buildFeatures(starts, asOf) {
  const startsCount = starts.length;
  const hasSample = startsCount > 0;
  const placingValues = starts.map((start) => finiteOrNull(start.placing));
  const gallopValues = starts.map((start) => boolean01OrNull(start.gallop));
  const disqualificationValues = starts.map((start) => boolean01OrNull(start.disqualified));
  const allPlacingsKnown = hasSample && placingValues.every((value) => value != null && value > 0);
  const allGallopsKnown = hasSample && gallopValues.every((value) => value != null);
  const allDisqualificationsKnown = hasSample && disqualificationValues.every((value) => value != null);
  const quality = startsCount >= 3 && allPlacingsKnown && allGallopsKnown && allDisqualificationsKnown
    ? 'sufficient'
    : hasSample ? 'limited' : 'unavailable';
  const latestDate = starts[0]?.race_date ?? null;
  const values = {
    form_starts_5: startsCount,
    form_wins_5: allPlacingsKnown ? placingValues.filter((placing) => placing === 1).length : null,
    form_top3_5: allPlacingsKnown ? placingValues.filter((placing) => placing <= 3).length : null,
    form_avg_placing_5: allPlacingsKnown ? placingValues.reduce((sum, placing) => sum + placing, 0) / placingValues.length : null,
    form_gallops_5: allGallopsKnown ? gallopValues.reduce((sum, value) => sum + value, 0) : null,
    form_disqualifications_5: allDisqualificationsKnown ? disqualificationValues.reduce((sum, value) => sum + value, 0) : null,
    form_days_since_last_start: latestDate ? daysBetween(asOf, latestDate) : null
  };
  return {
    values,
    quality,
    sampleSize: startsCount,
    fieldCoverage: {
      placing: placingValues.filter((value) => value != null && value > 0).length,
      gallop: gallopValues.filter((value) => value != null).length,
      disqualified: disqualificationValues.filter((value) => value != null).length
    }
  };
}

export async function calculateHorseFormFeatures(env, raceEntryId, options = {}) {
  const target = await targetEntry(env, raceEntryId);
  if (!target) throw new Error('race entry not found');

  const targetAsOf = target.scheduled_start_at || `${target.race_date}T00:00:00Z`;
  const asOf = options.asOf || targetAsOf;
  const asOfMs = Date.parse(asOf);
  const targetMs = Date.parse(targetAsOf);
  if (!Number.isFinite(asOfMs)) throw new Error('asOf must be an ISO date/time');
  if (!Number.isFinite(targetMs)) throw new Error('target race start must be a valid ISO date/time');
  if (asOfMs > targetMs) throw new Error('asOf cannot be after the target race start');

  const starts = await previousStarts(env, target, asOf);
  const calculated = buildFeatures(starts, asOf);

  return {
    raceEntryId,
    featureVersion: FORM_FEATURE_VERSION,
    asOf,
    sampleSize: calculated.sampleSize,
    fieldCoverage: calculated.fieldCoverage,
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
    fieldCoverage: result.fieldCoverage,
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
