const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

export function parseRetryAfter(value, nowMs = Date.now()) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Math.min(Number(text) * 1000, MAX_RETRY_AFTER_MS);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - nowMs), MAX_RETRY_AFTER_MS);
}

export function sourceHttpError(label, response, { notFoundCode = null } = {}) {
  const status = Number(response?.status);
  const error = new Error(`${label} returned HTTP ${status}`);
  error.httpStatus = status;
  if (status === 404 && notFoundCode) error.code = notFoundCode;
  else if (status === 429) error.code = 'SOURCE_RATE_LIMITED';
  else if (status === 403) error.code = 'SOURCE_ACCESS_DENIED';
  else if (status >= 500 && status <= 599) error.code = 'SOURCE_UPSTREAM_ERROR';
  else error.code = 'SOURCE_HTTP_ERROR';
  if (status === 429) error.retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'));
  return error;
}

export function sourceFetchError(error, label, { timeoutMs = null } = {}) {
  if (error?.name === 'AbortError') {
    const timeout = new Error(timeoutMs == null ? `${label} timed out` : `${label} timed out after ${timeoutMs}ms`);
    timeout.code = 'SOURCE_TIMEOUT';
    return timeout;
  }
  if (error?.httpStatus || (typeof error?.code === 'string' && (error.code.startsWith('SOURCE_') || error.code === 'XLABS_NOT_FOUND'))) {
    return error;
  }
  if (error instanceof TypeError) {
    const network = new Error(`${label} failed at the network boundary`);
    network.code = 'SOURCE_NETWORK_ERROR';
    return network;
  }
  return error;
}

export function sourceInvalidResponseError(message) {
  const error = new Error(message);
  error.code = 'SOURCE_INVALID_RESPONSE';
  return error;
}

export function sourceFailureRetryDelayMs(error) {
  if (Number.isFinite(error?.retryAfterMs)) return Math.max(0, error.retryAfterMs);
  if (error?.code === 'SOURCE_RATE_LIMITED') return 15 * 60_000;
  if (error?.code === 'SOURCE_ACCESS_DENIED') return 30 * 60_000;
  if (error?.code === 'SOURCE_UPSTREAM_ERROR' || error?.code === 'SOURCE_TIMEOUT' || error?.code === 'SOURCE_NETWORK_ERROR') {
    return 2 * 60_000;
  }
  if (error?.code === 'SOURCE_INVALID_RESPONSE') return 5 * 60_000;
  if (error?.code === 'SOURCE_HTTP_ERROR') return 60_000;
  return null;
}
