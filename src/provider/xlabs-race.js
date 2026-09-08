import { archiveRawSnapshot } from '../raw.js';
import { finishImportRun, startImportRun } from '../import/common.js';
import { validateXlabsDate } from './xlabs.js';
import { resolveCapturedXlabsRequestPath } from '../routes/xlabs-path-resolution.js';

const XLABS_HOST = 'kmtid.atgx.se';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 2;
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

export function buildXlabsRaceFileName(date, trackId, raceNumber) {
  const normalized = validateXlabsDate(date);
  const track = positiveInteger(trackId, 'track_id', 999);
  const race = positiveInteger(raceNumber, 'race_number', 99);
  const month = normalized.slice(5, 7);
  const day = normalized.slice(8, 10);
  return `${month}${day}${track}1${String(race).padStart(2, '0')}.json`;
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

async function fetchJsonText(url, fetchImpl) {
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
  if (!env.RAW_BUCKET) throw new Error('RAW_BUCKET is not configured');
  const sourceId = String(calculateSourceRecordId || '').trim();
  if (!sourceId) throw new Error('source_record_id is required');

  const { parentId, date } = await loadCaptureContext(env, sourceId);
  const pathResolution = await resolveCapturedXlabsRequestPath(env, sourceId);
  if (pathResolution.status !== 'resolved_static' || !pathResolution.resolvedBaseUrl) {
    throw new Error(`X-Labs race-data path is not uniquely resolved (${pathResolution.status})`);
  }
  const baseUrl = validateResolvedBaseUrl(pathResolution.resolvedBaseUrl, date);
  const track = positiveInteger(trackId, 'track_id', 999);
  const race = positiveInteger(raceNumber, 'race_number', 99);
  const fileName = buildXlabsRaceFileName(date, track, race);
  const requestedUrl = new URL(fileName, baseUrl).toString();
  const run = await startImportRun(env, 'xlabs_race_capture', {
    kind: 'race_json', parentSourceRecordId: parentId, calculateSourceRecordId: sourceId, date, trackId: track, raceNumber: race
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    const fetchedAt = new Date().toISOString();
    const fetched = await fetchJsonText(requestedUrl, options.fetchImpl || fetch);
    const archived = await archiveRawSnapshot(env, {
      sourceType: 'xlabs_race_json',
      externalId: `${date}:${track}:${race}`,
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
        trackId: track,
        raceNumber: race,
        fileName,
        parentSourceRecordId: parentId,
        calculateSourceRecordId: sourceId,
        requestedUrl,
        redirectCount: fetched.redirectCount,
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
      trackId: track,
      raceNumber: race,
      fileName,
      requestedUrl,
      url: fetched.finalUrl,
      redirectCount: fetched.redirectCount,
      reused: archived.reused,
      qualityStatus: 'captured_unmapped',
      normalizationStatus: 'not_implemented',
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
