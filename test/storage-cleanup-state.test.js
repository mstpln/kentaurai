import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import { checkpointStorageCleanupState, getStorageCleanupState } from '../src/storage-cleanup-state.js';

test('cleanup resume state persists a signed cursor and cumulative progress', async () => {
  const { env } = createTestEnv();
  const cursor = 'cGF5bG9hZA.c2lnbmF0dXJl';

  await checkpointStorageCleanupState(env, {
    target: 'horse_profile',
    cursor,
    complete: false,
    pages: 251,
    rowsScanned: 6275,
    rowsRemovable: 4700,
    rowsRemoved: 4700
  });

  const state = await getStorageCleanupState(env);
  assert.equal(state.targets.length, 1);
  assert.deepEqual(
    {
      target: state.targets[0].target,
      cursor: state.targets[0].cursor,
      complete: state.targets[0].complete,
      pages: state.targets[0].pages,
      rowsScanned: state.targets[0].rowsScanned,
      rowsRemoved: state.targets[0].rowsRemoved
    },
    {
      target: 'horse_profile',
      cursor,
      complete: false,
      pages: 251,
      rowsScanned: 6275,
      rowsRemoved: 4700
    }
  );
});

test('cleanup resume state is monotonic and completed targets cannot be reopened', async () => {
  const { env } = createTestEnv();
  await checkpointStorageCleanupState(env, {
    target: 'raw_object',
    cursor: 'Zmlyc3Q.c2ln',
    complete: false,
    pages: 300,
    rowsScanned: 7500,
    referencesRewritten: 280,
    canonicalObjectsCreated: 270,
    legacyObjectsDeleted: 280
  });
  await checkpointStorageCleanupState(env, {
    target: 'raw_object',
    cursor: null,
    complete: true,
    pages: 301,
    rowsScanned: 7510,
    referencesRewritten: 281,
    canonicalObjectsCreated: 271,
    legacyObjectsDeleted: 281
  });
  await checkpointStorageCleanupState(env, {
    target: 'raw_object',
    cursor: 'c2hvdWxkLW5vdA.cmVvcGVu',
    complete: false,
    pages: 1,
    rowsScanned: 1,
    referencesRewritten: 1,
    canonicalObjectsCreated: 1,
    legacyObjectsDeleted: 1
  });

  const row = (await getStorageCleanupState(env)).targets[0];
  assert.equal(row.complete, true);
  assert.equal(row.cursor, null);
  assert.equal(row.pages, 301);
  assert.equal(row.rowsScanned, 7510);
  assert.equal(row.referencesRewritten, 281);
  assert.equal(row.canonicalObjectsCreated, 271);
  assert.equal(row.legacyObjectsDeleted, 281);
});

test('cleanup resume state rejects unknown targets and malformed cursors', async () => {
  const { env } = createTestEnv();
  await assert.rejects(
    () => checkpointStorageCleanupState(env, { target: 'unknown', cursor: null }),
    /unsupported cleanup state target/
  );
  await assert.rejects(
    () => checkpointStorageCleanupState(env, { target: 'horse_stat', cursor: 'not a signed cursor' }),
    /cursor is invalid/
  );
});
