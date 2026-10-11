// Private recovery transport. HTTP 401 is safe to retry because the Worker
// rejects it before any recovery route is dispatched. No other error,
// transport ambiguity, or write failure is replayed automatically.
const MAX_AUTH_ATTEMPTS = 10;
const AUTH_RETRY_DELAY_MS = 2500;

export async function fetchPrivateRecoveryJson({
  url, token, method = 'GET', body = null, timeoutMs = 30000,
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
      const response = await fetchImpl(url, {
        method, redirect:'error', signal:controller.signal,
        headers: {
          authorization:'Bearer ' + token,
          ...(serialized === undefined ? {} : {'content-type':'application/json'})
        },
        body:serialized
      });
      if (response.status === 401) {
        if (attempt === MAX_AUTH_ATTEMPTS)
          throw new Error('recovery_private_api_authorization_failed');
        rejectedAuthorization = true;
      } else {
        if (!response.ok)
          throw new Error('recovery_private_api_http_' + response.status);
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
