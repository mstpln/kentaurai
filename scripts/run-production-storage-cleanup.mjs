const MODE = process.env.MODE;
const MAX_BATCHES = Number(process.env.MAX_BATCHES || 50);
const WORKER_URL = process.env.WORKER_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CONFIRMATION = 'execute-reviewed-storage-cleanup-batch';
const FAMILIES = ['horse_profile', 'horse_stat', 'horse_record', 'person_stat'];

if (!['dry-run', 'execute'].includes(MODE)) throw new Error('MODE must be dry-run or execute');
if (!Number.isInteger(MAX_BATCHES) || MAX_BATCHES < 1 || MAX_BATCHES > 250) throw new Error('MAX_BATCHES must be between 1 and 250');
if (!WORKER_URL || !ADMIN_TOKEN) throw new Error('WORKER_URL and ADMIN_TOKEN are required');

async function post(path, body) {
  const response = await fetch(WORKER_URL + path, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`${path} returned non-JSON HTTP ${response.status}`); }
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}: ${String(data?.error || 'unknown_error').slice(0, 160)}`);
  if (data?.safetyStop === true) throw new Error(`${path} tripped the D1 cost-safety stop`);
  return data;
}

function safeWarnings(value) {
  return Array.isArray(value) ? value.map(String).slice(0, 20) : [];
}

async function runSnapshotFamily(family) {
  let cursor = null;
  let pages = 0;
  let scanned = 0;
  let removable = 0;
  let removed = 0;
  const warnings = new Set();

  while (pages < MAX_BATCHES) {
    const plan = await post('/v1/storage-cleanup/snapshots/plan', { family, limit: 25, cursor });
    pages += 1;
    scanned += Number(plan.rowsScanned || 0);
    removable += Number(plan.rowsRemovable || 0);
    for (const warning of safeWarnings(plan.warnings)) warnings.add(warning);

    if (MODE === 'execute' && Number(plan.rowsRemovable || 0) > 0) {
      const result = await post('/v1/storage-cleanup/snapshots/execute', {
        family,
        limit: 25,
        cursor,
        planToken: plan.planToken,
        confirmation: CONFIRMATION
      });
      if (Number(result.rowsRemoved || 0) !== Number(plan.rowsRemovable || 0)) {
        throw new Error(`snapshot ${family} execution count differed from its dry-run plan`);
      }
      removed += Number(result.rowsRemoved || 0);
      cursor = result.nextCursor || null;
    } else {
      cursor = plan.nextCursor || null;
    }
    if (!cursor) break;
  }

  console.log(JSON.stringify({
    cleanup: 'snapshot',
    family,
    mode: MODE,
    pages,
    rowsScanned: scanned,
    rowsRemovable: removable,
    rowsRemoved: removed,
    completeWithinRun: cursor === null,
    warnings: [...warnings]
  }));
}

async function runRawCleanup() {
  let cursor = null;
  let batches = 0;
  let scanned = 0;
  let rewritesPlanned = 0;
  let rewritesDone = 0;
  let canonicalCreated = 0;
  let legacyDeleted = 0;
  let conflicts = 0;
  const warnings = new Set();

  while (batches < MAX_BATCHES) {
    const plan = await post('/v1/storage-cleanup/raw/plan', { limit: 25, cursor });
    batches += 1;
    scanned += Number(plan.rowsScanned || 0);
    rewritesPlanned += Number(plan.referenceRewrites || 0);
    conflicts += Number(plan.conflictsSkipped || 0);
    for (const warning of safeWarnings(plan.warnings)) warnings.add(warning);

    if (MODE === 'dry-run') {
      if (Number(plan.referenceRewrites || 0) > 0) break;
      cursor = plan.nextCursor || null;
      if (!cursor) break;
      continue;
    }

    if (Number(plan.conflictsSkipped || 0) > 0) {
      throw new Error('raw cleanup dry-run reported a conflict; refusing mutation');
    }

    if (Number(plan.referenceRewrites || 0) > 0) {
      const result = await post('/v1/storage-cleanup/raw/execute', {
        limit: 25,
        cursor,
        planToken: plan.planToken,
        confirmation: CONFIRMATION
      });
      if (Number(result.referencesRewritten || 0) !== Number(plan.referenceRewrites || 0)) {
        throw new Error('raw cleanup execution count differed from its dry-run plan');
      }
      rewritesDone += Number(result.referencesRewritten || 0);
      canonicalCreated += Number(result.canonicalObjectsCreated || 0);
      legacyDeleted += Number(result.legacyObjectsDeleted || 0);
      cursor = result.nextCursor || null;
    } else {
      cursor = plan.nextCursor || null;
    }
    if (!cursor && Number(plan.referenceRewrites || 0) === 0) break;
  }

  console.log(JSON.stringify({
    cleanup: 'raw_object',
    mode: MODE,
    batches,
    rowsScanned: scanned,
    referenceRewritesPlanned: rewritesPlanned,
    referencesRewritten: rewritesDone,
    canonicalObjectsCreated: canonicalCreated,
    legacyObjectsDeleted: legacyDeleted,
    conflictsSkipped: conflicts,
    completeWithinRun: cursor === null && rewritesPlanned === rewritesDone,
    warnings: [...warnings]
  }));
}

for (const family of FAMILIES) await runSnapshotFamily(family);
await runRawCleanup();
