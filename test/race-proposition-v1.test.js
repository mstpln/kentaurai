import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';
import {
  RACE_PROPOSITION_PARSER_VERSION,
  getRacePropositionsAsOf,
  parseRacePropositionTerms,
  storeRacePropositionFromObservation
} from '../src/race-proposition-v1.js';

function seedRaceObservation(db, { id, raceId = 'race-a', fetchedAt, terms }) {
  db.prepare("INSERT OR IGNORE INTO tracks (id, canonical_name) VALUES ('track-a','Synthetic Track')").run();
  db.prepare("INSERT OR IGNORE INTO races (id, track_id, race_date, race_number) VALUES (?, 'track-a', '2026-09-14', 1)").run(raceId);
  db.prepare("INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status) VALUES (?, 'official_provider', ?, ?, 'normalized_verified_subset')")
    .run(`source-${id}`, `race:${raceId}`, fetchedAt);
  db.prepare("INSERT INTO normalized_observations (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status) VALUES (?, 'race', ?, ?, ?, ?, 'normalized_verified_subset')")
    .run(id, raceId, `source-${id}`, fetchedAt, JSON.stringify({ terms }));
}

test('B1 Swedish allowlist extracts exact structured proposition facts', () => {
  const parsed = parseRacePropositionTerms([
    '3-5-åriga ston, högst 500.000 kr',
    'Spårtrappa',
    'Försök till final',
    'Amatörlopp',
    'Lärlingslopp',
    'Unghästlopp',
    '20 m tillägg'
  ]);
  assert.equal(parsed.parserVersion, RACE_PROPOSITION_PARSER_VERSION);
  assert.equal(parsed.parseStatus, 'parsed');
  assert.deepEqual(parsed.facts, {
    age_min_years: 3,
    age_max_years: 5,
    sex_restriction: 'mares_only',
    earnings_min_sek: null,
    earnings_max_sek: 500000,
    is_final: true,
    is_qualifier: true,
    is_heat: null,
    heat_number: null,
    is_lane_ladder: true,
    is_amateur: true,
    is_apprentice: true,
    is_young_horse: true,
    has_handicap_condition: true,
    handicap_step_m: 20
  });
  assert.deepEqual(parsed.unparsedFragments, []);
  assert.deepEqual(parsed.ambiguousFragments, []);
});

test('B1 Norwegian allowlist is conservative but supports verified generic forms', () => {
  const parsed = parseRacePropositionTerms([
    '4-årige og eldre hingster og vallaker',
    'maks 750 000 kr',
    'sportrapp',
    'amatørløp',
    'lærlingløp',
    'unghestløp',
    'forsøk heat 2',
    'tillegg 20 m'
  ]);
  assert.equal(parsed.parseStatus, 'parsed');
  assert.equal(parsed.facts.age_min_years, 4);
  assert.equal(parsed.facts.age_max_years, null);
  assert.equal(parsed.facts.sex_restriction, 'stallions_and_geldings');
  assert.equal(parsed.facts.earnings_max_sek, 750000);
  assert.equal(parsed.facts.is_lane_ladder, true);
  assert.equal(parsed.facts.is_heat, true);
  assert.equal(parsed.facts.heat_number, 2);
  assert.equal(parsed.facts.has_handicap_condition, true);
});

test('B1 unknown wording stays visible and does not become a guessed fact', () => {
  const parsed = parseRacePropositionTerms(['Specialvillkor enligt proposition']);
  assert.equal(parsed.parseStatus, 'unparsed');
  assert.deepEqual(parsed.unparsedFragments, ['Specialvillkor enligt proposition']);
  assert.ok(Object.values(parsed.facts).every((value) => value == null));
});

test('B1 negated supported wording fails closed', () => {
  const parsed = parseRacePropositionTerms(['Ej amatörlopp']);
  assert.equal(parsed.parseStatus, 'ambiguous');
  assert.equal(parsed.facts.is_amateur, null);
  assert.deepEqual(parsed.ambiguousFragments, ['Ej amatörlopp']);
});

test('B1 conflicting supported facts fail closed for the affected field', () => {
  const parsed = parseRacePropositionTerms(['3-åriga', '4-åriga']);
  assert.equal(parsed.parseStatus, 'ambiguous');
  assert.equal(parsed.facts.age_min_years, null);
  assert.equal(parsed.facts.age_max_years, null);
  assert.match(parsed.ambiguousFragments.at(-1), /age_max_years|age_min_years/);
});

test('B1 stored parser replay is idempotent and retains raw/source provenance', async () => {
  const { db, env } = createTestEnv();
  seedRaceObservation(db, { id: 'obs-old', fetchedAt: '2026-09-10T10:00:00Z', terms: ['3-åriga ston', 'Spårtrappa'] });
  const first = await storeRacePropositionFromObservation(env, 'obs-old');
  const second = await storeRacePropositionFromObservation(env, 'obs-old');
  assert.equal(first.inserted, true);
  assert.equal(second.inserted, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM race_proposition_facts').get().n, 1);
  const row = db.prepare('SELECT * FROM race_proposition_facts').get();
  assert.equal(row.source_observation_id, 'obs-old');
  assert.equal(row.source_record_id, 'source-obs-old');
  assert.deepEqual(JSON.parse(row.raw_terms_json), ['3-åriga ston', 'Spårtrappa']);
});

test('B1 as-of read excludes future proposition observations', async () => {
  const { db, env } = createTestEnv();
  seedRaceObservation(db, { id: 'obs-old', fetchedAt: '2026-09-10T10:00:00Z', terms: ['3-åriga ston'] });
  seedRaceObservation(db, { id: 'obs-new', fetchedAt: '2026-09-12T10:00:00Z', terms: ['4-åriga ston'] });
  await storeRacePropositionFromObservation(env, 'obs-old');
  await storeRacePropositionFromObservation(env, 'obs-new');

  let rows = await getRacePropositionsAsOf(env, ['race-a'], '2026-09-11T00:00:00Z');
  assert.equal(rows.get('race-a').facts.age_min_years, 3);
  assert.equal(rows.get('race-a').sourceObservationId, 'obs-old');

  rows = await getRacePropositionsAsOf(env, ['race-a'], '2026-09-13T00:00:00Z');
  assert.equal(rows.get('race-a').facts.age_min_years, 4);
  assert.equal(rows.get('race-a').sourceObservationId, 'obs-new');
});
