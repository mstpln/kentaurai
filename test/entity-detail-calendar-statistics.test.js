import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  getCalendarYearDetailStatistics,
  getDriverCalendarYearDetailStatistics,
  getHorseCalendarYearDetailStatistics,
  getTrainerCalendarYearDetailStatistics
} from '../src/entity-detail-calendar-statistics.js';
import { getTrainerCalendarHomeTrackResults } from '../src/trainer-calendar-home-statistics.js';
import worker from '../src/worker-v065.js';

test('shared calendar statistics exports one implementation for all supported detail entities', () => {
  assert.equal(typeof getCalendarYearDetailStatistics, 'function');
  assert.equal(typeof getTrainerCalendarYearDetailStatistics, 'function');
  assert.equal(typeof getDriverCalendarYearDetailStatistics, 'function');
  assert.equal(typeof getHorseCalendarYearDetailStatistics, 'function');
  assert.equal(typeof getTrainerCalendarHomeTrackResults, 'function');
});

test('entity calendar configuration preserves entity-specific form and specialist behavior', async () => {
  const source = await readFile(new URL('../src/entity-detail-calendar-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /trainers:\{table:'trainers',entryColumn:'trainer_id',resultKey:'trainer',formLimit:30,market:true,rest:true,volt:true\}/);
  assert.match(source, /drivers:\{table:'drivers',entryColumn:'driver_id',resultKey:'driver',formLimit:30,market:true,rest:false,volt:true\}/);
  assert.match(source, /horses:\{table:'horses',entryColumn:'horse_id',resultKey:'horse',formLimit:10,market:false,rest:true,volt:false\}/);
  assert.match(source, /voltLaneGood:\[1,6,7\]/);
});

test('calendar filtering uses YTD for the current year and closed full-year windows for prior years', async () => {
  const source = await readFile(new URL('../src/entity-detail-calendar-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /if\(filters\.year===currentYear\)\{conditions\.push\(`\$\{raceAlias\}\.race_date <= \?`\);bindings\.push\(filters\.asOfDate\);\}/);
  assert.match(source, /bindings\.push\(`\$\{filters\.year\+1\}-01-01`\)/);
});

test('trainer calendar detail preserves verified home-track and other-track summaries with active filters', async () => {
  const source = await readFile(new URL('../src/trainer-calendar-home-statistics.js', import.meta.url), 'utf8');
  assert.match(source, /normalized_observations/);
  assert.match(source, /source_type='official_provider'/);
  assert.match(source, /homeTrackExternalId/);
  assert.match(source, /addFilters\(conditions, bindings, filters\)/);
  assert.match(source, /homeTrackResults/);
  assert.match(source, /otherTrackResults/);
  assert.match(source, /filters\.year === currentYear/);
  assert.match(source, /re\.actual_lane IN \(1,6,7\)/);
});

test('worker enriches only trainer calendar detail with verified home-track summaries', async () => {
  const source = await readFile(new URL('../src/worker-v065.js', import.meta.url), 'utf8');
  assert.match(source, /getTrainerCalendarHomeTrackResults/);
  assert.match(source, /entityType !== 'trainers'/);
  assert.match(source, /return \{ \.\.\.data, \.\.\.home \}/);
});

test('new calendar detail routes remain private before touching D1', async () => {
  for (const page of ['trainers', 'drivers', 'horses']) {
    const response = await worker.fetch(new Request(`https://example.test/app/api/${page}/example/calendar-statistics?year=2026`), {}, {});
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'service_unavailable' });
  }
});

test('v065 only adds detail routes and horse filter options while leaving track and game routing delegated', async () => {
  const source = await readFile(new URL('../src/worker-v065.js', import.meta.url), 'utf8');
  assert.match(source, /\(trainers\|drivers\|horses\)/);
  assert.match(source, /\/app\/api\/horses\/statistics\/filter-options/);
  assert.doesNotMatch(source, /calendarHandlers\s*=\s*\{[^}]*tracks/s);
  assert.doesNotMatch(source, /calendarHandlers\s*=\s*\{[^}]*games/s);
});
