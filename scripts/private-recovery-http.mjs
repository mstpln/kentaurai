// Private recovery transport. HTTP 401 is safe to retry because the Worker
// rejects it before any recovery route is dispatched. No other error,
// transport ambiguity, or write failure is replayed automatically.
const MAX_AUTH_ATTEMPTS = 10;
const AUTH_RETRY_DELAY_MS = 2500;

const MULTIPART_START_STAGES = new Set([
  'read_private_state','check_d1_size','reserve_private_r2',
  'request_d1_export','store_private_bookmark'
]);
const MULTIPART_START_REASONS = new Set([
  'cloudflare_http_400','cloudflare_http_401','cloudflare_http_403',
  'cloudflare_http_404','cloudflare_http_409','cloudflare_http_423',
  'cloudflare_http_429','cloudflare_http_500','cloudflare_http_502',
  'cloudflare_http_503','cloudflare_http_504','cloudflare_response_unverified',
  'cloudflare_json_invalid','export_response_unverified',
  'source_size_out_of_bounds','private_bindings_unavailable',
  'internal_operation_failed','credentials_unavailable','transport_unavailable',
  'cloudflare_http_other'
]);

// Opt-in only for the multipart /start endpoint. Discard all untrusted
// response text; the only permitted output is two already-allowlisted enums.
async function readSafeMultipartStartError(response) {
  try {
    const declared=response.headers.get('content-length');
    if(declared!=null&&(!/^\d+$/.test(declared)||Number(declared)>512))
      return null;
    const payload=await response.text();
    if(payload.length>512)return null;
    const data=JSON.parse(payload);
    if(data?.error==='legacy_multipart_backup_unavailable'&&
       MULTIPART_START_STAGES.has(data.stage)&&
       MULTIPART_START_REASONS.has(data.reason))
      return {stage:data.stage,reason:data.reason};
  } catch {
    // Invalid/ambiguous HTTP responses remain a generic 409, never printed.
  }
  return null;
}

export async function fetchPrivateRecoveryJson({
  url, token, method = 'GET', body = null, timeoutMs = 30000,
  allowSafeMultipartStartError = false,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}) {
  if (typeof url !== 'string' || !url.startsWith('https://') ||
      typeof token !== 'string' || !token) {
    throw new Error('recovery_private_api_transport_not_configured');
  }
  // Reuse identical request content only if an upstream authorization
  // rejection guarantees that the Worker did not execute the route.
  const serialized = body == null ? undefined : JSON.stringify(body);
  for (let attempt = 1; attempt <= MAX_AUTH_ATTEMPTS; attempt++) {
    let rejectedAuthorization = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(url, {
          method, redirect:'error', signal:controller.signal,
          headers: {
            authorization:'Bearer ' + token,
            ...(serialized === undefined ? {} : {'content-type':'application/json'})
          },
          body:serialized
        });
      } catch {
        // Ambiguous transport failure: no replay, no raw URL/error logging.
        throw new Error('recovery_private_api_transport_unavailable');
      }
      if (response.status === 401) {
        if (attempt === MAX_AUTH_ATTEMPTS)
          throw new Error('recovery_private_api_authorization_failed');
        rejectedAuthorization = true;
      } else {
        if (!response.ok) {
          if (allowSafeMultipartStartError===true && method==='POST' &&
              url.endsWith('/v1/storage-cleanup/legacy-backup-multipart/start') &&
              response.status===409) {
            const safe=await readSafeMultipartStartError(response);
            if (safe) throw new Error('recovery_private_api_http_409_stage_' +
              safe.stage + '_reason_' + safe.reason);
          }
          throw new Error('recovery_private_api_http_' + response.status);
        }
        try {
          return await response.json();
        } catch {
          throw new Error('recovery_private_api_invalid_json');
        }
      }
    } finally {
      clearTimeout(timeout);
    }
    if (rejectedAuthorization) await sleep(AUTH_RETRY_DELAY_MS);
  }
  throw new Error('recovery_private_api_authorization_failed');
}
