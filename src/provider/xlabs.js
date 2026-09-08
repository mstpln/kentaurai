import { archiveRawSnapshot } from '../raw.js';
import { finishImportRun, startImportRun } from '../import/common.js';

const DEFAULT_BASE_URL = 'https://kmtid.atgx.se';
const XLABS_HOST = 'kmtid.atgx.se';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function providerBaseUrl(env) {
  const raw = env.XLABS_BASE_URL || DEFAULT_BASE_URL;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('X-Labs base URL must use https');
  if (url.username || url.password) throw new Error('X-Labs base URL must not contain credentials');
  if (url.hostname.toLowerCase() !== XLABS_HOST) throw new Error('X-Labs base URL must use kmtid.atgx.se');
  if (url.port && url.port !== '443') throw new Error('X-Labs base URL must use the standard https port');
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function validateRedirectUrl(currentUrl, location) {
  if (!location) throw new Error('X-Labs redirect did not include a location');
  const target = new URL(location, currentUrl);
  if (target.protocol !== 'https:') throw new Error('X-Labs redirect must use https');
  if (target.username || target.password) throw new Error('X-Labs redirect must not contain credentials');
  if (target.hostname.toLowerCase() !== XLABS_HOST) throw new Error('X-Labs redirect must stay on kmtid.atgx.se');
  if (target.port && target.port !== '443') throw new Error('X-Labs redirect must use the standard https port');
  target.hash = '';
  return target.toString();
}

export function validateXlabsDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('date must use YYYY-MM-DD');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new Error('date is not a valid calendar date');
  return text;
}

export function buildXlabsDateUrl(env, date) {
  const normalized = validateXlabsDate(date);
  const compact = normalized.slice(2).replaceAll('-', '');
  return `${providerBaseUrl(env)}/${compact}`;
}

async function fetchText(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let currentUrl = url;
  let redirects = 0;

  try {
    while (true) {
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        headers: { accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: controller.signal
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= MAX_REDIRECTS) throw new Error('X-Labs exceeded redirect limit');
        currentUrl = validateRedirectUrl(currentUrl, response.headers.get('location'));
        redirects += 1;
        continue;
      }

      if (!response.ok) throw new Error(`X-Labs returned HTTP ${response.status}`);
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml')) {
        throw new Error('X-Labs did not return HTML');
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('X-Labs response exceeded size limit');
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) throw new Error('X-Labs response exceeded size limit');
      return { body, finalUrl: currentUrl, redirectCount: redirects };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function captureXlabsDate(env, date, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const normalized = validateXlabsDate(date);
  const requestedUrl = buildXlabsDateUrl(env, normalized);
  const run = await startImportRun(env, 'xlabs_capture', { kind: 'date_page', date: normalized, sourceUrl: requestedUrl });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    if (!env.RAW_BUCKET) throw new Error('RAW_BUCKET is not configured');
    const fetchedAt = new Date().toISOString();
    const fetched = await fetchText(requestedUrl, options.fetchImpl || fetch);
    const archived = await archiveRawSnapshot(env, {
      sourceType: 'xlabs',
      externalId: `date:${normalized}`,
      sourceUrl: fetched.finalUrl,
      fetchedAt,
      body: fetched.body,
      extension: 'html',
      contentType: 'text/html; charset=utf-8',
      qualityStatus: 'captured_unmapped',
      rightsStatus: 'unknown',
      metadata: {
        kind: 'date_page',
        date: normalized,
        normalizationStatus: 'not_implemented',
        requestedUrl,
        redirectCount: fetched.redirectCount
      }
    });
    if (archived.reused) counts.skipped = 1;
    else counts.inserted = 1;
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId: archived.sourceRecordId,
      rawObjectKey: archived.objectKey,
      fetchedAt,
      date: normalized,
      requestedUrl,
      url: fetched.finalUrl,
      redirectCount: fetched.redirectCount,
      reused: archived.reused,
      normalizationStatus: 'not_implemented'
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
