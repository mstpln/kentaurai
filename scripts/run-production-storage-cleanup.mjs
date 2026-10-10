import { appendFileSync } from 'node:fs';

const MODE = process.env.MODE;
const DRY_RUN_MAX_BATCHES = Number(process.env.DRY_RUN_MAX_BATCHES || 50);
const SOFT_DEADLINE_MS = Number(process.env.CLEANUP_SOFT_DEADLINE_MS || 38 * 60 * 1000);
const RUN_MAX_ROWS_READ = Number(process.env.CLEANUP_RUN_MAX_ROWS_READ || 1_000_000);
const RUN_MAX_ROWS_WRITTEN = Number(process.env.CLEANUP_RUN_MAX_ROWS_WRITTEN || 100_000);
const DEADLINE_RESERVE_MS = 2 * 60 * 1000;
const WORKER_URL = process.env.WORKER_URL;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SOURCE_SHA = process.env.GITHUB_SHA || '';
const READ_ONLY_CONTINUATION_MARKER = 'RESUME READ ONLY AUDIT';
const TRIGGER_CONFIRMATION = process.env.CLEANUP_TRIGGER_CONFIRMATION || '';
const AUTOMATED_READ_ONLY_CONTINUATION = MODE === 'dry-run'
  && TRIGGER_CONFIRMATION === READ_ONLY_CONTINUATION_MARKER;
if (MODE === 'execute' && TRIGGER_CONFIRMATION === READ_ONLY_CONTINUATION_MARKER) {
  throw new Error('A read-only continuation marker cannot authorize execute mode');
}
if (MODE === 'dry-run' && !['', READ_ONLY_CONTINUATION_MARKER].includes(TRIGGER_CONFIRMATION)) {
  throw new Error('dry-run does not accept execute confirmation or unknown continuation markers');
}
if (AUTOMATED_READ_ONLY_CONTINUATION
  && (!process.env.CLEANUP_AUDIT_RUN_ID || process.env.CLEANUP_SESSION_ID)) {
  throw new Error('Automated read-only continuation requires an audit ID and no execute session');
}
// Dry-run has no execution session. Older UI listed the execute-only field
// first, leading people to paste their audit UUID into continuation_session.
const RAW_SESSION_ID = process.env.CLEANUP_SESSION_ID?.trim() || null;
const RAW_AUDIT_ID = process.env.CLEANUP_AUDIT_RUN_ID?.trim() || null;
if (MODE === 'dry-run' && RAW_SESSION_ID && RAW_AUDIT_ID) {
  throw new Error('dry-run has two continuation IDs; fill only continuation_audit');
}
const recoveredMisfiledAuditId = MODE === 'dry-run' && RAW_SESSION_ID && !RAW_AUDIT_ID;
const CLEANUP_SESSION_ID = MODE === 'dry-run' ? null : RAW_SESSION_ID;
const CLEANUP_AUDIT_RUN_ID = RAW_AUDIT_ID || (recoveredMisfiledAuditId ? RAW_SESSION_ID : null);
if (recoveredMisfiledAuditId) {
  console.warn('dry-run: using the Audit-ID from continuation_session as continuation_audit; no execution session will be used.');
}
const CONFIRMATION = 'execute-reviewed-storage-cleanup-batch';
const FAMILIES = ['horse_profile', 'horse_stat', 'horse_record', 'person_stat'];
const TARGETS = [...FAMILIES, 'raw_object'];
const startedAt = Date.now();
const deadlineAt = startedAt + SOFT_DEADLINE_MS;
const runCost = { rowsRead: 0, rowsWritten: 0, d1DurationMs: 0, requestCount: 0 };

