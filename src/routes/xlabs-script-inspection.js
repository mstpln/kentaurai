const SOURCE_TYPE = 'xlabs_script';
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 40;
const MAX_LABEL = 240;
const MAX_EXPRESSION_CHARS = 600;
const MAX_DEFINITIONS = 16;
const MAX_DEFINITION_DEPTH = 4;
const MAX_CONTEXT_SOURCES = 8;

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

function sanitizeLiteralComponent(value, baseUrl) {
  const raw = String(value || '');
  if (/^(?:https?:)?\/\//i.test(raw)) {
    const resolved = sanitizeUrl(raw, baseUrl);
    if (resolved) return resolved;
  }
  return compact(raw.split(/[?#]/, 1)[0], 120);
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

function firstArgument(text, openParenIndex) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  let out = '';
  for (let i = openParenIndex + 1; i < text.length && out.length < MAX_EXPRESSION_CHARS; i += 1) {
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
    if (ch === ')' && depth === 0) return out.trim();
    if (ch === ',' && depth === 0) return out.trim();
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    out += ch;
  }
  return out.trim();
}

function assignedExpression(text, startIndex) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  let out = '';
  for (let i = startIndex; i < text.length && out.length < MAX_EXPRESSION_CHARS; i += 1) {
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
    if ((ch === ';' || ch === '\n') && depth === 0) return out.trim();
    if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    out += ch;
  }
  return out.trim();
}

function expressionParts(expression, baseUrl) {
  const text = String(expression || '');
  const parts = [];
  const tokenPattern = /(['"`])([^'"`]{0,500})\1|\b[A-Za-z_$][A-Za-z0-9_$]*\b/g;
  const ignored = new Set(['true', 'false', 'null', 'undefined', 'const', 'let', 'var', 'return', 'function', 'if', 'else', 'new']);
  for (const match of text.matchAll(tokenPattern)) {
    if (match[1]) {
      const value = sanitizeLiteralComponent(match[2], baseUrl);
      if (value) parts.push({ kind: 'string', value });
    } else if (!ignored.has(match[0])) {
      parts.push({ kind: 'identifier', value: match[0] });
    }
    if (parts.length >= 30) break;
  }
  return parts;
}

function summarizeExpression(expression, baseUrl) {
  const text = String(expression || '').trim();
  if (!text) return null;

  const singleLiteral = text.match(/^(['"`])([^'"`]*)\1$/);
  if (singleLiteral) {
    const resolvedUrl = sanitizeUrl(singleLiteral[2], baseUrl);
    return {
      expressionType: 'literal',
      identifiers: [],
      literals: resolvedUrl ? [{ kind: 'url', value: resolvedUrl }] : [],
      parts: resolvedUrl ? [{ kind: 'url', value: resolvedUrl }] : []
    };
  }

  const withoutQuotedStrings = text.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, ' ');
  const identifiers = unique([...withoutQuotedStrings.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g)].map((m) => m[0]))
    .filter((value) => !['true', 'false', 'null', 'undefined'].includes(value))
    .slice(0, 20);
  const literals = [];
  for (const match of text.matchAll(/(['"`])([^'"`]{0,500})\1/g)) {
    const value = sanitizeLiteralComponent(match[2], baseUrl);
    if (value) literals.push({ kind: 'string', value });
    if (literals.length >= 20) break;
  }
  return {
    expressionType: 'dynamic',
    identifiers,
    literals,
    parts: expressionParts(text, baseUrl)
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function latestDefinition(text, identifier, beforeIndex, baseUrl) {
  const escaped = escapeRegExp(identifier);
  const pattern = new RegExp(`(?:^|[;{}\\n])\\s*(?:(?:const|let|var)\\s+)?${escaped}\\s*=\\s*(?!=)`, 'gm');
  let latest = null;
  for (const match of text.slice(0, beforeIndex).matchAll(pattern)) latest = match;
  if (!latest) return null;
  const expressionStart = (latest.index || 0) + latest[0].length;
  const summary = summarizeExpression(assignedExpression(text, expressionStart), baseUrl);
  return summary ? { identifier, ...summary } : null;
}

function definitionSummaries(text, identifiers, beforeIndex, baseUrl) {
  const definitions = [];
  const visited = new Set();
  let frontier = identifiers.map((identifier) => ({ identifier, depth: 0 }));

  while (frontier.length && definitions.length < MAX_DEFINITIONS) {
    const next = [];
    for (const item of frontier) {
      if (visited.has(item.identifier) || item.depth >= MAX_DEFINITION_DEPTH) continue;
      visited.add(item.identifier);
      const definition = latestDefinition(text, item.identifier, beforeIndex, baseUrl);
      if (!definition) continue;
      definitions.push(definition);
      for (const nested of definition.identifiers) {
        if (!visited.has(nested)) next.push({ identifier: nested, depth: item.depth + 1 });
      }
      if (definitions.length >= MAX_DEFINITIONS) break;
    }
    frontier = next;
  }
  return definitions;
}

function unresolvedIdentifiers(shape) {
  const referenced = new Set(shape.identifiers || []);
  for (const definition of shape.definitions || []) {
    for (const identifier of definition.identifiers || []) referenced.add(identifier);
  }
  const defined = new Set((shape.definitions || []).map((definition) => definition.identifier));
  return [...referenced].filter((identifier) => !defined.has(identifier)).slice(0, 20);
}

function requestArgumentShapes(text, baseUrl) {
  const patterns = [
    ['fetch', /\bfetch\s*\(/g],
    ['jquery_get_json', /\$\.getJSON\s*\(/g],
    ['jquery_get', /\$\.get\s*\(/g],
    ['jquery_post', /\$\.post\s*\(/g]
  ];
  const items = [];
  for (const [kind, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      const callIndex = match.index || 0;
      const openParen = callIndex + match[0].lastIndexOf('(');
      const summary = summarizeExpression(firstArgument(text, openParen), baseUrl);
      if (summary) {
        const definitions = definitionSummaries(text, summary.identifiers, callIndex, baseUrl);
        const shape = { kind, ...summary, definitions };
        shape.unresolvedIdentifiers = unresolvedIdentifiers(shape);
        items.push(shape);
      }
      if (items.length >= MAX_ITEMS) return items;
    }
  }
  return items;
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
    requestArgumentShapes: requestArgumentShapes(text, baseUrl),
    candidateEndpoints: candidateEndpoints(text, baseUrl),
    keywordCounts: keywordCounts(text)
  };
}

async function readContextSources(env, source, metadata) {
  const context = [];
  const parentId = typeof metadata.parentSourceRecordId === 'string' ? metadata.parentSourceRecordId : null;
  if (!parentId) return context;

  const siblings = await env.DB.prepare(`
    SELECT id, raw_object_key, metadata_json
    FROM source_records
    WHERE source_type = 'xlabs_script' AND external_id LIKE ?
    ORDER BY fetched_at DESC
    LIMIT ?
  `).bind(`${parentId}:%`, MAX_CONTEXT_SOURCES).all();

  for (const row of siblings.results || []) {
    if (!row?.raw_object_key || row.id === source.id) continue;
    const object = await env.RAW_BUCKET.get(row.raw_object_key);
    if (!object) continue;
    const siblingMetadata = parseMetadata(row.metadata_json);
    context.push({
      source: typeof siblingMetadata.scriptName === 'string' ? compact(siblingMetadata.scriptName, 80) : 'captured_script',
      text: await object.text()
    });
  }

  const parent = await env.DB.prepare(`
    SELECT source_url, raw_object_key
    FROM source_records
    WHERE id = ? AND source_type = 'xlabs'
    LIMIT 1
  `).bind(parentId).first();
  if (parent?.raw_object_key) {
    const object = await env.RAW_BUCKET.get(parent.raw_object_key);
    if (object) context.push({ source: 'parent_page', text: await object.text() });
  }
  return context.slice(0, MAX_CONTEXT_SOURCES);
}

function contextDefinitionsForShape(shape, contextSources, baseUrl) {
  const results = [];
  for (const identifier of shape.unresolvedIdentifiers || []) {
    for (const context of contextSources) {
      const definition = latestDefinition(context.text, identifier, context.text.length, baseUrl);
      if (!definition) continue;
      results.push({ source: context.source, ...definition });
      if (results.length >= MAX_DEFINITIONS) return results;
    }
  }
  return results;
}

function buildRequestRecipe(shape) {
  return {
    kind: shape.kind,
    requestParts: shape.parts || [],
    localDefinitions: (shape.definitions || []).map((definition) => ({
      identifier: definition.identifier,
      parts: definition.parts || [],
      identifiers: definition.identifiers || []
    })),
    contextDefinitions: (shape.contextDefinitions || []).map((definition) => ({
      source: definition.source,
      identifier: definition.identifier,
      parts: definition.parts || [],
      identifiers: definition.identifiers || []
    })),
    unresolvedIdentifiers: shape.unresolvedIdentifiers || []
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

  const inspection = inspectXlabsScriptText(script, { sourceUrl: source.source_url, documentBaseUrl });
  const contextSources = await readContextSources(env, source, metadata);
  for (const shape of inspection.requestArgumentShapes) {
    shape.contextDefinitions = contextDefinitionsForShape(shape, contextSources, documentBaseUrl || source.source_url);
    shape.requestRecipe = buildRequestRecipe(shape);
  }

  return {
    sourceRecordId: source.id,
    scriptName: typeof metadata.scriptName === 'string' ? compact(metadata.scriptName, 80) : null,
    sourceUrl: sanitizeUrl(source.source_url),
    fetchedAt: source.fetched_at,
    contentHash: source.content_hash,
    qualityStatus: source.quality_status,
    parentSourceRecordId: typeof metadata.parentSourceRecordId === 'string' ? metadata.parentSourceRecordId : null,
    inspection,
    normalizedRowsWritten: 0,
    mapperStatus: 'not_implemented'
  };
}
