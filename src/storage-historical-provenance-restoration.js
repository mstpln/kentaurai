// Recovery primitive for loss of a source's logical snapshot representation.
// Intentionally NOT reachable from an HTTP route or production schedule.
// A direct source-owned snapshot restores truthful as-of provenance without
// guessing whether the value was unchanged across an incomplete timeline.
import { stableId } from './ids.js';
import { snapshotFactMatches } from './storage-snapshot-reconciliation.js';

const QUALITY = 'verified_official_snapshot';
const SOURCE_TYPE = 'official_provider';
const SOURCE_QUALITY = 'normalized_verified_subset';

const CONFIG = Object.freeze({
  horse_profile: {
    table: 'horse_profile_snapshots', externalTable: 'horse_external_ids',
    idColumn: 'horse_id', scope: (f) => 'profile',
    values: (f) => ({ age_years: f.ageYears }),
    identity: (mapped, f) => ({ horse_id: mapped }),
    id: (mapped, source, f) => stableId('horse-profile-snapshot', mapped, source.id)
  },
  horse_stat: {
    table: 'horse_stat_snapshots', externalTable: 'horse_external_ids',
    idColumn: 'horse_id', scope: (f) => f.snapshotScope,
    values: (f) => ({
      snapshot_scope: f.snapshotScope, stat_year: f.statYear,
      starts: f.starts, earnings_raw: f.earningsRaw, wins: f.wins,
      seconds: f.seconds, thirds: f.thirds, win_percentage_raw: f.winPercentageRaw,
      place_percentage_raw: f.placePercentageRaw, earnings_per_start_raw: f.earningsPerStartRaw,
      start_points: f.startPoints
    }),
    identity: (mapped, f) => ({ horse_id: mapped, snapshot_scope: f.snapshotScope }),
    id: (mapped, source, f) => stableId('horse-stat-snapshot', mapped, source.id, f.snapshotScope)
  },
  horse_record: {
    table: 'horse_record_snapshots', externalTable: 'horse_external_ids',
    idColumn: 'horse_id', scope: (f) =>
      (f.recordScope === 'year' ? 'year:' + f.statYear : f.recordScope) + ':' + f.ordinal,
    values: (f) => ({
      record_scope: f.recordScope, stat_year: f.statYear, record_ordinal: f.ordinal,
      code: f.code, start_method: f.startMethod, distance_group: f.distanceGroup,
      time_minutes: f.timeMinutes, time_seconds: f.timeSeconds,
      time_tenths: f.timeTenths, place: f.place
    }),
    identity: (mapped, f) => ({
      horse_id: mapped, record_scope: f.recordScope,
      stat_year: f.statYear, record_ordinal: f.ordinal
    }),
    id: (mapped, source, f) => stableId('horse-record-snapshot', mapped, source.id,
      f.recordScope === 'year' ? 'year:' + f.statYear : f.recordScope, f.ordinal)
  },
  person_stat: {
    table: 'person_stat_snapshots', externalTable: null, idColumn: 'person_id',
    scope: (f) => String(f.statYear),
    values: (f) => ({
      stat_year: f.statYear, starts: f.starts, earnings_raw: f.earningsRaw,
      wins: f.wins, seconds: f.seconds, thirds: f.thirds,
      win_percentage_raw: f.winPercentageRaw
    }),
    identity: (mapped, f) => ({
      person_type: f.personType, person_id: mapped, stat_year: f.statYear
    }),
    id: (mapped, source, f) => stableId('person-stat-snapshot',
      f.personType, mapped, source.id, f.statYear)
  }
});

function validSource(source) {
  return source && typeof source.id === 'string' && source.id &&
    typeof source.fetched_at === 'string' && Number.isFinite(Date.parse(source.fetched_at)) &&
    typeof source.content_hash === 'string' && /^[a-f0-9]{64}$/.test(source.content_hash) &&
    source.source_type === SOURCE_TYPE &&
    source.quality_status === SOURCE_QUALITY;
}

function sameNativeFact(family, left, right) {
  if (left?.externalId == null || right?.externalId == null ||
      String(left.externalId) !== String(right.externalId)) return false;
  if (family === 'horse_profile') return true;
  if (family === 'horse_stat') return left.snapshotScope === right.snapshotScope;
  if (family === 'horse_record') return left.recordScope === right.recordScope &&
    left.statYear === right.statYear && left.ordinal === right.ordinal;
  if (family === 'person_stat') return left.personType === right.personType &&
    left.statYear === right.statYear;
  return false;
}