if (!['dry-run', 'execute'].includes(MODE)) throw new Error('MODE must be dry-run or execute');
if (!Number.isInteger(DRY_RUN_MAX_BATCHES) || DRY_RUN_MAX_BATCHES < 1 || DRY_RUN_MAX_BATCHES > 250) {
  throw new Error('DRY_RUN_MAX_BATCHES must be between 1 and 250');
}
if (!Number.isFinite(SOFT_DEADLINE_MS) || SOFT_DEADLINE_MS < 5 * 60 * 1000 || SOFT_DEADLINE_MS > 40 * 60 * 1000) {
  throw new Error('CLEANUP_SOFT_DEADLINE_MS must be between 5 and 40 minutes');
}
if (!Number.isInteger(RUN_MAX_ROWS_READ) || RUN_MAX_ROWS_READ < 100_000 || RUN_MAX_ROWS_READ > 10_000_000) {
  throw new Error('CLEANUP_RUN_MAX_ROWS_READ must be between 100000 and 10000000');
}
if (!Number.isInteger(RUN_MAX_ROWS_WRITTEN) || RUN_MAX_ROWS_WRITTEN < 10_000 || RUN_MAX_ROWS_WRITTEN > 1_000_000) {
  throw new Error('CLEANUP_RUN_MAX_ROWS_WRITTEN must be between 10000 and 1000000');
}
if (!WORKER_URL || !ADMIN_TOKEN) throw new Error('WORKER_URL and ADMIN_TOKEN are required');
if (!/^[a-f0-9]{40}$/.test(SOURCE_SHA)) {
  throw new Error('cleanup requires the exact GITHUB_SHA');
}

function deadlineReached() {
  return Date.now() + DEADLINE_RESERVE_MS >= deadlineAt;
}

function addRunCost(cost) {
  if (!cost || typeof cost !== 'object') return;
  runCost.rowsRead += Math.max(0, Number(cost.rowsRead || 0));
  runCost.rowsWritten += Math.max(0, Number(cost.rowsWritten || 0));
  runCost.d1DurationMs += Math.max(0, Number(cost.d1DurationMs || 0));
  runCost.requestCount += 1;
}

function costBudgetReached() {
  return runCost.rowsRead > RUN_MAX_ROWS_READ || runCost.rowsWritten > RUN_MAX_ROWS_WRITTEN;
}

// Only known audit lifecycle failures are surfaced; never print arbitrary
// Worker/database exception messages or private identifiers.
function knownAuditStartFailure(message) {
  const detail = String(message || '');
  if (detail === 'cleanup audit run not found') {
    return { code: 'audit_not_found', hint: 'Audit ID not found; check continuation_audit.' };
  }
  if (detail === 'cleanup audit source_sha changed; start a new audit') {
    return { code: 'audit_source_changed', hint: 'The audit belongs to an earlier deployment.' };
  }
  if (detail === 'cleanup audit run expired; start a new audit') {
    return { code: 'audit_expired', hint: 'The audit has passed its expiry.' };
  }
  if (detail === 'cleanup audit dataset changed; start a new audit') {
    return { code: 'audit_dataset_changed', hint: 'Underlying data changed since the audit began.' };
  }
  const status = /^cleanup audit run is (stale|expired|exhausted); start a new audit$/.exec(detail);
  if (status) return { code: 'audit_' + status[1], hint: 'This audit cannot be resumed.' };
  if (detail === 'cleanup audit continuation limit reached') {
    return { code: 'audit_exhausted', hint: 'The audit reached its continuation limit.' };
  }
  const active = /^cleanup audit is already running; resume it explicitly with audit_run_id ([0-9a-f-]{36})$/.exec(detail);
  if (active) return { code: 'audit_already_running', hint: 'Resuming the currently running audit is allowed for dry-run.', auditRunId: active[1] };
  return null;
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
    if (!response.ok) {
      const known = path === '/v1/storage-cleanup/audit/start'
        ? knownAuditStartFailure(data?.message) : null;
      const errorCode = String(data?.error || 'unknown_error').replace(/[^a-z0-9_:-]/gi, '').slice(0, 48);
      const error = new Error(path + ' failed with HTTP ' + response.status + ': ' + errorCode
        + (known ? ' [' + known.code + '] ' + known.hint : ''));
      error.cleanupReason = known?.code || null;
      error.auditRunId = known?.auditRunId || null;
      throw error;
    }
    addRunCost(data?.cost);
    if (data?.safetyStop === true) {
      const cost = data?.cost || {};
      const scope = String(data?.safetyStopScope || 'unspecified')
        .replace(/[^a-z0-9_:-]/gi, '')
        .slice(0, 64) || 'unspecified';
      const detailedReadCost = (data?.families || []).find((family) => family?.family === scope)?.readCostByCheck;
      const checks = ['representations','observations','direct_timeline']
        .filter((name) => Number.isFinite(detailedReadCost?.[name]) && detailedReadCost[name] >= 0)
        .map((name) => `${name}=${Math.floor(detailedReadCost[name])}`)
        .join(',');
      throw new Error(
        `${path} tripped the D1 cost-safety stop ` +
        `(scope=${scope}, rowsRead=${Math.max(0, Number(cost.rowsRead || 0))}, ` +
        `rowsWritten=${Math.max(0, Number(cost.rowsWritten || 0))}, ` +
        `durationMs=${Math.max(0, Number(cost.durationMs || 0))}${checks ? `, readChecks=${checks}` : ''})`
      );
    }
    return data;
  }
  throw new Error(`${path} authentication did not stabilize within 30 seconds`);
}

