import { writeFileSync } from 'node:fs';

const MODE = process.env.MODE;
const MAX_BATCHES = Number(process.env.MAX_BATCHES || 50);
const RUN_UNTIL_COMPLETE = process.env.RUN_UNTIL_COMPLETE === 'true';
const CLEANUP_SESSION_ID = process.env.CLEANUP_SESSION_ID || null;
const SOURCE_SHA = process.env.GITHUB_SHA || '';
const WORKER_URL = process.env.WORKER_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const CONFIRMATION = 'execute-reviewed-storage-cleanup-batch';
const FAMILIES = ['horse_profile', 'horse_stat', 'horse_record', 'person_stat'];
const TARGETS = [...FAMILIES, 'raw_object'];
const CHECKPOINT_EVERY = 10;
const AUTO_TIME_BUDGET_MS = 32 * 60 * 1000;
const startedAt = Date.now();

if (!['dry-run', 'execute'].includes(MODE)) throw new Error('MODE must be dry-run or execute');
if (!Number.isInteger(MAX_BATCHES) || MAX_BATCHES < 1 || MAX_BATCHES > 250) throw new Error('MAX_BATCHES must be between 1 and 250');
if (!WORKER_URL || !ADMIN_TOKEN) throw new Error('WORKER_URL and ADMIN_TOKEN are required');
if (RUN_UNTIL_COMPLETE && MODE !== 'execute') throw new Error('run-until-complete is available only in execute mode');
if (RUN_UNTIL_COMPLETE && !/^[a-f0-9]{40}$/.test(SOURCE_SHA)) throw new Error('run-until-complete requires GITHUB_SHA');

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(path, body) {
  for (let attempt = 1; attempt <= 15; attempt += 1) {
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
    if (response.status === 401 && attempt < 15) {
      await sleep(2000);
      continue;
    }
    if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}: ${String(data?.error || 'unknown_error').slice(0, 160)}`);
    if (data?.safetyStop === true) throw new Error(`${path} tripped the D1 cost-safety stop`);
    return data;
  }
  throw new Error(`${path} authentication did not stabilize within 30 seconds`);
}

function safeWarnings(value) {
  return Array.isArray(value) ? value.map(String).slice(0, 20) : [];
}

function withinAutoBudget() {
  return !RUN_UNTIL_COMPLETE || (Date.now() - startedAt) < AUTO_TIME_BUDGET_MS;
}

async function checkpoint(sessionId, target, cursor, complete) {
  if (!RUN_UNTIL_COMPLETE) return { sessionComplete: false };
  return post('/v1/storage-cleanup/session/checkpoint', {
    session_id: sessionId,
    source_sha: SOURCE_SHA,
    target,
    cursor: complete ? null : cursor,
    complete
  });
}

async function runSnapshotFamily(family, initialCursor = null, alreadyComplete = false, sessionId = null) {
  if (alreadyComplete) return { target: family, complete: true, cursor: null, pages: 0 };
  let cursor = initialCursor;
  let pages = 0;
  let scanned = 0;
  let removable = 0;
  let removed = 0;
  const warnings = new Set();
  const batchLimit = RUN_UNTIL_COMPLETE ? Number.MAX_SAFE_INTEGER : MAX_BATCHES;

  while (pages < batchLimit && withinAutoBudget()) {
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
    if (RUN_UNTIL_COMPLETE && pages % CHECKPOINT_EVERY === 0) {
      await checkpoint(sessionId, family, cursor, false);
    }
  }

  const complete = cursor === null;
  if (RUN_UNTIL_COMPLETE) await checkpoint(sessionId, family, cursor, complete);

  console.log(JSON.stringify({
    cleanup: 'snapshot',
    family,
    mode: MODE,
    pages,
    rowsScanned: scanned,
    rowsRemovable: removable,
    rowsRemoved: removed,
    completeWithinRun: complete,
    autoContinuation: RUN_UNTIL_COMPLETE && !complete,
    warnings: [...warnings]
  }));
  return { target: family, complete, cursor, pages };
}

async function runRawCleanup(initialCursor = null, alreadyComplete = false, sessionId = null) {
  if (alreadyComplete) return { target: 'raw_object', complete: true, cursor: null, batches: 0 };
  let cursor = initialCursor;
  let batches = 0;
  let scanned = 0;
  let rewritesPlanned = 0;
  let rewritesDone = 0;
  let canonicalCreated = 0;
  let legacyDeleted = 0;
  let conflicts = 0;
  let confirmedComplete = false;
  const warnings = new Set();
  const batchLimit = RUN_UNTIL_COMPLETE ? Number.MAX_SAFE_INTEGER : MAX_BATCHES;

  while (batches < batchLimit && withinAutoBudget()) {
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

    const complete = cursor === null && Number(plan.referenceRewrites || 0) === 0;
    if (complete) {
      confirmedComplete = true;
      break;
    }
    if (RUN_UNTIL_COMPLETE && batches % CHECKPOINT_EVERY === 0 && cursor) {
      await checkpoint(sessionId, 'raw_object', cursor, false);
    }
  }

  const complete = confirmedComplete;
  if (RUN_UNTIL_COMPLETE) {
    if (complete) await checkpoint(sessionId, 'raw_object', null, true);
    else if (cursor) await checkpoint(sessionId, 'raw_object', cursor, false);
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
    completeWithinRun: complete,
    autoContinuation: RUN_UNTIL_COMPLETE && !complete,
    warnings: [...warnings]
  }));
  return { target: 'raw_object', complete, cursor, batches };
}

let session = null;
let targetState = new Map(TARGETS.map((target) => [target, { cursor: null, complete: false }]));
if (RUN_UNTIL_COMPLETE) {
  session = await post('/v1/storage-cleanup/session/start', {
    session_id: CLEANUP_SESSION_ID,
    source_sha: SOURCE_SHA
  });
  targetState = new Map(session.targets.map((target) => [target.target, target]));
}

const results = [];
for (const family of FAMILIES) {
  const state = targetState.get(family) || { cursor: null, complete: false };
  results.push(await runSnapshotFamily(family, state.cursor, state.complete, session?.sessionId || null));
  if (!withinAutoBudget()) break;
}

if (withinAutoBudget()) {
  const rawState = targetState.get('raw_object') || { cursor: null, complete: false };
  results.push(await runRawCleanup(rawState.cursor, rawState.complete, session?.sessionId || null));
}

if (RUN_UNTIL_COMPLETE) {
  const completedTargets = new Set([
    ...[...targetState.entries()].filter(([, value]) => value.complete).map(([target]) => target),
    ...results.filter((result) => result.complete).map((result) => result.target)
  ]);
  const complete = TARGETS.every((target) => completedTargets.has(target));
  const result = {
    sessionId: session.sessionId,
    complete,
    continuationRequired: !complete,
    continuationCount: session.continuationCount,
    sourceSha: SOURCE_SHA
  };
  writeFileSync('/tmp/storage-cleanup-result.json', JSON.stringify(result));
  console.log(JSON.stringify({
    cleanup: 'session',
    mode: MODE,
    complete,
    continuationRequired: !complete,
    continuationCount: session.continuationCount
  }));
}
