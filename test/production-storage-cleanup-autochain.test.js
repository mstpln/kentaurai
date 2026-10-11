import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READ_ONLY_MARKER,
  buildReadOnlyAuditContinuation,
  continuationRunName,
  queueReadOnlyAudit
} from '../scripts/queue-production-storage-audit.mjs';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const ID = 'aaaaeeee-1111-4222-8333-999988887777';

function permittedEnv() {
  return {
    GITHUB_REPOSITORY: 'mstpln/kentaurai',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: 'a'.repeat(40),
    GITHUB_RUN_ID: '38070000123',
    GH_TOKEN: 'synthetic-github-token',
    MODE: 'dry-run',
    CONFIRMATION: '',
    AUDIT_INCOMPLETE: 'true',
    PROGRESS_MADE: 'true',
    COST_BUDGET_STOP: 'false',
    AUDIT_SAFETY_STOP: 'false',
    CLEANUP_SESSION_ID: '',
    AUDIT_RUN_ID: ID,
    AUDIT_CONTINUATION_COUNT: '3',
    AUDIT_MAX_CONTINUATIONS: '48',
    AUDIT_EXPIRES_AT: new Date(NOW + 60 * 60 * 1000).toISOString(),
    DRY_RUN_MAX_BATCHES: '50'
  };
}

test('automatic continuation always dispatches the SAME read-only audit, never execute', () => {
  const payload = buildReadOnlyAuditContinuation(permittedEnv(), NOW);
  assert.deepEqual(payload, {
    ref: 'main',
    inputs: {
      mode: 'dry-run',
      confirmation: READ_ONLY_MARKER,
      dry_run_max_batches: '50',
      continuation_audit: ID,
      continuation_session: '',
      continuation_request: '38070000123'
    }
  });
  assert.doesNotMatch(JSON.stringify(payload), /EXECUTE REVIEWED STORAGE CLEANUP/);
});

test('a valid previous automated read-only confirmation may continue but never escalate', () => {
  const env = permittedEnv();
  env.CONFIRMATION = READ_ONLY_MARKER;
  assert.equal(buildReadOnlyAuditContinuation(env, NOW).inputs.mode, 'dry-run');
});

test('fail closed for exhausted, stale, costly, stalled and ambiguous continuations', () => {
  const violations = [
    ['execute mode', { MODE: 'execute' }, /non-destructive/],
    ['execute confirmation', { CONFIRMATION: 'EXECUTE REVIEWED STORAGE CLEANUP' }, /non-destructive/],
    ['foreign marker', { CONFIRMATION: 'unknown' }, /non-destructive/],
    ['foreign repo', { GITHUB_REPOSITORY: 'another/repo' }, /KentaurAI main/],
    ['foreign branch', { GITHUB_REF: 'refs/heads/unsafe' }, /KentaurAI main/],
    ['invalid source SHA', { GITHUB_SHA: 'not-a-hash' }, /KentaurAI main/],
    ['missing parent run', { GITHUB_RUN_ID: '' }, /parent GitHub run ID/],
    ['complete audit', { AUDIT_INCOMPLETE: 'false' }, /progressing/],
    ['no progress', { PROGRESS_MADE: 'false' }, /progressing/],
    ['run cost exceeded', { COST_BUDGET_STOP: 'true' }, /cost\/safety stop/],
    ['audit safety stop', { AUDIT_SAFETY_STOP: 'true' }, /cost\/safety stop/],
    ['execute session supplied', { CLEANUP_SESSION_ID: ID }, /execute session/],
    ['missing audit ID', { AUDIT_RUN_ID: '' }, /valid source-bound audit ID/],
    ['bad audit ID', { AUDIT_RUN_ID: 'invalid' }, /valid source-bound audit ID/],
    ['missing continuation count', { AUDIT_CONTINUATION_COUNT: '' }, /nonnegative integer/],
    ['limit already reached', { AUDIT_CONTINUATION_COUNT: '48' }, /continuation cap/],
    ['invalid maximum', { AUDIT_MAX_CONTINUATIONS: '300' }, /continuation cap/],
    ['invalid maximum format', { AUDIT_MAX_CONTINUATIONS: 'NaN' }, /nonnegative integer/],
    ['expired audit', { AUDIT_EXPIRES_AT: new Date(NOW - 1000).toISOString() }, /expires too soon/],
    ['nearly expired audit', { AUDIT_EXPIRES_AT: new Date(NOW + 20 * 1000).toISOString() }, /expires too soon/],
    ['invalid expiry', { AUDIT_EXPIRES_AT: 'never' }, /expires too soon/],
    ['invalid batch size', { DRY_RUN_MAX_BATCHES: '1000' }, /bounded/]
  ];
  for (const [name, change, pattern] of violations) {
    assert.throws(() => buildReadOnlyAuditContinuation({ ...permittedEnv(), ...change }, NOW),
      pattern, name);
  }
});