const post = (path, body) => request(path, { method: 'POST', body });
let activeAuditRunId = CLEANUP_AUDIT_RUN_ID;

function authorizationBody(session) {
  return MODE === 'execute'
    ? { session_id: session.sessionId, source_sha: SOURCE_SHA }
    : { audit_run_id: activeAuditRunId, source_sha: SOURCE_SHA };
}

function safeWarnings(value) {
  return Array.isArray(value) ? value.map(String).slice(0, 20) : [];
}

function logIntegrityAudit(audit, { sessionBound = false } = {}) {
  console.log(JSON.stringify({
    cleanup: 'integrity_audit',
    mode: MODE,
    ok: audit?.ok === true,
    sessionBound,
    families: (audit?.families || []).map((family) => ({
      family: family.family,
      mismatchedSources: Number(family.mismatchedSources || 0),
      missingRepresentations: Number(family.missingRepresentations || 0),
      excessRepresentations: Number(family.excessRepresentations || 0),
      danglingObservations: Number(family.danglingObservations || 0),
      identityMismatchObservations: Number(family.identityMismatchObservations || 0),
      timestampMismatchRepresentations: Number(family.timestampMismatchRepresentations || 0),
      readCostByCheck: Object.fromEntries(['representations','observations','direct_timeline']
        .filter((name) => Number.isFinite(family.readCostByCheck?.[name]) && family.readCostByCheck[name] >= 0)
        .map((name) => [name, Math.floor(family.readCostByCheck[name])]))
    })),
    operations: {
      startedBatches: Number(audit?.operations?.startedBatches || 0),
      strandedRawBatches: Number(audit?.operations?.strandedRawBatches || 0),
      ok: audit?.operations?.ok !== false
    }
  }));
}

async function verifyResumableIntegrity(session) {
  if (MODE === 'execute' && session?.auditVerified === true) {
    return { ready: true, auditRunId: null, progressMade: false };
  }
  let audit;
  try {
    audit = await post('/v1/storage-cleanup/audit/start', {
      audit_run_id: CLEANUP_AUDIT_RUN_ID,
      source_sha: SOURCE_SHA
    });
  } catch (error) {
    // A manually triggered dry-run with no ID may resume an existing proof
    // ONLY when the Worker itself selected it by the exact source SHA and
    // current dataset revision. No arbitrary session or unverified ID reuse.
    if (MODE === 'dry-run' && !CLEANUP_AUDIT_RUN_ID
      && error?.cleanupReason === 'audit_already_running' && error?.auditRunId) {
      console.warn('dry-run: resuming the active source/revision-bound audit without requiring an operator-entered ID.');
      audit = await post('/v1/storage-cleanup/audit/start', {
        audit_run_id: error.auditRunId,
        source_sha: SOURCE_SHA
      });
    } else {
      // A proof from an older release or changed dataset is never reused.
      // Only dry-run may restart read-only verification; missing IDs, cost
      // stops, exhausted proofs and execute mode continue to fail closed.
      const safeResetReasons = new Set([
        'audit_source_changed', 'audit_expired', 'audit_stale', 'audit_dataset_changed'
      ]);
      if (MODE !== 'dry-run' || AUTOMATED_READ_ONLY_CONTINUATION
        || !CLEANUP_AUDIT_RUN_ID || !safeResetReasons.has(error?.cleanupReason)) throw error;
      console.warn('dry-run: previous audit is not reusable (' + error.cleanupReason
        + '); starting a new read-only audit with independent integrity verification.');
      audit = await post('/v1/storage-cleanup/audit/start', {
        audit_run_id: null,
        source_sha: SOURCE_SHA
      });
    }
  }
  const auditRunId = audit.auditRunId;
  let progressMade = false;
  while (audit?.complete !== true) {
    if (costBudgetReached() || deadlineReached()) {
      return { ready: false, auditRunId, progressMade, audit };
    }
    audit = await post('/v1/storage-cleanup/audit/step', { audit_run_id: auditRunId });
    if (audit?.cumulativeSafetyStop === true || audit?.safetyStop === true
      || audit?.budgetBlocked === true) {
      return { ready: false, auditRunId, progressMade, audit };
    }
    // A response is not proof of progress. Only an accepted, settled page
    // may authorize another automatic audit workflow.
    if (audit?.page?.accepted !== true || audit?.concurrentRetry === true) {
      return { ready: false, auditRunId, progressMade: false, audit };
    }
    progressMade = true;
  }
  logIntegrityAudit(audit, { sessionBound: MODE === 'execute' });
  if (audit?.ok !== true) throw new Error('storage cleanup integrity audit failed; refusing cleanup');
  if (costBudgetReached()) return { ready: false, auditRunId, progressMade, audit };
  if (MODE === 'execute') {
    const bound = await post('/v1/storage-cleanup/session/audit', {
      session_id: session.sessionId,
      source_sha: SOURCE_SHA,
      audit_run_id: auditRunId
    });
    if (bound?.ok !== true || bound?.auditVerified !== true) {
      throw new Error('storage cleanup session integrity audit failed; refusing cleanup');
    }
  }
  return { ready: true, auditRunId, progressMade, audit };
}

