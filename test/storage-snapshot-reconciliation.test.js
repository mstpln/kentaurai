import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileSnapshotFacts, snapshotFactMatches } from '../src/storage-snapshot-reconciliation.js';

const fetched_at = '2026-09-12T12:00:00Z';
function inspect({ facts = new Map([['synthetic:1', { externalId: '123', ageYears: 4 }]]),
  identities = new Map([['123', ['horse-1']]]), direct = [], observations = [],
  referencedSnapshots = [], chronology = [], historicalIdentityVerified = false, chronologyVerified = false, family = 'horse_profile' } = {}) {
  return reconcileSnapshotFacts({ family, source: { id: 'source-1', fetched_at },
    facts, identities, direct, observations, referencedSnapshots, chronology, historicalIdentityVerified, chronologyVerified });
}
function status(result) {
  return Object.entries(result.classifications).filter(([, count]) => count).map(([name]) => name);
}
const representation = {
  id: 'snap-1', source_record_id: 'source-1', entity_key: 'horse-1', scope_key: 'profile',
  observed_at: fetched_at, age_years: 4
};

test('source-owned direct row with matching time and actual facts is represented', () => {
  assert.deepEqual(status(inspect({ direct: [representation] })), ['represented']);
});
test('older matching change-point linked by a same-source observation is represented', () => {
  const earlier = { ...representation, id: 'prior-1', source_record_id: 'source-0',
    observed_at: '2026-09-10T12:00:00Z' };
  const observation = { source_record_id: 'source-1', entity_key: 'horse-1',
    scope_key: 'profile', snapshot_family: 'horse_profile', snapshot_id: earlier.id,
    observed_at: fetched_at };
  assert.deepEqual(status(inspect({ observations: [observation],
    referencedSnapshots: [earlier] })), ['represented']);
});
test('wrong factual columns, timestamps or dangling observation are conflicts', () => {
  assert.deepEqual(status(inspect({ direct: [{ ...representation, age_years: 8 }] })), ['conflict']);
  assert.deepEqual(status(inspect({ direct: [{ ...representation, observed_at: '2026-09-10T00:00:00Z' }] })), ['conflict']);
  assert.deepEqual(status(inspect({ observations: [{
    source_record_id: 'source-1', entity_key: 'horse-1', scope_key: 'profile',
    snapshot_family: 'horse_profile', snapshot_id: 'missing',
    observed_at: fetched_at
  }] })), ['conflict']);
});
test('unknown historical identity is never treated as a repair authorization', () => {
  assert.deepEqual(status(inspect({ identities: new Map() })), ['missing_identity']);
  assert.deepEqual(status(inspect({ identities: new Map([['123', ['horse-1', 'horse-2']]]) })), ['identity_ambiguous']);
  assert.deepEqual(status(inspect()), ['missing_unverified_chronology']);
});
test('even a verified identity with later chronological evidence requires manual evaluation', () => {
  assert.deepEqual(status(inspect({ historicalIdentityVerified: true, chronologyVerified: true,
    chronology: [{ entity_key: 'horse-1', scope_key: 'profile',
      observed_at: '2026-09-14T00:00:00Z' }] })), ['missing_unverified_chronology']);
  const candidate = inspect({ historicalIdentityVerified: true, chronologyVerified: true });
  assert.deepEqual(status(candidate), ['missing_candidate']);
  assert.equal(candidate.repairAuthorized, false);
});
test('scope-specific factual comparison preserves nullable fields', () => {
  const facts = new Map([['a', {
    externalId: '123', snapshotScope: 'life', statYear: null,
    starts: 10, earningsRaw: null, wins: 2, seconds: null,
    thirds: null, winPercentageRaw: null, placePercentageRaw: null,
    earningsPerStartRaw: null, startPoints: null
  }]]);
  const direct = [{
    source_record_id: 'source-1', entity_key: 'horse-1', scope_key: 'life',
    observed_at: fetched_at, stat_year: null, starts: 10, earnings_raw: null, wins: 2,
    seconds: null, thirds: null, win_percentage_raw: null,
    place_percentage_raw: null, earnings_per_start_raw: null, start_points: null
  }];
  assert.deepEqual(status(inspect({ facts, direct, family: 'horse_stat' })), ['represented']);
});
test('source fact count caps and malformed evidence fail closed', () => {
  assert.throws(() => inspect({ facts: new Map(Array.from({ length: 513 },
    (_, i) => [String(i), { externalId: String(i), ageYears: 4 }])) }), /reconciliation_budget_exceeded/);
  assert.throws(() => inspect({ family: 'unknown' }), /reconciliation_invalid_family_or_facts/);
  assert.throws(() => reconcileSnapshotFacts({ family: 'horse_profile',
    source: { id: 'source-1', fetched_at: 'not-a-date' }, facts: new Map(),
    identities: new Map() }), /reconciliation_invalid_input/);
});
test('aggregate-only report never includes original source identifiers or factual contents', () => {
  const report = inspect({ historicalIdentityVerified: true, chronologyVerified: true });
  const serial = JSON.stringify(report);
  for (const privateText of ['source-1','horse-1','123','synthetic:1','ageYears']) {
    assert.equal(serial.includes(privateText), false);
  }
  assert.equal(report.classificationsComplete, true);
  assert.equal(report.expectedFacts, 1);
});

test('unknown completeness of earlier/later timeline blocks candidate classification', () => {
  assert.deepEqual(status(inspect({ historicalIdentityVerified: true })), ['missing_unverified_chronology']);
});


test('private status callback does not change public classification or return facts', () => {
  const observed = [];
  const base = inspect();
  const result = reconcileSnapshotFacts({
    family:'horse_profile',
    source:{ id:'source-1', fetched_at },
    facts:new Map([['a',{ externalId:'123', ageYears:4 }]]),
    identities:new Map([['123',['horse-1']]]),
    onFactClassified:({status,mapped,fact})=>observed.push({status,mapped,fact})
  });
  assert.deepEqual(result,base);
  assert.equal(observed[0].status,'missing_unverified_chronology');
  assert.equal(observed[0].fact.ageYears,4);
  assert.equal(JSON.stringify(result).includes('horse-1'),false);
  assert.throws(() => reconcileSnapshotFacts({
    family:'horse_profile',source:{id:'source-1',fetched_at},
    facts:new Map(),identities:new Map(),onFactClassified:true
  }), /reconciliation_invalid_callback/);
});

test('predecessor comparison is exact and rejects a missing projection', () => {
  assert.equal(snapshotFactMatches('horse_profile',{age_years:5},{ageYears:5}),true);
  assert.equal(snapshotFactMatches('horse_profile',{age_years:7},{ageYears:5}),false);
  assert.throws(() => snapshotFactMatches('horse_profile',{}, {ageYears:null}),
    /reconciliation_incomplete_projection/);
});
