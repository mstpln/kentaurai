import { appendFileSync } from 'node:fs';

const MODE = process.env.MODE;
const DRY_RUN_MAX_BATCHES = Number(process.env.DRY_RUN_MAX_BATCHES || 50);
const SOFT_DEADLINE_MS = Number(process.env.CLEANUP_SOFT_DEADLINE_MS || 38 * 60 * 1000);
const DEADLINE_RESERVE_MS = 2 * 60 * 1000;
const WORKER_URL = process.env.WORKER_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CONFIRMATION = 'execute-reviewed-storage-cleanup-batch';
const FAMILIES = ['horse_profile', 'horse_stat', 'horse_record', 'person_stat'];
const startedAt = Date.now();
const deadlineAt = startedAt + SOFT_DEADLINE_MS;

if (!['dry-run', 'execute'].includes(MODE)) throw new Error('MODE must be dry-run or execute');
if (!Number.isInteger(DRY_RUN_MAX_BATCHES) || DRY_RUN_MAX_BATCHES < 1 || DRY_RUN_MAX_BATCHES > 250) {
  throw new Error('DRY_RUN_MAX_BATCHES must be between 1 and 250');
}
if (!Number.isFinite(SOFT_DEADLINE_MS) || SOFT_DEADLINE_MS < 5 * 60 * 1000 || SOFT_DEADLINE_MS > 40 * 60 * 1000) {
  throw new Error('CLEANUP_SOFT_DEADLINE_MS must be between 5 and 40 minutes');
}
if (!WORKER_URL || !ADMIN_TOKEN) throw new Error('WORKER_URL and ADMIN_TOKEN are required');

function deadlineReached() {
  return MODE === 'execute' && Date.now() + DEADLINE_RESERVE_MS >= deadlineAt;
}

