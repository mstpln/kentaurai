import { archiveRawSnapshot } from '../raw.js';
import { finishImportRun, startImportRun } from '../import/common.js';
import { validateXlabsDate } from './xlabs.js';
import { buildXlabsRaceFileName } from './xlabs-race.js';
import { resolveCapturedXlabsRequestPath } from '../routes/xlabs-path-resolution.js';

const XLABS_HOST = 'kmtid.atgx.se';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RACES_SCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const MAX_PROBE_CANDIDATES = 12;
const MAX_SAMPLE_FIELDS = 20;
const MAX_SAMPLE_DEPTH = 3;

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
    SELECT id, metadata_json
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
    SELECT id, metadata_json
    FROM source_records
    WHERE id = ? AND source_type = 'xlabs'
    LIMIT 1
  `).bind(parentId).first();
  if (!parent) throw new Error('captured X-Labs parent source record was not found');
  const parentMetadata = parseMetadata(parent.metadata_json);
  const date = typeof parentMetadata.date === 'string' ? parentMetadata.date : null;
  try { validateXlabsDate(date); } catch { throw new Error('captured X-Labs parent source is missing a valid date'); }
  return { parentId, date };
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

async function loadNewestRacesScript(env, parentId) {
  const row = await env.DB.prepare(`
    SELECT raw_object_key
    FROM source_records
    WHERE source_type = 'xlabs_script'
      AND external_id = ?
    ORDER BY fetched_at DESC, id DESC
    LIMIT 1
  `).bind(`${parentId}:races.js`).first();
  if (!row?.raw_object_key) return null;
  const object = await env.RAW_BUCKET.get(row.raw_object_key);
  if (!object) return null;
  const text = await object.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RACES_SCRIPT_BYTES) throw new Error('captured X-Labs races.js exceeded mapping size limit');
  return text;
}

function decodeJavascriptString(value) {
  return String(value || '')
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (match, hex) => {
      const code = Number.parseInt(hex, 16);
      return code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\([\\'"`])/g, '$1');
}

function normalizedTrackName(value) {
  return decodeJavascriptString(value).normalize('NFKC').trim().toLocaleLowerCase('sv-SE');
}

function scanJavascriptObjectsAndStrings(script) {
  const text = String(script || '');
  const objectStack = [];
  const objects = [];
  const strings = [];
  const comments = [];
  let quote = null;
  let stringStart = -1;
  let stringValue = '';
  let escaped = false;
  let lineComment = false;
  let lineCommentStart = -1;
  let blockComment = false;
  let blockCommentStart = -1;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) {
      if (ch === '\n') {
        comments.push({ start: lineCommentStart, end: i - 1 });
        lineComment = false;
        lineCommentStart = -1;
      }
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        comments.push({ start: blockCommentStart, end: i + 1 });
        blockComment = false;
        blockCommentStart = -1;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        stringValue += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        stringValue += '\\';
        escaped = true;
        continue;
      }
      if (ch === quote) {
        strings.push({ start: stringStart, end: i, value: stringValue, template: quote === '`' });
        quote = null;
        stringStart = -1;
        stringValue = '';
        continue;
      }
      stringValue += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      lineCommentStart = i;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      blockCommentStart = i;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      stringStart = i;
      stringValue = '';
      escaped = false;
      continue;
    }
    if (ch === '{') objectStack.push(i);
    else if (ch === '}') {
      const start = objectStack.pop();
      if (start != null) objects.push({ start, end: i });
    }
  }
  if (lineComment) comments.push({ start: lineCommentStart, end: text.length - 1 });
  if (blockComment) comments.push({ start: blockCommentStart, end: text.length - 1 });
  return { objects, strings, comments };
}

function indexInsideRange(index, ranges) {
  return ranges.some((range) => range.start <= index && range.end >= index);
}

function nextNonWhitespace(text, index) {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return text[i] || null;
}

