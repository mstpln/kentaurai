import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  checkpointStorageCleanupSession,
  startOrResumeStorageCleanupSession
} from '../src/storage-cleanup-session.js';

const SOURCE_SHA = 'a'.repeat(40);

test('cleanup session resumes one active operation and a completed operation can be started fresh later', async () => {
  const { env } = createTestEnv();
  const created = await startOrResumeStorageCleanupSession(env, { source_sha: SOURCE_SHA });
  assert.match(created.sessionId, /^[0-9a-f-]{36}$/i);
  assert.equal(created.status, 'running');
  assert.equal(created.continuationCount, 1);
  assert.equal(created.maxContinuations, 48);
  assert.equal(created.targets.length, 5);

  const cursor = 'cGF5bG9hZA.c2lnbmF0dXJl';
  await checkpointStorageCleanupSession(env, {
    session_id: created.sessionId,
    source_sha: SOURCE_SHA,
    target: 'horse_profile',
    cursor,
    complete: false
  });

  const resumedWithoutExplicitId = await startOrResumeStorageCleanupSession(env, { source_sha: SOURCE_SHA });
  assert.equal(resumedWithoutExplicitId.sessionId, created.sessionId);
  assert.equal(resumedWithoutExplicitId.continuationCount, 2);
  assert.equal(
    resumedWithoutExplicitId.targets.find((target) => target.target === 'horse_profile').cursor,
    cursor
  );

  for (const target of ['horse_profile','horse_stat','horse_record','person_stat','raw_object']) {
    await checkpointStorageCleanupSession(env, {
      session_id: created.sessionId,
      source_sha: SOURCE_SHA,
      target,
      cursor: null,
      complete: true
    });
  }

  const completed = await startOrResumeStorageCleanupSession(env, {
    session_id: created.sessionId,
    source_sha: SOURCE_SHA
  });
  assert.equal(completed.status, 'complete');
  assert.ok(completed.targets.every((target) => target.complete));

  const nextOperation = await startOrResumeStorageCleanupSession(env, { source_sha: SOURCE_SHA });
  assert.notEqual(nextOperation.sessionId, created.sessionId);
  assert.equal(nextOperation.status, 'running');
  assert.equal(nextOperation.continuationCount, 1);
  assert.ok(nextOperation.targets.every((target) => !target.complete && target.cursor === null));
});

test('cleanup session is source-bound and incomplete checkpoints require a signed cursor shape', async () => {
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
    /valid signed cursor/
  );

  await assert.rejects(
    () => checkpointStorageCleanupSession(env, {
      session_id: created.sessionId,
      source_sha: SOURCE_SHA,
      target: 'horse_stat',
      cursor: 'not-a-signed-cursor',
      complete: false
    }),
    /valid signed cursor/
  );
});

test('cleanup sessions expire, stop at the hard continuation limit and allow a fresh manual operation', async () => {
  const { db, env } = createTestEnv();
  const capped = await startOrResumeStorageCleanupSession(env, { source_sha: SOURCE_SHA });
  db.prepare('UPDATE storage_cleanup_sessions SET continuation_count=48 WHERE id=?')
    .run(capped.sessionId);

  await assert.rejects(
    () => startOrResumeStorageCleanupSession(env, {
      session_id: capped.sessionId,
      source_sha: SOURCE_SHA
    }),
    /continuation limit reached/
  );
  assert.equal(
    db.prepare('SELECT status FROM storage_cleanup_sessions WHERE id=?').get(capped.sessionId).status,
    'exhausted'
  );

  const freshAfterCap = await startOrResumeStorageCleanupSession(env, { source_sha: SOURCE_SHA });
  assert.notEqual(freshAfterCap.sessionId, capped.sessionId);
  assert.equal(freshAfterCap.continuationCount, 1);

  const expiredSource = 'c'.repeat(40);
  const expired = await startOrResumeStorageCleanupSession(env, { source_sha: expiredSource });
  db.prepare("UPDATE storage_cleanup_sessions SET expires_at='2000-01-01T00:00:00Z' WHERE id=?")
    .run(expired.sessionId);

  await assert.rejects(
    () => startOrResumeStorageCleanupSession(env, {
      session_id: expired.sessionId,
      source_sha: expiredSource
    }),
    /session expired/
  );
  assert.equal(
    db.prepare('SELECT status FROM storage_cleanup_sessions WHERE id=?').get(expired.sessionId).status,
    'expired'
  );
});

test('completed targets are monotonic within a cleanup session', async () => {
  const { env } = createTestEnv();
  const created = await startOrResumeStorageCleanupSession(env, { source_sha: SOURCE_SHA });

  await checkpointStorageCleanupSession(env, {
    session_id: created.sessionId,
    source_sha: SOURCE_SHA,
    target: 'horse_record',
    cursor: null,
    complete: true
  });

  await checkpointStorageCleanupSession(env, {
    session_id: created.sessionId,
    source_sha: SOURCE_SHA,
    target: 'horse_record',
    cursor: 'cGF5bG9hZA.c2ln',
    complete: false
  });

  const resumed = await startOrResumeStorageCleanupSession(env, {
    session_id: created.sessionId,
    source_sha: SOURCE_SHA
  });
  const target = resumed.targets.find((item) => item.target === 'horse_record');
  assert.equal(target.complete, true);
  assert.equal(target.cursor, null);
});
