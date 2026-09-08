import { randomId } from './ids.js';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizedExtension(value) {
  const extension = String(value || 'bin').toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(extension)) throw new Error('raw snapshot extension is invalid');
  return extension;
}

export async function archiveRawSnapshot(env, {
  sourceType,
  externalId = null,
  sourceUrl = null,
  fetchedAt,
  body,
  extension = 'bin',
  contentType = 'application/octet-stream',
  qualityStatus = 'unknown',
  rightsStatus = null,
  metadata = null
}) {
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  const hash = await sha256Hex(rawBody);
  const day = fetchedAt.slice(0, 10);
  const objectKey = `raw/${sourceType}/${day}/${hash}.${normalizedExtension(extension)}`;

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
    await env.RAW_BUCKET.put(objectKey, rawBody, {
      httpMetadata: { contentType },
      customMetadata: { sourceType, fetchedAt, contentHash: hash, contentType }
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

export async function archiveRawPayload(env, {
  sourceType,
  externalId = null,
  sourceUrl = null,
  fetchedAt,
  payload,
  qualityStatus = 'unknown',
  rightsStatus = null,
  metadata = null
}) {
  return archiveRawSnapshot(env, {
    sourceType,
    externalId,
    sourceUrl,
    fetchedAt,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    extension: 'json',
    contentType: 'application/json',
    qualityStatus,
    rightsStatus,
    metadata
  });
}
