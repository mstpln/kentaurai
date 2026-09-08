const SOURCE_TYPE = 'xlabs_script';
const XLABS_HOST = 'kmtid.atgx.se';
const MAX_UNIQUE_SIBLINGS = 7;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_ASSIGNMENTS = 16;
const MAX_PARTS = 20;
const MAX_PART_LENGTH = 160;

function parseMetadata(value) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compact(value, max = MAX_PART_LENGTH) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function safeUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== XLABS_HOST || (url.port && url.port !== '443')) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizePart(value, baseUrl) {
  const raw = String(value || '');
  if (/^(?:https?:)?\/\//i.test(raw)) return safeUrl(raw, baseUrl) || '[redacted_url]';
  return compact(raw.split(/[?#]/, 1)[0]);
}

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

async function readRawText(env, key) {
  if (!key) return null;
  const object = await env.RAW_BUCKET.get(key);
  if (!object) return null;
  const text = await object.text();
  if (byteLength(text) > MAX_SOURCE_BYTES) throw new Error('captured X-Labs context source exceeded inspection size limit');
  return text;
}

function stripComments(value) {
  const text = String(value || '').replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ' '));
  let out = '';
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === '\n') {
        lineComment = false;
        out += '\n';
      } else {
        out += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        out += '  ';
        i += 1;
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      out += '  ';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      out += '  ';
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function assignedExpression(text, startIndex) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  let out = '';
  for (let i = startIndex; i < text.length && out.length < 800; i += 1) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth += 1;
      out += ch;
      continue;
    }
    if ((ch === ';' || ch === ',' || ch === '\n' || ch === '<') && depth === 0) return out.trim();
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    out += ch;
  }
  return out.trim();
}

function tokenizeExpression(expression, baseUrl) {
  const text = String(expression || '');
  const parts = [];
  const pattern = /(['"`])([^'"`]{0,500})\1|\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      const value = sanitizePart(match[2], baseUrl);
      if (value !== null) parts.push({ kind: 'string', value });
    } else {
      let i = (match.index || 0) - 1;
      while (i >= 0 && /\s/.test(text[i])) i -= 1;
      if (i >= 0 && text[i] === '.') continue;
      if (!['true', 'false', 'null', 'undefined', 'const', 'let', 'var', 'return', 'function', 'new'].includes(match[0])) {
        parts.push({ kind: 'identifier', value: match[0] });
      }
    }
    if (parts.length >= MAX_PARTS) break;
  }
  return parts;
}

