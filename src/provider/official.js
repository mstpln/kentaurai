import { archiveRawPayload } from '../raw.js';
import { discoverProviderShape } from '../import/atg.js';
import { finishImportRun, startImportRun } from '../import/common.js';
import { sourceFetchError, sourceHttpError, sourceInvalidResponseError } from './source-error.js';

const DEFAULT_BASE_URL = 'https://www.atg.se/services/racinginfo/v1/api';
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_GAME_ID_LENGTH = 160;
const RACE_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})_(\d{1,3})_(\d{1,2})$/;

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

export function validateRaceId(value) {
  const id = String(value || '').trim();
  const match = RACE_ID_PATTERN.exec(id);
  if (!match) throw new Error('race id has an unsupported format');
  validateIsoDate(match[1]);
  const trackId = Number(match[2]);
  const raceNumber = Number(match[3]);
  if (!Number.isInteger(trackId) || trackId < 1 || trackId > 999 ||
      !Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 99) {
    throw new Error('race id has an unsupported format');
  }
  return id;
}

export function buildCalendarUrl(env, date) {
  return `${providerBaseUrl(env)}/calendar/day/${encodeURIComponent(validateIsoDate(date))}`;
}

export function buildGameUrl(env, gameId) {
  return `${providerBaseUrl(env)}/games/${encodeURIComponent(validateGameId(gameId))}`;
}

export function buildRaceUrl(env, raceId) {
  return `${providerBaseUrl(env)}/races/${encodeURIComponent(validateRaceId(raceId))}`;
}

async function readBoundedText(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw sourceInvalidResponseError('official provider response exceeded size limit');
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
      throw sourceInvalidResponseError('official provider response exceeded size limit');
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join('');
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response;
  try {
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'manual',
        signal: controller.signal
      });
    } catch (error) {
      throw sourceFetchError(error, 'official provider request', { timeoutMs: 12_000 });
    }
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw sourceHttpError('official provider', response);
  const type = response.headers.get('content-type') || '';
  if (!type.toLowerCase().includes('json')) throw sourceInvalidResponseError('official provider did not return JSON');

  const contentLength = response.headers.get('content-length');
  if (contentLength != null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw sourceInvalidResponseError('official provider response exceeded size limit');
    }
  }

  const rawText = await readBoundedText(response);

  try {
    const payload = JSON.parse(rawText);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw sourceInvalidResponseError('official provider payload must be an object');
    }
    return { payload, rawText };
  } catch (error) {
    if (error?.code === 'SOURCE_INVALID_RESPONSE') throw error;
    throw sourceInvalidResponseError(`official provider returned invalid JSON: ${error.message}`);
  }
}

async function capture(env, { kind, identity, url, fetchImpl = fetch, validatePayload = null }) {
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
    if (validatePayload) {
      try { validatePayload(payload); } catch (error) { throw sourceInvalidResponseError(error.message); }
    }
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
    fetchImpl: options.fetchImpl,
    validatePayload(payload) {
      if (payload.date !== normalized || !Array.isArray(payload.tracks)) {
        throw new Error('official calendar payload does not match the requested date');
      }
    }
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

export async function captureRace(env, raceId, options = {}) {
  const normalized = validateRaceId(raceId);
  const [date, trackId, raceNumber] = normalized.split('_');
  return capture(env, {
    kind: 'race',
    identity: normalized,
    url: buildRaceUrl(env, normalized),
    fetchImpl: options.fetchImpl,
    validatePayload(payload) {
      if (payload.id !== normalized || payload.date !== date ||
          Number(payload.track?.id) !== Number(trackId) || Number(payload.number) !== Number(raceNumber)) {
        throw new Error('official race payload does not match the requested race');
      }
      if (!Array.isArray(payload.starts)) throw new Error('official race payload starts must be an array');
    }
  });
}
