import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// This script may enqueue ONLY one further source-bound, read-only audit
// workflow. It must never dispatch execute mode or approve data mutation.
const REPOSITORY = 'mstpln/kentaurai';
export const READ_ONLY_MARKER = 'RESUME READ ONLY AUDIT';
export const WORKFLOW = 'production-storage-cleanup.yml';
// A successor may spend up to 45 minutes in its production job. Do not queue
// one unless the persisted proof can survive that entire bounded lifecycle.
const MIN_TIME_REMAINING_MS = 50 * 60 * 1000;
const RUN_DISCOVERY_ATTEMPTS = 12;
const RUN_DISCOVERY_DELAY_MS = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function positiveInteger(value, label) {
  const text = String(value ?? '');
  if (!/^[0-9]+$/.test(text)) throw new Error(label + ' must be a nonnegative integer');
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Error(label + ' is out of range');
  return number;
}

export function buildReadOnlyAuditContinuation(env, nowMs = Date.now()) {
  if (env.GITHUB_REPOSITORY !== REPOSITORY
    || env.GITHUB_REF !== 'refs/heads/main'
    || !/^[0-9a-f]{40}$/.test(String(env.GITHUB_SHA || ''))) {
    throw new Error('Read-only audit continuation must come from exact KentaurAI main');
  }
  if (env.MODE !== 'dry-run' || (env.CONFIRMATION || '') === 'EXECUTE REVIEWED STORAGE CLEANUP'
    || !['', READ_ONLY_MARKER].includes(env.CONFIRMATION || '')) {
    throw new Error('Only explicitly non-destructive dry-run audit continuation is allowed');
  }
  if (env.AUDIT_INCOMPLETE !== 'true' || env.PROGRESS_MADE !== 'true') {
    throw new Error('No verified incomplete-and-progressing audit to continue');
  }
  if (env.COST_BUDGET_STOP !== 'false' || env.AUDIT_SAFETY_STOP !== 'false') {
    throw new Error('Read-only audit auto-continuation is blocked by a cost/safety stop');
  }
  if (env.CLEANUP_SESSION_ID) {
    throw new Error('Read-only audit must never carry an execute session');
  }
  if (!UUID.test(String(env.AUDIT_RUN_ID || ''))) {
    throw new Error('A valid source-bound audit ID is required');
  }
  const requestId = String(env.GITHUB_RUN_ID || '');
  if (!/^[1-9][0-9]*$/.test(requestId)) {
    throw new Error('A valid parent GitHub run ID is required');
  }
  const count = positiveInteger(env.AUDIT_CONTINUATION_COUNT, 'Audit continuation count');
  const max = positiveInteger(env.AUDIT_MAX_CONTINUATIONS, 'Audit continuation limit');
  if (max < 1 || max > 48 || count < 1 || count >= max) {
    throw new Error('Audit continuation cap reached or invalid; no further job will be queued');
  }
  const expiresAt = Date.parse(String(env.AUDIT_EXPIRES_AT || ''));
  if (!Number.isFinite(expiresAt) || expiresAt - nowMs < MIN_TIME_REMAINING_MS) {
    throw new Error('Audit expires too soon for a safe continuation; no new job will be queued');
  }
  const batches = String(env.DRY_RUN_MAX_BATCHES || '');
  if (!['25', '50', '100', '250'].includes(batches)) {
    throw new Error('Invalid bounded dry-run batch count');
  }

  return {
    ref: 'main',
    inputs: {
      mode: 'dry-run',
      confirmation: READ_ONLY_MARKER,
      dry_run_max_batches: batches,
      continuation_audit: env.AUDIT_RUN_ID,
      continuation_session: '',
      continuation_request: requestId
    }
  };
}

function requestHeaders(token, { json = false } = {}) {
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(json ? { 'Content-Type': 'application/json' } : {})
  };
}

async function parseJsonResponse(response) {
  try {
    if (typeof response.json === 'function') return await response.json();
    return JSON.parse(await response.text());
  } catch {
    throw new Error('GitHub workflow-run lookup returned an invalid response');
  }
}

