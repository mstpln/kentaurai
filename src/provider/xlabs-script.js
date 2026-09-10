import { archiveRawSnapshot } from '../raw.js';
import { finishImportRun, startImportRun } from '../import/common.js';
import { inspectXlabsHtml } from '../routes/xlabs-inspection.js';
import { sourceFetchError, sourceHttpError, sourceInvalidResponseError } from './source-error.js';

const XLABS_HOST = 'kmtid.atgx.se';
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const PRIMARY_SCRIPT_NAMES = new Set(['races.js', 'calculate.js', 'main.js']);
const CONTEXT_SCRIPT_NAMES = ['language.js', 'helper.js'];
const ALL_INTERNAL_SCRIPT_NAMES = new Set([...PRIMARY_SCRIPT_NAMES, ...CONTEXT_SCRIPT_NAMES]);
export const XLABS_SCRIPT_SELECTOR_VERSION = 'inspector-sources-v5';

function validateXlabsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('X-Labs script URL must use https');
  if (url.username || url.password) throw new Error('X-Labs script URL must not contain credentials');
  if (url.hostname.toLowerCase() !== XLABS_HOST) throw new Error('X-Labs script URL must stay on kmtid.atgx.se');
  if (url.port && url.port !== '443') throw new Error('X-Labs script URL must use the standard https port');
  url.hash = '';
  return url;
}

function sanitizedUrl(value) {
  const url = validateXlabsUrl(value);
  url.search = '';
  return url.toString();
}

function safeScriptNames(sources) {
  const names = [];
  for (const source of sources) {
    try {
      const url = validateXlabsUrl(source);
      const name = url.pathname.split('/').pop();
      if (name && !names.includes(name)) names.push(name);
    } catch {}
  }
  return names;
}

function chooseScript(html, baseUrl, scriptName, options = {}) {
  const requested = String(scriptName || '').trim();
  const allowedNames = options.allowContextScripts ? ALL_INTERNAL_SCRIPT_NAMES : PRIMARY_SCRIPT_NAMES;
  if (!allowedNames.has(requested)) {
    throw new Error(options.allowContextScripts
      ? 'script_name is not an allowed X-Labs application script'
      : 'script_name must be races.js, calculate.js or main.js');
  }

  const sources = inspectXlabsHtml(html, { baseUrl }).scripts.externalSources;
  const match = sources.find((source) => {
    try {
      const url = validateXlabsUrl(source);
      return url.pathname.split('/').pop() === requested;
    } catch {
      return false;
    }
  });

  if (!match) {
    const available = safeScriptNames(sources).join(',') || 'none';
    throw new Error(`requested X-Labs script was not referenced by the captured page [selector=${XLABS_SCRIPT_SELECTOR_VERSION}; requested=${requested}; available=${available}]`);
  }
  return validateXlabsUrl(match);
}

function validateRedirect(currentUrl, location) {
  if (!location) throw new Error('X-Labs script redirect did not include a location');
  return validateXlabsUrl(new URL(location, currentUrl).toString()).toString();
}

async function fetchScript(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let currentUrl = url;
  let redirects = 0;
  try {
    while (true) {
      const response = await fetchImpl(currentUrl, {
        method: 'GET',
        headers: { accept: 'application/javascript,text/javascript,*/*;q=0.1' },
        redirect: 'manual',
        signal: controller.signal
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= MAX_REDIRECTS) throw new Error('X-Labs script exceeded redirect limit');
        currentUrl = validateRedirect(currentUrl, response.headers.get('location'));
        redirects += 1;
        continue;
      }
      if (!response.ok) throw sourceHttpError('X-Labs script', response);
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (type && !type.includes('javascript') && !type.includes('text/plain') && !type.includes('application/octet-stream')) {
        throw sourceInvalidResponseError('X-Labs script did not return JavaScript');
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_SCRIPT_BYTES) throw sourceInvalidResponseError('X-Labs script exceeded size limit');
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > MAX_SCRIPT_BYTES) throw sourceInvalidResponseError('X-Labs script exceeded size limit');
      return { body, finalUrl: currentUrl, redirectCount: redirects };
    }
  } catch (error) {
    throw sourceFetchError(error, 'X-Labs script capture', { timeoutMs: 12_000 });
  } finally {
    clearTimeout(timeout);
  }
}

