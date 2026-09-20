import { normalizeCapturedXlabsIntervalsV2, XLABS_INTERVALS_V2_VERSION } from '../xlabs-intervals-v2.js';

export const XLABS_INTERVAL_REPAIR_BATCH_SIZE = 3;
const MAX_ATTEMPTS = 3;

async function markState(env, sourceRecordId, status, { intervalRows = null, validIntervals = null, error = null } = {}) {
  await env.DB.prepare(`
    INSERT INTO xlabs_interval_source_state
      (source_record_id, mapper_version, status, attempts, interval_rows, valid_intervals, last_error, updated_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(source_record_id) DO UPDATE SET
      mapper_version = excluded.mapper_version,
      status = excluded.status,
      attempts = xlabs_interval_source_state.attempts + 1,
      interval_rows = excluded.interval_rows,
      valid_intervals = excluded.valid_intervals,
      last_error = excluded.last_error,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    sourceRecordId,
    XLABS_INTERVALS_V2_VERSION,
    status,
    intervalRows,
    validIntervals,
    error ? String(error.message || error).slice(0, 1000) : null
  ).run();
}

async function nextCandidates(env, limit) {
  const { results } = await env.DB.prepare(`
    SELECT sr.id, sr.fetched_at
    FROM source_records sr
    WHERE sr.source_type = 'xlabs_race_json'
      AND sr.quality_status = 'normalized_verified_subset'
      AND sr.raw_object_key IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM xlabs_data x WHERE x.source_record_id = sr.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM xlabs_interval_source_state s
        WHERE s.source_record_id = sr.id
          AND s.mapper_version = ?
          AND (s.status = 'success' OR (s.status = 'failed' AND s.attempts >= ?))
      )
    ORDER BY julianday(sr.fetched_at) DESC, sr.id DESC
    LIMIT ?
  `).bind(XLABS_INTERVALS_V2_VERSION, MAX_ATTEMPTS, limit).all();
  return results || [];
}

export async function ensureXlabsIntervalsForSource(env, sourceRecordId) {
  const existing = await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM xlabs_intervals
    WHERE source_record_id = ? AND mapper_version = ?
  `).bind(sourceRecordId, XLABS_INTERVALS_V2_VERSION).first();

  if (Number(existing?.n || 0) > 0) {
    const valid = await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM xlabs_intervals
      WHERE source_record_id = ? AND mapper_version = ? AND eligibility_status = 'valid'
    `).bind(sourceRecordId, XLABS_INTERVALS_V2_VERSION).first();
    await markState(env, sourceRecordId, 'success', {
      intervalRows: Number(existing.n),
      validIntervals: Number(valid?.n || 0)
    });
    return {
      sourceRecordId,
      reused: true,
      intervalRows: Number(existing.n),
      validIntervals: Number(valid?.n || 0)
    };
  }

  try {
    const result = await normalizeCapturedXlabsIntervalsV2(env, sourceRecordId);
    await markState(env, sourceRecordId, 'success', {
      intervalRows: result.intervalRows,
      validIntervals: result.validIntervals
    });
    return {
      sourceRecordId,
      reused: false,
      intervalRows: result.intervalRows,
      validIntervals: result.validIntervals
    };
  } catch (error) {
    await markState(env, sourceRecordId, 'failed', { error });
    throw error;
  }
}

export async function runXlabsIntervalRepairBatch(env, { limit = XLABS_INTERVAL_REPAIR_BATCH_SIZE } = {}) {
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || XLABS_INTERVAL_REPAIR_BATCH_SIZE));
  const candidates = await nextCandidates(env, safeLimit);
  const items = [];
  let successCount = 0;
  let failureCount = 0;

  for (const candidate of candidates) {
    try {
      const result = await ensureXlabsIntervalsForSource(env, candidate.id);
      items.push({ sourceRecordId: candidate.id, ok: true, ...result });
      successCount += 1;
    } catch (error) {
      items.push({
        sourceRecordId: candidate.id,
        ok: false,
        error: String(error.message || error).slice(0, 500)
      });
      failureCount += 1;
    }
  }

  const remaining = await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM source_records sr
    WHERE sr.source_type = 'xlabs_race_json'
      AND sr.quality_status = 'normalized_verified_subset'
      AND sr.raw_object_key IS NOT NULL
      AND EXISTS (SELECT 1 FROM xlabs_data x WHERE x.source_record_id = sr.id)
      AND NOT EXISTS (
        SELECT 1 FROM xlabs_interval_source_state s
        WHERE s.source_record_id = sr.id
          AND s.mapper_version = ?
          AND s.status = 'success'
      )
  `).bind(XLABS_INTERVALS_V2_VERSION).first();

  return {
    mapperVersion: XLABS_INTERVALS_V2_VERSION,
    attempted: candidates.length,
    successCount,
    failureCount,
    remaining: Number(remaining?.n || 0),
    items
  };
}
