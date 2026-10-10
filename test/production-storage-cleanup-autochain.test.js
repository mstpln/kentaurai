import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READ_ONLY_MARKER,
  buildReadOnlyAuditContinuation,
  queueReadOnlyAudit
} from '../scripts/queue-production-storage-audit.mjs';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const ID = 'aaaaeeee-1111-4222-8333-999988887777';

function permittedEnv() {
  return {
    GITHUB_REPOSITORY: 'mstpln/kentaurai',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: 'a'.repeat(40),
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
    AUDIT_EXPIRES_AT: new Date(NOW + 10 * 60 * 1000).toISOString(),
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
      continuation_session: ''
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
  let callCount = 0;
  const fetchFn = async (url, options) => {
    callCount++;
    assert.equal(url, 'https://api.github.com/repos/mstpln/kentaurai/actions/workflows/production-storage-cleanup.yml/dispatches');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-github-token');
    assert.equal(options.headers['X-GitHub-Api-Version'], '2022-11-28');
    assert.equal(JSON.parse(options.body).inputs.mode, 'dry-run');
    assert.equal(JSON.parse(options.body).inputs.confirmation, READ_ONLY_MARKER);
    assert.equal(JSON.parse(options.body).inputs.continuation_session, '');
    return { status: 204 };
  };
  const result = await queueReadOnlyAudit(env, { fetchFn, nowMs: NOW });
  assert.deepEqual(result, { queued: true });
  assert.equal(callCount, 1);
});

test('failed dispatch does not silently claim success or expose provider details', async () => {
  const env = permittedEnv();
  await assert.rejects(
    () => queueReadOnlyAudit(env, {
      nowMs: NOW,
      fetchFn: async () => ({ status: 403, text: async () => 'private-auth-error-body' })
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