async function startSession() {
  if (MODE !== 'execute') return null;
  return post('/v1/storage-cleanup/session/start', {
    session_id: CLEANUP_SESSION_ID,
    source_sha: SOURCE_SHA
  });
}

async function checkpoint(session, target, cursor, complete) {
  if (MODE !== 'execute') return;
  if (!complete && !cursor) return;
  await post('/v1/storage-cleanup/session/checkpoint', {
    session_id: session.sessionId,
    source_sha: SOURCE_SHA,
    target,
    cursor: complete ? null : cursor,
    complete
  });
}

function logSnapshot(family, runPages, scanned, removable, removed, complete, warnings, stoppedForDeadline = false) {
  console.log(JSON.stringify({
    cleanup: 'snapshot',
    family,
    mode: MODE,
    pagesThisRun: runPages,
    rowsScannedThisRun: scanned,
    rowsRemovableThisRun: removable,
    rowsRemovedThisRun: removed,
    complete,
    stoppedForDeadline,
    warnings: [...warnings]
  }));
}

async function runSnapshotFamily(family, initialState, session) {
  if (MODE === 'execute' && initialState?.complete) {
    logSnapshot(family, 0, 0, 0, 0, true, new Set());
    return { target: family, complete: true, progressMade: false };
  }

  let cursor = MODE === 'execute' ? (initialState?.cursor || null) : null;
  let runPages = 0;
  let scanned = 0;
  let removable = 0;
  let removed = 0;
  const warnings = new Set();

  while (MODE === 'execute' || runPages < DRY_RUN_MAX_BATCHES) {
    if (deadlineReached()) {
      logSnapshot(family, runPages, scanned, removable, removed, false, warnings, true);
      return { target: family, complete: false, progressMade: runPages > 0 };
    }
    if (costBudgetReached()) {
      logSnapshot(family, runPages, scanned, removable, removed, false, warnings);
      return { target: family, complete: false, progressMade: runPages > 0, stoppedForCost: true };
    }

    const plan = await post('/v1/storage-cleanup/snapshots/plan', {
      family, limit: 25, cursor, ...authorizationBody(session)
    });
    runPages += 1;
    scanned += Number(plan.rowsScanned || 0);
    removable += Number(plan.rowsRemovable || 0);
    for (const warning of safeWarnings(plan.warnings)) warnings.add(warning);
    if (costBudgetReached()) {
      logSnapshot(family, runPages, scanned, removable, removed, false, warnings);
      return { target: family, complete: false, progressMade: runPages > 0, stoppedForCost: true };
    }

    if (MODE === 'execute' && Number(plan.rowsRemovable || 0) > 0) {
      const result = await post('/v1/storage-cleanup/snapshots/execute', {
        family,
        limit: 25,
        cursor,
        ...authorizationBody(session),
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

    const complete = cursor === null;
    if (MODE === 'execute') await checkpoint(session, family, cursor, complete);
    if (complete) {
      logSnapshot(family, runPages, scanned, removable, removed, true, warnings);
      return { target: family, complete: true, progressMade: true };
    }
  }

  logSnapshot(family, runPages, scanned, removable, removed, false, warnings);
  return { target: family, complete: false, progressMade: runPages > 0 };
}

function logRaw(runBatches, scanned, rewritesPlanned, rewritesDone, canonicalCreated, legacyDeleted, conflicts, complete, warnings, stoppedForDeadline = false) {
  console.log(JSON.stringify({
    cleanup: 'raw_object',
    mode: MODE,
    batchesThisRun: runBatches,
    rowsScannedThisRun: scanned,
    referenceRewritesPlannedThisRun: rewritesPlanned,
    referencesRewrittenThisRun: rewritesDone,
    canonicalObjectsCreatedThisRun: canonicalCreated,
    legacyObjectsDeletedThisRun: legacyDeleted,
    conflictsSkipped: conflicts,
    complete,
    stoppedForDeadline,
    warnings: [...warnings]
  }));
}

async function runRawCleanup(initialState, session) {
  if (MODE === 'execute' && initialState?.complete) {
    logRaw(0, 0, 0, 0, 0, 0, 0, true, new Set());
    return { target: 'raw_object', complete: true, progressMade: false };
  }

  let cursor = MODE === 'execute' ? (initialState?.cursor || null) : null;
  let runBatches = 0;
  let scanned = 0;
  let rewritesPlanned = 0;
  let rewritesDone = 0;
  let canonicalCreated = 0;
  let legacyDeleted = 0;
  let conflicts = 0;
  let confirmedComplete = false;
  const warnings = new Set();

  while (MODE === 'execute' || runBatches < DRY_RUN_MAX_BATCHES) {
    if (deadlineReached()) {
      logRaw(runBatches, scanned, rewritesPlanned, rewritesDone, canonicalCreated, legacyDeleted, conflicts, false, warnings, true);
      return { target: 'raw_object', complete: false, progressMade: runBatches > 0 };
    }
    if (costBudgetReached()) {
      logRaw(runBatches, scanned, rewritesPlanned, rewritesDone, canonicalCreated, legacyDeleted, conflicts, false, warnings);
      return { target: 'raw_object', complete: false, progressMade: runBatches > 0, stoppedForCost: true };
    }

    const plan = await post('/v1/storage-cleanup/raw/plan', {
      limit: 25, cursor, ...authorizationBody(session)
    });
    runBatches += 1;
    scanned += Number(plan.rowsScanned || 0);
    rewritesPlanned += Number(plan.referenceRewrites || 0);
    conflicts += Number(plan.conflictsSkipped || 0);
    for (const warning of safeWarnings(plan.warnings)) warnings.add(warning);
    if (costBudgetReached()) {
      logRaw(runBatches, scanned, rewritesPlanned, rewritesDone, canonicalCreated, legacyDeleted, conflicts, false, warnings);
      return { target: 'raw_object', complete: false, progressMade: runBatches > 0, stoppedForCost: true };
    }

    if (MODE === 'dry-run') {
      if (Number(plan.referenceRewrites || 0) > 0) break;
      cursor = plan.nextCursor || null;
      if (!cursor) {
        confirmedComplete = true;
        break;
      }
      continue;
    }

    if (Number(plan.conflictsSkipped || 0) > 0) {
      throw new Error('raw cleanup dry-run reported a conflict; refusing mutation');
    }

    if (Number(plan.referenceRewrites || 0) > 0) {
      const result = await post('/v1/storage-cleanup/raw/execute', {
        limit: 25,
        cursor,
        ...authorizationBody(session),
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
      if (cursor) await checkpoint(session, 'raw_object', cursor, false);
      continue;
    }

    cursor = plan.nextCursor || null;
    if (!cursor) {
      confirmedComplete = true;
      await checkpoint(session, 'raw_object', null, true);
      break;
    }
    await checkpoint(session, 'raw_object', cursor, false);
  }

  logRaw(runBatches, scanned, rewritesPlanned, rewritesDone, canonicalCreated, legacyDeleted, conflicts, confirmedComplete, warnings);
  return { target: 'raw_object', complete: confirmedComplete, progressMade: runBatches > 0 };
}

async function main() {
  const session = await startSession();
  const integrity = await verifyResumableIntegrity(session);
  activeAuditRunId = integrity.auditRunId || activeAuditRunId;
  if (!integrity.ready) {
    console.log(JSON.stringify({
      cleanup: 'integrity_audit',
      mode: MODE,
      complete: false,
      auditRunId: integrity.auditRunId,
      progressMade: integrity.progressMade,
      stoppedForCost: costBudgetReached(),
      auditSafetyStop: integrity.audit?.cumulativeSafetyStop === true || integrity.audit?.safetyStop === true,
      continuationCount: integrity.audit?.continuationCount ?? null,
      maxContinuations: integrity.audit?.maxContinuations ?? null,
      verifiedRows: (integrity.audit?.families || []).reduce(
        (sum, family) => sum + Number(family?.rowsChecked || 0), 0
      ) + Number(integrity.audit?.operations?.rowsChecked || 0),
      completedFamilies: (integrity.audit?.families || []).filter(
        (family) => family?.complete === true
      ).length,
      cost: runCost
    }));
    return {
      session,
      auditRunId: integrity.auditRunId,
      audit: integrity.audit,
      auditIncomplete: true,
      allComplete: false,
      progressMade: integrity.progressMade,
      stoppedForCost: costBudgetReached()
    };
  }

  const targetState = new Map(
    (session?.targets || TARGETS.map((target) => ({ target, cursor: null, complete: false })))
      .map((state) => [state.target, state])
  );
  const completeTargets = new Set(
    [...targetState.entries()].filter(([, state]) => state.complete).map(([target]) => target)
  );
  let progressMade = integrity.progressMade;
  let stoppedForCost = false;

  for (const family of FAMILIES) {
    const result = await runSnapshotFamily(family, targetState.get(family), session);
    if (result.complete) completeTargets.add(family);
    progressMade ||= result.progressMade;
    stoppedForCost ||= result.stoppedForCost === true;
    if (!result.complete && (deadlineReached() || stoppedForCost)) break;
  }

  if (!deadlineReached() && !stoppedForCost) {
    const rawResult = await runRawCleanup(targetState.get('raw_object'), session);
    if (rawResult.complete) completeTargets.add('raw_object');
    progressMade ||= rawResult.progressMade;
    stoppedForCost ||= rawResult.stoppedForCost === true;
  }

  const allComplete = MODE === 'execute'
    ? TARGETS.every((target) => completeTargets.has(target))
    : false;
  if (MODE === 'execute') {
    console.log(JSON.stringify({
      cleanup: 'session',
      mode: MODE,
      complete: allComplete,
      progressMade,
      continuationCount: Number(session?.continuationCount || 0),
      stoppedForDeadline: !allComplete && deadlineReached(),
      stoppedForCost,
      cost: runCost
    }));
    if (!allComplete && Number(session?.continuationCount || 0) >= Number(session?.maxContinuations || 0)) {
      throw new Error('cleanup session continuation limit reached before completion');
    }
  }
  return {
    session,
    auditRunId: integrity.auditRunId,
    auditIncomplete: false,
    allComplete,
    progressMade,
    stoppedForCost
  };
}

const result = await main();
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `cleanup_complete=${MODE === 'execute' && result.allComplete ? 'true' : 'false'}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `progress_made=${result.progressMade ? 'true' : 'false'}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `cost_budget_stop=${result.stoppedForCost ? 'true' : 'false'}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `audit_incomplete=${result.auditIncomplete ? 'true' : 'false'}\n`);
  if (result.auditRunId) appendFileSync(process.env.GITHUB_OUTPUT, `cleanup_audit_run_id=${result.auditRunId}\n`);
  if (result.auditIncomplete) {
    const a = result.audit || {};
    appendFileSync(process.env.GITHUB_OUTPUT, `audit_safety_stop=${a.cumulativeSafetyStop === true || a.safetyStop === true ? 'true' : 'false'}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `audit_continuation_count=${a.continuationCount ?? ''}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `audit_max_continuations=${a.maxContinuations ?? ''}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `audit_expires_at=${a.expiresAt ?? ''}\n`);
  }
  if (MODE === 'execute' && result.session?.sessionId) {
    appendFileSync(process.env.GITHUB_OUTPUT, `cleanup_session_id=${result.session.sessionId}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `continuation_count=${Number(result.session.continuationCount || 0)}\n`);
  }
}
