import { pathToFileURL } from 'node:url';

export const NON_PROMOTING_DEPLOY_COMMAND = 'npx wrangler versions upload';
export const DEFAULT_WORKER_NAME = 'kentaurai-api';
export const DEFAULT_REPO_NAME = 'kentaurai';
export const DEFAULT_PRODUCTION_BRANCH = 'main';

function requireValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function sanitizeApiMessage(value) {
  return String(value || 'unknown_error')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .slice(0, 180);
}

async function cloudflareRequest(fetchImpl, url, token, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(options.body == null ? {} : { 'content-type': 'application/json' }),
      ...(options.headers || {})
    }
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.success === false) {
    const firstError = Array.isArray(payload?.errors) ? payload.errors[0] : null;
    const code = firstError?.code ?? 'unknown';
    const message = sanitizeApiMessage(firstError?.message || `HTTP ${response.status}`);
    throw new Error(`Cloudflare Builds API request failed (HTTP ${response.status}; code=${code}; message=${message})`);
  }
  return payload?.result;
}

export function selectWorkerScript(scripts, workerName = DEFAULT_WORKER_NAME) {
  const candidates = (Array.isArray(scripts) ? scripts : [])
    .filter((script) => script?.id === workerName && typeof script?.tag === 'string' && script.tag.trim());
  if (candidates.length !== 1) {
    throw new Error(`expected exactly one Cloudflare Worker script named ${workerName}; found ${candidates.length}`);
  }
  return candidates[0];
}

function includesBranch(patterns, branch) {
  return Array.isArray(patterns) && patterns.some((value) => value === branch);
}

function includesWildcard(patterns) {
  return Array.isArray(patterns) && patterns.some((value) => value === '*');
}

function excludesBranch(patterns, branch) {
  return Array.isArray(patterns) && patterns.some((value) => value === branch || value === '*');
}

function triggerMatchesRepository(trigger, repoName) {
  const connection = trigger?.repo_connection;
  return connection?.provider_type === 'github' && connection?.repo_name === repoName;
}

export function selectProductionTrigger(
  triggers,
  {
    repoName = DEFAULT_REPO_NAME,
    productionBranch = DEFAULT_PRODUCTION_BRANCH
  } = {}
) {
  const active = (Array.isArray(triggers) ? triggers : [])
    .filter((trigger) => !trigger?.deleted_on)
    .filter((trigger) => triggerMatchesRepository(trigger, repoName))
    .filter((trigger) => !excludesBranch(trigger?.branch_excludes, productionBranch));

  const exact = active.filter((trigger) => includesBranch(trigger?.branch_includes, productionBranch));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`multiple Cloudflare production build triggers target ${productionBranch}; refusing to choose one`);
  }

  const wildcard = active.filter((trigger) => includesWildcard(trigger?.branch_includes));
  if (wildcard.length === 1) return wildcard[0];
  throw new Error(`expected exactly one Cloudflare production build trigger for ${repoName}/${productionBranch}; found ${wildcard.length}`);
}

export function isNonPromotingTrigger(trigger) {
  return String(trigger?.deploy_command || '').trim() === NON_PROMOTING_DEPLOY_COMMAND;
}

export async function enforceCloudflareBuildsPolicy({
  fetchImpl = globalThis.fetch,
  token,
  accountId,
  workerName = DEFAULT_WORKER_NAME,
  repoName = DEFAULT_REPO_NAME,
  productionBranch = DEFAULT_PRODUCTION_BRANCH,
  mode = 'check'
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');
  const apiToken = requireValue(token, 'Cloudflare Builds API token');
  const account = requireValue(accountId, 'Cloudflare account id');
  if (!['check', 'apply'].includes(mode)) throw new Error('mode must be check or apply');

  const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}`;
  const scripts = await cloudflareRequest(
    fetchImpl,
    `${base}/workers/scripts`,
    apiToken
  );
  const worker = selectWorkerScript(scripts, workerName);

  const triggerUrl = `${base}/builds/workers/${encodeURIComponent(worker.tag)}/triggers`;
  const triggers = await cloudflareRequest(fetchImpl, triggerUrl, apiToken);
  const productionTrigger = selectProductionTrigger(triggers, { repoName, productionBranch });

  if (isNonPromotingTrigger(productionTrigger)) {
    return {
      policy: 'single_release_promotion_path_v1',
      compliant: true,
      updated: false,
      workerName,
      productionBranch,
      deployCommand: NON_PROMOTING_DEPLOY_COMMAND
    };
  }

  if (mode === 'check') {
    throw new Error('Cloudflare production Git trigger can promote directly; expected non-promoting versions upload command');
  }

  const triggerUuid = requireValue(productionTrigger.trigger_uuid, 'Cloudflare production trigger uuid');
  await cloudflareRequest(
    fetchImpl,
    `${base}/builds/triggers/${encodeURIComponent(triggerUuid)}`,
    apiToken,
    {
      method: 'PATCH',
      body: JSON.stringify({ deploy_command: NON_PROMOTING_DEPLOY_COMMAND })
    }
  );

  const verifiedTriggers = await cloudflareRequest(fetchImpl, triggerUrl, apiToken);
  const verifiedTrigger = selectProductionTrigger(verifiedTriggers, { repoName, productionBranch });
  if (!isNonPromotingTrigger(verifiedTrigger)) {
    throw new Error('Cloudflare production Git trigger did not retain the non-promoting deploy command');
  }

  return {
    policy: 'single_release_promotion_path_v1',
    compliant: true,
    updated: true,
    workerName,
    productionBranch,
    deployCommand: NON_PROMOTING_DEPLOY_COMMAND
  };
}

async function main() {
  const arg = process.argv[2] || '--check';
  const mode = arg === '--apply' ? 'apply' : arg === '--check' ? 'check' : null;
  if (!mode) throw new Error('usage: node scripts/cloudflare-builds-policy.mjs [--check|--apply]');

  const result = await enforceCloudflareBuildsPolicy({
    token: process.env.CLOUDFLARE_BUILDS_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN,
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    workerName: process.env.CLOUDFLARE_WORKER_NAME || DEFAULT_WORKER_NAME,
    repoName: process.env.CLOUDFLARE_REPO_NAME || DEFAULT_REPO_NAME,
    productionBranch: process.env.CLOUDFLARE_PRODUCTION_BRANCH || DEFAULT_PRODUCTION_BRANCH,
    mode
  });

  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