function directNumericPropertyValues(text, object, propertyName, objects, strings, comments) {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:['"]?\\b${escaped}\\b['"]?)\\s*[:=]\\s*['"]?(\\d{1,3})`, 'g');
  const bodyStart = object.start + 1;
  const body = text.slice(bodyStart, object.end);
  const childObjects = objects.filter((candidate) => candidate.start > object.start && candidate.end < object.end);
  const values = [];
  for (const match of body.matchAll(pattern)) {
    const absoluteIndex = bodyStart + (match.index || 0);
    if (childObjects.some((child) => child.start < absoluteIndex && child.end > absoluteIndex)) continue;
    if (indexInsideRange(absoluteIndex, comments)) continue;
    const containingString = strings.find((token) => token.start <= absoluteIndex && token.end >= absoluteIndex);
    if (containingString) {
      const decodedKey = decodeJavascriptString(containingString.value);
      const isPropertyKey = containingString.start === absoluteIndex
        && decodedKey === propertyName
        && nextNonWhitespace(text, containingString.end + 1) === ':';
      if (!isPropertyKey) continue;
    }
    const value = Number(match[1]);
    if (Number.isInteger(value) && value > 0 && value <= 999 && !values.includes(value)) values.push(value);
  }
  return values;
}

function trackIdCandidatesForExactName(script, trackName) {
  const text = String(script || '');
  const needle = normalizedTrackName(trackName);
  if (!needle) return [];
  const { objects, strings, comments } = scanJavascriptObjectsAndStrings(text);
  const candidates = [];

  for (const token of strings) {
    if (indexInsideRange(token.start, comments)) continue;
    if (token.template && token.value.includes('${')) continue;
    if (normalizedTrackName(token.value) !== needle) continue;
    const containers = objects
      .filter((object) => object.start < token.start && object.end > token.end)
      .sort((a, b) => (a.end - a.start) - (b.end - b.start));
    for (const object of containers) {
      const ids = directNumericPropertyValues(text, object, 'trackId', objects, strings, comments);
      if (ids.length > 1) break;
      if (ids.length === 1) {
        if (!candidates.includes(ids[0])) candidates.push(ids[0]);
        break;
      }
    }
  }
  return candidates.sort((a, b) => a - b);
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

async function fetchCandidateJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
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
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`X-Labs race data returned HTTP ${response.status}`);
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (type && !type.includes('json') && !type.includes('text/plain')) throw new Error('X-Labs race-data response had an unexpected content type');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('X-Labs race-data response exceeded size limit');
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error('X-Labs race-data response exceeded size limit');
      let parsed;
      try { parsed = JSON.parse(body); } catch { throw new Error('X-Labs race-data response was not valid JSON'); }
      return { body, parsed, finalUrl: currentUrl, redirectCount: redirects };
    }
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

  const { parentId, date } = await loadCaptureContext(env, sourceId);
  const pathResolution = await resolveCapturedXlabsRequestPath(env, sourceId);
  if (pathResolution.status !== 'resolved_static' || !pathResolution.resolvedBaseUrl) {
    throw new Error(`X-Labs race-data path is not uniquely resolved (${pathResolution.status})`);
  }
  const baseUrl = validateResolvedBaseUrl(pathResolution.resolvedBaseUrl, date);
  const requestedTrackId = positiveInteger(trackId, 'track_id', 999);
  const race = positiveInteger(raceNumber, 'race_number', 99);
  const canonicalTrackName = await lookupCanonicalTrackName(env, requestedTrackId);
  if (!canonicalTrackName) throw new Error('official track id is not mapped to a canonical track');
  const racesScript = await loadNewestRacesScript(env, parentId);
  if (!racesScript) throw new Error('captured X-Labs races.js is required to resolve the X-Labs track id');
  const candidates = trackIdCandidatesForExactName(racesScript, canonicalTrackName);
  if (!candidates.length) throw new Error('no X-Labs track-id candidates matched the official canonical track name');
  if (candidates.length > MAX_PROBE_CANDIDATES) throw new Error('too many X-Labs track-id candidates for a bounded race-data probe');

  const fetchImpl = options.fetchImpl || fetch;
  const matches = [];
  for (const candidate of candidates) {
    const fileName = buildXlabsRaceFileName(date, candidate, race);
    const requestedUrl = new URL(fileName, baseUrl).toString();
    const fetched = await fetchCandidateJson(requestedUrl, fetchImpl);
    if (fetched) matches.push({ candidate, fileName, requestedUrl, fetched });
    if (matches.length > 1) break;
  }
  if (!matches.length) throw new Error('no verified X-Labs race JSON existed for the bounded track candidates');
  if (matches.length > 1) throw new Error('multiple X-Labs race JSON candidates existed; refusing to guess');

  const selected = matches[0];
  const xlabsTrackId = positiveInteger(selected.candidate, 'xlabs_track_id', 999);
  const run = await startImportRun(env, 'xlabs_race_capture', {
    kind: 'race_json',
    parentSourceRecordId: parentId,
    calculateSourceRecordId: sourceId,
    date,
    requestedTrackId,
    xlabsTrackId,
    raceNumber: race,
    trackMappingStatus: 'resolved_by_bounded_json_probe',
    probeCandidateCount: candidates.length
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    const fetchedAt = new Date().toISOString();
    const archived = await archiveRawSnapshot(env, {
      sourceType: 'xlabs_race_json',
      externalId: `${date}:${xlabsTrackId}:${race}`,
      sourceUrl: selected.fetched.finalUrl,
      fetchedAt,
      body: selected.fetched.body,
      extension: 'json',
      contentType: 'application/json; charset=utf-8',
      qualityStatus: 'captured_unmapped',
      rightsStatus: 'unknown',
      metadata: {
        kind: 'race_json',
        date,
        requestedTrackId,
        xlabsTrackId,
        canonicalTrackName,
        trackMappingStatus: 'resolved_by_bounded_json_probe',
        probeCandidateCount: candidates.length,
        raceNumber: race,
        fileName: selected.fileName,
        parentSourceRecordId: parentId,
        calculateSourceRecordId: sourceId,
        requestedUrl: selected.requestedUrl,
        redirectCount: selected.fetched.redirectCount,
        normalizationStatus: 'not_implemented'
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
      trackMappingStatus: 'resolved_by_bounded_json_probe',
      probeCandidateCount: candidates.length,
      raceNumber: race,
      fileName: selected.fileName,
      requestedUrl: selected.requestedUrl,
      url: selected.fetched.finalUrl,
      redirectCount: selected.fetched.redirectCount,
      reused: archived.reused,
      qualityStatus: 'captured_unmapped',
      normalizationStatus: 'not_implemented',
      schemaSampleFieldLimit: MAX_SAMPLE_FIELDS,
      schemaSample: summarizeValue(selected.fetched.parsed),
      normalizedRowsWritten: 0
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
