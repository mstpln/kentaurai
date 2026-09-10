import { archiveRawSnapshot } from '../raw.js';
import { finishImportRun, startImportRun } from '../import/common.js';
import { validateXlabsDate } from './xlabs.js';
import { resolveCapturedXlabsRequestPath } from '../routes/xlabs-path-resolution.js';

const XLABS_HOST = 'kmtid.atgx.se';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const MAX_SAMPLE_FIELDS = 20;
const MAX_SAMPLE_DEPTH = 3;
const XLABS_FETCH_TIMEOUT_MS = 30_000;
const MAX_FAST_CONTEXT_BYTES = 512 * 1024;

function positiveInteger(value, name, max) {
  const text = typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be an integer between 1 and ${max}`);
  const number = Number(text);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error(`${name} must be an integer between 1 and ${max}`);
  return number;
}

function compactDate(date) {
  return validateXlabsDate(date).slice(2).replaceAll('-', '');
}

function validateResolvedBaseUrl(value, date) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('resolved X-Labs race-data URL must use https');
  if (url.username || url.password) throw new Error('resolved X-Labs race-data URL must not contain credentials');
  if (url.hostname.toLowerCase() !== XLABS_HOST) throw new Error('resolved X-Labs race-data URL must use kmtid.atgx.se');
  if (url.port && url.port !== '443') throw new Error('resolved X-Labs race-data URL must use the standard https port');
  const expectedPath = `/${compactDate(date)}/json/`;
  if (url.pathname !== expectedPath) throw new Error(`resolved X-Labs race-data URL must use ${expectedPath}`);
  url.search = '';
  url.hash = '';
  return url;
}

function validateCapturedDatePageUrl(value, date) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.hostname.toLowerCase() !== XLABS_HOST) return null;
  if (url.port && url.port !== '443') return null;
  const expected = `/${compactDate(date)}`;
  if (url.pathname !== expected && url.pathname !== `${expected}/`) return null;
  if (url.search || url.hash) return null;
  return url;
}

function parseMetadata(value) {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function loadCaptureContext(env, calculateSourceRecordId) {
  const source = await env.DB.prepare(`
    SELECT id, raw_object_key, metadata_json
    FROM source_records
    WHERE id = ? AND source_type = 'xlabs_script'
    LIMIT 1
  `).bind(calculateSourceRecordId).first();
  if (!source) throw new Error('captured X-Labs calculate script source record was not found');
  const metadata = parseMetadata(source.metadata_json);
  if (metadata.scriptName !== 'calculate.js') throw new Error('source_record_id must reference captured calculate.js');
  const parentId = typeof metadata.parentSourceRecordId === 'string' ? metadata.parentSourceRecordId : null;
  if (!parentId) throw new Error('captured X-Labs calculate script is missing parent provenance');

  const parent = await env.DB.prepare(`
    SELECT id, source_url, metadata_json
    FROM source_records
    WHERE id = ? AND source_type = 'xlabs'
    LIMIT 1
  `).bind(parentId).first();
  if (!parent) throw new Error('captured X-Labs parent source record was not found');
  const parentMetadata = parseMetadata(parent.metadata_json);
  const date = typeof parentMetadata.date === 'string' ? parentMetadata.date : null;
  try { validateXlabsDate(date); } catch { throw new Error('captured X-Labs parent source is missing a valid date'); }
  return {
    parentId,
    parentSourceUrl: parent.source_url,
    calculateRawObjectKey: source.raw_object_key,
    date
  };
}

async function readFastContextText(env, key) {
  if (!key) return null;
  const object = await env.RAW_BUCKET.get(key);
  if (!object) return null;
  const text = await object.text();
  if (new TextEncoder().encode(text).byteLength > MAX_FAST_CONTEXT_BYTES) return null;
  return text;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function maskStringsAndComments(value) {
  const text = String(value || '');
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
      } else out += ' ';
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        out += '  ';
        i += 1;
      } else out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        out += ' ';
      } else if (ch === '\\') {
        escaped = true;
        out += ' ';
      } else if (ch === quote) {
        quote = null;
        out += ch;
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
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

function findMatching(text, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitArguments(text) {
  const args = [];
  let quote = null;
  let escaped = false;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start).trim());
  return args;
}

function staticJsonPathArgument(value) {
  const text = String(value || '').trim();
  const match = /^(['"])json\/\1$/.exec(text);
  return Boolean(match);
}

function isDirectFunctionCall(maskedText, nameIndex) {
  const immediate = maskedText[nameIndex - 1];
  if (immediate && /[A-Za-z0-9_$]/.test(immediate)) return false;
  let i = nameIndex - 1;
  while (i >= 0 && /\s/.test(maskedText[i])) i -= 1;
  return i < 0 || maskedText[i] !== '.';
}

function calculatePathFunctions(calculateText) {
  if (!calculateText) return [];
  const masked = maskStringsAndComments(calculateText);
  const found = [];
  const pattern = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*\{/g;
  for (const match of masked.matchAll(pattern)) {
    const params = match[2].split(',').map((part) => part.trim()).filter(Boolean);
    const pathIndex = params.indexOf('path');
    if (pathIndex < 0) continue;
    const openBrace = (match.index || 0) + match[0].lastIndexOf('{');
    const closeBrace = findMatching(masked, openBrace, '{', '}');
    if (closeBrace < 0) continue;
    const body = masked.slice(openBrace + 1, closeBrace);
    if (!/\$\.getJSON\s*\(\s*path\s*\+/.test(body)) continue;
    found.push({ name: match[1], pathIndex });
  }
  return found;
}

function mainUsesOnlyJsonPath(mainText, fn) {
  if (!mainText || !fn) return false;
  const masked = maskStringsAndComments(mainText);
  const callPattern = new RegExp(`\\b${escapeRegExp(fn.name)}\\s*\\(`, 'g');
  let seen = false;
  for (const match of masked.matchAll(callPattern)) {
    const nameIndex = match.index || 0;
    if (!isDirectFunctionCall(masked, nameIndex)) continue;
    const openParen = nameIndex + match[0].lastIndexOf('(');
    const closeParen = findMatching(masked, openParen, '(', ')');
    if (closeParen < 0) return false;
    const args = splitArguments(String(mainText).slice(openParen + 1, closeParen));
    if (fn.pathIndex >= args.length || !staticJsonPathArgument(args[fn.pathIndex])) return false;
    seen = true;
  }
  return seen;
}

function uniqueVerifiedJsonPathFunction(calculateText, mainText) {
  const verified = calculatePathFunctions(calculateText).filter((fn) => mainUsesOnlyJsonPath(mainText, fn));
  return verified.length === 1 ? verified[0].name : null;
}

async function verifiedCapturedContextBaseUrl(env, context) {
  if (!validateCapturedDatePageUrl(context.parentSourceUrl, context.date)) return null;
  const sibling = await env.DB.prepare(`
    SELECT raw_object_key
    FROM source_records
    WHERE source_type = 'xlabs_script'
      AND external_id = ?
      AND raw_object_key IS NOT NULL
    ORDER BY fetched_at DESC, id DESC
    LIMIT 1
  `).bind(`${context.parentId}:main.js`).first();
  if (!sibling?.raw_object_key) return null;

  const [calculateText, mainText] = await Promise.all([
    readFastContextText(env, context.calculateRawObjectKey),
    readFastContextText(env, sibling.raw_object_key)
  ]);
  if (!uniqueVerifiedJsonPathFunction(calculateText, mainText)) return null;
  return validateResolvedBaseUrl(`https://${XLABS_HOST}/${compactDate(context.date)}/json/`, context.date);
}

async function resolveRaceBaseUrl(env, sourceId, context) {
  const verified = await verifiedCapturedContextBaseUrl(env, context);
  if (verified) return { baseUrl: verified, resolution: 'verified_captured_context' };

  const pathResolution = await resolveCapturedXlabsRequestPath(env, sourceId);
  if (pathResolution.status !== 'resolved_static' || !pathResolution.resolvedBaseUrl) {
    throw new Error(`X-Labs race-data path is not uniquely resolved (${pathResolution.status})`);
  }
  return {
    baseUrl: validateResolvedBaseUrl(pathResolution.resolvedBaseUrl, context.date),
    resolution: 'script_path_resolution'
  };
}

async function lookupCanonicalTrackName(env, externalTrackId) {
  const row = await env.DB.prepare(`
    SELECT t.canonical_name AS name
    FROM track_external_ids x
    JOIN tracks t ON t.id = x.track_id
    WHERE x.source_type = 'official' AND x.external_id = ?
    LIMIT 1
  `).bind(String(externalTrackId)).first();
  const name = String(row?.name || '').trim();
  return name || null;
}

async function resolveXlabsTrackId(env, requestedTrackId) {
  const canonicalTrackName = await lookupCanonicalTrackName(env, requestedTrackId);
  if (!canonicalTrackName) throw new Error('official track id is not mapped to a canonical track');
  return {
    xlabsTrackId: requestedTrackId,
    canonicalTrackName,
    mappingStatus: 'observed_official_track_id_with_payload_guard'
  };
}

export function buildXlabsRaceFileName(date, trackId, raceNumber) {
  const normalized = validateXlabsDate(date);
  const track = positiveInteger(trackId, 'track_id', 99);
  const race = positiveInteger(raceNumber, 'race_number', 99);
  const month = normalized.slice(5, 7);
  const day = normalized.slice(8, 10);
  return `1${month}${day}${String(track).padStart(2, '0')}${String(race).padStart(2, '0')}.json`;
}

export function validateXlabsRacePayload(payload, trackId, raceNumber) {
  if (!Array.isArray(payload) || payload.length === 0) throw new Error('X-Labs race data must be a non-empty telemetry-frame array');
  const track = positiveInteger(trackId, 'xlabs_track_id', 99);
  const race = positiveInteger(raceNumber, 'race_number', 99);
  for (let index = 0; index < payload.length; index += 1) {
    const frame = payload[index];
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error(`X-Labs telemetry frame ${index} must be an object`);
    if (frame.trackId !== track) throw new Error(`X-Labs telemetry frame ${index} has an unexpected trackId`);
    if (frame.raceNumber !== race) throw new Error(`X-Labs telemetry frame ${index} has an unexpected raceNumber`);
    if (!Array.isArray(frame.targets)) throw new Error(`X-Labs telemetry frame ${index} targets must be an array`);
    if (typeof frame.timestamp !== 'string' || !Number.isFinite(Date.parse(frame.timestamp))) {
      throw new Error(`X-Labs telemetry frame ${index} has an invalid timestamp`);
    }
  }
  return payload;
}

function validateRedirectUrl(currentUrl, location, expectedPathname) {
  if (!location) throw new Error('X-Labs race-data redirect did not include a location');
  const target = new URL(location, currentUrl);
  if (target.protocol !== 'https:') throw new Error('X-Labs race-data redirect must use https');
  if (target.username || target.password) throw new Error('X-Labs race-data redirect must not contain credentials');
  if (target.hostname.toLowerCase() !== XLABS_HOST) throw new Error('X-Labs race-data redirect must stay on kmtid.atgx.se');
  if (target.port && target.port !== '443') throw new Error('X-Labs race-data redirect must use the standard https port');
  if (target.pathname !== expectedPathname) throw new Error('X-Labs race-data redirect must preserve the verified race file path');
  target.search = '';
  target.hash = '';
  return target.toString();
}

function raceHttpError(status) {
  const error = new Error(`X-Labs race data returned HTTP ${status}`);
  if (status === 404) error.code = 'XLABS_NOT_FOUND';
  return error;
}

async function readBoundedText(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new Error('X-Labs race-data response exceeded size limit');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('X-Labs race-data response exceeded size limit');
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}

async function fetchJsonText(url, fetchImpl, timeoutMs = XLABS_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const expectedPathname = new URL(url).pathname;
  let currentUrl = url;
  let redirects = 0;
  try {
    while (true) {
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        headers: { accept: 'application/json,text/plain;q=0.5' },
        redirect: 'manual',
        signal: controller.signal
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= MAX_REDIRECTS) throw new Error('X-Labs race-data capture exceeded redirect limit');
        currentUrl = validateRedirectUrl(currentUrl, response.headers.get('location'), expectedPathname);
        redirects += 1;
        continue;
      }
      if (!response.ok) throw raceHttpError(response.status);
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (type && !type.includes('json') && !type.includes('text/plain')) throw new Error('X-Labs race-data response had an unexpected content type');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('X-Labs race-data response exceeded size limit');
      const body = await readBoundedText(response);
      let parsed;
      try { parsed = JSON.parse(body); } catch { throw new Error('X-Labs race-data response was not valid JSON'); }
      return { body, parsed, finalUrl: currentUrl, redirectCount: redirects };
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`X-Labs race-data capture timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeValue(value, depth = 0, budget = { remaining: MAX_SAMPLE_FIELDS }) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: depth < MAX_SAMPLE_DEPTH && value.length ? summarizeValue(value[0], depth + 1, budget) : null
    };
  }
  if (typeof value === 'object') {
    const allKeys = Object.keys(value).sort();
    const keys = [];
    const fields = {};
    for (const key of allKeys) {
      if (budget.remaining <= 0) break;
      budget.remaining -= 1;
      keys.push(key);
      if (depth < MAX_SAMPLE_DEPTH) fields[key] = summarizeValue(value[key], depth + 1, budget);
    }
    return { type: 'object', keys, fields, truncated: keys.length < allKeys.length };
  }
  if (typeof value === 'string') return { type: 'string', example: value.slice(0, 120) };
  if (typeof value === 'number' || typeof value === 'boolean') return { type: typeof value, example: value };
  return { type: typeof value };
}

export async function captureXlabsRaceJson(env, calculateSourceRecordId, trackId, raceNumber, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get || !env.RAW_BUCKET?.put) throw new Error('RAW_BUCKET read/write access is not configured');
  const sourceId = String(calculateSourceRecordId || '').trim();
  if (!sourceId) throw new Error('source_record_id is required');

  const context = await loadCaptureContext(env, sourceId);
  const { parentId, date } = context;
  const { baseUrl, resolution } = await resolveRaceBaseUrl(env, sourceId, context);
  const requestedTrackId = positiveInteger(trackId, 'track_id', 99);
  const race = positiveInteger(raceNumber, 'race_number', 99);
  const trackMapping = await resolveXlabsTrackId(env, requestedTrackId);
  const xlabsTrackId = positiveInteger(trackMapping.xlabsTrackId, 'xlabs_track_id', 99);
  const fileName = buildXlabsRaceFileName(date, xlabsTrackId, race);
  const requestedUrl = new URL(fileName, baseUrl).toString();
  const run = await startImportRun(env, 'xlabs_race_capture', {
    kind: 'race_json', parentSourceRecordId: parentId, calculateSourceRecordId: sourceId, date,
    requestedTrackId, xlabsTrackId, raceNumber: race, trackMappingStatus: trackMapping.mappingStatus,
    pathResolution: resolution
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    const fetchedAt = new Date().toISOString();
    const fetched = await fetchJsonText(requestedUrl, options.fetchImpl || fetch, options.timeoutMs ?? XLABS_FETCH_TIMEOUT_MS);
    validateXlabsRacePayload(fetched.parsed, xlabsTrackId, race);
    const archived = await archiveRawSnapshot(env, {
      sourceType: 'xlabs_race_json',
      externalId: `${date}:${xlabsTrackId}:${race}`,
      sourceUrl: fetched.finalUrl,
      fetchedAt,
      body: fetched.body,
      extension: 'json',
      contentType: 'application/json; charset=utf-8',
      qualityStatus: 'captured_unmapped',
      rightsStatus: 'unknown',
      metadata: {
        kind: 'race_json',
        date,
        requestedTrackId,
        xlabsTrackId,
        canonicalTrackName: trackMapping.canonicalTrackName,
        trackMappingStatus: trackMapping.mappingStatus,
        raceNumber: race,
        fileName,
        parentSourceRecordId: parentId,
        calculateSourceRecordId: sourceId,
        requestedUrl,
        redirectCount: fetched.redirectCount,
        pathResolution: resolution,
        acquisitionRecipe: '1MMDDTTRR.json',
        normalizationStatus: 'available_verified_subset'
      }
    });
    if (archived.reused) counts.skipped = 1;
    else counts.inserted = 1;
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId: archived.sourceRecordId,
      parentSourceRecordId: parentId,
      date,
      requestedTrackId,
      xlabsTrackId,
      trackMappingStatus: trackMapping.mappingStatus,
      pathResolution: resolution,
      raceNumber: race,
      fileName,
      requestedUrl,
      url: fetched.finalUrl,
      redirectCount: fetched.redirectCount,
      reused: archived.reused,
      qualityStatus: 'captured_unmapped',
      normalizationStatus: 'available_verified_subset',
      schemaSampleFieldLimit: MAX_SAMPLE_FIELDS,
      schemaSample: summarizeValue(fetched.parsed),
      normalizedRowsWritten: 0
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