async function request(path, { method = 'GET', body = null } = {}) {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const response = await fetch(WORKER_URL + path, {
      method,
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        ...(body == null ? {} : { 'content-type': 'application/json' })
      },
      ...(body == null ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`${path} returned non-JSON HTTP ${response.status}`); }
    if (response.status === 401 && attempt < 15) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}: ${String(data?.error || 'unknown_error').slice(0, 160)}`);
    if (data?.safetyStop === true) throw new Error(`${path} tripped the D1 cost-safety stop`);
    return data;
  }
  throw new Error(`${path} authentication did not stabilize within 30 seconds`);
}

const post = (path, body) => request(path, { method: 'POST', body });

function safeWarnings(value) {
  return Array.isArray(value) ? value.map(String).slice(0, 20) : [];
}

function emptyState(target) {
  return {
    target,
    cursor: null,
    complete: false,
    pages: 0,
    rowsScanned: 0,
    rowsRemovable: 0,
    rowsRemoved: 0,
    referencesRewritten: 0,
    canonicalObjectsCreated: 0,
    legacyObjectsDeleted: 0
  };
}

async function loadResumeState() {
  if (MODE !== 'execute') return new Map();
  const data = await request('/v1/storage-cleanup/state');
  return new Map((data.targets || []).map((row) => [row.target, row]));
}

async function checkpoint(state) {
  if (MODE !== 'execute') return;
  await post('/v1/storage-cleanup/state', {
    target: state.target,
    cursor: state.cursor,
    complete: state.complete,
    pages: state.pages,
    rowsScanned: state.rowsScanned,
    rowsRemovable: state.rowsRemovable,
    rowsRemoved: state.rowsRemoved,
    referencesRewritten: state.referencesRewritten,
    canonicalObjectsCreated: state.canonicalObjectsCreated,
    legacyObjectsDeleted: state.legacyObjectsDeleted
  });
}

function logSnapshot(state, runPages, warnings, stoppedForDeadline = false) {
  console.log(JSON.stringify({
    cleanup: 'snapshot',
    family: state.target,
    mode: MODE,
    pagesThisRun: runPages,
    pagesTotal: state.pages,
    rowsScannedTotal: state.rowsScanned,
    rowsRemovableTotal: state.rowsRemovable,
    rowsRemovedTotal: state.rowsRemoved,
    complete: state.complete,
    stoppedForDeadline,
    warnings: [...warnings]
  }));
}

async function runSnapshotFamily(family, resumeState) {
  const state = { ...emptyState(family), ...(resumeState.get(family) || {}) };
  if (state.complete) {
    logSnapshot(state, 0, new Set());
    return { complete: true, progressMade: false };
  }

  const warnings = new Set();
  let runPages = 0;

  while (MODE === 'execute' || runPages < DRY_RUN_MAX_BATCHES) {
    if (deadlineReached()) {
      logSnapshot(state, runPages, warnings, true);
      return { complete: false, progressMade: runPages > 0 };
    }

    const cursor = state.cursor || null;
    const plan = await post('/v1/storage-cleanup/snapshots/plan', { family, limit: 25, cursor });
    runPages += 1;
    state.pages += 1;
    state.rowsScanned += Number(plan.rowsScanned || 0);
    state.rowsRemovable += Number(plan.rowsRemovable || 0);
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
      state.rowsRemoved += Number(result.rowsRemoved || 0);
      state.cursor = result.nextCursor || null;
    } else {
      state.cursor = plan.nextCursor || null;
    }

    state.complete = state.cursor === null;
    await checkpoint(state);
    if (state.complete) break;
  }

  logSnapshot(state, runPages, warnings);
  return { complete: state.complete, progressMade: runPages > 0 };
}

function logRaw(state, runBatches, rewritesPlanned, conflicts, warnings, stoppedForDeadline = false) {
  console.log(JSON.stringify({
    cleanup: 'raw_object',
    mode: MODE,
    batchesThisRun: runBatches,
    batchesTotal: state.pages,
    rowsScannedTotal: state.rowsScanned,
    referenceRewritesPlannedThisRun: rewritesPlanned,
    referencesRewrittenTotal: state.referencesRewritten,
    canonicalObjectsCreatedTotal: state.canonicalObjectsCreated,
    legacyObjectsDeletedTotal: state.legacyObjectsDeleted,
    conflictsSkipped: conflicts,
    complete: state.complete,
    stoppedForDeadline,
    warnings: [...warnings]
  }));
}

async function runRawCleanup(resumeState) {
  const state = { ...emptyState('raw_object'), ...(resumeState.get('raw_object') || {}) };
  if (state.complete) {
    logRaw(state, 0, 0, 0, new Set());
    return { complete: true, progressMade: false };
  }

  let runBatches = 0;
  let rewritesPlanned = 0;
  let conflicts = 0;
  const warnings = new Set();

  while (MODE === 'execute' || runBatches < DRY_RUN_MAX_BATCHES) {
    if (deadlineReached()) {
      logRaw(state, runBatches, rewritesPlanned, conflicts, warnings, true);
      return { complete: false, progressMade: runBatches > 0 };
    }

    const cursor = state.cursor || null;
    const plan = await post('/v1/storage-cleanup/raw/plan', { limit: 25, cursor });
    runBatches += 1;
    state.pages += 1;
    state.rowsScanned += Number(plan.rowsScanned || 0);
    rewritesPlanned += Number(plan.referenceRewrites || 0);
    conflicts += Number(plan.conflictsSkipped || 0);
    for (const warning of safeWarnings(plan.warnings)) warnings.add(warning);

    if (MODE === 'dry-run') {
      if (Number(plan.referenceRewrites || 0) > 0) break;
      state.cursor = plan.nextCursor || null;
      state.complete = state.cursor === null;
      if (state.complete) break;
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
      state.referencesRewritten += Number(result.referencesRewritten || 0);
      state.canonicalObjectsCreated += Number(result.canonicalObjectsCreated || 0);
      state.legacyObjectsDeleted += Number(result.legacyObjectsDeleted || 0);
      state.cursor = result.nextCursor || null;
      state.complete = false;
    } else {
      state.cursor = plan.nextCursor || null;
      state.complete = state.cursor === null;
    }

    await checkpoint(state);
    if (state.complete) break;
  }

  logRaw(state, runBatches, rewritesPlanned, conflicts, warnings);
  return { complete: state.complete, progressMade: runBatches > 0 };
}

const resumeState = await loadResumeState();
let allComplete = true;
let progressMade = false;

for (const family of FAMILIES) {
  const result = await runSnapshotFamily(family, resumeState);
  allComplete &&= result.complete;
  progressMade ||= result.progressMade;
  if (!result.complete && deadlineReached()) break;
}

if (allComplete || !deadlineReached()) {
  const result = await runRawCleanup(resumeState);
  allComplete &&= result.complete;
  progressMade ||= result.progressMade;
} else {
  allComplete = false;
}

if (MODE === 'execute') {
  console.log(JSON.stringify({
    cleanup: 'run',
    mode: MODE,
    complete: allComplete,
    progressMade,
    stoppedForDeadline: !allComplete && deadlineReached()
  }));
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `cleanup_complete=${MODE === 'execute' && allComplete ? 'true' : 'false'}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `progress_made=${progressMade ? 'true' : 'false'}\n`);
}
