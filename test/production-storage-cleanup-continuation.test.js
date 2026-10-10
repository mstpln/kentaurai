import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const AUDIT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SOURCE_SHA = 'a'.repeat(40);

function reply(res, body, status = 200) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

async function invokeRunner(extraEnv, responder) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let body = {};
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const url = new URL(req.url, 'http://127.0.0.1');
      calls.push({ path: url.pathname, body });
      await responder({ path: url.pathname, body, req, res, calls });
    } catch (error) {
      reply(res, { error: 'mock_route_failed' }, 500);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const script = fileURLToPath(new URL('../scripts/run-production-storage-cleanup.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      MODE: 'dry-run',
      CLEANUP_SESSION_ID: '',
      CLEANUP_AUDIT_RUN_ID: '',
      DRY_RUN_MAX_BATCHES: '25',
      CLEANUP_SOFT_DEADLINE_MS: '300000',
      WORKER_URL: 'http://127.0.0.1:' + address.port,
      ADMIN_TOKEN: 'synthetic-test-token',
      GITHUB_SHA: SOURCE_SHA,
      GITHUB_OUTPUT: '',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  server.close();
  await once(server, 'close');
  return { code, stdout, stderr, calls };
}

function completeAudit() {
  return {
    auditRunId: AUDIT_ID, status: 'complete', complete: true, ok: true,
    families: [], operations: { complete: true, ok: true },
    cost: { rowsRead: 2, rowsWritten: 0, durationMs: 1 }, safetyStop: false
  };
}

async function normalDryRunRoute({ path, body, res }) {
  if (path === '/v1/storage-cleanup/audit/start') {
    assert.equal(body.source_sha, SOURCE_SHA);
    reply(res, completeAudit());
  } else if (path === '/v1/storage-cleanup/snapshots/plan') {
    reply(res, { rowsScanned: 0, rowsRemovable: 0, nextCursor: null });
  } else if (path === '/v1/storage-cleanup/raw/plan') {
    reply(res, { rowsScanned: 0, referenceRewrites: 0, nextCursor: null });
  } else {
    reply(res, { error: 'unexpected_execution_route' }, 500);
  }
}

test('misfiled dry-run audit ID is recovered without starting an execution session', async () => {
  const result = await invokeRunner({
    CLEANUP_SESSION_ID: AUDIT_ID,
    CLEANUP_AUDIT_RUN_ID: ''
  }, async (request) => {
    if (request.path === '/v1/storage-cleanup/audit/start') {
      assert.equal(request.body.audit_run_id, AUDIT_ID);
    }
    await normalDryRunRoute(request);
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /using the Audit-ID from continuation_session as continuation_audit/);
  assert.equal(result.calls.filter((call) => call.path === '/v1/storage-cleanup/audit/start').length, 1);
  assert.equal(result.calls.filter((call) => call.path.includes('/execute') || call.path.includes('/session/')).length, 0);
});

test('an old-release audit is rejected and one NEW read-only audit is started', async () => {
  let starts = 0;
  const result = await invokeRunner({
    CLEANUP_SESSION_ID: AUDIT_ID,
    CLEANUP_AUDIT_RUN_ID: ''
  }, async (request) => {
    if (request.path === '/v1/storage-cleanup/audit/start') {
      starts++;
      assert.equal(request.body.source_sha, SOURCE_SHA);
      if (starts === 1) {
        assert.equal(request.body.audit_run_id, AUDIT_ID);
        reply(request.res, {
          error: 'request_failed',
          message: 'cleanup audit source_sha changed; start a new audit'
        }, 400);
      } else {
        assert.equal(request.body.audit_run_id, null);
        reply(request.res, completeAudit());
      }
      return;
    }
    await normalDryRunRoute(request);
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(starts, 2);
  assert.match(result.stderr, /starting a new read-only audit with independent integrity verification/);
  assert.equal(result.calls.filter((call) => call.path.includes('/execute') || call.path.includes('/session/')).length, 0);
});

test('an invalid audit ID fails explicitly and does not silently start again', async () => {
  const result = await invokeRunner({
    CLEANUP_AUDIT_RUN_ID: AUDIT_ID
  }, async ({ path, res }) => {
    if (path === '/v1/storage-cleanup/audit/start') {
      reply(res, { error: 'request_failed', message: 'cleanup audit run not found' }, 400);
    } else {
      reply(res, { error: 'unexpected' }, 500);
    }
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /audit_not_found.*check continuation_audit/);
  assert.equal(result.calls.length, 1);
});

test('ambiguous dry-run continuation fields are refused before network or mutations', async () => {
  const result = await invokeRunner({
    CLEANUP_AUDIT_RUN_ID: AUDIT_ID,
    CLEANUP_SESSION_ID: AUDIT_ID
  }, async ({ res }) => reply(res, { error: 'unexpected' }, 500));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /dry-run has two continuation IDs/);
  assert.equal(result.calls.length, 0);
});

test('unrecognized Worker errors do not leak their raw message or trigger restart', async () => {
  const result = await invokeRunner({
    CLEANUP_AUDIT_RUN_ID: AUDIT_ID
  }, async ({ res }) => reply(res, {
    error: 'request_failed', message: 'private-source-secret-do-not-log'
  }, 400));
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /HTTP 400: request_failed/);
  assert.doesNotMatch(result.stderr, /private-source-secret-do-not-log/);
  assert.equal(result.calls.length, 1);
});

test('blank dry-run continuation fields resume only the active source-bound audit selected by the Worker', async () => {
  let starts = 0;
  const result = await invokeRunner({}, async (request) => {
    if (request.path === '/v1/storage-cleanup/audit/start') {
      starts++;
      assert.equal(request.body.source_sha, SOURCE_SHA);
      if (starts === 1) {
        assert.equal(request.body.audit_run_id, null);
        reply(request.res, {
          error: 'request_failed',
          message: 'cleanup audit is already running; resume it explicitly with audit_run_id ' + AUDIT_ID
        }, 400);
      } else {
        assert.equal(request.body.audit_run_id, AUDIT_ID);
        reply(request.res, completeAudit());
      }
      return;
    }
    await normalDryRunRoute(request);
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(starts, 2);
  assert.match(result.stderr, /resuming the active source\/revision-bound audit/);
  assert.equal(result.calls.filter((call) => call.path.includes('/execute') || call.path.includes('/session/')).length, 0);
});

test('a budget-paused audit exports bounded auto-continuation evidence and never plans cleanup', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'kentaurai-audit-test-'));
  const outputFile = join(temp, 'github-output');
  let stepCalls = 0;
  let planCalls = 0;
  const state = {
    auditRunId: AUDIT_ID,
    sourceSha: SOURCE_SHA,
    continuationCount: 7,
    maxContinuations: 48,
    expiresAt: '2099-01-01T00:00:00.000Z',
    status: 'running',
    complete: false,
    ok: false,
    cumulativeSafetyStop: false,
    families: [{ family: 'horse_profile', complete: false, rowsChecked: 5000 }],
    operations: { complete: false, rowsChecked: 0, ok: false },
    cost: { rowsRead: 50, rowsWritten: 5, durationMs: 5 }
  };
  try {
    const result = await invokeRunner({ GITHUB_OUTPUT: outputFile }, async ({ path, res }) => {
      if (path === '/v1/storage-cleanup/audit/start') return reply(res, state);
      if (path === '/v1/storage-cleanup/audit/step') {
        stepCalls++;
        if (stepCalls === 1) return reply(res, { ...state, page: { target: 'horse_profile:direct', rowsChecked: 5000, complete: false, accepted: true }, cost: { rowsRead: 100, rowsWritten: 3, durationMs: 5 } });
        return reply(res, { ...state, budgetBlocked: true });
      }
      if (path.includes('/plan') || path.includes('/execute') || path.includes('/session/')) planCalls++;
      reply(res, { error: 'unexpected_mutation_or_plan' }, 500);
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(stepCalls, 2);
    assert.equal(planCalls, 0);
    const output = readFileSync(outputFile, 'utf8');
    assert.match(output, /^audit_incomplete=true$/m);
    assert.match(output, /^progress_made=true$/m);
    assert.match(output, /^cost_budget_stop=false$/m);
    assert.match(output, /^audit_safety_stop=false$/m);
    assert.match(output, /^audit_continuation_count=7$/m);
    assert.match(output, /^audit_max_continuations=48$/m);
    assert.match(output, /^audit_expires_at=2099-01-01T00:00:00.000Z$/m);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('automatically chained read-only audit MUST NOT silently restart when the source version changes', async () => {
  let requests = 0;
  const result = await invokeRunner({
    CLEANUP_TRIGGER_CONFIRMATION: 'RESUME READ ONLY AUDIT',
    CLEANUP_AUDIT_RUN_ID: AUDIT_ID,
    CLEANUP_SESSION_ID: ''
  }, async ({ path, res }) => {
    requests++;
    if (path === '/v1/storage-cleanup/audit/start') {
      return reply(res, { error: 'request_failed',
        message: 'cleanup audit source_sha changed; start a new audit' }, 400);
    }
    return reply(res, { error: 'unapproved_route' }, 500);
  });
  assert.notEqual(result.code, 0);
  assert.equal(requests, 1, 'no unattended replacement audit');
  assert.match(result.stderr, /audit_source_changed/);
});

test('automated read-only continuation requires an audit ID and never accepts execute session', async () => {
  for (const env of [
    { CLEANUP_TRIGGER_CONFIRMATION: 'RESUME READ ONLY AUDIT', CLEANUP_AUDIT_RUN_ID: '' },
    { CLEANUP_TRIGGER_CONFIRMATION: 'RESUME READ ONLY AUDIT', CLEANUP_AUDIT_RUN_ID: AUDIT_ID,
      CLEANUP_SESSION_ID: AUDIT_ID },
    { CLEANUP_TRIGGER_CONFIRMATION: 'EXECUTE REVIEWED STORAGE CLEANUP', CLEANUP_AUDIT_RUN_ID: AUDIT_ID }
  ]) {
    const result = await invokeRunner(env, async ({ res }) => reply(res, { error: 'not_authorized' }, 500));
    assert.notEqual(result.code, 0);
    assert.equal(result.calls.length, 0, 'invalid continuation should stop before any request');
  }
});

test('HTTP audit response without a settled page is not treated as forward progress', async () => {
  let steps = 0;
  const state = {
    auditRunId: AUDIT_ID, continuationCount: 2, maxContinuations: 48,
    expiresAt: '2099-01-01T00:00:00.000Z',
    status: 'running', complete: false, ok: false, families: [], operations: {}
  };
  const result = await invokeRunner({}, async ({ path, res }) => {
    if (path === '/v1/storage-cleanup/audit/start') return reply(res, state);
    if (path === '/v1/storage-cleanup/audit/step') {
      steps++;
      return reply(res, { ...state, concurrentRetry: true, cost: { rowsRead: 12, rowsWritten: 0 } });
    }
    reply(res, { error: 'unapproved' }, 500);
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(steps, 1);
  assert.match(result.stdout, /"progressMade":false/);
  assert.equal(result.calls.filter((x) => x.path.includes('/execute')).length, 0);
});
