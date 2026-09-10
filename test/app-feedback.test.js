import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker-settings.js';
import { renderAppPage } from '../src/app-page-feedback.js';
import { friendlyRunName } from '../src/settings-data-display.js';
import { getEnhancedGameHistoryDetail } from '../src/routes/game-detail-display.js';
import { createTestEnv } from './helpers/d1.js';

test('settings uses understandable source labels and compact status symbols', () => {
  assert.equal(friendlyRunName('official_historical_race_normalize'), 'Historiska lopp & resultat');
  assert.equal(friendlyRunName('official_live_capture'), 'Kommande V85/V86');
  assert.equal(friendlyRunName('xlabs_telemetry_normalize'), 'X-Labs');

  const html = renderAppPage();
  assert.match(html, /working:'✓'/);
  assert.match(html, /error:'✕'/);
  assert.match(html, /\.status-pill\{[^}]*border:0!important/);
  assert.match(html, /hasDisplayValue/);
  assert.match(html, /Saknar verifierat positionsunderlag/);
  assert.match(html, /Förväntat:/);
  assert.match(html, /Faktisk loppbild: saknar verifierad helhetsbedömning/);
});

test('login and root redirects stay inside the installed PWA scope', async () => {
  const { env } = createTestEnv();
  env.APP_PASSWORD = 'synthetic-app-password-with-high-entropy';

  let response = await worker.fetch(new Request('https://example.test/'), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/');

  response = await worker.fetch(new Request('https://example.test/app/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: env.APP_PASSWORD })
  }), env);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/app/');
});

function seedRoundForRaceShape(db, {
  roundId = 'round-shape',
  raceId = 'race-shape',
  systemId = 'system-shape',
  modelVersionId,
  featureVersion,
  configJson,
  analysisId,
  marketBlind,
  analysisOrigin,
  raceShapeSummary
}) {
  db.prepare(`INSERT OR IGNORE INTO tracks (id, canonical_name) VALUES ('track-shape', 'Synthetic Park')`).run();
  db.prepare(`INSERT OR IGNORE INTO horses (id, canonical_name) VALUES ('horse-shape', 'Synthetic Winner')`).run();
  db.prepare(`INSERT OR IGNORE INTO game_rounds (id, game_type, round_date, status) VALUES (?, 'V85', '2099-05-01', 'results')`).run(roundId);
  db.prepare(`INSERT OR IGNORE INTO races (id, track_id, race_date, race_number, distance_m, start_method, status) VALUES (?, 'track-shape', '2099-05-01', 1, 2140, 'auto', 'results')`).run(raceId);
  db.prepare(`INSERT OR IGNORE INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, 1, ?)`).run(roundId, raceId);
  db.prepare(`INSERT OR IGNORE INTO race_entries (id, race_id, horse_id, start_number) VALUES ('entry-shape', ?, 'horse-shape', 1)`).run(raceId);
  db.prepare(`INSERT OR IGNORE INTO race_results (race_entry_id, placing, result_status) VALUES ('entry-shape', 1, 'official')`).run();
  db.prepare(`INSERT OR IGNORE INTO model_versions (id, created_at, feature_version, config_json) VALUES (?, '2099-05-01T10:00:00Z', ?, ?)`).run(modelVersionId, featureVersion, configJson);
  db.prepare(`INSERT OR IGNORE INTO ai_race_analyses (id, race_id, model_version_id, data_snapshot_at, market_blind, race_shape_summary, data_quality, created_at, analysis_origin) VALUES (?, ?, ?, '2099-05-01T10:00:00Z', ?, ?, 'sufficient', '2099-05-01T10:00:00Z', ?)`).run(analysisId, raceId, modelVersionId, marketBlind, raceShapeSummary, analysisOrigin);
  db.prepare(`INSERT OR IGNORE INTO systems (id, game_round_id, model_version_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES (?, ?, ?, 'main', 200, 1, 3, '2099-05-01T11:00:00Z')`).run(systemId, roundId, modelVersionId);
}

