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

test('execute runner continues beyond 250 batches and checkpoints completion', async () => {
  const states = new Map();
  let snapshotPlans = 0;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/v1/storage-cleanup/state') {
        json(res, { targets: [...states.values()] });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/storage-cleanup/state') {
        const body = await readBody(req);
        states.set(body.target, { ...body });
        json(res, { ok: true, target: body.target, complete: body.complete });
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
  assert.ok(snapshotPlans > 250, `expected >250 snapshot plans, saw ${snapshotPlans}`);
  assert.equal(states.get('horse_profile')?.complete, true);
  assert.equal(states.get('horse_profile')?.pages, 260);
  assert.equal(states.get('horse_stat')?.complete, true);
  assert.equal(states.get('horse_record')?.complete, true);
  assert.equal(states.get('person_stat')?.complete, true);
  assert.equal(states.get('raw_object')?.complete, true);
  assert.match(stdout, /"cleanup":"run".*"complete":true/);
});
