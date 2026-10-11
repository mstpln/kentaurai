import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTestEnv } from './helpers/d1.js';
import { stableId } from '../src/ids.js';
import { collectOfficialSnapshotFacts, syncOfficialSnapshotsFromSource } from '../src/import/official-snapshots.js';
import {
  buildVerifiedHistoricalRestoration, applyVerifiedHistoricalRestoration
} from '../src/storage-historical-provenance-restoration.js';

const PAST = '2026-09-25T10:00:00Z';
const LATER = '2026-09-26T10:00:00Z';
const FAMILIES = [
  ['horse_profile', 'horseProfiles', 'horse_profile_snapshots', 'horse_profile_count', 'h100'],
  ['horse_stat', 'horseStats', 'horse_stat_snapshots', 'horse_stat_count', 'h100'],
  ['horse_record', 'horseRecords', 'horse_record_snapshots', 'horse_record_count', 'h100'],
  ['person_stat', 'personStats', 'person_stat_snapshots', 'person_stat_count', 'd501']
];
const FACTUAL = {
  horse_profile: (fact) => ({ age_years: fact.ageYears }),
  horse_stat: (fact) => ({
    snapshot_scope: fact.snapshotScope, stat_year: fact.statYear, starts: fact.starts,
    earnings_raw: fact.earningsRaw, wins: fact.wins, seconds: fact.seconds,
    thirds: fact.thirds, win_percentage_raw: fact.winPercentageRaw,
    place_percentage_raw: fact.placePercentageRaw,
    earnings_per_start_raw: fact.earningsPerStartRaw, start_points: fact.startPoints
  }),
  horse_record: (fact) => ({
    record_scope: fact.recordScope, stat_year: fact.statYear,
    record_ordinal: fact.ordinal, code: fact.code, start_method: fact.startMethod,
    distance_group: fact.distanceGroup, time_minutes: fact.timeMinutes,
    time_seconds: fact.timeSeconds, time_tenths: fact.timeTenths, place: fact.place
  }),
  person_stat: (fact) => ({
    person_type: fact.personType, stat_year: fact.statYear, starts: fact.starts,
    earnings_raw: fact.earningsRaw, wins: fact.wins,
    seconds: fact.seconds, thirds: fact.thirds,
    win_percentage_raw: fact.winPercentageRaw
  })
};

function payload() {
  return { races: [{ starts: [{
    horse: { id: 100, age: 4, record: { code: 'aM' },
      statistics: { life: { starts: 10 } } },
    driver: { id: 501, statistics: { years: { '2026': { starts: 12 } } } }
  }] }] };
}

async function source(f, id, fetchedAt) {
  const body = JSON.stringify(payload());
  const hash = createHash('sha256').update(body).digest('hex');
  const key = 'raw/official_provider/' + hash + '.json';
  f.db.prepare(
    'INSERT INTO source_records(id,source_type,fetched_at,raw_object_key,content_hash,quality_status)' +
    " VALUES (?,'official_provider',?,?,?,'normalized_verified_subset')"
  ).run(id, fetchedAt, key, hash);
  await f.env.RAW_BUCKET.put(key, body, {
    customMetadata: { contentHash: hash, sourceType: 'official_provider' }
  });
  const raw = await f.env.RAW_BUCKET.get(key);
  const readBack = await raw.text();
  assert.equal(createHash('sha256').update(readBack).digest('hex'), hash);
  return { id, fetched_at: fetchedAt, content_hash: hash,
    source_type: 'official_provider', quality_status: 'normalized_verified_subset',
    facts: collectOfficialSnapshotFacts(JSON.parse(readBack)) };
}

function insertSnapshot(db, table, row) {
  const cols = Object.keys(row);
  db.prepare('INSERT INTO ' + table + ' (' + cols.join(',') +
    ') VALUES (' + cols.map(() => '?').join(',') + ')').run(...Object.values(row));
}