function staticStringValue(expression) {
  const text = String(expression || '').trim();
  if (!text) return null;
  const tokenPattern = /\s*(?:(['"`])((?:\\.|(?!\1).)*)\1|\+)\s*/gy;
  const strings = [];
  let index = 0;
  let expectString = true;
  while (index < text.length) {
    tokenPattern.lastIndex = index;
    const match = tokenPattern.exec(text);
    if (!match || match.index !== index) return null;
    if (expectString) {
      if (!match[1]) return null;
      strings.push(match[2].replace(/\\(['"`\\])/g, '$1'));
    } else if (match[0].trim() !== '+') {
      return null;
    }
    expectString = !expectString;
    index = tokenPattern.lastIndex;
  }
  return !expectString && strings.length ? strings.join('') : null;
}

function findPathAssignments(text, source, baseUrl) {
  const cleaned = stripComments(text);
  const matches = [];
  const patterns = [
    /(?:^|[;{}\n>])\s*(?:(?:const|let|var)\s+)?path\s*=\s*(?!=)/gm,
    /(?:^|[;{}\n>])\s*(?:window|globalThis)\.path\s*=\s*(?!=)/gm
  ];
  for (const pattern of patterns) {
    for (const match of cleaned.matchAll(pattern)) {
      const start = (match.index || 0) + match[0].length;
      const expression = assignedExpression(cleaned, start);
      if (!expression) continue;
      const staticValue = staticStringValue(expression);
      matches.push({
        source,
        kind: staticValue === null ? 'dynamic' : 'static',
        parts: tokenizeExpression(expression, baseUrl),
        resolvedBaseUrl: staticValue === null ? null : safeUrl(staticValue, baseUrl)
      });
      if (matches.length >= MAX_ASSIGNMENTS) return matches;
    }
  }
  return matches;
}

async function readDeterministicContext(env, source, metadata) {
  const parentId = typeof metadata.parentSourceRecordId === 'string' ? metadata.parentSourceRecordId : null;
  if (!parentId) throw new Error('captured X-Labs script is missing parent provenance');

  const parent = await env.DB.prepare(`
    SELECT id, source_url, raw_object_key
    FROM source_records
    WHERE id = ? AND source_type = 'xlabs'
    LIMIT 1
  `).bind(parentId).first();
  if (!parent?.source_url || !parent.raw_object_key) throw new Error('captured X-Labs parent source record was not found');

  const prefix = `${parentId}:`;
  const siblings = await env.DB.prepare(`
    SELECT id, fetched_at, raw_object_key, metadata_json
    FROM (
      SELECT id, external_id, fetched_at, raw_object_key, metadata_json,
        ROW_NUMBER() OVER (PARTITION BY external_id ORDER BY fetched_at DESC, id DESC) AS rn
      FROM source_records
      WHERE source_type = 'xlabs_script' AND substr(external_id, 1, ?) = ?
    )
    WHERE rn = 1
    ORDER BY fetched_at DESC, id DESC
    LIMIT ?
  `).bind(prefix.length, prefix, MAX_UNIQUE_SIBLINGS + 1).all();

  const context = [];
  const targetText = await readRawText(env, source.raw_object_key);
  if (targetText) context.push({ source: 'target_script', text: targetText });

  const targetScriptName = typeof metadata.scriptName === 'string' ? compact(metadata.scriptName, 80) : null;
  const seenNames = new Set();
  for (const row of siblings.results || []) {
    if (row.id === source.id || !row.raw_object_key) continue;
    const rowMetadata = parseMetadata(row.metadata_json);
    const scriptName = typeof rowMetadata.scriptName === 'string' ? compact(rowMetadata.scriptName, 80) : null;
    if (!scriptName || scriptName === targetScriptName || seenNames.has(scriptName)) continue;
    const text = await readRawText(env, row.raw_object_key);
    if (!text) continue;
    seenNames.add(scriptName);
    context.push({ source: scriptName, text });
    if (seenNames.size >= MAX_UNIQUE_SIBLINGS) break;
  }

  const parentText = await readRawText(env, parent.raw_object_key);
  if (parentText) context.push({ source: 'parent_page', text: parentText });

  return { parentId, parentUrl: parent.source_url, context, uniqueSiblingSources: [...seenNames] };
}

export async function resolveCapturedXlabsRequestPath(env, sourceRecordId) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get) throw new Error('RAW_BUCKET read access is not configured');
  const id = String(sourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');

  const source = await env.DB.prepare(`
    SELECT id, source_url, raw_object_key, metadata_json
    FROM source_records
    WHERE id = ? AND source_type = ?
    LIMIT 1
  `).bind(id, SOURCE_TYPE).first();
  if (!source?.raw_object_key) throw new Error('captured X-Labs script source record was not found');

  const metadata = parseMetadata(source.metadata_json);
  const { parentId, parentUrl, context, uniqueSiblingSources } = await readDeterministicContext(env, source, metadata);
  const assignments = [];
  for (const item of context) {
    assignments.push(...findPathAssignments(item.text, item.source, parentUrl));
    if (assignments.length >= MAX_ASSIGNMENTS) break;
  }

  const staticUrls = [...new Set(assignments.filter((item) => item.kind === 'static' && item.resolvedBaseUrl).map((item) => item.resolvedBaseUrl))];
  const rejectedStatic = assignments.filter((item) => item.kind === 'static' && !item.resolvedBaseUrl);
  const dynamic = assignments.filter((item) => item.kind === 'dynamic');
  let status = 'not_found';
  let resolvedBaseUrl = null;
  if (staticUrls.length > 1) {
    status = 'conflict';
  } else if (staticUrls.length === 1 && (dynamic.length || rejectedStatic.length)) {
    status = 'ambiguous';
  } else if (staticUrls.length === 1) {
    status = 'resolved_static';
    resolvedBaseUrl = staticUrls[0];
  } else if (rejectedStatic.length && dynamic.length) {
    status = 'ambiguous';
  } else if (rejectedStatic.length) {
    status = 'rejected_static';
  } else if (dynamic.length) {
    status = 'dynamic';
  }

  return {
    sourceRecordId: source.id,
    parentSourceRecordId: parentId,
    status,
    resolvedBaseUrl,
    assignments,
    contextSummary: {
      parentIncluded: context.some((item) => item.source === 'parent_page'),
      uniqueSiblingSources,
      sourceCount: context.length
    },
    rawContentReturned: false,
    normalizedRowsWritten: 0
  };
}