test('GitHub dispatch makes one authenticated workflow_dispatch and never logs a token or response', async () => {
  const env = permittedEnv();
  let postCount = 0;
  let lookupCount = 0;
  const fetchFn = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-github-token');
    if (url.endsWith('/dispatches')) {
      postCount++;
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
      assert.equal(JSON.parse(options.body).inputs.mode, 'dry-run');
      assert.equal(JSON.parse(options.body).inputs.confirmation, READ_ONLY_MARKER);
      assert.equal(JSON.parse(options.body).inputs.continuation_session, '');
      assert.equal(JSON.parse(options.body).inputs.continuation_request, env.GITHUB_RUN_ID);
      return { status: 204 };
    }
    lookupCount++;
    return { status: 200, json: async () => ({ workflow_runs: lookupCount > 1 ? [{
      id: 7001,
      name: continuationRunName(env.GITHUB_RUN_ID),
      event: 'workflow_dispatch',
      head_sha: env.GITHUB_SHA,
      status: 'in_progress'
    }] : [] }) };
  };
  const result = await queueReadOnlyAudit(env, {
    fetchFn, nowMs: NOW, sleepFn: async () => {}, discoveryAttempts: 2
  });
  assert.deepEqual(result, { queued: true, runId: 7001, alreadyExisted: false });
  assert.equal(postCount, 1);
  assert.equal(lookupCount, 2);
});

test('failed dispatch does not silently claim success or expose provider details', async () => {
  const env = permittedEnv();
  await assert.rejects(
    () => queueReadOnlyAudit(env, {
      nowMs: NOW,
      fetchFn: async (url) => url.includes('/runs?')
        ? { status: 200, json: async () => ({ workflow_runs: [] }) }
        : { status: 403, text: async () => 'private-auth-error-body' }
    }),
    (error) => /HTTP 403/.test(error.message) && !error.message.includes('private-auth-error-body')
  );
  const invalid = { ...env, AUDIT_SAFETY_STOP: 'true' };
  let networkCalled = false;
  await assert.rejects(
    () => queueReadOnlyAudit(invalid, {
      nowMs: NOW, fetchFn: async () => { networkCalled = true; return { status: 204 }; }
    }),
    /cost\/safety stop/
  );
  assert.equal(networkCalled, false);
  await assert.rejects(
    () => queueReadOnlyAudit({ ...env, GH_TOKEN: '' }, { nowMs: NOW }),
    /write token missing/
  );
});

test('an observed successor makes a job retry idempotent without a duplicate dispatch', async () => {
  const env = permittedEnv();
  let postCount = 0;
  let lookupCount = 0;
  const result = await queueReadOnlyAudit(env, {
    nowMs: NOW,
    sleepFn: async () => {},
    discoveryAttempts: 2,
    fetchFn: async (url) => {
      if (url.endsWith('/dispatches')) {
        postCount++;
        return { status: 204 };
      }
      lookupCount++;
      return { status: 200, json: async () => ({ workflow_runs: [{
        id: 7002,
        name: continuationRunName(env.GITHUB_RUN_ID),
        event: 'workflow_dispatch',
        head_sha: env.GITHUB_SHA,
        status: lookupCount === 1 ? 'queued' : 'in_progress'
      }] }) };
    }
  });
  assert.deepEqual(result, { queued: true, runId: 7002, alreadyExisted: true });
  assert.equal(postCount, 0);
});

