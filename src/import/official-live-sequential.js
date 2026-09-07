import { normalizeCapturedOfficialGameChunk } from './official-live-chunked.js';

function parseCursor(value) {
  const cursor = value == null ? 0 : Number(value);
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error('cursor must be a non-negative integer');
  return cursor;
}

export async function normalizeCapturedOfficialGameSequential(env, sourceRecordId, cursorValue = 0) {
  if (!env.DB) throw new Error('DB is not configured');
  const sourceId = String(sourceRecordId || '').trim();
  if (!sourceId) throw new Error('source_record_id is required');
  const cursor = parseCursor(cursorValue);

  const progress = await env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM normalized_observations
    WHERE source_record_id = ? AND entity_type = 'race_entry'
  `).bind(sourceId).first();
  const completedEntries = Number(progress?.n ?? 0);

  if (cursor > completedEntries) {
    throw new Error(`cursor cannot skip unfinished entries; highest safe cursor is ${completedEntries}`);
  }

  return normalizeCapturedOfficialGameChunk(env, sourceId, cursor);
}
