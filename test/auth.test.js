import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin } from '../src/auth.js';

test('private API fails closed when admin secret is not configured', async () => {
  const denied = requireAdmin(new Request('https://example.invalid/v1/test'), {});
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: 'service_unavailable' });
});

test('private API rejects an invalid bearer token', async () => {
  const denied = requireAdmin(
    new Request('https://example.invalid/v1/test', {
      headers: { authorization: 'Bearer wrong' }
    }),
    { ADMIN_TOKEN: 'correct' }
  );
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: 'unauthorized' });
});

test('private API accepts the configured bearer token', () => {
  const denied = requireAdmin(
    new Request('https://example.invalid/v1/test', {
      headers: { authorization: 'Bearer correct' }
    }),
    { ADMIN_TOKEN: 'correct' }
  );
  assert.equal(denied, null);
});
