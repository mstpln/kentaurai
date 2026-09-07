import { archiveRawPayload } from '../raw.js';
import { discoverProviderShape } from '../import/atg.js';
import { finishImportRun, startImportRun } from '../import/common.js';

const DEFAULT_BASE_URL = 'https://www.atg.se/services/racinginfo/v1/api';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_GAME_ID_LENGTH = 160;

function assertOfficialHostname(url) {
  const host = url.hostname.toLowerCase();
  if (host !== 'atg.se' && !host.endsWith('.atg.se')) {
    throw new Error('official provider base URL must use an atg.se host');
  }
}

function providerBaseUrl(env) {
  const raw = env.OFFICIAL_PROVIDER_BASE_URL || DEFAULT_BASE_URL;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('official provider base URL must use https');
  if (url.username || url.password) throw new Error('official provider base URL must not contain credentials');
  assertOfficialHostname(url);
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export function validateIsoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('date must use YYYY-MM-DD');
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error('date is not a valid calendar date');
  }
  return text;
}

export function validateGameId(value) {
  const id = String(value || '').trim();
  if (id.length === 0 || id.length > MAX_GAME_ID_LENGTH) {
    throw new Error('game id has an unsupported format');
  }
  if (!/^(V85|V86)_[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('game id has an unsupported format');
  }
  return id;
}

export function buildCalendarUrl(env, date) {
  return `${providerBaseUrl(env)}/calendar/day/${encodeURIComponent(validateIsoDate(date))}`;
}

export function buildGameUrl(env, gameId) {
  return `${providerBaseUrl(env)}/games/${encodeURIComponent(validateGameId(gameId))}`;
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`official provider returned HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('json')) throw new Error('official provider did not return JSON');

  const contentLength = response.headers.get('content-length');
  if (contentLength != null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error('official provider response exceeded size limit');
    }
  }

  const rawText = await response.text();
  if (new TextEncoder().encode(rawText).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('official provider response exceeded size limit');
  }

  try {
    const payload = JSON.parse(rawText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payload must be an object');
    }
    return { payload, rawText };
  } catch (error) {
    throw new Error(`official provider returned invalid JSON: ${error.message}`);
  }
}

async function capture(env, { kind, identity, url, fetchImpl = fetch }) {
  if (!env.DB) throw new Error('DB is not configured');

  const run = await startImportRun(env, 'official_provider_capture', {
    kind,
    identity,
    sourceUrl: url
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    if (!env.RAW_BUCKET) throw new Error('RAW_BUCKET is not configured');

    const fetchedAt = new Date().toISOString();
    const { payload, rawText } = await fetchJson(url, fetchImpl);
    const archived = await archiveRawPayload(env, {
      sourceType: 'official_provider',
      externalId: `${kind}:${identity}`,
      sourceUrl: url,
      fetchedAt,
      payload: rawText,
      qualityStatus: 'captured_unmapped',
      rightsStatus: 'unknown',
      metadata: { kind, identity }
    });

    if (archived.reused) counts.skipped = 1;
    else counts.inserted = 1;
    await finishImportRun(env, run.id, counts);

    return {
      importRunId: run.id,
      sourceRecordId: archived.sourceRecordId,
      rawObjectKey: archived.objectKey,
      fetchedAt,
      kind,
      identity,
      shape: discoverProviderShape(payload),
      reused: archived.reused
    };
  } catch (error) {
    counts.errors = 1;
    await finishImportRun(env, run.id, counts, error);
    throw error;
  }
}

export async function captureCalendar(env, date, options = {}) {
  const normalized = validateIsoDate(date);
  return capture(env, {
    kind: 'calendar',
    identity: normalized,
    url: buildCalendarUrl(env, normalized),
    fetchImpl: options.fetchImpl
  });
}

export async function captureGame(env, gameId, options = {}) {
  const normalized = validateGameId(gameId);
  return capture(env, {
    kind: 'game',
    identity: normalized,
    url: buildGameUrl(env, normalized),
    fetchImpl: options.fetchImpl
  });
}
