import { randomId } from './ids.js';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function archiveRawPayload(env, { sourceType, externalId = null, sourceUrl = null, fetchedAt, payload, qualityStatus = 'unknown', rightsStatus = null, metadata = null }) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const hash = await sha256Hex(body);
  const day = fetchedAt.slice(0, 10);
  const objectKey = `raw/${sourceType}/${day}/${hash}.json`;

  if (externalId != null) {
    const existing = await env.DB.prepare(`
      SELECT id, raw_object_key, content_hash
      FROM source_records
      WHERE source_type = ? AND external_id = ? AND fetched_at = ?
      LIMIT 1
    `).bind(sourceType, externalId, fetchedAt).first();
    if (existing) {
      if (existing.content_hash && existing.content_hash !== hash) {
        throw new Error('source snapshot conflict: same external id and timestamp has different content');
      }
      return {
        sourceRecordId: existing.id,
        objectKey: existing.raw_object_key || objectKey,
        hash,
        reused: true
      };
    }
  }

  if (env.RAW_BUCKET) {
    await env.RAW_BUCKET.put(objectKey, body, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { sourceType, fetchedAt, contentHash: hash }
    });
  }

  const sourceRecordId = randomId('src');
  await env.DB.prepare(`
    INSERT INTO source_records
      (id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, rights_status, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sourceRecordId,
    sourceType,
    externalId,
    sourceUrl,
    fetchedAt,
    objectKey,
    hash,
    qualityStatus,
    rightsStatus,
    metadata ? JSON.stringify(metadata) : null
  ).run();

  return { sourceRecordId, objectKey, hash, reused: false };
}