async function setup(family) {
  const f = createTestEnv();
  f.db.prepare('INSERT INTO horses(id,canonical_name) VALUES (?,?)').run('h100', 'Synthetic Horse');
  f.db.prepare('INSERT INTO drivers(id,canonical_name) VALUES (?,?)').run('d501', 'Synthetic Driver');
  f.db.prepare(
    "INSERT INTO horse_external_ids(horse_id,source_type,external_id) VALUES ('h100','official','100')"
  ).run();
  f.db.prepare(
    "INSERT INTO driver_external_ids(driver_id,source_type,external_id) VALUES ('d501','official','501')"
  ).run();

  const descriptor = FAMILIES.find(([name]) => name === family);
  const [, collection, table, countColumn, canonical] = descriptor;
  const earlier = await source(f, 'source-older', PAST);
  const current = await source(f, 'source-later', LATER);
  const previousFact = [...earlier.facts[collection].values()][0];
  const currentFact = [...current.facts[collection].values()][0];
  assert.ok(previousFact && currentFact);
  for (const input of [earlier, current]) {
    f.db.prepare(
      'INSERT INTO official_snapshot_source_sync(source_record_id,status,processed_at,' +
      countColumn + ") VALUES (?,'complete',?,1)"
    ).run(input.id, '2026-09-28T10:00:00Z');
  }
  const identity = family === 'person_stat'
    ? { person_type: 'driver', person_id: canonical } : { horse_id: canonical };
  const older = {
    id: 'synthetic-prior-' + family, ...identity, observed_at: earlier.fetched_at,
    ...FACTUAL[family](previousFact), source_record_id: earlier.id,
    quality_status: 'verified_official_snapshot'
  };
  const newRow = {
    id: 'synthetic-doomed-' + family, ...identity, observed_at: current.fetched_at,
    ...FACTUAL[family](currentFact), source_record_id: current.id,
    quality_status: 'verified_official_snapshot'
  };
  insertSnapshot(f.db, table, older);
  insertSnapshot(f.db, table, newRow);
  const proposal = () => buildVerifiedHistoricalRestoration({
    family, currentSource: current, priorSource: earlier,
    currentFact, priorFact: previousFact,
    priorSnapshot: older, canonicalId: canonical,
    currentOriginalVerified: true, priorOriginalVerified: true
  });
  return { ...f, table, older, newer: newRow, previousFact,
    currentFact, earlier, current, proposal };
}

function legacyBrokenCleanup(f, family) {
  // This exactly reproduces the Sept 27 executor: UPDATE previously created
  // observations, but DO NOT INSERT a new source observation before deletion.
  const updated = f.db.prepare(
    'UPDATE official_snapshot_observations SET snapshot_id=? ' +
    'WHERE snapshot_family=? AND snapshot_id=?'
  ).run(f.older.id, family, f.newer.id);
  assert.equal(Number(updated.changes), 0);
  const removed = f.db.prepare(
    'DELETE FROM ' + f.table + ' WHERE id=? AND NOT EXISTS (' +
    'SELECT 1 FROM official_snapshot_observations o ' +
    'WHERE o.snapshot_family=? AND o.snapshot_id=?)'
  ).run(f.newer.id, family, f.newer.id);
  assert.equal(Number(removed.changes), 1);
}

test('legacy 2026-09-27 cleanup loses later source representation in all four snapshot families', async () => {
  for (const [family] of FAMILIES) {
    const f = await setup(family);
    legacyBrokenCleanup(f, family);
    const sourceCount = f.db.prepare(
      'SELECT COUNT(*) AS n FROM ' + f.table + ' WHERE source_record_id=?'
    ).get(f.current.id).n;
    const observations = f.db.prepare(
      'SELECT COUNT(*) AS n FROM official_snapshot_observations WHERE source_record_id=? AND snapshot_family=?'
    ).get(f.current.id, family).n;
    assert.equal(sourceCount, 0);
    assert.equal(observations, 0);
    await assert.rejects(
      () => syncOfficialSnapshotsFromSource(f.env, f.current.id),
      /official snapshot source representation count mismatch/
    );
  }
});