test('final system uses its pre-market parent race shape as the expected scenario', async () => {
  const { env, db } = createTestEnv();
  const roundId = 'round-analysis-exchange';
  const raceId = 'race-analysis-exchange';
  const preConfig = JSON.stringify({ analysisExchange: { submissionId: 'pre-1', roundId, stage: 'pre_market', parentSubmissionId: null } });
  const finalConfig = JSON.stringify({ analysisExchange: { submissionId: 'final-1', roundId, stage: 'final', parentSubmissionId: 'pre-1' } });

  db.prepare(`INSERT INTO tracks (id, canonical_name) VALUES ('track-shape', 'Synthetic Park')`).run();
  db.prepare(`INSERT INTO horses (id, canonical_name) VALUES ('horse-shape', 'Synthetic Winner')`).run();
  db.prepare(`INSERT INTO game_rounds (id, game_type, round_date, status) VALUES (?, 'V85', '2099-05-01', 'results')`).run(roundId);
  db.prepare(`INSERT INTO races (id, track_id, race_date, race_number, distance_m, start_method, status) VALUES (?, 'track-shape', '2099-05-01', 1, 2140, 'auto', 'results')`).run(raceId);
  db.prepare(`INSERT INTO game_legs (game_round_id, leg_number, race_id) VALUES (?, 1, ?)`).run(roundId, raceId);
  db.prepare(`INSERT INTO race_entries (id, race_id, horse_id, start_number) VALUES ('entry-shape', ?, 'horse-shape', 1)`).run(raceId);
  db.prepare(`INSERT INTO race_results (race_entry_id, placing, result_status) VALUES ('entry-shape', 1, 'official')`).run();
  db.prepare(`INSERT INTO model_versions (id, created_at, feature_version, config_json) VALUES ('mv-pre', '2099-05-01T09:00:00Z', 'analysis-exchange-v1', ?)`).run(preConfig);
  db.prepare(`INSERT INTO model_versions (id, created_at, feature_version, config_json) VALUES ('mv-final', '2099-05-01T11:00:00Z', 'analysis-exchange-v1', ?)`).run(finalConfig);
  db.prepare(`INSERT INTO ai_race_analyses (id, race_id, model_version_id, data_snapshot_at, market_blind, race_shape_summary, data_quality, created_at, analysis_origin) VALUES ('analysis-pre', ?, 'mv-pre', '2099-05-01T09:00:00Z', 1, 'Pre-market expected shape', 'sufficient', '2099-05-01T09:00:00Z', 'analysis_exchange')`).run(raceId);
  db.prepare(`INSERT INTO ai_race_analyses (id, race_id, model_version_id, data_snapshot_at, market_blind, race_shape_summary, data_quality, created_at, analysis_origin) VALUES ('analysis-final', ?, 'mv-final', '2099-05-01T11:00:00Z', 0, 'Market-influenced final shape', 'sufficient', '2099-05-01T11:00:00Z', 'analysis_exchange')`).run(raceId);
  db.prepare(`INSERT INTO systems (id, game_round_id, model_version_id, system_type, budget_sek, row_count, spike_count, created_at) VALUES ('system-final', ?, 'mv-final', 'main', 200, 1, 3, '2099-05-01T11:00:00Z')`).run(roundId);

  const detail = await getEnhancedGameHistoryDetail(env, roundId);
  assert.equal(detail.legs[0].systems['system-final'].expectedRaceShape, 'Pre-market expected shape');
});

test('reference system keeps its explicitly imported pre-race race shape', async () => {
  const { env, db } = createTestEnv();
  seedRoundForRaceShape(db, {
    modelVersionId: 'mv-reference',
    featureVersion: 'reference-v1',
    configJson: JSON.stringify({ imported: true }),
    analysisId: 'analysis-reference',
    marketBlind: 0,
    analysisOrigin: 'reference_import',
    raceShapeSummary: 'Reference pre-race expected shape'
  });

  const detail = await getEnhancedGameHistoryDetail(env, 'round-shape');
  assert.equal(detail.legs[0].systems['system-shape'].expectedRaceShape, 'Reference pre-race expected shape');
});

test('enhanced game detail fails closed for an unknown round', async () => {
  const { env } = createTestEnv();
  assert.equal(await getEnhancedGameHistoryDetail(env, 'missing-round'), null);
});
