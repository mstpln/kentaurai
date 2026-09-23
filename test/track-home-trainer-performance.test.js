import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routeSource = readFileSync(new URL('../src/routes/tracks.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/0036_trainer_home_track_lookup.sql', import.meta.url), 'utf8');

test('home-trainer lookup narrows candidates before ranking latest observations', () => {
  assert.match(routeSource, /candidate_trainers AS MATERIALIZED/);
  assert.match(routeSource, /JOIN candidate_trainers c/);
  assert.match(routeSource, /INDEXED BY idx_normalized_observations_entity/);
  assert.match(routeSource, /COUNT\(\*\) OVER\(\) AS total_count/);
});

test('home-trainer first page avoids a duplicate count query', () => {
  assert.match(routeSource, /if \(!results\?\.length && offset > 0\)/);
  const fn = routeSource.slice(
    routeSource.indexOf('export async function getTrackHomeTrainers'),
    routeSource.indexOf('export async function getTrackLaneStats')
  );
  assert.equal((fn.match(/countHomeTrainers\(/g) || []).length, 1);
});

test('trainer home-track JSON lookup has a dedicated partial expression index', () => {
  assert.match(migration, /idx_normalized_trainer_home_track_external/);
  assert.match(migration, /json_extract\(fields_json, '\$\.homeTrackExternalId'\)/);
  assert.match(migration, /WHERE entity_type = 'trainer' AND json_valid\(fields_json\)/);
});
