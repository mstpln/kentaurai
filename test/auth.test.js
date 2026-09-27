import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin, requireStorageCleanupAdmin } from '../src/auth.js';

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


test('storage cleanup accepts a fresh cleanup-only token', () => {
  const token = `${Date.now()}.${'a'.repeat(64)}`;
  const denied = requireStorageCleanupAdmin(
    new Request('https://example.invalid/v1/storage-cleanup/snapshots/plan', {
      headers: { authorization: `Bearer ${token}` }
    }),
    { STORAGE_CLEANUP_TOKEN: token }
  );
  assert.equal(denied, null);
});

test('storage cleanup rejects an expired cleanup-only token', async () => {
  const token = `${Date.now() - (2 * 60 * 60 * 1000)}.${'b'.repeat(64)}`;
  const denied = requireStorageCleanupAdmin(
    new Request('https://example.invalid/v1/storage-cleanup/snapshots/plan', {
      headers: { authorization: `Bearer ${token}` }
    }),
    { STORAGE_CLEANUP_TOKEN: token }
  );
  assert.ok(denied instanceof Response);
  assert.equal(denied.status, 401);
});

test('storage cleanup still accepts the normal admin token', () => {
  const denied = requireStorageCleanupAdmin(
    new Request('https://example.invalid/v1/storage-cleanup/snapshots/plan', {
      headers: { authorization: 'Bearer admin' }
    }),
    { ADMIN_TOKEN: 'admin' }
  );
  assert.equal(denied, null);
});
