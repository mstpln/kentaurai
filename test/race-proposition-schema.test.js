import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestEnv } from './helpers/d1.js';

function seedBase(db) {
  db.prepare("INSERT INTO tracks (id, canonical_name) VALUES ('track-a','Synthetic Track')").run();
  db.prepare("INSERT INTO races (id, track_id, race_date, race_number) VALUES ('race-a','track-a','2026-09-14',1)").run();
  db.prepare("INSERT INTO source_records (id, source_type, external_id, fetched_at, quality_status) VALUES ('source-a','official_provider','race:race-a','2026-09-14T10:00:00Z','normalized_verified_subset')").run();
  db.prepare("INSERT INTO normalized_observations (id, entity_type, entity_id, source_record_id, observed_at, fields_json, quality_status) VALUES ('obs-a','race','race-a','source-a','2026-09-14T10:00:00Z','{\"terms\":[]}','normalized_verified_subset')").run();
}

function insertSql(parseStatus = 'parsed', rawJson = '[]') {
  return `INSERT INTO race_proposition_facts
    (id, race_id, source_observation_id, source_record_id, observed_at, parser_version, parse_status,
     raw_terms_json, facts_json, matched_patterns_json, unparsed_fragments_json, ambiguous_fragments_json)
    VALUES ('fact-a','race-a','obs-a','source-a','2026-09-14T10:00:00Z','test-v1','${parseStatus}',
      '${rawJson}','{}','[]','[]','[]')`;
}

test('B1 schema rejects unsupported parse status', () => {
  const { db } = createTestEnv();
  seedBase(db);
  assert.throws(() => db.exec(insertSql('guessed')), /CHECK constraint failed/);
});

test('B1 schema rejects malformed JSON audit payloads', () => {
  const { db } = createTestEnv();
  seedBase(db);
  assert.throws(() => db.exec(insertSql('parsed', 'not-json')), /malformed JSON|CHECK constraint failed/);
});