export function continuationRunName(requestId) {
  return 'Production storage cleanup (dry-run) — continuation from ' + requestId;
}

async function findContinuationRun(env, fetchFn) {
  const url = 'https://api.github.com/repos/' + REPOSITORY + '/actions/workflows/' + WORKFLOW
    + '/runs?branch=main&event=workflow_dispatch&per_page=100';
  const response = await fetchFn(url, { headers: requestHeaders(env.GH_TOKEN) });
  if (response.status !== 200) {
    throw new Error('GitHub workflow-run lookup failed (HTTP ' + response.status + ')');
  }
  const data = await parseJsonResponse(response);
  const expectedName = continuationRunName(String(env.GITHUB_RUN_ID));
  return (Array.isArray(data?.workflow_runs) ? data.workflow_runs : []).find((run) =>
    run?.name === expectedName
      && run?.event === 'workflow_dispatch'
      && run?.head_sha === env.GITHUB_SHA
  ) || null;
}

function acceptedRunState(run) {
  // The parent cleanup job releases the shared production-operation lock
  // before this handoff. A successor may still be queued behind a release;
  // waiting for in_progress inside the lock would deadlock the chain.
  if (run?.status === 'queued' || run?.status === 'pending' || run?.status === 'in_progress') {
    return true;
  }
  return run?.status === 'completed' && run?.conclusion === 'success';
}

function terminalRunFailure(run) {
  return run?.status === 'completed' && run?.conclusion !== 'success';
}

export async function queueReadOnlyAudit(env, {
  fetchFn = fetch,
  nowMs = Date.now(),
  sleepFn = (delay) => new Promise((resolveSleep) => setTimeout(resolveSleep, delay)),
  discoveryAttempts = RUN_DISCOVERY_ATTEMPTS
} = {}) {
  const payload = buildReadOnlyAuditContinuation(env, nowMs);
  if (!env.GH_TOKEN) throw new Error('GitHub Actions write token missing');
  const existing = await findContinuationRun(env, fetchFn);
  if (terminalRunFailure(existing)) {
    throw new Error('The correlated successor already finished unsuccessfully; no duplicate was dispatched');
  }
  if (acceptedRunState(existing)) {
    return { queued: true, runId: existing.id, alreadyExisted: true };
  }

  if (!existing) {
    let response;
    try {
      response = await fetchFn(
        'https://api.github.com/repos/' + REPOSITORY + '/actions/workflows/' + WORKFLOW + '/dispatches',
        {
          method: 'POST',
          headers: requestHeaders(env.GH_TOKEN, { json: true }),
          body: JSON.stringify(payload)
        }
      );
    } catch {
      throw new Error('Read-only audit dispatch outcome is unknown; inspect Actions before retrying this job');
    }
    if (response.status !== 204) {
      throw new Error('Read-only audit continuation dispatch failed (HTTP ' + response.status + ')');
    }
  }

  for (let attempt = 1; attempt <= discoveryAttempts; attempt += 1) {
    if (attempt > 1) await sleepFn(RUN_DISCOVERY_DELAY_MS);
    const run = await findContinuationRun(env, fetchFn);
    if (terminalRunFailure(run)) {
      throw new Error('The correlated successor finished unsuccessfully; no duplicate was dispatched');
    }
    if (acceptedRunState(run)) {
      return { queued: true, runId: run.id, alreadyExisted: Boolean(existing) };
    }
  }
  throw new Error((existing ? 'The correlated successor' : 'GitHub accepted the dispatch but the successor run')
    + ' was not observed running; inspect Actions before retrying this job');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await queueReadOnlyAudit(process.env);
    console.log('Observed the bounded READ-ONLY audit successor run ' + result.runId
      + '. It may be queued behind the shared production lock; NO cleanup was authorized.');
  } catch (error) {
    // Do not log raw GitHub API response bodies, tokens or database identifiers.
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}
