import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// This script may enqueue ONLY one further source-bound, read-only audit
// workflow. It must never dispatch execute mode or approve data mutation.
const REPOSITORY = 'mstpln/kentaurai';
export const READ_ONLY_MARKER = 'RESUME READ ONLY AUDIT';
export const WORKFLOW = 'production-storage-cleanup.yml';
const MIN_TIME_REMAINING_MS = 3 * 60 * 1000;
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
      continuation_session: ''
    }
  };
}

export async function queueReadOnlyAudit(env, { fetchFn = fetch, nowMs = Date.now() } = {}) {
  const payload = buildReadOnlyAuditContinuation(env, nowMs);
  if (!env.GH_TOKEN) throw new Error('GitHub Actions write token missing');
  const response = await fetchFn(
    'https://api.github.com/repos/' + REPOSITORY + '/actions/workflows/' + WORKFLOW + '/dispatches',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.GH_TOKEN,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  if (response.status !== 204) {
    throw new Error('Read-only audit continuation dispatch failed (HTTP ' + response.status + ')');
  }
  return { queued: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await queueReadOnlyAudit(process.env);
    console.log('Queued one further bounded READ-ONLY audit continuation; NO cleanup was authorized.');
  } catch (error) {
    // Do not log raw GitHub API response bodies, tokens or database identifiers.
    console.error('::error::' + error.message);
    process.exitCode = 1;
  }
}
