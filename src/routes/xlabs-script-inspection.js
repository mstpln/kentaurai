const SOURCE_TYPE = 'xlabs_script';
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 40;
const MAX_LABEL = 240;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function compact(value, max = MAX_LABEL) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function parseMetadata(value) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeUrl(value, baseUrl) {
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return compact(url.toString(), 300);
  } catch {
    return null;
  }
}

function count(text, pattern) {
  let total = 0;
  for (const _ of text.matchAll(pattern)) total += 1;
  return total;
}

function literalNetworkReferences(text, baseUrl) {
  const refs = [];
  const patterns = [
    ['fetch', /\bfetch\s*\(\s*(['"`])([^'"`]{1,500})\1/g],
    ['jquery_get_json', /\$\.getJSON\s*\(\s*(['"`])([^'"`]{1,500})\1/g],
    ['jquery_get', /\$\.get\s*\(\s*(['"`])([^'"`]{1,500})\1/g],
    ['jquery_post', /\$\.post\s*\(\s*(['"`])([^'"`]{1,500})\1/g],
    ['ajax_url', /\burl\s*:\s*(['"`])([^'"`]{1,500})\1/g]
  ];
  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const resolvedUrl = sanitizeUrl(match[2], baseUrl);
      if (resolvedUrl) refs.push({ kind, resolvedUrl });
      if (refs.length >= MAX_ITEMS) return refs;
    }
  }
  return refs;
}

function candidateEndpoints(text, baseUrl) {
  const values = [];
  const pattern = /(?:https?:\/\/[^"'`\s)]+|\/[A-Za-z0-9_./-]{2,}(?:\?[^"'`\s)]*)?|[A-Za-z0-9_./-]+\.(?:json|php|aspx)(?:\?[^"'`\s)]*)?)/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const resolved = sanitizeUrl(raw, baseUrl);
    values.push(resolved || compact(raw.split(/[?#]/, 1)[0], 220));
    if (values.length >= MAX_ITEMS * 3) break;
  }
  return unique(values).slice(0, MAX_ITEMS);
}

function keywordCounts(text) {
  const terms = ['race', 'horse', 'start', 'date', 'track', 'result', 'meeting', 'game', 'json', 'api'];
  const output = {};
  for (const term of terms) output[term] = count(text, new RegExp(`\\b${term}[A-Za-z0-9_]*\\b`, 'gi'));
  return output;
}

export function inspectXlabsScriptText(script, options = {}) {
  const text = String(script || '');
  if (!text.trim()) throw new Error('captured X-Labs script is empty');
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_SCRIPT_BYTES) throw new Error('captured X-Labs script exceeded inspection size limit');
  const baseUrl = options.documentBaseUrl || options.sourceUrl || null;

  return {
    byteLength,
    networkCounts: {
      fetch: count(text, /\bfetch\s*\(/g),
      xhr: count(text, /\bXMLHttpRequest\b/g),
      jqueryAjax: count(text, /\$\.ajax\s*\(/g),
      jqueryGetJson: count(text, /\$\.getJSON\s*\(/g),
      jqueryGet: count(text, /\$\.get\s*\(/g),
      jqueryPost: count(text, /\$\.post\s*\(/g)
    },
    literalNetworkReferences: literalNetworkReferences(text, baseUrl),
    candidateEndpoints: candidateEndpoints(text, baseUrl),
    keywordCounts: keywordCounts(text)
  };
}

export async function inspectCapturedXlabsScript(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');

  const source = await env.DB.prepare(`
    SELECT id, source_type, external_id, source_url, fetched_at, raw_object_key, content_hash, quality_status, metadata_json
    FROM source_records
    WHERE id = ? AND source_type = ?
    LIMIT 1
  `).bind(id, SOURCE_TYPE).first();
  if (!source?.raw_object_key) throw new Error('captured X-Labs script source record was not found');

  const object = await env.RAW_BUCKET.get(source.raw_object_key);
  if (!object) throw new Error('captured X-Labs script raw object was not found');
  const script = await object.text();
  const metadata = parseMetadata(source.metadata_json);

  let documentBaseUrl = null;
  if (metadata.parentSourceRecordId) {
    const parent = await env.DB.prepare(`SELECT source_url FROM source_records WHERE id = ? AND source_type = 'xlabs' LIMIT 1`)
      .bind(metadata.parentSourceRecordId).first();
    documentBaseUrl = parent?.source_url || null;
  }

  return {
    sourceRecordId: source.id,
    scriptName: typeof metadata.scriptName === 'string' ? compact(metadata.scriptName, 80) : null,
    sourceUrl: sanitizeUrl(source.source_url),
    fetchedAt: source.fetched_at,
    contentHash: source.content_hash,
    qualityStatus: source.quality_status,
    parentSourceRecordId: typeof metadata.parentSourceRecordId === 'string' ? metadata.parentSourceRecordId : null,
    inspection: inspectXlabsScriptText(script, { sourceUrl: source.source_url, documentBaseUrl }),
    normalizedRowsWritten: 0,
    mapperStatus: 'not_implemented'
  };
}
