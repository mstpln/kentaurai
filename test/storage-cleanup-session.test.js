import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  checkpointStorageCleanupSession,
  startOrResumeStorageCleanupSession
} from '../src/storage-cleanup-session.js';

const SOURCE_SHA = 'a'.repeat(40);

test('cleanup session creates resumable target state and completes only after every target', async () => {
  const { env } = createTestEnv();
  const created = await startOrResumeStorageCleanupSession(env, { source_sha: SOURCE_SHA });
  assert.match(created.sessionId, /^[0-9a-f-]{36}$/i);
  assert.equal(created.status, 'running');
  assert.equal(created.continuationCount, 1);
  assert.equal(created.targets.length, 5);

  const horseCursor = 'signed-cursor';
  const checkpoint = await checkpointStorageCleanupSession(env, {
    session_id: created.sessionId,
    source_sha: SOURCE_SHA,
    target: 'horse_profile',
    cursor: horseCursor,
    complete: false
  });
  assert.equal(checkpoint.sessionComplete, false);

  const resumed = await startOrResumeStorageCleanupSession(env, {
    session_id: created.sessionId,
    source_sha: SOURCE_SHA
  });
  assert.equal(resumed.continuationCount, 2);
  assert.equal(resumed.targets.find((target) => target.target === 'horse_profile').cursor, horseCursor);

  for (const target of ['horse_profile','horse_stat','horse_record','person_stat','raw_object']) {
    await checkpointStorageCleanupSession(env, {
      session_id: created.sessionId,
      source_sha: SOURCE_SHA,
      target,
      cursor: null,
      complete: true
    });
  }

  const complete = await startOrResumeStorageCleanupSession(env, {
    session_id: created.sessionId,
    source_sha: SOURCE_SHA
  });
  assert.equal(complete.status, 'complete');
  assert.ok(complete.targets.every((target) => target.complete));
});

test('cleanup session rejects source changes and incomplete checkpoints without cursor', async () => {
  const { env } = createTestEnv();
  const created = await startOrResumeStorageCleanupSession(env, { source_sha: SOURCE_SHA });

  await assert.rejects(
    () => startOrResumeStorageCleanupSession(env, {
      session_id: created.sessionId,
      source_sha: 'b'.repeat(40)
    }),
    /source_sha changed/
  );

  await assert.rejects(
    () => checkpointStorageCleanupSession(env, {
      session_id: created.sessionId,
      source_sha: SOURCE_SHA,
      target: 'horse_stat',
      cursor: null,
      complete: false
    }),
    /requires a bounded cursor/
  );
});
