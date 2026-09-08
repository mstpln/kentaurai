import { archiveRawSnapshot } from '../raw.js';
import { finishImportRun, startImportRun } from '../import/common.js';

const DEFAULT_BASE_URL = 'https://kmtid.atgx.se';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function providerBaseUrl(env) {
  const raw = env.XLABS_BASE_URL || DEFAULT_BASE_URL;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('X-Labs base URL must use https');
  if (url.username || url.password) throw new Error('X-Labs base URL must not contain credentials');
  if (url.hostname.toLowerCase() !== 'kmtid.atgx.se') throw new Error('X-Labs base URL must use kmtid.atgx.se');
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
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
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'text/html,application/xhtml+xml' },
      redirect: 'manual',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
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
  return body;
}

export async function captureXlabsDate(env, date, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const normalized = validateXlabsDate(date);
  const url = buildXlabsDateUrl(env, normalized);
  const run = await startImportRun(env, 'xlabs_capture', { kind: 'date_page', date: normalized, sourceUrl: url });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    if (!env.RAW_BUCKET) throw new Error('RAW_BUCKET is not configured');
    const fetchedAt = new Date().toISOString();
    const body = await fetchText(url, options.fetchImpl || fetch);
    const archived = await archiveRawSnapshot(env, {
      sourceType: 'xlabs',
      externalId: `date:${normalized}`,
      sourceUrl: url,
      fetchedAt,
      body,
      extension: 'html',
      contentType: 'text/html; charset=utf-8',
      qualityStatus: 'captured_unmapped',
      rightsStatus: 'unknown',
      metadata: { kind: 'date_page', date: normalized, normalizationStatus: 'not_implemented' }
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
      url,
      reused: archived.reused,
      normalizationStatus: 'not_implemented'
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}
