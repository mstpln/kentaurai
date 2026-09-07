import test from 'node:test';
import assert from 'node:assert/strict';
import { appPasswordMatches, createAppSessionCookie, hasValidAppSession } from '../src/app-auth.js';

function requestWithCookie(cookie) {
  return new Request('https://example.test/app', { headers: { cookie } });
}

test('app password comparison fails closed when secret is absent', () => {
  assert.equal(appPasswordMatches({}, 'anything'), false);
});

test('app session cookie validates only with the same secret before expiry', async () => {
  const now = Date.UTC(2099, 0, 1);
  const env = { APP_PASSWORD: 'synthetic-test-password-with-entropy' };
  const cookie = await createAppSessionCookie(env, now);
  const pair = cookie.split(';')[0];

  assert.equal(await hasValidAppSession(requestWithCookie(pair), env, now + 1000), true);
  assert.equal(await hasValidAppSession(requestWithCookie(pair), { APP_PASSWORD: 'different-secret' }, now + 1000), false);
  assert.equal(await hasValidAppSession(requestWithCookie(pair), env, now + (31 * 24 * 60 * 60 * 1000)), false);
});
