import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

function json(res, value, status = 200) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

test('execute runner continues beyond 250 batches and checkpoints one source-bound session', async () => {
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const sourceSha = 'a'.repeat(40);
  const targets = new Map(
    ['horse_profile','horse_stat','horse_record','person_stat','raw_object']
      .map((target) => [target, { target, cursor: null, complete: false }])
  );
  let snapshotPlans = 0;
  let startCalls = 0;
  let auditCalls = 0;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/v1/storage-cleanup/audit') {
        auditCalls += 1;
        json(res, {
          ok: true,
          families: ['horse_profile','horse_stat','horse_record','person_stat'].map((family) => ({
            family,
            mismatchedSources: 0,
            missingRepresentations: 0,
            excessRepresentations: 0,
            danglingObservations: 0,
            identityMismatchObservations: 0,
            ok: true
          })),
          safetyStop: false
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/storage-cleanup/session/start') {
        const body = await readBody(req);
        startCalls += 1;
        assert.equal(body.source_sha, sourceSha);
        json(res, {
          sessionId,
          sourceSha,
          status: 'running',
          continuationCount: startCalls,
          maxContinuations: 48,
          expiresAt: '2099-01-01T00:00:00.000Z',
          targets: [...targets.values()],
          safetyStop: false
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/storage-cleanup/session/checkpoint') {
        const body = await readBody(req);
        assert.equal(body.session_id, sessionId);
        assert.equal(body.source_sha, sourceSha);
        targets.set(body.target, {
          target: body.target,
          cursor: body.complete ? null : body.cursor,
          complete: body.complete === true
        });
        json(res, { sessionId, target: body.target, complete: body.complete, sessionComplete: false, safetyStop: false });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/storage-cleanup/snapshots/plan') {
        const body = await readBody(req);
        snapshotPlans += 1;
        if (body.family !== 'horse_profile') {
          json(res, {
            rowsScanned: 0,
            rowsRemovable: 0,
            warnings: [],
            planToken: 'a'.repeat(64),
            nextCursor: null,
            safetyStop: false
          });
          return;
        }
        const page = body.cursor ? Number(String(body.cursor).split('.')[0].slice(1)) : 0;
        const nextPage = page + 1;
        json(res, {
          rowsScanned: 1,
          rowsRemovable: 0,
          warnings: [],
          planToken: 'a'.repeat(64),
          nextCursor: nextPage < 260 ? `p${nextPage}.sig` : null,
          safetyStop: false
        });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/storage-cleanup/raw/plan') {
        json(res, {
          rowsScanned: 0,
          referenceRewrites: 0,
          conflictsSkipped: 0,
          warnings: [],
          planToken: 'b'.repeat(64),
          nextCursor: null,
          safetyStop: false
        });
        return;
      }
      json(res, { error: 'unexpected_test_route' }, 404);
    } catch (error) {
      json(res, { error: error.message }, 500);
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const script = fileURLToPath(new URL('../scripts/run-production-storage-cleanup.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      MODE: 'execute',
      DRY_RUN_MAX_BATCHES: '25',
      CLEANUP_SOFT_DEADLINE_MS: String(5 * 60 * 1000),
      WORKER_URL: `http://127.0.0.1:${address.port}`,
      ADMIN_TOKEN: 'synthetic-cleanup-token',
      GITHUB_SHA: sourceSha,
      CLEANUP_SESSION_ID: '',
      GITHUB_OUTPUT: ''
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

  assert.equal(code, 0, stderr);
  assert.equal(auditCalls, 1);
  assert.equal(startCalls, 1);
  assert.ok(snapshotPlans > 250, `expected >250 snapshot plans, saw ${snapshotPlans}`);
  assert.ok([...targets.values()].every((target) => target.complete));
  assert.match(stdout, /"cleanup":"session".*"complete":true/);
});


test('runner refuses every new cleanup when provenance integrity preflight fails', async () => {
  let planCalls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/v1/storage-cleanup/audit') {
      json(res, {
        ok: false,
        families: [{
          family: 'horse_profile',
          mismatchedSources: 1,
          missingRepresentations: 1,
          excessRepresentations: 0,
          danglingObservations: 0,
          identityMismatchObservations: 0,
          ok: false
        }],
        safetyStop: false
      });
      return;
    }
    if (url.pathname.includes('/plan') || url.pathname.includes('/execute') || url.pathname.includes('/session/start')) {
      planCalls += 1;
    }
    json(res, { error: 'unexpected_test_route' }, 500);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const script = fileURLToPath(new URL('../scripts/run-production-storage-cleanup.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      MODE: 'dry-run',
      DRY_RUN_MAX_BATCHES: '25',
      CLEANUP_SOFT_DEADLINE_MS: String(5 * 60 * 1000),
      WORKER_URL: `http://127.0.0.1:${address.port}`,
      ADMIN_TOKEN: 'synthetic-cleanup-token',
      GITHUB_OUTPUT: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  server.close();
  await once(server, 'close');

  assert.notEqual(code, 0);
  assert.equal(planCalls, 0);
  assert.match(stderr, /storage cleanup integrity audit failed; refusing cleanup/);
});