test('ambiguous dispatch never retries POST and reports an unknown outcome', async () => {
  const env = permittedEnv();
  let postCount = 0;
  await assert.rejects(() => queueReadOnlyAudit(env, {
    nowMs: NOW,
    fetchFn: async (url) => {
      if (url.includes('/runs?')) return { status: 200, json: async () => ({ workflow_runs: [] }) };
      postCount++;
      throw new Error('socket closed after request upload');
    }
  }), /outcome is unknown/);
  assert.equal(postCount, 1);
});

test('a 204 without an observable successor is a clear failure, not false success', async () => {
  const env = permittedEnv();
  let postCount = 0;
  await assert.rejects(() => queueReadOnlyAudit(env, {
    nowMs: NOW,
    discoveryAttempts: 3,
    sleepFn: async () => {},
    fetchFn: async (url) => {
      if (url.includes('/runs?')) return { status: 200, json: async () => ({ workflow_runs: [] }) };
      postCount++;
      return { status: 204 };
    }
  }), /successor run was not observed/);
  assert.equal(postCount, 1);
});

test('workflow-run lookup permission and rate-limit failures stop before dispatch', async () => {
  for (const status of [403, 429, 500]) {
    let postCount = 0;
    await assert.rejects(() => queueReadOnlyAudit(permittedEnv(), {
      nowMs: NOW,
      fetchFn: async (url) => {
        if (url.endsWith('/dispatches')) postCount++;
        return { status };
      }
    }), new RegExp('HTTP ' + status));
    assert.equal(postCount, 0);
  }
});

test('a queued successor is not trusted until it starts after the production lock is released', async () => {
  let lookupCount = 0;
  let posted = 0;
  const result = await queueReadOnlyAudit(permittedEnv(), {
    nowMs: NOW,
    sleepFn: async () => {},
    discoveryAttempts: 3,
    fetchFn: async (url) => {
      if (url.endsWith('/dispatches')) {
        posted++;
        return { status: 204 };
      }
      lookupCount++;
      return { status: 200, json: async () => ({
        workflow_runs: lookupCount === 1 ? [] : [{
          id: 90001,
          event: 'workflow_dispatch',
          name: continuationRunName(permittedEnv().GITHUB_RUN_ID),
          head_sha: permittedEnv().GITHUB_SHA,
          status: lookupCount < 3 ? 'queued' : 'in_progress',
          conclusion: null
        }]
      }) };
    }
  });
  assert.equal(posted, 1);
  assert.deepEqual(result, { queued: true, runId: 90001, alreadyExisted: false });
});

test('a cancelled, superseded or failed correlated successor is never called successful', async () => {
  for (const conclusion of ['cancelled', 'failure', 'skipped']) {
    let dispatched = 0;
    await assert.rejects(() => queueReadOnlyAudit(permittedEnv(), {
      nowMs: NOW,
      fetchFn: async (url) => {
        if (url.endsWith('/dispatches')) dispatched++;
        return { status: 200, json: async () => ({
          workflow_runs: [{
            id: 90002, name: continuationRunName(permittedEnv().GITHUB_RUN_ID),
            event: 'workflow_dispatch', head_sha: permittedEnv().GITHUB_SHA,
            status: 'completed', conclusion
          }]
        }) };
      }
    }), /successor already finished unsuccessfully/);
    assert.equal(dispatched, 0);
  }
});

test('a successor that remains pending cannot silently report success', async () => {
  let posted = 0;
  await assert.rejects(() => queueReadOnlyAudit(permittedEnv(), {
    nowMs: NOW,
    sleepFn: async () => {},
    discoveryAttempts: 3,
    fetchFn: async (url) => {
      if (url.endsWith('/dispatches')) {
        posted++;
        return { status: 204 };
      }
      return { status: 200, json: async () => ({
        workflow_runs: [{
          id: 90003,
          event: 'workflow_dispatch',
          name: continuationRunName(permittedEnv().GITHUB_RUN_ID),
          head_sha: permittedEnv().GITHUB_SHA,
          status: 'pending',
          conclusion: null
        }]
      }) };
    }
  }), /not observed running/);
  assert.equal(posted, 0, 'no duplicate dispatch for existing pending successor');
});
