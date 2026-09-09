import { stableId } from '../ids.js';

export const CLASS_FEATURE_VERSION = 'class-exposure-v1';
const HISTORY_LIMIT = 10;

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
    SELECT re.id, re.horse_id, r.race_date, r.scheduled_start_at, r.first_prize_sek
    FROM race_entries re
    JOIN races r ON r.id = re.race_id
    WHERE re.id = ?
  `).bind(raceEntryId).first();
}

async function history(env, target, asOf) {
  const { results } = await env.DB.prepare(`
    SELECT r.first_prize_sek, rr.prize_sek, rr.placing
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

function calculate(rows, targetFirstPrize) {
  const advertised = rows.map((row) => numeric(row.first_prize_sek)).filter((value) => value != null && value >= 0);
  const earnings = rows.map((row) => numeric(row.prize_sek)).filter((value) => value != null && value >= 0);
  const placings = rows.map((row) => numeric(row.placing)).filter((value) => value != null && value > 0);
  const maxPrize = advertised.length ? Math.max(...advertised) : null;
  const avgPrize = advertised.length ? advertised.reduce((sum, value) => sum + value, 0) / advertised.length : null;
  const targetPrize = numeric(targetFirstPrize);
  const ratio = targetPrize != null && maxPrize != null && maxPrize > 0 ? targetPrize / maxPrize : null;
  const quality = rows.length === 0 ? 'unavailable' : advertised.length >= 5 ? 'sufficient' : 'limited';

  return {
    dataQuality: quality,
    sampleSize: rows.length,
    knownClassPrizeCount: advertised.length,
    features: {
      class_starts_10: rows.length,
      class_wins_10: placings.filter((placing) => placing === 1).length,
      class_max_first_prize_10: maxPrize,
      class_avg_first_prize_10: avgPrize,
      class_prize_earnings_10: earnings.length ? earnings.reduce((sum, value) => sum + value, 0) : null,
      class_target_first_prize: targetPrize,
      class_target_vs_max_prize_ratio: ratio
    }
  };
}

export async function calculateClassExposureFeatures(env, raceEntryId, options = {}) {
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
  const result = calculate(rows, target.first_prize_sek);
  return { raceEntryId, featureVersion: CLASS_FEATURE_VERSION, asOf, ...result };
}

export async function persistClassExposureFeatures(env, raceEntryId, options = {}) {
  const result = await calculateClassExposureFeatures(env, raceEntryId, options);
  const provenance = JSON.stringify({
    calculation: CLASS_FEATURE_VERSION,
    historyLimit: HISTORY_LIMIT,
    sampleSize: result.sampleSize,
    knownClassPrizeCount: result.knownClassPrizeCount,
    inputs: ['races.first_prize_sek', 'race_entries', 'race_results.prize_sek', 'race_results.placing']
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