test('selective restorer recreates exact source-owned facts across four families without overwrites', async () => {
  for (const [family] of FAMILIES) {
    const f = await setup(family);
    legacyBrokenCleanup(f, family);
    const proposal = f.proposal();
    assert.equal(proposal.sourceId, f.current.id);
    assert.equal(proposal.priorSourceId, f.earlier.id);
    assert.equal(proposal.direct.source_record_id, f.current.id);
    assert.equal(proposal.direct.observed_at, LATER);

    await assert.rejects(
      () => applyVerifiedHistoricalRestoration(f.env, proposal),
      /historical_restoration_not_authorized/
    );
    assert.equal(f.db.prepare(
      'SELECT COUNT(*) AS n FROM ' + f.table + ' WHERE source_record_id=?'
    ).get(f.current.id).n, 0);

    f.env.HISTORICAL_REPAIR_ENABLED = 'true';
    f.env.HISTORICAL_REPAIR_TOKEN = 'synthetic_recovery_token_with_at_least_32_chars';
    const revisionBefore = f.db.prepare(
      'SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1'
    ).get().revision;
    const result = await applyVerifiedHistoricalRestoration(f.env, proposal, {
      approved: true, authorization: f.env.HISTORICAL_REPAIR_TOKEN
    });
    assert.equal(result.restored, 1);
    assert.equal(result.snapshotsDeleted, 0);
    assert.equal(result.unchangedFactsOverwritten, 0);
    const recovered = f.db.prepare('SELECT * FROM ' + f.table + ' WHERE id=?')
      .get(proposal.direct.id);
    assert.ok(recovered);
    for (const [key, value] of Object.entries(proposal.direct)) {
      assert.deepEqual(recovered[key] ?? null, value ?? null, family + '.' + key);
    }
    assert.ok(f.db.prepare('SELECT * FROM ' + f.table + ' WHERE id=?').get(f.older.id));
    const revisionAfter = f.db.prepare(
      'SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1'
    ).get().revision;
    assert.equal(revisionAfter, revisionBefore + 1);

    const reuse = await applyVerifiedHistoricalRestoration(f.env, proposal, {
      approved: true, authorization: f.env.HISTORICAL_REPAIR_TOKEN
    });
    assert.equal(reuse.restored, 0);
    assert.equal(reuse.reused, 1);
    assert.equal(f.db.prepare('SELECT revision FROM storage_cleanup_dataset_revision WHERE singleton=1')
      .get().revision, revisionAfter);
    assert.deepEqual(
      await syncOfficialSnapshotsFromSource(f.env, f.current.id),
      { sourceRecordId: f.current.id, status: 'complete', reused: true }
    );
  }
});

test('rejects unverified current or older originals, mismatched native IDs and altered facts', async () => {
  const f = await setup('horse_profile');
  assert.throws(() => buildVerifiedHistoricalRestoration({
    family:'horse_profile', currentSource:f.current, priorSource:f.earlier,
    currentFact:f.currentFact, priorFact:f.previousFact,
    priorSnapshot:f.older, canonicalId:'h100', priorOriginalVerified:true
  }), /historical_restoration_lineage_unverified/);
  assert.throws(() => buildVerifiedHistoricalRestoration({
    family:'horse_profile', currentSource:f.current, priorSource:f.earlier,
    currentFact:f.currentFact, priorFact:{ ...f.previousFact, externalId:'999' },
    priorSnapshot:f.older, canonicalId:'h100',
    currentOriginalVerified:true, priorOriginalVerified:true
  }), /historical_restoration_lineage_unverified/);
  assert.throws(() => buildVerifiedHistoricalRestoration({
    family:'horse_profile', currentSource:f.current, priorSource:f.earlier,
    currentFact:{ ...f.currentFact, ageYears:8 }, priorFact:f.previousFact,
    priorSnapshot:f.older, canonicalId:'h100',
    currentOriginalVerified:true, priorOriginalVerified:true
  }), /historical_restoration_fact_conflict/);
  assert.throws(() => buildVerifiedHistoricalRestoration({
    family:'horse_profile', currentSource:f.current, priorSource:f.earlier,
    currentFact:f.currentFact, priorFact:f.previousFact,
    priorSnapshot:f.older, canonicalId:'h-other',
    currentOriginalVerified:true, priorOriginalVerified:true
  }), /historical_restoration_identity_conflict/);
});

