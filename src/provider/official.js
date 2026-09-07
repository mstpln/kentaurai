import { archiveRawPayload } from '../raw.js';
import { discoverProviderShape } from '../import/atg.js';

const DEFAULT_BASE_URL = 'https://www.atg.se/services/racinginfo/v1/api';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function providerBaseUrl(env) {
  const raw = env.OFFICIAL_PROVIDER_BASE_URL || DEFAULT_BASE_URL;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('official provider base URL must use https');
  if (url.username || url.password) throw new Error('official provider base URL must not contain credentials');
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

export function buildCalendarUrl(env, date) {
  return `${providerBaseUrl(env)}/calendar/day/${encodeURIComponent(validateIsoDate(date))}`;
}

export function buildGameUrl(env, gameId) {
  const id = String(gameId || '').trim();
  if (!/^(V85|V86)_\d{4}-\d{2}-\d{2}_[A-Za-z0-9_-]+_[0-9]+$/.test(id)) {
    throw new Error('game id has an unsupported format');
  }
  return `${providerBaseUrl(env)}/games/${encodeURIComponent(id)}`;
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new Error(`official provider returned HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('json')) throw new Error('official provider did not return JSON');

  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('official provider response exceeded size limit');
  }

  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new Error('official provider response exceeded size limit');
  }

  try {
    const payload = JSON.parse(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payload must be an object');
    }
    return payload;
  } catch (error) {
    throw new Error(`official provider returned invalid JSON: ${error.message}`);
  }
}

async function capture(env, { kind, identity, url, fetchImpl = fetch }) {
  const fetchedAt = new Date().toISOString();
  const payload = await fetchJson(url, fetchImpl);
  const archived = await archiveRawPayload(env, {
    sourceType: 'official_provider',
    externalId: `${kind}:${identity}`,
    sourceUrl: url,
    fetchedAt,
    payload,
    qualityStatus: 'captured_unmapped',
    rightsStatus: 'official_source',
    metadata: { kind, identity }
  });

  return {
    sourceRecordId: archived.sourceRecordId,
    rawObjectKey: archived.objectKey,
    fetchedAt,
    kind,
    identity,
    shape: discoverProviderShape(payload)
  };
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
  const normalized = String(gameId || '').trim();
  return capture(env, {
    kind: 'game',
    identity: normalized,
    url: buildGameUrl(env, normalized),
    fetchImpl: options.fetchImpl
  });
}