// This factory must only receive actual current and older R2-original facts,
// each independently SHA-verified within the SAME private Worker invocation.
// No assertion based only on a current canonical mapping is sufficient.
export function buildVerifiedHistoricalRestoration({
  family, currentSource, priorSource, currentFact, priorFact, priorSnapshot,
  canonicalId, currentOriginalVerified = false, priorOriginalVerified = false
} = {}) {
  const conf = CONFIG[family];
  if (!conf || !validSource(currentSource) || !validSource(priorSource) ||
      !currentOriginalVerified || !priorOriginalVerified ||
      typeof canonicalId !== 'string' || !canonicalId ||
      typeof currentFact !== 'object' || !currentFact ||
      typeof priorFact !== 'object' || !priorFact ||
      !priorSnapshot || typeof priorSnapshot.id !== 'string' ||
      priorSnapshot.source_record_id !== priorSource.id ||
      priorSnapshot.quality_status !== QUALITY ||
      !sameNativeFact(family, currentFact, priorFact) ||
      Date.parse(priorSource.fetched_at) >= Date.parse(currentSource.fetched_at) ||
      Date.parse(priorSnapshot.observed_at) !== Date.parse(priorSource.fetched_at)) {
    throw new Error('historical_restoration_lineage_unverified');
  }

  const priorIdentity = conf.identity(canonicalId, priorFact);
  if (Object.entries(priorIdentity).some(([key, expected]) =>
    !Object.is(priorSnapshot[key] ?? null, expected ?? null))) {
    throw new Error('historical_restoration_identity_conflict');
  }
  if (!snapshotFactMatches(family, priorSnapshot, priorFact) ||
      !snapshotFactMatches(family, priorSnapshot, currentFact)) {
    throw new Error('historical_restoration_fact_conflict');
  }

  const identity = conf.identity(canonicalId, currentFact);
  const values = conf.values(currentFact);
  const direct = {
    id: conf.id(canonicalId, currentSource, currentFact),
    ...identity, observed_at: currentSource.fetched_at, ...values,
    source_record_id: currentSource.id, quality_status: QUALITY
  };
  const externalTable = family === 'person_stat'
    ? (currentFact.personType === 'driver' ? 'driver_external_ids' :
      currentFact.personType === 'trainer' ? 'trainer_external_ids' : null)
    : conf.externalTable;
  if (!externalTable) throw new Error('historical_restoration_person_type_invalid');

  return Object.freeze({
    family, table: conf.table, scopeKey: conf.scope(currentFact),
    externalTable, externalIdColumn: family === 'person_stat' ?
      (currentFact.personType === 'driver' ? 'driver_id' : 'trainer_id') : conf.idColumn,
    sourceId: currentSource.id, sourceHash: currentSource.content_hash,
    fetchedAt: currentSource.fetched_at, priorSourceId: priorSource.id,
    priorSourceHash: priorSource.content_hash,
    priorFetchedAt: priorSource.fetched_at, priorSnapshotId: priorSnapshot.id,
    canonicalId, externalId: String(currentFact.externalId),
    direct: Object.freeze(direct),
    factualColumns: Object.freeze({ ...conf.values(currentFact) }),
    entityKey: family === 'person_stat' ? currentFact.personType + ':' + canonicalId : canonicalId
  });
}

function nonempty(value) { return typeof value === 'string' && value.length > 0; }