test('restoration fails closed when earlier source metadata or mapping changes', async () => {
  const f = await setup('horse_profile');
  legacyBrokenCleanup(f, 'horse_profile');
  const proposal = f.proposal();
  f.env.HISTORICAL_REPAIR_ENABLED = 'true';
  f.env.HISTORICAL_REPAIR_TOKEN = 'synthetic_recovery_token_with_at_least_32_chars';
  f.db.prepare(
    "UPDATE source_records SET content_hash=? WHERE id='source-older'"
  ).run('f'.repeat(64));
  await assert.rejects(() => applyVerifiedHistoricalRestoration(f.env, proposal, {
    approved:true, authorization:f.env.HISTORICAL_REPAIR_TOKEN
  }), /historical_restoration_guard_failed/);
  assert.equal(f.db.prepare(
    'SELECT COUNT(*) AS n FROM horse_profile_snapshots WHERE source_record_id=?'
  ).get(f.current.id).n, 0);
});

test('direct snapshot restoration cannot run without a separately enabled secret', async () => {
  const f = await setup('horse_record');
  legacyBrokenCleanup(f, 'horse_record');
  const proposal = f.proposal();
  f.env.HISTORICAL_REPAIR_ENABLED = 'true';
  f.env.HISTORICAL_REPAIR_TOKEN = 'synthetic_recovery_token_with_at_least_32_chars';
  for (const [approval,token] of [[false, f.env.HISTORICAL_REPAIR_TOKEN],[true,'wrong'],[true,null]]) {
    await assert.rejects(
      () => applyVerifiedHistoricalRestoration(f.env, proposal, {
        approved:approval, authorization:token
      }), /historical_restoration_not_authorized/
    );
  }
});


test('guarded restorer rejects altered dynamic SQL identifiers or fact projection', async () => {
  const f = await setup('horse_stat');
  legacyBrokenCleanup(f, 'horse_stat');
  f.env.HISTORICAL_REPAIR_ENABLED = 'true';
  f.env.HISTORICAL_REPAIR_TOKEN = 'synthetic_recovery_token_with_at_least_32_chars';
  const original = f.proposal();
  const apply = (candidate) => applyVerifiedHistoricalRestoration(f.env, candidate, {
    approved: true, authorization: f.env.HISTORICAL_REPAIR_TOKEN
  });
  await assert.rejects(
    () => apply({ ...original, externalTable: 'horse_external_ids WHERE 1=1--' }),
    /historical_restoration_external_mapping_conflict/
  );
  await assert.rejects(
    () => apply({ ...original, externalIdColumn: 'driver_id' }),
    /historical_restoration_external_mapping_conflict/
  );
  await assert.rejects(
    () => apply({ ...original, factualColumns: { starts: 10 } }),
    /historical_restoration_candidate_mutated/
  );
  await assert.rejects(
    () => apply({ ...original, factualColumns: {
      ...original.factualColumns, 'starts OR 1=1': 10
    } }),
    /historical_restoration_candidate_mutated/
  );
  assert.equal(f.db.prepare(
    'SELECT COUNT(*) AS n FROM horse_stat_snapshots WHERE source_record_id=?'
  ).get(f.current.id).n, 0);
  assert.equal(f.d1Metrics.batches, 0);
});
