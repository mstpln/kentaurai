import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRetryAfter,
  sourceFailureRetryDelayMs,
  sourceFetchError,
  sourceHttpError,
  sourceInvalidResponseError
} from '../src/provider/source-error.js';

test('source HTTP errors distinguish rate limits, access pushback and temporary upstream failures', () => {
  const rateLimited = sourceHttpError('synthetic source', new Response('', {
    status: 429,
    headers: { 'retry-after': '120' }
  }));
  assert.equal(rateLimited.code, 'SOURCE_RATE_LIMITED');
  assert.equal(rateLimited.httpStatus, 429);
  assert.equal(sourceFailureRetryDelayMs(rateLimited), 120_000);

  const denied = sourceHttpError('synthetic source', new Response('', { status: 403 }));
  assert.equal(denied.code, 'SOURCE_ACCESS_DENIED');
  assert.equal(sourceFailureRetryDelayMs(denied), 30 * 60_000);

  const unavailable = sourceHttpError('synthetic source', new Response('', { status: 503 }));
  assert.equal(unavailable.code, 'SOURCE_UPSTREAM_ERROR');
  assert.equal(sourceFailureRetryDelayMs(unavailable), 2 * 60_000);
});

test('Retry-After accepts bounded delta seconds and HTTP dates', () => {
  const now = Date.parse('2099-01-01T00:00:00Z');
  assert.equal(parseRetryAfter('90', now), 90_000);
  assert.equal(parseRetryAfter('Fri, 01 Jan 2099 00:03:00 GMT', now), 180_000);
  assert.equal(parseRetryAfter('not-a-delay', now), null);
});

test('source fetch errors distinguish timeouts and network failures', () => {
  const timeout = sourceFetchError(new DOMException('aborted', 'AbortError'), 'synthetic source', { timeoutMs: 25 });
  assert.equal(timeout.code, 'SOURCE_TIMEOUT');
  assert.match(timeout.message, /timed out after 25ms/);
  assert.equal(sourceFailureRetryDelayMs(timeout), 2 * 60_000);

  const network = sourceFetchError(new TypeError('fetch failed'), 'synthetic source');
  assert.equal(network.code, 'SOURCE_NETWORK_ERROR');
  assert.equal(sourceFailureRetryDelayMs(network), 2 * 60_000);
});

test('malformed source responses have a distinct conservative cooldown', () => {
  const malformed = sourceInvalidResponseError('synthetic malformed response');
  assert.equal(malformed.code, 'SOURCE_INVALID_RESPONSE');
  assert.equal(sourceFailureRetryDelayMs(malformed), 5 * 60_000);
});

test('X-Labs 404 remains an explicit neutral unavailable condition', () => {
  const missing = sourceHttpError('X-Labs', new Response('', { status: 404 }), {
    notFoundCode: 'XLABS_NOT_FOUND'
  });
  assert.equal(missing.code, 'XLABS_NOT_FOUND');
  assert.equal(sourceFailureRetryDelayMs(missing), null);
});