export async function captureReferencedXlabsScript(env, sourceRecordId, scriptName, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  if (!env.RAW_BUCKET?.get || !env.RAW_BUCKET?.put) throw new Error('RAW_BUCKET read/write access is not configured');
  const parentId = String(sourceRecordId || '').trim();
  if (!parentId) throw new Error('source_record_id is required');

  const parent = await env.DB.prepare(`
    SELECT id, source_type, source_url, raw_object_key, external_id
    FROM source_records
    WHERE id = ? AND source_type = 'xlabs'
    LIMIT 1
  `).bind(parentId).first();
  if (!parent?.raw_object_key || !parent.source_url) throw new Error('captured X-Labs source record was not found');

  const parentObject = await env.RAW_BUCKET.get(parent.raw_object_key);
  if (!parentObject) throw new Error('captured X-Labs raw object was not found');
  const parentHtml = await parentObject.text();
  const selected = chooseScript(parentHtml, parent.source_url, scriptName, options);
  const requestedUrl = selected.toString();
  const requestedUrlForProvenance = sanitizedUrl(requestedUrl);
  const run = await startImportRun(env, 'xlabs_script_capture', {
    parentSourceRecordId: parent.id,
    scriptName,
    requestedUrl: requestedUrlForProvenance,
    selectorVersion: XLABS_SCRIPT_SELECTOR_VERSION
  });
  const counts = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    const fetchedAt = new Date().toISOString();
    const fetched = await fetchScript(requestedUrl, options.fetchImpl || fetch);
    const finalUrlForProvenance = sanitizedUrl(fetched.finalUrl);
    const archived = await archiveRawSnapshot(env, {
      sourceType: 'xlabs_script',
      externalId: `${parent.id}:${scriptName}`,
      sourceUrl: finalUrlForProvenance,
      fetchedAt,
      body: fetched.body,
      extension: 'js',
      contentType: 'application/javascript; charset=utf-8',
      qualityStatus: 'captured_unmapped',
      rightsStatus: 'unknown',
      metadata: {
        kind: 'referenced_script',
        parentSourceRecordId: parent.id,
        parentExternalId: parent.external_id,
        scriptName,
        requestedUrl: requestedUrlForProvenance,
        redirectCount: fetched.redirectCount,
        selectorVersion: XLABS_SCRIPT_SELECTOR_VERSION,
        normalizationStatus: 'not_implemented'
      }
    });
    if (archived.reused) counts.skipped = 1;
    else counts.inserted = 1;
    await finishImportRun(env, run.id, counts);
    return {
      importRunId: run.id,
      sourceRecordId: archived.sourceRecordId,
      parentSourceRecordId: parent.id,
      scriptName,
      selectorVersion: XLABS_SCRIPT_SELECTOR_VERSION,
      fetchedAt,
      url: finalUrlForProvenance,
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

export async function captureXlabsContextScripts(env, scriptSourceRecordId, options = {}) {
  if (!env.DB) throw new Error('DB is not configured');
  const id = String(scriptSourceRecordId || '').trim();
  if (!id) throw new Error('source_record_id is required');
  const source = await env.DB.prepare(`
    SELECT metadata_json
    FROM source_records
    WHERE id = ? AND source_type = 'xlabs_script'
    LIMIT 1
  `).bind(id).first();
  if (!source) throw new Error('captured X-Labs script source record was not found');

  let metadata = {};
  try { metadata = JSON.parse(source.metadata_json || '{}'); } catch {}
  const parentId = typeof metadata.parentSourceRecordId === 'string' ? metadata.parentSourceRecordId : '';
  if (!parentId) throw new Error('captured X-Labs script is missing parent provenance');

  const captures = [];
  for (const scriptName of CONTEXT_SCRIPT_NAMES) {
    captures.push(await captureReferencedXlabsScript(env, parentId, scriptName, {
      ...options,
      allowContextScripts: true
    }));
  }
  return captures;
}