// Only callable from an explicitly reviewed *future* recovery execution path.
// This module has deliberately no public Worker route or automatic scheduler.
export async function applyVerifiedHistoricalRestoration(env, candidate, {
  approved = false, authorization = null, runId = null, expectedEpoch = null
} = {}) {
  if (!approved || env?.HISTORICAL_REPAIR_ENABLED !== 'true' ||
      !nonempty(env?.HISTORICAL_REPAIR_TOKEN) ||
      env.HISTORICAL_REPAIR_TOKEN.length < 32 ||
      authorization !== env.HISTORICAL_REPAIR_TOKEN) {
    throw new Error('historical_restoration_not_authorized');
  }
  if (!candidate || !CONFIG[candidate.family] ||
      CONFIG[candidate.family].table !== candidate.table ||
      !nonempty(candidate.sourceId) || !nonempty(candidate.priorSourceId) ||
      !nonempty(candidate.priorSnapshotId) || !nonempty(candidate.canonicalId) ||
      !nonempty(candidate.externalId) || !nonempty(candidate.direct?.id) ||
      !/^[a-f0-9]{64}$/.test(String(candidate.sourceHash || '')) ||
      !/^[a-f0-9]{64}$/.test(String(candidate.priorSourceHash || ''))) {
    throw new Error('historical_restoration_invalid_candidate');
  }
  if (!env?.DB?.prepare || !env?.DB?.batch) throw new Error('historical_restoration_db_missing');

  const conf = CONFIG[candidate.family];
  const personType = candidate.direct.person_type;
  const canonicalExternalTable = candidate.family !== 'person_stat' ?
    conf.externalTable : personType === 'driver' ? 'driver_external_ids' :
      personType === 'trainer' ? 'trainer_external_ids' : null;
  const canonicalExternalColumn = candidate.family !== 'person_stat' ?
    conf.idColumn : personType === 'driver' ? 'driver_id' :
      personType === 'trainer' ? 'trainer_id' : null;
  if (!canonicalExternalTable || candidate.externalTable !== canonicalExternalTable ||
      candidate.externalIdColumn !== canonicalExternalColumn ||
      candidate.entityKey !== (candidate.family === 'person_stat'
        ? personType + ':' + candidate.canonicalId : candidate.canonicalId)) {
    throw new Error('historical_restoration_external_mapping_conflict');
  }
  const row = candidate.direct;
  // Ensure the proposal is exactly an official immutable source-owned row.
  if (row.source_record_id !== candidate.sourceId ||
      row.observed_at !== candidate.fetchedAt ||
      row.quality_status !== QUALITY ||
      row[conf.idColumn] !== candidate.canonicalId ||
      row.id !== conf.id(candidate.canonicalId, { id: candidate.sourceId }, {
        personType: row.person_type, snapshotScope: row.snapshot_scope,
        recordScope: row.record_scope, statYear: row.stat_year, ordinal: row.record_ordinal
      })) {
    throw new Error('historical_restoration_candidate_mutated');
  }
  const keys = Object.keys(row);
  const factKeys = Object.keys(candidate.factualColumns);
  const expectedFactKeys = Object.keys(conf.values({
    ageYears: row.age_years, snapshotScope: row.snapshot_scope,
    recordScope: row.record_scope, statYear: row.stat_year,
    ordinal: row.record_ordinal, code: row.code,
    startMethod: row.start_method, distanceGroup: row.distance_group,
    timeMinutes: row.time_minutes, timeSeconds: row.time_seconds,
    timeTenths: row.time_tenths, place: row.place,
    starts: row.starts, earningsRaw: row.earnings_raw, wins: row.wins,
    seconds: row.seconds, thirds: row.thirds,
    winPercentageRaw: row.win_percentage_raw,
    placePercentageRaw: row.place_percentage_raw,
    earningsPerStartRaw: row.earnings_per_start_raw,
    startPoints: row.start_points
  }));
  if (keys.some((key) => !/^[a-z_]+$/.test(key)) ||
      factKeys.length !== expectedFactKeys.length ||
      expectedFactKeys.some((key) => !Object.hasOwn(candidate.factualColumns, key)) ||
      factKeys.some((key) => !/^[a-z_]+$/.test(key) ||
        !Object.is(row[key] ?? null, candidate.factualColumns[key] ?? null))) {
    throw new Error('historical_restoration_candidate_mutated');
  }

  // Idempotent replay must also revalidate its source/identity lineage.
  // An equal-looking row is NOT reusable evidence if the older source,
  // current source or official canonical mapping has since changed.
  const existing = await env.DB.prepare(
    'SELECT * FROM ' + candidate.table + ' WHERE id=? LIMIT 1'
  ).bind(row.id).first();
  if (existing) {
    const isExact = Object.entries(row).every(([key, value]) =>
      Object.is(existing[key] ?? null, value ?? null));
    if (!isExact) throw new Error('historical_restoration_existing_snapshot_conflict');
    const priorRow = await env.DB.prepare(
      'SELECT * FROM ' + candidate.table + ' WHERE id=? LIMIT 1'
    ).bind(candidate.priorSnapshotId).first();
    const mappingRows = await env.DB.prepare(
      'SELECT ' + candidate.externalIdColumn + ' AS mapped FROM ' + candidate.externalTable +
      " WHERE source_type='official' AND external_id=? LIMIT 2"
    ).bind(candidate.externalId).all();
    const currentSource = await env.DB.prepare(
      'SELECT source_type,quality_status,content_hash,fetched_at FROM source_records WHERE id=?'
    ).bind(candidate.sourceId).first();
    const olderSource = await env.DB.prepare(
      'SELECT source_type,quality_status,content_hash,fetched_at FROM source_records WHERE id=?'
    ).bind(candidate.priorSourceId).first();
    const currentSync = await env.DB.prepare(
      'SELECT status FROM official_snapshot_source_sync WHERE source_record_id=?'
    ).bind(candidate.sourceId).first();
    const earlierSync = await env.DB.prepare(
      'SELECT status FROM official_snapshot_source_sync WHERE source_record_id=?'
    ).bind(candidate.priorSourceId).first();
    const priorIdentity = conf.identity(candidate.canonicalId, {
      personType: row.person_type, snapshotScope: row.snapshot_scope,
      recordScope: row.record_scope, statYear: row.stat_year, ordinal: row.record_ordinal
    });
    if (!priorRow || priorRow.source_record_id !== candidate.priorSourceId ||
        priorRow.quality_status !== QUALITY ||
        priorRow.observed_at !== candidate.priorFetchedAt ||
        Object.entries(priorIdentity).some(([k,v]) => !Object.is(priorRow[k] ?? null, v ?? null)) ||
        Object.entries(candidate.factualColumns).some(([k,v]) =>
          !Object.is(priorRow[k] ?? null, v ?? null)) ||
        mappingRows.results?.length !== 1 ||
        mappingRows.results[0].mapped !== candidate.canonicalId ||
        currentSync?.status !== 'complete' || earlierSync?.status !== 'complete' ||
        currentSource?.source_type !== SOURCE_TYPE ||
        olderSource?.source_type !== SOURCE_TYPE ||
        currentSource?.quality_status !== SOURCE_QUALITY ||
        olderSource?.quality_status !== SOURCE_QUALITY ||
        currentSource?.content_hash !== candidate.sourceHash ||
        olderSource?.content_hash !== candidate.priorSourceHash ||
        currentSource?.fetched_at !== candidate.fetchedAt ||
        olderSource?.fetched_at !== candidate.priorFetchedAt) {
      throw new Error('historical_restoration_replay_lineage_conflict');
    }
    return { restored: 0, reused: 1, snapshotsDeleted: 0,
      unchangedFactsOverwritten: 0, oldAuditInvalidated: false };
  }

  const priorChecks = Object.entries(candidate.factualColumns)
    .map(([column]) => 'prior.' + column + ' IS ?').join(' AND ');
  const identityChecks = Object.keys(conf.identity(candidate.canonicalId, {
    personType: row.person_type, snapshotScope: row.snapshot_scope,
    recordScope: row.record_scope, statYear: row.stat_year, ordinal: row.record_ordinal
  })).map((column) => 'prior.' + column + ' IS ?').join(' AND ');
  const identityValues = Object.values(conf.identity(candidate.canonicalId, {
    personType: row.person_type, snapshotScope: row.snapshot_scope,
    recordScope: row.record_scope, statYear: row.stat_year, ordinal: row.record_ordinal
  }));
  const existingScope = Object.keys(conf.identity(candidate.canonicalId, {
    personType: row.person_type, snapshotScope: row.snapshot_scope,
    recordScope: row.record_scope, statYear: row.stat_year, ordinal: row.record_ordinal
  })).map((column) => 'existing.' + column + ' IS ?').join(' AND ');
  const identKinds = Object.keys(conf.identity(candidate.canonicalId, {
    personType: row.person_type, snapshotScope: row.snapshot_scope,
    recordScope: row.record_scope, statYear: row.stat_year, ordinal: row.record_ordinal
  }));
  const currentValues = identKinds.map(k => row[k]);
  const journalled = runId !== null;
  if (journalled && (!nonempty(runId) || !Number.isSafeInteger(expectedEpoch) ||
      expectedEpoch < 0)) throw new Error('historical_restoration_journal_invalid');
  const query = [
    'INSERT INTO ' + candidate.table + ' (' + keys.join(',') + ')',
    'SELECT ' + keys.map(() => '?').join(','),
    'FROM source_records current',
    ...(journalled ? [
      'JOIN historical_recovery_runs recovery ON recovery.id=?',
      "AND recovery.phase='applying' AND recovery.expected_epoch=?",
      'JOIN historical_recovery_epoch rev ON rev.singleton=1 AND rev.revision=recovery.expected_epoch',
      'JOIN historical_recovery_receipts receipt ON receipt.run_id=recovery.id',
      "AND receipt.status='ready' AND receipt.family=? AND receipt.source_record_id=current.id"
    ] : []),
    'JOIN official_snapshot_source_sync sync ON sync.source_record_id=current.id AND sync.status=?',
    'JOIN source_records older ON older.id=? AND older.source_type=? AND older.quality_status=?',
    'JOIN official_snapshot_source_sync earlier_sync ON earlier_sync.source_record_id=older.id AND earlier_sync.status=?',
    'JOIN ' + candidate.table + ' prior ON prior.id=? AND prior.source_record_id=older.id',
    'WHERE current.id=? AND current.source_type=? AND current.quality_status=?',
    'AND current.content_hash=? AND current.fetched_at=?',
    'AND older.content_hash=? AND older.fetched_at=?',
    'AND prior.observed_at=older.fetched_at AND prior.quality_status=?',
    'AND ' + priorChecks, 'AND ' + identityChecks,
    'AND (SELECT COUNT(*) FROM ' + candidate.externalTable +
      ' WHERE source_type=? AND external_id=?)=1',
    'AND EXISTS (SELECT 1 FROM ' + candidate.externalTable +
      ' WHERE source_type=? AND external_id=? AND ' + candidate.externalIdColumn + '=?)',
    'AND NOT EXISTS (SELECT 1 FROM official_snapshot_observations o',
    'WHERE o.source_record_id=current.id AND o.snapshot_family=? AND o.entity_key=? AND o.scope_key=?)',
    'AND NOT EXISTS (SELECT 1 FROM ' + candidate.table + ' existing',
    'WHERE existing.source_record_id=current.id AND ' + existingScope + ')'
  ].join(' ');
  const bindings = [
    ...Object.values(row), ...(journalled ? [runId,expectedEpoch,candidate.family] : []),
    'complete', candidate.priorSourceId, SOURCE_TYPE, SOURCE_QUALITY, 'complete',
    candidate.priorSnapshotId, candidate.sourceId, SOURCE_TYPE, SOURCE_QUALITY,
    candidate.sourceHash, candidate.fetchedAt, candidate.priorSourceHash, candidate.priorFetchedAt,
    QUALITY, ...Object.values(candidate.factualColumns), ...identityValues,
    'official', candidate.externalId, 'official', candidate.externalId, candidate.canonicalId,
    candidate.family, candidate.entityKey, candidate.scopeKey, ...currentValues
  ];
  if (bindings.length > 100) throw new Error('historical_restoration_bind_budget');

  // D1 batch is one transaction. No DELETE, UPDATE of snapshots, replacement,
  // or source-count mutation. The dataset revision fence invalidates old audit
  // evidence after successful inserts. A failed guard yields zero insertions.
  const statements = [env.DB.prepare(query).bind(...bindings)];
  if (journalled) {
    statements.push(env.DB.prepare(
      'UPDATE historical_recovery_runs SET expected_epoch=expected_epoch+1,' +
      'restored_count=restored_count+1,updated_at=CURRENT_TIMESTAMP' +
      " WHERE id=? AND phase='applying' AND expected_epoch=?" +
      ' AND (SELECT revision FROM historical_recovery_epoch WHERE singleton=1)=?' +
      ' AND changes()=1'
    ).bind(runId, expectedEpoch, expectedEpoch + 1));
    statements.push(env.DB.prepare(
      'UPDATE historical_recovery_receipts SET restored_count=restored_count+1,' +
      'updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND family=?' +
      " AND source_record_id=? AND status='ready' AND changes()=1"
    ).bind(runId, candidate.family, candidate.sourceId));
  }
  statements.push(env.DB.prepare(
    'UPDATE storage_cleanup_dataset_revision SET revision=revision+1,' +
    'updated_at=CURRENT_TIMESTAMP WHERE singleton=1 AND changes()=1'
  ));
  const results = await env.DB.batch(statements);
  const inserted = Number(results?.[0]?.meta?.changes ?? -1);
  if (inserted !== 1 || results.slice(1).some((part) =>
    Number(part?.meta?.changes ?? -1) !== 1)) {
    throw new Error('historical_restoration_guard_failed');
  }
  return { restored: 1, unchangedFactsOverwritten: 0, snapshotsDeleted: 0,
    oldAuditInvalidated: true };
}
