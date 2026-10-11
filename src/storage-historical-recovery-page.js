// Orchestrates source-scoped historical repair evidence; all non-aggregate
// candidate data stays inside one private Worker request.
import { inspectPrivateSnapshotReconciliationPage } from './storage-snapshot-reconciliation-reader.js';
import {
  buildVerifiedHistoricalRestoration, applyVerifiedHistoricalRestoration
} from './storage-historical-provenance-restoration.js';

const MAX_WRITES_PER_PAGE = 24;

function projectedPriorIdentity(family, prior, currentFact, canonicalId) {
  if (family === 'horse_profile') return { ...prior, horse_id: canonicalId };
  if (family === 'horse_stat') {
    return { ...prior, horse_id: canonicalId, snapshot_scope: currentFact.snapshotScope };
  }
  if (family === 'horse_record') {
    return { ...prior, horse_id: canonicalId, record_scope: currentFact.recordScope,
      stat_year: currentFact.statYear, record_ordinal: currentFact.ordinal };
  }
  if (family === 'person_stat') {
    return { ...prior, person_type: currentFact.personType,
      person_id: canonicalId, stat_year: currentFact.statYear };
  }
  throw new Error('historical_recovery_family_invalid');
}

export async function planInternalHistoricalRestoration(env, family, cursor = null, internalSourceId = null) {
  const candidates = [];
  let discardedCandidates = 0;
  const report = await inspectPrivateSnapshotReconciliationPage(env, {
    family, cursor, internalSourceId,
    onVerifiedPredecessor: (record) => {
      // A contradictory source is quarantined without discarding independently
      // verified candidates from the same source.
      try {
        const normalized = projectedPriorIdentity(
          family, record.priorSnapshot, record.currentFact, record.canonicalId
        );
        candidates.push(buildVerifiedHistoricalRestoration({
          ...record, priorSnapshot: normalized,
          currentOriginalVerified: true, priorOriginalVerified: true
        }));
      } catch {
        discardedCandidates++;
      }
    }
  });
  if (!report.revisionCounterMatchesProof || !report.classificationOnly ||
      report.repairAuthorized || candidates.length > MAX_WRITES_PER_PAGE ||
      candidates.length + discardedCandidates >
        Number(report.predecessorHints?.earlierOriginalVerifiedFacts || 0)) {
    throw new Error('historical_recovery_source_evidence_incomplete');
  }
  return { candidates, report, discardedCandidates };
}

function sanitizedPlan(report, candidates, mode) {
  return {
    mode,
    family: report.family,
    sourcePagesExamined: report.sourcesExamined,
    sourceOriginalVerified: report.originalVerified,
    olderOriginalVerifiedFacts: report.predecessorHints?.earlierOriginalVerifiedFacts ?? 0,
    sourceRepresentationDeficit: report.ledgerShortfall,
    readyDirectSnapshotCandidates: candidates.length,
    nonCandidateMissingFacts: Math.max(0,
      Number(report.classifications.missing_unverified_chronology || 0) - candidates.length),
    classificationConflicts: report.classifications.conflict,
    deferredEvidence: report.predecessorHints?.earlierOriginalDeferred ?? 0,
    completeSourceBeforeWrite: report.done,
    // Opaque cryptographic keyset cursor only; never log or persist publicly.
    cursor: report.cursor,
    repairAuthorized: false,
    privateSourceIdsReturned: false,
    sourceFactsReturned: false,
    budget: report.budget
  };
}

// Read-only preview: returns only generic aggregate counters and an opaque
// cursor. Safe for an authenticated private GitHub Actions workflow.
export async function inspectHistoricalRestorationPage(env, { family, cursor = null } = {}) {
  const { report, candidates } = await planInternalHistoricalRestoration(env, family, cursor);
  return sanitizedPlan(report, candidates, 'read_only_verified_restoration_preview');
}

// A separately enabled and explicitly authorized future execution path can
// call this. It is NOT an implicit continuation of a read-only audit.
export async function applyHistoricalRestorationPage(env, {
  family, cursor = null, approved = false, authorization = null
} = {}) {
  if (!approved || env?.HISTORICAL_REPAIR_ENABLED !== 'true' ||
      typeof env?.HISTORICAL_REPAIR_TOKEN !== 'string' ||
      env.HISTORICAL_REPAIR_TOKEN.length < 32 ||
      authorization !== env.HISTORICAL_REPAIR_TOKEN) {
    throw new Error('historical_restoration_not_authorized');
  }
  const { report, candidates } = await planInternalHistoricalRestoration(env, family, cursor);
  if (!report.auditLedgerVerified || report.originalVerified !== 1 ||
      report.classifications.conflict !== 0 ||
      report.classifications.invalid_evidence !== 0 ||
      report.classifications.identity_ambiguous !== 0) {
    throw new Error('historical_restoration_source_conflict');
  }
  let restored = 0;
  let reused = 0;
  for (const candidate of candidates) {
    const result = await applyVerifiedHistoricalRestoration(env, candidate, {
      approved: true, authorization
    });
    restored += Number(result.restored || 0);
    reused += Number(result.reused || 0);
  }
  // Applying is intentionally non-atomic across different facts, but each
  // source-owned INSERT and dataset revision advance is atomic and idempotent.
  // The next invocation must start with a fresh audit/proof if its revision
  // was invalidated. Unprocessed uncertain cases remain quarantine.
  return {
    mode: 'approved_verified_source_owned_restoration',
    family, sourcePagesExamined: report.sourcesExamined,
    eligible: candidates.length, restored, reused,
    skippedUnverified: Math.max(0,
      Number(report.classifications.missing_unverified_chronology || 0) - candidates.length),
    snapshotsDeleted: 0, factsOverwritten: 0,
    nextCursor: report.cursor,
    repairAuthorized: true,
    privateSourceIdsReturned: false, sourceFactsReturned: false
  };
}
