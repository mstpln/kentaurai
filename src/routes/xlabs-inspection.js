const SOURCE_TYPE = 'xlabs';
const MAX_LIST_ITEMS = 20;
const MAX_LABEL_LENGTH = 120;
const MAX_HTML_BYTES = 8 * 1024 * 1024;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function boundedText(value, max = MAX_LABEL_LENGTH) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function stripTags(value) {
  return boundedText(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"));
}

function countMatches(text, pattern) {
  let count = 0;
  for (const _ of text.matchAll(pattern)) count += 1;
  return count;
}

function attributeValue(attrs, name) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(attrs || '').match(pattern);
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function sanitizeHttpUrl(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return boundedText(url.toString(), 240);
}

function normalizeUrlCandidate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    if (/^https?:\/\//i.test(text)) return sanitizeHttpUrl(new URL(text));
  } catch {
    return null;
  }
  if (text.startsWith('/') && !text.startsWith('//')) return boundedText(text.split(/[?#]/, 1)[0], 240);
  return null;
}

function normalizeDocumentReference(value, baseUrl) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const resolved = baseUrl ? new URL(text, baseUrl) : new URL(text);
    return sanitizeHttpUrl(resolved);
  } catch {
    return null;
  }
}

function scriptSummaries(html) {
  const scripts = [];
  const srcs = [];
  let inlineScripts = 0;
  let externalScripts = 0;
  let jsonScripts = 0;
  let fetchCalls = 0;
  let xhrMentions = 0;
  let apiMentions = 0;
  let nextData = false;
  let windowData = false;
  const candidateUrls = [];

  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const src = attributeValue(attrs, 'src');
    const type = (attributeValue(attrs, 'type') || '').toLowerCase();
    const id = attributeValue(attrs, 'id');
    if (src) {
      externalScripts += 1;
      const normalizedSrc = normalizeUrlCandidate(src);
      if (normalizedSrc) srcs.push(normalizedSrc);
    } else {
      inlineScripts += 1;
    }

    fetchCalls += countMatches(body, /\bfetch\s*\(/g);
    xhrMentions += countMatches(body, /\bXMLHttpRequest\b/g);
    apiMentions += countMatches(body, /(?:\/api\/|\.json\b)/gi);
    if (id === '__NEXT_DATA__' || body.includes('__NEXT_DATA__')) nextData = true;
    if (/window\.__[A-Za-z0-9_]+\s*=/.test(body)) windowData = true;

    for (const urlMatch of body.matchAll(/(?:https?:\/\/[^"'`\s)]+|\/[A-Za-z0-9_./-]+(?:\?[^"'`\s)]*)?)/g)) {
      const normalized = normalizeUrlCandidate(urlMatch[0]);
      if (normalized) candidateUrls.push(normalized);
    }

    if (type.includes('json') || id === '__NEXT_DATA__') {
      jsonScripts += 1;
      const summary = {
        id: boundedText(id, 80),
        type: boundedText(type, 80),
        parseable: false,
        valueType: null,
        topLevelKeys: [],
        arrayLength: null
      };
      try {
        const parsed = JSON.parse(body.trim());
        summary.parseable = true;
        if (Array.isArray(parsed)) {
          summary.valueType = 'array';
          summary.arrayLength = parsed.length;
        } else if (parsed && typeof parsed === 'object') {
          summary.valueType = 'object';
          summary.topLevelKeys = Object.keys(parsed).sort().slice(0, MAX_LIST_ITEMS).map((key) => boundedText(key, 80));
        } else {
          summary.valueType = typeof parsed;
        }
      } catch {}
      scripts.push(summary);
    }
  }

  return {
    total: countMatches(html, /<script\b/gi),
    inline: inlineScripts,
    external: externalScripts,
    externalSources: unique(srcs).slice(0, MAX_LIST_ITEMS),
    jsonScripts,
    jsonScriptSummaries: scripts.slice(0, 10),
    fetchCalls,
    xhrMentions,
    apiMentions,
    hasNextData: nextData,
    hasWindowAssignedData: windowData,
    candidateEndpoints: unique(candidateUrls).slice(0, MAX_LIST_ITEMS)
  };
}

function iframeSummaries(html, baseUrl) {
  const frames = [];
  for (const match of html.matchAll(/<iframe\b([^>]*)>/gi)) {
    const attrs = match[1] || '';
    const src = normalizeDocumentReference(attributeValue(attrs, 'src'), baseUrl);
    frames.push({
      src,
      name: boundedText(attributeValue(attrs, 'name'), 80),
      id: boundedText(attributeValue(attrs, 'id'), 80)
    });
    if (frames.length >= MAX_LIST_ITEMS) break;
  }
  return frames;
}

function tableSummaries(html) {
  const tables = [];
  for (const tableMatch of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const tableHtml = tableMatch[1] || '';
    const headers = [];
    const thead = tableHtml.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
    for (const th of thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)) {
      const text = stripTags(th[1]);
      if (text) headers.push(text);
    }
    tables.push({
      headers: unique(headers).slice(0, MAX_LIST_ITEMS),
      rowCount: countMatches(tableHtml, /<tr\b/gi)
    });
    if (tables.length >= 10) break;
  }
  return tables;
}

function dataAttributes(html) {
  const names = [];
  for (const match of html.matchAll(/\s(data-[a-z0-9_-]+)\s*=/gi)) names.push(match[1].toLowerCase());
  return unique(names).sort().slice(0, MAX_LIST_ITEMS);
}

export function inspectXlabsHtml(html, options = {}) {
  const text = String(html || '');
  if (!text.trim()) throw new Error('captured X-Labs HTML is empty');
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_HTML_BYTES) throw new Error('captured X-Labs HTML exceeded inspection size limit');
  const titleMatch = text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const scripts = scriptSummaries(text);
  const tables = tableSummaries(text);
  const iframes = iframeSummaries(text, options.baseUrl);
  const channels = [];
  if (tables.length) channels.push('html_table');
  if (scripts.jsonScripts) channels.push('embedded_json');
  if (scripts.fetchCalls || scripts.xhrMentions || scripts.apiMentions || scripts.candidateEndpoints.length) channels.push('network_or_api_reference');
  if (scripts.hasNextData || scripts.hasWindowAssignedData) channels.push('embedded_application_state');
  if (iframes.some((frame) => frame.src)) channels.push('iframe_document');
  if (!channels.length) channels.push('static_html_or_unknown');

  return {
    byteLength,
    title: titleMatch ? stripTags(titleMatch[1]) : null,
    counts: {
      tables: countMatches(text, /<table\b/gi),
      rows: countMatches(text, /<tr\b/gi),
      forms: countMatches(text, /<form\b/gi),
      iframes: countMatches(text, /<iframe\b/gi),
      links: countMatches(text, /<a\b/gi)
    },
    candidateDataChannels: channels,
    scripts,
    iframes,
    tables,
    dataAttributes: dataAttributes(text)
  };
}

function safeMetadata(metadataJson) {
  let parsed;
  try { parsed = metadataJson ? JSON.parse(metadataJson) : null; } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return {
    kind: typeof parsed.kind === 'string' ? boundedText(parsed.kind, 80) : null,
    date: typeof parsed.date === 'string' ? boundedText(parsed.date, 40) : null,
    normalizationStatus: typeof parsed.normalizationStatus === 'string' ? boundedText(parsed.normalizationStatus, 80) : null
  };
}

export async function inspectCapturedXlabs(env, sourceRecordId) {
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
  if (!source?.raw_object_key) throw new Error('captured X-Labs source record was not found');

  const object = await env.RAW_BUCKET.get(source.raw_object_key);
  if (!object) throw new Error('captured X-Labs raw object was not found');
  const html = await object.text();

  return {
    sourceRecordId: source.id,
    externalId: source.external_id,
    sourceUrl: normalizeUrlCandidate(source.source_url),
    fetchedAt: source.fetched_at,
    contentHash: source.content_hash,
    qualityStatus: source.quality_status,
    metadata: safeMetadata(source.metadata_json),
    inspection: inspectXlabsHtml(html, { baseUrl: source.source_url }),
    normalizedRowsWritten: 0,
    mapperStatus: 'not_implemented'
  };
}
