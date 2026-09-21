import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acknowledgeSettingsAlerts,
  getSettingsAlertState,
  getSettingsSourceHealth
} from '../src/settings-source-health.js';
import { createTestEnv } from './helpers/d1.js';

const NOW = new Date('2099-09-21T20:00:00Z');

function insertOfficialHistorical(db, overrides = {}) {
  const row = {
    id: 'official-history',
    start_date: '2026-09-01',
    end_date: '2026-09-10',
    next_date: '2026-09-05',
    next_race_index: 2,
    status: 'running',
    processed_dates: 5,
    processed_races: 120,
    reused_races: 4,
    consecutive_errors: 0,
    last_error: null,
    last_run_at: '2099-09-21T19:59:00Z',
    ...overrides
  };
  db.prepare(`
    INSERT INTO historical_backfill_jobs (
      id,start_date,end_date,next_date,next_race_index,status,processed_dates,
      processed_races,reused_races,consecutive_errors,last_error,last_run_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.id,row.start_date,row.end_date,row.next_date,row.next_race_index,row.status,
    row.processed_dates,row.processed_races,row.reused_races,row.consecutive_errors,
    row.last_error,row.last_run_at
  );
}

function insertXlabsHistorical(db, overrides = {}) {
  const row = {
    id: 'xlabs-history',
    scope: 'historical_all',
    start_date: '2026-09-01',
    end_date: '2026-09-10',
    next_date: '2026-09-05',
    next_race_index: 1,
    status: 'running',
    processed_dates: 5,
    processed_races: 80,
    reused_races: 2,
    unavailable_dates: 1,
    unavailable_races: 3,
    consecutive_errors: 0,
    last_error: null,
    last_run_at: '2099-09-21T19:59:00Z',
    retry_after: null,
    ...overrides
  };
  db.prepare(`
    INSERT INTO xlabs_backfill_jobs (
      id,scope,start_date,end_date,next_date,next_race_index,status,processed_dates,
      processed_races,reused_races,unavailable_dates,unavailable_races,
      consecutive_errors,last_error,last_run_at,retry_after
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.id,row.scope,row.start_date,row.end_date,row.next_date,row.next_race_index,row.status,
    row.processed_dates,row.processed_races,row.reused_races,row.unavailable_dates,
    row.unavailable_races,row.consecutive_errors,row.last_error,row.last_run_at,row.retry_after
  );
}

test('persistent historical jobs drive source health and date progress without recent import rows', async () => {
  const { env, db } = createTestEnv();
  insertOfficialHistorical(db);

  const result = await getSettingsSourceHealth(env, { now: NOW });
  const official = result.sources.find((source) => source.id === 'official');
  const xlabs = result.sources.find((source) => source.id === 'xlabs');

  assert.equal(official.status, 'working');
  assert.equal(official.processing.status, 'running');
  assert.equal(official.processing.totalDates, 10);
  assert.equal(official.processing.processedDates, 5);
  assert.equal(official.processing.remainingDates, 5);
  assert.equal(official.processing.progressPercent, 50);
  assert.equal(official.processing.processedRaces, 120);
  assert.equal(xlabs.status, 'never_run');
  assert.equal(xlabs.processing.status, 'never_run');
});

test('X-Labs retry error is red-alert health while historical processing remains running', async () => {
  const { env, db } = createTestEnv();
  insertXlabsHistorical(db, {
    consecutive_errors: 1,
    last_error: 'Synthetic transient source failure',
    retry_after: '2099-09-21T20:05:00Z'
  });

  const result = await getSettingsSourceHealth(env, { now: NOW });
  const xlabs = result.sources.find((source) => source.id === 'xlabs');

  assert.equal(xlabs.status, 'error_retrying');
  assert.equal(xlabs.processing.status, 'running');
  assert.equal(xlabs.issue.label, 'Fel upptäckt · nytt försök pågår');
  assert.match(xlabs.issue.error, /Synthetic transient/);
  assert.equal(result.alerts.length, 1);
});

test('acknowledgement hides the badge for the same incident and escalation creates a new badge', async () => {
  const { env, db } = createTestEnv();
  insertXlabsHistorical(db, {
    consecutive_errors: 1,
    last_error: 'Synthetic retry failure',
    retry_after: '2099-09-21T20:05:00Z'
  });

  let alert = await getSettingsAlertState(env);
  assert.equal(alert.hasUnacknowledged, true);
  assert.equal(alert.unacknowledgedCount, 1);

  await acknowledgeSettingsAlerts(env);
  alert = await getSettingsAlertState(env);
  assert.equal(alert.hasActiveAlerts, true);
  assert.equal(alert.hasUnacknowledged, false);

  db.prepare(`
    UPDATE xlabs_backfill_jobs
    SET consecutive_errors=2,last_error='Synthetic retry failure again',
        last_run_at='2099-09-21T20:01:00Z',retry_after='2099-09-21T20:06:00Z'
    WHERE id='xlabs-history'
  `).run();
  alert = await getSettingsAlertState(env);
  assert.equal(alert.hasUnacknowledged, false);

  db.prepare(`
    UPDATE xlabs_backfill_jobs
    SET status='failed',consecutive_errors=3,last_error='Synthetic terminal failure',
        last_run_at='2099-09-21T20:02:00Z'
    WHERE id='xlabs-history'
  `).run();
  alert = await getSettingsAlertState(env);
  assert.equal(alert.hasUnacknowledged, true);
  assert.equal(alert.unacknowledgedCount, 1);
});

test('resolved incidents clear acknowledgement state so a later same-checkpoint error is new', async () => {
  const { env, db } = createTestEnv();
  insertXlabsHistorical(db, {
    consecutive_errors: 1,
    last_error: 'Synthetic first incident',
    retry_after: '2099-09-21T20:05:00Z'
  });
  await acknowledgeSettingsAlerts(env);

  db.prepare(`
    UPDATE xlabs_backfill_jobs
    SET consecutive_errors=0,last_error=NULL,retry_after=NULL,last_run_at='2099-09-21T20:03:00Z'
    WHERE id='xlabs-history'
  `).run();
  let alert = await getSettingsAlertState(env);
  assert.equal(alert.hasActiveAlerts, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM settings_alert_acknowledgements').get().n, 0);

  db.prepare(`
    UPDATE xlabs_backfill_jobs
    SET consecutive_errors=1,last_error='Synthetic second incident',
        retry_after='2099-09-21T20:10:00Z',last_run_at='2099-09-21T20:04:00Z'
    WHERE id='xlabs-history'
  `).run();
  alert = await getSettingsAlertState(env);
  assert.equal(alert.hasUnacknowledged, true);
});

test('completed historical job reports 100 percent and Klar processing state', async () => {
  const { env, db } = createTestEnv();
  insertOfficialHistorical(db, {
    next_date: '2026-08-31',
    next_race_index: 0,
    status: 'completed',
    processed_dates: 10,
    last_run_at: '2099-09-21T19:59:00Z'
  });

  const result = await getSettingsSourceHealth(env, { now: NOW });
  const official = result.sources.find((source) => source.id === 'official');
  assert.equal(official.processing.status, 'completed');
  assert.equal(official.processing.progressPercent, 100);
});
